-- 阶段 6：寄 Email（Gmail SMTP）+ 每天会议截止提醒
-- 流程：各功能把信排进 email_outbox（同一交易）→ pg_cron 每分钟看有没有待寄的信，有就叫 Edge Function「send-email」
--       → send-email 用 service role 呼叫 claim_email_batch 领一批 → 用 Gmail（465 埠）寄出 → finish_email 记结果。
-- Gmail 账号和应用程式密码只放在 Edge Function 的 Secrets（用户自己在 Supabase 设定），不在资料库、不在 repo。
-- 这个档案不用任何删除类的指令（Supabase 会要求确认，用户在手机上看不到确认框）。

alter table public.email_outbox add column locked_until timestamptz;   -- 寄信程序领走后暂时锁住，避免重复寄
alter table public.email_outbox add column recipients int generated always as (cardinality(to_emails) + cardinality(cc_emails)) stored;

-- 每个环境自己的设定（不是秘密）：后台网址、Edge Function 网址、公开的 API key
insert into public.app_settings (key, value, note) values
  ('app_url', '""'::jsonb, 'Email 里「打开播青后台」按钮的网址'),
  ('functions_url', '""'::jsonb, 'Edge Functions 网址（https://<专案>.supabase.co/functions/v1）'),
  ('public_api_key', '""'::jsonb, 'publishable / anon key（本来就公开，给 pg_cron 呼叫 Edge Function 用）'),
  ('email_daily_limit', '450'::jsonb, '每 24 小时最多寄给几位收件人（Gmail 个人账号约 500）')
on conflict (key) do nothing;

create or replace function private.setting(p_key text) returns text
language sql stable set search_path = '' as $$ select value #>> '{}' from public.app_settings where key = p_key $$;

/* ---------- 给寄信程序（service role）用 ---------- */

-- 领一批待寄的信（锁 5 分钟）；超过每日额度就先不领，留到之后再寄
create or replace function public.claim_email_batch(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_limit int := coalesce(nullif(private.setting('email_daily_limit'), '')::int, 450);
        v_used int; v_left int; v_rows jsonb := '[]'::jsonb; r public.email_outbox; v_taken int := 0;
begin
  select coalesce(sum(recipients), 0) into v_used from public.email_outbox where status = 'SENT' and sent_at > now() - interval '24 hours';
  v_left := v_limit - v_used;
  for r in select * from public.email_outbox
            where status = 'PENDING' and (locked_until is null or locked_until < now())
            order by created_at, id limit greatest(1, least(coalesce(p_limit, 20), 50))
            for update skip locked loop
    if r.recipients > v_left then exit; end if;   -- 额度不够：这封和之后的都留到明天
    v_left := v_left - r.recipients;
    update public.email_outbox set locked_until = now() + interval '5 minutes', attempts = attempts + 1 where id = r.id;
    v_rows := v_rows || jsonb_build_object('id', r.id, 'to', to_jsonb(r.to_emails), 'cc', to_jsonb(r.cc_emails),
                                            'subject', r.subject, 'lines', to_jsonb(r.lines), 'hideButton', r.hide_button);
    v_taken := v_taken + 1;
  end loop;
  return jsonb_build_object('appUrl', coalesce(private.setting('app_url'), ''), 'emails', v_rows,
                            'quotaLeft', v_left, 'quotaFull', v_taken = 0 and exists (select 1 from public.email_outbox where status = 'PENDING'));
end $$;

-- 记录寄信结果：成功 → SENT；失败 → 之后再试，试 5 次还不行就 FAILED
create or replace function public.finish_email(p_id bigint, p_ok boolean, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.email_outbox set
    status = case when p_ok then 'SENT' when attempts >= 5 then 'FAILED' else 'PENDING' end,
    sent_at = case when p_ok then now() else sent_at end,
    error = case when p_ok then null else left(coalesce(p_error, ''), 500) end,
    locked_until = case when p_ok then locked_until else now() + interval '2 minutes' end
  where id = p_id
$$;

revoke all on function public.claim_email_batch(int) from public, anon, authenticated;
revoke all on function public.finish_email(bigint, boolean, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_email_batch(int) to service_role;
    grant execute on function public.finish_email(bigint, boolean, text) to service_role;
  end if;
end $$;

/* ---------- 测试信（旧版 testEmail）：管理员寄一封测试信给自己 ---------- */
create or replace function public.queue_test_email() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff();
begin
  if not private.is_admin(s) then raise exception '只有管理员可以寄测试信。' using errcode = '42501'; end if;
  perform private.notify(array[s ->> 'email'], '{}', '测试信',
    array['这是一封测试信。', '', '收到这封信，表示系统可以寄出 Email 了。', '寄出时间会比按下按钮晚一两分钟，这是正常的。']);
  return jsonb_build_object('success', true, 'message', '测试信已排进队列，一两分钟内会寄到 ' || (s ->> 'email') || '。');
end $$;
revoke all on function public.queue_test_email() from public, anon;
grant execute on function public.queue_test_email() to authenticated;

/* ---------- 每天早上 9 点：会议报告截止前 3 天，提醒还没提交的组（旧版 sendMeetingDeadlineReminders） ---------- */
create or replace function private.send_meeting_deadline_reminders() returns int
language plpgsql set search_path = '' as $$
declare m public.ministry_meetings; g text; v_st text; v_emails text[]; v_count int := 0;
begin
  for m in select * from public.ministry_meetings
            where report_deadline = private.today() + 3 and status not in ('报告已生成', '已完成') loop
    foreach g in array private.ministry_groups() loop
      select coalesce((select status from public.ministry_submissions where year = m.year and meeting_no = m.meeting_no and grp = g), '未提交') into v_st;
      if v_st in ('已提交', '已确认') then continue; end if;
      v_emails := private.emails_by_group(g);
      if cardinality(v_emails) = 0 then continue; end if;
      perform private.notify(v_emails, '{}', g || '：第' || m.meeting_no || '次会议报告 3 天后截止',
        array['提醒 ' || g || '：', '', m.year || ' 年第 ' || m.meeting_no || ' 次会议（' || m.meeting_type || '）的报告将在 ' ||
              to_char(m.report_deadline, 'YYYY-MM-DD') || ' 截止。', '目前状态：' || v_st, '', '请到后台「事工管理」更新事工资料，然后按「提交本组报告」。']);
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end $$;

/* ---------- 有待寄的信才叫寄信程序（pg_cron 每分钟跑） ---------- */
create or replace function private.kick_email_sender() returns void
language plpgsql set search_path = '' as $$
declare v_url text := private.setting('functions_url'); v_key text := private.setting('public_api_key');
begin
  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then return; end if;
  if not exists (select 1 from public.email_outbox where status = 'PENDING' and (locked_until is null or locked_until < now())) then return; end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 60000)'
    using v_url || '/send-email', jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key, 'apikey', v_key), '{}'::jsonb;
end $$;

-- 排程（只在 Supabase 上：本地测试的 Postgres 没有 pg_cron / pg_net）
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
    perform cron.schedule('pmc-send-email', '* * * * *', 'select private.kick_email_sender()');
    perform cron.schedule('pmc-meeting-reminders', '1 1 * * *', 'select private.send_meeting_deadline_reminders()');   -- 01:01 UTC = 马来西亚 09:01
  end if;
end $$;
