-- 阶段 5：事工管理、会议、组别提交、会议报告资料、议案首页、财政报告签名、报告存档
-- 规格来源：legacy/gas/src/MinistryBackend.gs
-- 报告的整理和 Word 组装在浏览器做（web/js/reports.js，沿用旧版程式码）；这里只负责权限和资料。
-- 这个档案不用任何删除类的指令（Supabase 会要求确认，用户在手机上看不到确认框）。

/* ============================================================
   资料表
   ============================================================ */

create table public.ministry_meetings (
  id text primary key,                         -- MTG-2026-01
  year int not null check (year between 2000 and 2100),
  meeting_no int not null check (meeting_no between 1 and 4),
  meeting_type text not null default '',
  meeting_date date,
  status text not null default '未开始',
  report_deadline date,
  report_doc_path text not null default '',
  report_doc_url text not null default '',     -- 旧资料的外部链接
  report_pdf_url text not null default '',
  generated_at timestamptz,
  remark text not null default '',
  cover jsonb,                                 -- 议案首页（null = 用预设）
  unique (year, meeting_no)
);
alter table public.ministry_meetings enable row level security;

create sequence public.ministry_code_seq;
create table public.ministries (
  id text primary key default ('MIN-' || lpad(nextval('public.ministry_code_seq')::text, 4, '0')),
  year int not null,
  grp text not null,
  category text not null,
  serial text not null default '',
  name text not null,
  purpose text not null default '',
  method text not null default '',
  target text not null default '',
  planned_date date,
  budget numeric(12, 2),
  pic text not null default '',
  event_id text not null default '',
  status text not null default '计划中',
  sort_order numeric,
  remark text not null default '',
  created_by text not null default '',
  updated_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ministries enable row level security;
create index ministries_year_grp on public.ministries (year, grp);

create sequence public.ministry_update_code_seq;
create table public.ministry_updates (
  id text primary key default ('UPD-' || lpad(nextval('public.ministry_update_code_seq')::text, 4, '0')),
  ministry_id text not null references public.ministries (id),
  year int not null,
  meeting_no int not null check (meeting_no between 1 and 4),
  grp text not null default '',
  status text not null default '',
  date_changed text not null default '否',
  new_date date,
  method_changed text not null default '否',
  current_method text not null default '',
  progress text not null default '',
  result text not null default '',
  attendance numeric,
  budget_changed text not null default '否',
  new_budget numeric(12, 2),
  expense numeric(12, 2),
  next_step text not null default '',
  attachment_url text not null default '',
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  unique (ministry_id, meeting_no)
);
alter table public.ministry_updates enable row level security;

create sequence public.ministry_stat_code_seq;
create table public.ministry_stats (
  id text primary key default ('STAT-' || lpad(nextval('public.ministry_stat_code_seq')::text, 4, '0')),
  ministry_id text not null references public.ministries (id),
  year int not null,
  meeting_no int not null check (meeting_no between 1 and 4),
  stat_date date,
  item text not null,
  value numeric,
  unit text not null default '',
  remark text not null default '',
  created_at timestamptz not null default now()
);
alter table public.ministry_stats enable row level security;

create sequence public.ministry_sub_code_seq;
create table public.ministry_submissions (
  id text primary key default ('SUB-' || lpad(nextval('public.ministry_sub_code_seq')::text, 4, '0')),
  year int not null,
  meeting_no int not null check (meeting_no between 1 and 4),
  grp text not null,
  status text not null check (status in ('已提交', '已退回', '已确认', '未提交')),
  submitted_by text not null default '',
  submitted_at timestamptz,
  note text not null default '',
  updated_at timestamptz not null default now(),
  unique (year, meeting_no, grp)
);
alter table public.ministry_submissions enable row level security;

-- 每一期财政报告的签名（小 PNG，存成 data URL；空字串 = 拿掉签名）
create table public.finance_signatures (
  year int not null,
  month int not null check (month between 1 and 12),
  key text not null check (key in ('treasurer', 'auditor')),
  data_url text not null default '',
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  primary key (year, month, key)
);
alter table public.finance_signatures enable row level security;

-- 存档的报告：Word 档也记在会议记录里
alter table public.meeting_docs add column word_path text not null default '';
alter table public.meeting_docs add column saved_by text not null default '';

/* ============================================================
   内部工具
   ============================================================ */

create or replace function private.ministry_categories() returns text[]
language sql immutable set search_path = '' as $$ select array['牧区青团事工', '聚会', '教区 & 年会青团事工'] $$;

create or replace function private.meeting_type(n int) returns text
language sql immutable set search_path = '' as $$
  select (array['年度策划会议', '第一次进度会议', '第二次进度会议', '年度总结会议'])[n]
$$;

create or replace function private.num_or_blank(v numeric) returns jsonb
language sql immutable set search_path = '' as $$ select case when v is null then to_jsonb(''::text) else to_jsonb(v) end $$;

create or replace function private.parse_num(v text) returns numeric
language plpgsql immutable set search_path = '' as $$
begin
  if v is null or btrim(v) = '' then return null; end if;
  return replace(btrim(v), ',', '')::numeric;
exception when others then return null;
end $$;

-- 文书 / 管理员（旧版 ministryIsOffice_）
create or replace function private.is_office(s jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(not (s ->> 'readOnly')::boolean and (s ->> 'role' in ('管理员', '文书') or s ->> 'group' = '文书'), false)
$$;

-- 自己的事工组别（六组之一，否则空白）
create or replace function private.user_group(s jsonb) returns text
language sql immutable set search_path = '' as $$
  select case when private.norm_group(s ->> 'group') = any (private.ministry_groups()) then private.norm_group(s ->> 'group') else '' end
$$;

create or replace function private.require_view_group(s jsonb, p_group text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if private.is_office(s) then return; end if;
  if private.user_group(s) = '' then raise exception '你在这一届还没有组别任期，请联系管理员。' using errcode = '42501'; end if;
  if private.user_group(s) <> private.norm_group(p_group) then raise exception '你不能查看其他组的事工。' using errcode = '42501'; end if;
end $$;

-- 改：看得到 + 以前年份的资料只有管理员可以改
create or replace function private.require_edit_group(s jsonb, p_group text, p_year int) returns void
language plpgsql stable set search_path = '' as $$
begin
  perform private.require_view_group(s, p_group);
  if p_year is not null and p_year < private.current_year() and s ->> 'role' <> '管理员' then
    raise exception '% 年的资料属于上一届，已锁定为只读。如需修改请联系管理员。', p_year using errcode = '42501';
  end if;
end $$;

create or replace function private.require_office(s jsonb) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if not private.is_office(s) then raise exception '只有文书或管理员可以执行这个操作。' using errcode = '42501'; end if;
end $$;

create or replace function private.ensure_meetings(p_year int) returns void
language sql set search_path = '' as $$
  insert into public.ministry_meetings (id, year, meeting_no, meeting_type)
  select 'MTG-' || p_year || '-' || lpad(n::text, 2, '0'), p_year, n, private.meeting_type(n) from generate_series(1, 4) n
  on conflict (year, meeting_no) do nothing
$$;

create or replace function private.meeting_json(m public.ministry_meetings) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('会议编号', m.id, '年份', m.year, '会议次数', m.meeting_no, '会议类型', m.meeting_type,
    '会议日期', private.d_admin(m.meeting_date), '状态', m.status, '报告截止日期', private.d_admin(m.report_deadline),
    '报告Doc路径', m.report_doc_path, '报告Doc链接', m.report_doc_url, '报告PDF链接', m.report_pdf_url,
    '报告文件ID', '', '报告PDF文件ID', '', '生成时间', private.ts_admin(m.generated_at), '备注', m.remark)
$$;

create or replace function private.ministry_json(m public.ministries) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('事工编号', m.id, '年份', m.year, '组别', m.grp, '类别', m.category, '序号', m.serial, '事工名称', m.name,
    '目的', m.purpose, '进行方式', m.method, '目标/指标', m.target, '计划日期', private.d_admin(m.planned_date),
    '计划时间', private.d_admin(m.planned_date), '预算', private.num_or_blank(m.budget), '负责人', m.pic,
    '节目编号', m.event_id, '关联节目编号', m.event_id, '状态', m.status, '排序', private.num_or_blank(m.sort_order), '备注', m.remark,
    '建立者', m.created_by, '更新者', m.updated_by, '建立时间', private.ts_admin(m.created_at), '更新日期', private.ts_admin(m.updated_at))
$$;

create or replace function private.ministry_update_json(u public.ministry_updates) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('更新编号', u.id, '事工编号', u.ministry_id, '年份', u.year, '会议次数', u.meeting_no, '组别', u.grp,
    '状态', u.status, '日期变更', u.date_changed, '新日期', private.d_admin(u.new_date), '进行方式变更', u.method_changed,
    '本次进行方式', u.current_method, '本次进度', u.progress, '本次结果', u.result, '参与人数', private.num_or_blank(u.attendance),
    '本次预算调整', u.budget_changed, '新预算', private.num_or_blank(u.new_budget), '本次支出', private.num_or_blank(u.expense),
    '下一步', u.next_step, '附件链接', u.attachment_url, '更新人', u.updated_by, '更新时间', private.ts_admin(u.updated_at))
$$;

create or replace function private.ministry_stat_json(t public.ministry_stats) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('统计编号', t.id, '事工编号', t.ministry_id, '年份', t.year, '统计日期', private.d_admin(t.stat_date),
    '统计项目', t.item, '数值', private.num_or_blank(t.value), '单位', t.unit, '备注', t.remark, '会议次数', t.meeting_no)
$$;

create or replace function private.submission_json(x public.ministry_submissions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('提交编号', x.id, '年份', x.year, '会议次数', x.meeting_no, '组别', x.grp, '状态', x.status,
    '提交人', x.submitted_by, '提交时间', private.ts_admin(x.submitted_at), '文书备注', x.note, '更新时间', private.ts_admin(x.updated_at))
$$;

-- 那一年各组的职员（在任 / 已卸任），「、」分隔（旧版 ministryGetAllGroupStaff_）
create or replace function private.group_staff(p_year int) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(g, names), '{}'::jsonb) from (
    select g, string_agg(name, '、' order by first_at) names from (
      select private.norm_group(t.grp) g, t.name, min(t.created_at) first_at from public.terms t
       where t.year = p_year and t.status in ('在任', '已卸任') and btrim(t.name) <> '' and btrim(t.grp) <> ''
       group by 1, 2) a group by g) b
$$;

-- 那一年的职位 → 人名，以及全部人名（旧版 rptStaffByRole_）
create or replace function private.staff_roles(p_year int) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'roles', coalesce((select jsonb_object_agg(role, name) from (
               select distinct on (role) role, name from public.terms
                where year = p_year and status in ('在任', '已卸任') and btrim(name) <> '' and btrim(role) <> ''
                order by role, created_at) r), '{}'::jsonb),
    'all', coalesce((select jsonb_agg(name order by first_at) from (
               select name, min(created_at) first_at from public.terms
                where year = p_year and status in ('在任', '已卸任') and btrim(name) <> '' group by name) a), '[]'::jsonb))
$$;

create or replace function private.ministry_next_serial(p_year int, p_group text) returns text
language sql stable set search_path = '' as $$
  select greatest(array_position(private.ministry_groups(), p_group), 1) || '.' ||
         (coalesce(max((substring(serial from '\.(\d+)$'))::int), 0) + 1)
    from public.ministries where year = p_year and grp = p_group
$$;

/* ============================================================
   会议
   ============================================================ */

create or replace function public.save_ministry_meeting(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); v_year int := (p_data ->> 'year')::int; v_no int := (p_data ->> 'meetingNo')::int; v_id text;
begin
  perform private.require_office(s);
  if v_year is null or v_no is null or v_no not between 1 and 4 then raise exception '会议年份或次数不正确。'; end if;
  perform private.ensure_meetings(v_year);
  v_id := 'MTG-' || v_year || '-' || lpad(v_no::text, 2, '0');
  update public.ministry_meetings set
    meeting_type = coalesce(nullif(private.clip(p_data ->> 'meetingType', 40), ''), private.meeting_type(v_no)),
    meeting_date = private.parse_date(p_data ->> 'meetingDate'),
    status = coalesce(nullif(private.clip(p_data ->> 'status', 20), ''), '未开始'),
    report_deadline = private.parse_date(p_data ->> 'reportDeadline'),
    remark = left(coalesce(p_data ->> 'remark', ''), 500)
  where id = v_id;
  perform private.log(s, '更新事工会议', '会议', v_id, v_year || '年第' || v_no || '次会议');
  return jsonb_build_object('success', true, 'meetingId', v_id);
end $$;

/* ============================================================
   事工资料（各组只看自己组；文书 / 管理员看全部）
   ============================================================ */

create or replace function public.get_ministry_system_data(p_year int, p_meeting_no int) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s jsonb := private.session(); v_office boolean := private.is_office(s); v_group text := private.user_group(s);
  v_year int := coalesce(nullif(p_year, 0), extract(year from private.today())::int); v_no int := coalesce(nullif(p_meeting_no, 0), 1);
  v_ids text[];
begin
  if v_no not between 1 and 4 then raise exception '会议次数必须是 1 至 4。'; end if;
  select coalesce(array_agg(id), '{}') into v_ids from public.ministries where year = v_year and (v_office or grp = v_group);
  return jsonb_build_object(
    'success', true, 'year', v_year, 'meetingNo', v_no,
    'user', jsonb_build_object('name', s ->> 'name', 'role', s ->> 'role', 'group', v_group, 'isOffice', v_office),
    'groups', to_jsonb(private.ministry_groups()), 'categories', to_jsonb(private.ministry_categories()),
    'meetings', (select coalesce(jsonb_agg(private.meeting_json(m) order by m.meeting_no), '[]'::jsonb) from public.ministry_meetings m where m.year = v_year),
    'ministries', (select coalesce(jsonb_agg(private.ministry_json(m) order by m.id), '[]'::jsonb) from public.ministries m where m.id = any (v_ids)),
    'updates', (select coalesce(jsonb_agg(private.ministry_update_json(u) order by u.id), '[]'::jsonb) from public.ministry_updates u where u.year = v_year and u.ministry_id = any (v_ids)),
    'stats', (select coalesce(jsonb_agg(private.ministry_stat_json(t) order by t.id), '[]'::jsonb) from public.ministry_stats t where t.year = v_year and t.ministry_id = any (v_ids)),
    'submissions', (select coalesce(jsonb_agg(private.submission_json(x) order by x.id), '[]'::jsonb) from public.ministry_submissions x
                     where x.year = v_year and (v_office or x.grp = v_group)),
    -- 节目：有关联事工的节目带上「事工编号」；看得到的事工或自己组负责的节目才回传
    'events', (select coalesce(jsonb_agg(j order by d nulls last, i), '[]'::jsonb) from (
                 select private.event_json(e) || case when lk.mid is not null then jsonb_build_object('事工编号', lk.mid) else '{}'::jsonb end j,
                        e.date d, e.id i, lk.mid
                   from public.events e
                   left join lateral (select m.id mid from public.ministries m, regexp_split_to_table(m.event_id, '[;,；、\n]+') x
                                       where m.year = v_year and m.id = any (v_ids) and btrim(x) = e.id limit 1) lk on true) z
                where case when z.mid is not null then true else v_office or (select grp from public.events where id = z.i) = v_group end));
end $$;

create or replace function public.save_ministry_plan(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s jsonb := private.require_staff(); m public.ministries; v_year int := (p_data ->> 'year')::int;
  v_group text := private.norm_group(p_data ->> 'group'); v_cat text := btrim(coalesce(p_data ->> 'category', ''));
  v_id text := nullif(btrim(coalesce(p_data ->> 'ministryId', '')), ''); v_new boolean := false;
begin
  if v_year is null then raise exception '年份不能为空。'; end if;
  if not (v_group = any (private.ministry_groups())) then raise exception '组别不正确。'; end if;
  if not (v_cat = any (private.ministry_categories())) then raise exception '类别不正确。'; end if;
  if private.clip(p_data ->> 'name', 200) = '' then raise exception '请填写事工名称。'; end if;
  perform private.require_edit_group(s, v_group, v_year);
  if v_id is not null then
    select * into m from public.ministries where id = v_id for update;
    if not found then raise exception '找不到这个事工。'; end if;
    perform private.require_edit_group(s, m.grp, m.year);   -- 原本那一组也要有权限
  else
    perform pg_advisory_xact_lock(hashtext('ministry_serial'), v_year);
    insert into public.ministries (year, grp, category, name, serial, created_by)
    values (v_year, v_group, v_cat, private.clip(p_data ->> 'name', 200),
            coalesce(nullif(private.clip(p_data ->> 'serial', 20), ''), private.ministry_next_serial(v_year, v_group)), s ->> 'name')
    returning * into m;
    v_new := true;
  end if;
  update public.ministries set year = v_year, grp = v_group, category = v_cat,
    serial = case when v_new then serial else private.clip(p_data ->> 'serial', 20) end,
    name = private.clip(p_data ->> 'name', 200), purpose = left(coalesce(p_data ->> 'purpose', ''), 4000),
    method = left(coalesce(p_data ->> 'method', ''), 4000), target = left(coalesce(p_data ->> 'target', ''), 2000),
    planned_date = private.parse_date(p_data ->> 'plannedDate'), budget = private.parse_num(p_data ->> 'budget'),
    pic = private.clip(p_data ->> 'pic', 200), event_id = private.clip(p_data ->> 'eventId', 200),
    status = coalesce(nullif(private.clip(p_data ->> 'status', 20), ''), '计划中'), sort_order = private.parse_num(p_data ->> 'sortOrder'),
    remark = left(coalesce(p_data ->> 'remark', ''), 2000), updated_by = s ->> 'name', updated_at = now()
  where id = m.id returning * into m;
  perform private.log(s, case when v_new then '新增事工' else '更新事工' end, '事工', m.id, m.grp || '｜' || m.name);
  return jsonb_build_object('success', true, 'ministryId', m.id, 'ministry', private.ministry_json(m),
                            'message', case when v_new then '事工已建立。' else '事工已更新。' end);
end $$;

create or replace function public.save_ministry_update(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); m public.ministries; u public.ministry_updates;
        v_year int := (p_data ->> 'year')::int; v_no int := (p_data ->> 'meetingNo')::int;
begin
  if coalesce(p_data ->> 'ministryId', '') = '' then raise exception '缺少事工编号。'; end if;
  if v_year is null or v_no is null or v_no not between 1 and 4 then raise exception '年份或会议次数不正确。'; end if;
  select * into m from public.ministries where id = p_data ->> 'ministryId';
  if not found then raise exception '找不到这个事工。'; end if;
  if m.year <> v_year then raise exception '事工年份不一致。'; end if;
  perform private.require_edit_group(s, m.grp, m.year);
  insert into public.ministry_updates (ministry_id, year, meeting_no, grp, status, date_changed, new_date, method_changed, current_method,
    progress, result, attendance, budget_changed, new_budget, expense, next_step, attachment_url, updated_by, updated_at)
  values (m.id, v_year, v_no, m.grp, private.clip(p_data ->> 'status', 40), coalesce(nullif(p_data ->> 'dateChanged', ''), '否'),
    private.parse_date(p_data ->> 'newDate'), coalesce(nullif(p_data ->> 'methodChanged', ''), '否'), left(coalesce(p_data ->> 'currentMethod', ''), 4000),
    left(coalesce(p_data ->> 'progress', ''), 4000), left(coalesce(p_data ->> 'result', ''), 8000), private.parse_num(p_data ->> 'attendance'),
    coalesce(nullif(p_data ->> 'budgetChanged', ''), '否'), private.parse_num(p_data ->> 'newBudget'), private.parse_num(p_data ->> 'expense'),
    left(coalesce(p_data ->> 'nextStep', ''), 4000), left(coalesce(p_data ->> 'attachmentUrl', ''), 1000), s ->> 'name', now())
  on conflict (ministry_id, meeting_no) do update set status = excluded.status, date_changed = excluded.date_changed,
    new_date = excluded.new_date, method_changed = excluded.method_changed, current_method = excluded.current_method,
    progress = excluded.progress, result = excluded.result, attendance = excluded.attendance, budget_changed = excluded.budget_changed,
    new_budget = excluded.new_budget, expense = excluded.expense, next_step = excluded.next_step, attachment_url = excluded.attachment_url,
    updated_by = excluded.updated_by, updated_at = now()
  returning * into u;
  perform private.log(s, '保存事工会议更新', '事工更新', u.id, '第' || v_no || '次会议｜' || m.name);
  return jsonb_build_object('success', true, 'updateId', u.id, 'message', '本次会议更新已保存。');
end $$;

create or replace function public.get_ministry_history(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := private.session(); m public.ministries;
begin
  select * into m from public.ministries where id = p_id;
  if not found then raise exception '找不到这个事工。'; end if;
  perform private.require_view_group(s, m.grp);
  return jsonb_build_object('success', true, 'ministry', private.ministry_json(m),
    'updates', (select coalesce(jsonb_agg(private.ministry_update_json(u) order by u.meeting_no), '[]'::jsonb) from public.ministry_updates u where u.ministry_id = m.id),
    'stats', (select coalesce(jsonb_agg(private.ministry_stat_json(t) order by t.stat_date nulls first, t.id), '[]'::jsonb) from public.ministry_stats t where t.ministry_id = m.id));
end $$;

create or replace function public.save_ministry_stat(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); m public.ministries; t public.ministry_stats;
        v_year int := (p_data ->> 'year')::int; v_no int := (p_data ->> 'meetingNo')::int; v_id text := nullif(btrim(coalesce(p_data ->> 'statId', '')), '');
begin
  if coalesce(p_data ->> 'ministryId', '') = '' or v_year is null or v_no is null or v_no not between 1 and 4 then raise exception '统计资料缺少必要资料。'; end if;
  select * into m from public.ministries where id = p_data ->> 'ministryId';
  if not found then raise exception '找不到这个事工。'; end if;
  perform private.require_edit_group(s, m.grp, m.year);
  if m.year <> v_year then raise exception '年份不一致。'; end if;
  if private.clip(p_data ->> 'item', 200) = '' then raise exception '请填写统计项目。'; end if;
  if v_id is not null then
    select * into t from public.ministry_stats where id = v_id and ministry_id = m.id for update;
    if not found then raise exception '找不到统计记录。'; end if;
    update public.ministry_stats set meeting_no = v_no, stat_date = private.parse_date(p_data ->> 'date'), item = private.clip(p_data ->> 'item', 200),
           value = private.parse_num(p_data ->> 'value'), unit = private.clip(p_data ->> 'unit', 40), remark = left(coalesce(p_data ->> 'remark', ''), 500)
     where id = t.id returning * into t;
  else
    insert into public.ministry_stats (ministry_id, year, meeting_no, stat_date, item, value, unit, remark)
    values (m.id, v_year, v_no, private.parse_date(p_data ->> 'date'), private.clip(p_data ->> 'item', 200), private.parse_num(p_data ->> 'value'),
            private.clip(p_data ->> 'unit', 40), left(coalesce(p_data ->> 'remark', ''), 500))
    returning * into t;
  end if;
  perform private.log(s, case when v_id is null then '新增事工统计' else '更新事工统计' end, '事工统计', t.id, m.name || '｜' || t.item);
  return jsonb_build_object('success', true, 'statId', t.id);
end $$;

/* ============================================================
   组别提交
   ============================================================ */

create or replace function public.submit_ministry_group_report(p_year int, p_meeting_no int, p_group text, p_remark text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); v_group text := private.norm_group(coalesce(nullif(p_group, ''), private.user_group(s))); x public.ministry_submissions;
begin
  if not (v_group = any (private.ministry_groups())) then raise exception '组别不正确。'; end if;
  if p_year is null or p_meeting_no is null or p_meeting_no not between 1 and 4 then raise exception '会议资料不正确。'; end if;
  perform private.require_edit_group(s, v_group, p_year);
  insert into public.ministry_submissions (year, meeting_no, grp, status, submitted_by, submitted_at, note, updated_at)
  values (p_year, p_meeting_no, v_group, '已提交', s ->> 'name', now(), left(coalesce(p_remark, ''), 500), now())
  on conflict (year, meeting_no, grp) do update set status = '已提交', submitted_by = excluded.submitted_by, submitted_at = now(),
    note = excluded.note, updated_at = now()
  returning * into x;
  perform private.log(s, '提交组别事工报告', '会议组提交', x.id, p_year || '年第' || p_meeting_no || '次｜' || v_group);
  perform private.notify(private.emails_by_role(array['文书']), '{}', v_group || ' 已提交第' || p_meeting_no || '次会议报告',
    array_remove(array[v_group || ' 已提交 ' || p_year || ' 年第 ' || p_meeting_no || ' 次会议的事工报告。', '', '提交人：' || (s ->> 'name'),
      case when coalesce(p_remark, '') <> '' then '备注：' || p_remark end, '', '请到后台「事工管理」或「会议报告」查看并确认。'], null));
  return jsonb_build_object('success', true, 'message', v_group || ' 已提交，文书会收到 Email 通知。');
end $$;

create or replace function public.set_ministry_group_submission_status(p_year int, p_meeting_no int, p_group text, p_status text, p_remark text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); v_group text := private.norm_group(p_group); x public.ministry_submissions;
begin
  perform private.require_office(s);
  if not (p_status = any (array['已提交', '已退回', '已确认', '未提交'])) then raise exception '提交状态不正确。'; end if;
  if not (v_group = any (private.ministry_groups())) then raise exception '组别不正确。'; end if;
  insert into public.ministry_submissions (year, meeting_no, grp, status, note, updated_at)
  values (p_year, p_meeting_no, v_group, p_status, left(coalesce(p_remark, ''), 500), now())
  on conflict (year, meeting_no, grp) do update set status = excluded.status, note = excluded.note, updated_at = now()
  returning * into x;
  perform private.log(s, '更新组别提交状态', '会议组提交', x.id, p_year || '年第' || p_meeting_no || '次｜' || v_group || '｜' || p_status);
  return jsonb_build_object('success', true);
end $$;

/* ============================================================
   会议报告中心
   ============================================================ */

create or replace function public.get_meeting_center_data(p_year int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.session(); v_office boolean := private.is_office(s); v_year int := coalesce(nullif(p_year, 0), extract(year from private.today())::int);
        v_progress jsonb := '{}'; n int; g text;
begin
  if v_office then perform private.ensure_meetings(v_year); end if;
  for n in 1..4 loop
    v_progress := v_progress || jsonb_build_object(n::text, (select coalesce(jsonb_object_agg(gg, jsonb_build_object('total', tot, 'updated', upd)), '{}'::jsonb) from (
      select gg, (select count(*) from public.ministries m where m.year = v_year and m.grp = gg and m.status <> '已停用') tot,
                 (select count(*) from public.ministries m join public.ministry_updates u on u.ministry_id = m.id and u.meeting_no = n
                   where m.year = v_year and m.grp = gg and m.status <> '已停用') upd
        from unnest(private.ministry_groups()) gg) z));
  end loop;
  return jsonb_build_object('success', true, 'year', v_year, 'isOffice', v_office,
    'user', jsonb_build_object('name', s ->> 'name', 'role', s ->> 'role', 'group', private.user_group(s), 'isOffice', v_office),
    'groups', to_jsonb(private.ministry_groups()),
    'meetings', (select coalesce(jsonb_agg(private.meeting_json(m) order by m.meeting_no), '[]'::jsonb) from public.ministry_meetings m where m.year = v_year),
    'submissions', (select coalesce(jsonb_agg(private.submission_json(x) order by x.id), '[]'::jsonb) from public.ministry_submissions x where x.year = v_year),
    'progress', v_progress);
end $$;

-- 会议报告的原始资料（文书 / 管理员）：浏览器照旧版规则整理成报告
create or replace function public.get_ministry_report_source(p_year int, p_meeting_no int) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := private.require_staff();
begin
  perform private.require_office(s);
  if p_year is null or p_meeting_no is null or p_meeting_no not between 1 and 4 then raise exception '报告年份或会议次数不正确。'; end if;
  return jsonb_build_object('success', true, 'year', p_year, 'meetingNo', p_meeting_no,
    'groups', to_jsonb(private.ministry_groups()), 'categories', to_jsonb(private.ministry_categories()),
    'meetingType', private.meeting_type(p_meeting_no),
    'ministries', (select coalesce(jsonb_agg(private.ministry_json(m) order by m.id), '[]'::jsonb) from public.ministries m
                    where m.year = p_year and m.grp = any (private.ministry_groups()) and m.status <> '已停用'),
    'updates', (select coalesce(jsonb_agg(private.ministry_update_json(u) order by u.id), '[]'::jsonb) from public.ministry_updates u
                 where u.year = p_year and u.meeting_no <= p_meeting_no),
    'stats', (select coalesce(jsonb_agg(private.ministry_stat_json(t) order by t.id), '[]'::jsonb) from public.ministry_stats t
               where t.year = p_year and t.meeting_no <= p_meeting_no),
    'groupStaff', private.group_staff(p_year));
end $$;

/* ---------- 议案首页 ---------- */
create or replace function public.get_meeting_cover(p_year int, p_no int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.session(); m public.ministry_meetings; v_staff jsonb := private.staff_roles(p_year);
begin
  if p_no is null or p_no not between 1 and 4 then raise exception '会议次数不正确。'; end if;
  perform private.ensure_meetings(p_year);
  select * into m from public.ministry_meetings where year = p_year and meeting_no = p_no;
  return jsonb_build_object('success', true, 'saved', m.cover is not null and m.cover <> 'null'::jsonb,
    'cover', case when m.cover is not null and m.cover <> 'null'::jsonb then m.cover end,
    'meeting', private.meeting_json(m), 'staffRoles', v_staff -> 'roles', 'staff', v_staff -> 'all',
    'groupStaff', private.group_staff(p_year), 'groups', to_jsonb(private.ministry_groups()),
    'canEdit', private.is_office(s) or (not (s ->> 'readOnly')::boolean and s ->> 'role' in ('主席', '副主席')));
end $$;

create or replace function public.save_meeting_cover(p_year int, p_no int, p_cover jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); v_id text;
begin
  if not (private.is_office(s) or s ->> 'role' in ('主席', '副主席')) then raise exception '只有文书、主席或管理员可以编辑议案。' using errcode = '42501'; end if;
  if p_no is null or p_no not between 1 and 4 then raise exception '会议次数不正确。'; end if;
  if length(coalesce(p_cover, 'null'::jsonb)::text) > 45000 then raise exception '议案内容太长了。'; end if;
  perform private.ensure_meetings(p_year);
  update public.ministry_meetings set cover = case when p_cover is null or p_cover = 'null'::jsonb then null else p_cover end,
         meeting_date = coalesce(private.parse_date(p_cover ->> 'date'), meeting_date)
   where year = p_year and meeting_no = p_no returning id into v_id;
  perform private.log(s, '保存会议议案', '会议', v_id, p_year || '年第' || p_no || '次会议');
  return jsonb_build_object('success', true, 'message', '议案已保存。');
end $$;

/* ============================================================
   财政报告：数字 + 签名
   ============================================================ */

create or replace function private.finance_sigs(p_year int, p_month int) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(key, data_url) filter (where data_url <> ''), '{}'::jsonb)
    from public.finance_signatures where year = p_year and month = p_month
$$;

create or replace function public.get_finance_report_preview(p_year int, p_month int) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := private.require_finance(false);
begin
  return jsonb_build_object('success', true, 'report', private.fin_report(p_year, p_month));
end $$;

-- 文书准备议案时也要看财政报告（只读，含签名）
create or replace function public.get_finance_report_for_meeting(p_year int, p_month int) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := private.require_staff();
begin
  perform private.require_office(s);
  return jsonb_build_object('success', true, 'report', private.fin_report(p_year, p_month), 'sigs', private.finance_sigs(p_year, p_month));
end $$;

create or replace function public.get_finance_signatures(p_year int, p_month int) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := private.require_finance(false);
begin
  return jsonb_build_object('success', true, 'sigs', private.finance_sigs(p_year, p_month));
end $$;

-- 生成财政报告时在报告下面签名；签了就记住这一期的签名。p_sigs：{ treasurer: dataUrl | '' , auditor: ... }
create or replace function public.store_finance_signatures(p_year int, p_month int, p_sigs jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_finance(true); k text;
begin
  if p_month is null or p_month not between 1 and 12 then raise exception '月份不正确。'; end if;
  foreach k in array array['treasurer', 'auditor'] loop
    if p_sigs ? k then
      if coalesce(p_sigs ->> k, '') <> '' and (p_sigs ->> k !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or length(p_sigs ->> k) > 300000) then
        raise exception '签名图片不正确。';
      end if;
      insert into public.finance_signatures (year, month, key, data_url, updated_by, updated_at)
      values (p_year, p_month, k, coalesce(p_sigs ->> k, ''), s ->> 'name', now())
      on conflict (year, month, key) do update set data_url = excluded.data_url, updated_by = excluded.updated_by, updated_at = now();
    end if;
  end loop;
  perform private.log(s, '保存财政报告签名', '财政', p_year || '-' || p_month, '');
  return jsonb_build_object('success', true, 'sigs', private.finance_sigs(p_year, p_month));
end $$;

/* ============================================================
   存档：生成后过目，确定没问题才存（档案已由浏览器上传到 Storage「meeting-docs」）
   ============================================================ */
create or replace function public.save_generated_report(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s jsonb := private.require_staff(); v_kind text := coalesce(p_data ->> 'kind', ''); v_path text := btrim(coalesce(p_data ->> 'path', ''));
  v_title text := left(regexp_replace(coalesce(p_data ->> 'title', '报告'), '[\\/:*?"<>|]', '', 'g'), 200);
  v_type text := case v_kind when 'motion' then '会议议案' when 'finance' then '财政报告' else '会议报告' end;
  v_date date := private.today(); v_year int := private.parse_num(p_data ->> 'year')::int; v_no int := private.parse_num(p_data ->> 'meetingNo')::int;
  m public.ministry_meetings; d public.meeting_docs;
begin
  if v_kind = 'finance' then perform private.require_finance(true); else perform private.require_office(s); end if;
  if v_path = '' or v_path !~ '^[0-9]{4}/[A-Za-z0-9._-]+$' then raise exception '没有档案可以保存，请先生成。'; end if;
  if v_kind <> 'finance' and v_year is not null and v_no between 1 and 4 then
    perform private.ensure_meetings(v_year);
    update public.ministry_meetings set status = '报告已生成', generated_at = now(), report_doc_path = v_path
     where year = v_year and meeting_no = v_no returning * into m;
    v_date := coalesce(m.meeting_date, v_date);
  end if;
  insert into public.meeting_docs (meeting_date, name, doc_type, file_path, word_path, uploaded_by, saved_by)
  values (v_date, v_title, v_type, v_path, v_path, s ->> 'name', (s ->> 'name') || '（' || (s ->> 'role') || '）')
  returning * into d;
  perform private.log(s, '存档 ' || v_type, '会议记录', d.id, v_title);
  return jsonb_build_object('success', true, 'message', '已存档，所有职员都可以在「议案与记录档案」看到。');
end $$;

-- 会议记录列表：多回传 Word 档路径和保存人
create or replace function public.list_meeting_docs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := private.session();
begin
  return jsonb_build_object('success', true, 'meetings', (select coalesce(jsonb_agg(jsonb_build_object(
    '记录编号', d.id, '会议日期', private.d_admin(d.meeting_date), '会议名称', d.name, '档案类型', d.doc_type,
    '档案路径', d.file_path, '档案链接', d.file_url, 'Word路径', d.word_path, 'Word链接', '', '保存人', d.saved_by,
    '建立时间', private.ts_admin(d.created_at)) order by d.meeting_date, d.id), '[]'::jsonb)
    from public.meeting_docs d));
end $$;

/* ============================================================
   补上前几个阶段留下的：轮值表的事工日期、交换节目时事工日期一起搬
   ============================================================ */

create or replace function private.ministry_dates() returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('date', d, 'group', grp, 'name', name, 'id', id, 'linked', linked) order by d, id), '[]'::jsonb)
  from (
    select m.id, m.grp, m.name, coalesce(to_char(e.date, 'YYYY-MM-DD'), to_char(m.planned_date, 'YYYY-MM-DD')) d, e.id is not null linked
      from public.ministries m
      left join public.events e on e.id = btrim(split_part(m.event_id, ',', 1)) and m.event_id <> ''
     where m.status <> '已停用' and m.grp = any (private.ministry_groups())
  ) x where d is not null
$$;

create or replace function public.get_roster_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := private.require_roster(); v_cy int := private.current_year(); v_staff jsonb := '{}'::jsonb; y int;
begin
  foreach y in array array[v_cy, v_cy + 1] loop
    v_staff := v_staff || jsonb_build_object(y::text, jsonb_build_object(
      'admin', (select coalesce(jsonb_agg(jsonb_build_object('role', t.role, 'name', t.name)
                  order by array_position(array['主席', '副主席', '文书', '财政', '查账'], t.role), t.created_at), '[]'::jsonb)
                from public.terms t where t.year = y and t.status = '在任' and t.role = any (array['主席', '副主席', '文书', '财政', '查账'])),
      'groups', (select coalesce(jsonb_object_agg(g, names), '{}'::jsonb) from (
                  select t.grp g, jsonb_agg(distinct t.name) names from public.terms t
                   where t.year = y and t.status = '在任' and t.grp = any (private.ministry_groups()) and t.grp <> '行政组'
                   group by t.grp) x)));
  end loop;
  return jsonb_build_object(
    'success', true,
    'positions', to_jsonb(private.roster_positions()),
    'groups', to_jsonb(private.ministry_groups()),
    'pool', coalesce((select items from public.roster_pool where id = 1), '[]'::jsonb),
    'drafts', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'start', d.start_date, 'end', d.end_date,
               'status', d.status, 'updatedBy', d.updated_by, 'updatedAt', replace(left(private.ts_admin(d.updated_at), 16), 'T', ' '),
               'publishedBy', d.published_by, 'publishedAt', replace(left(private.ts_admin(d.published_at), 16), 'T', ' '))
               order by d.id), '[]'::jsonb) from public.roster_drafts d),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'date', coalesce(to_char(e.date, 'YYYY-MM-DD'), ''),
               'name', e.name, 'status', e.status, 'note', e.theme, 'assign', private.event_assign(e))
               order by e.date nulls last, e.id), '[]'::jsonb) from public.events e where e.status <> 'INACTIVE'),
    'members', (select coalesce(jsonb_agg(m.name order by m.id), '[]'::jsonb) from public.members m where m.status = 'ACTIVE'),
    'inactive', (select coalesce(jsonb_agg(distinct n), '[]'::jsonb) from public.members m,
                   unnest(array[m.name, m.nickname]) n where m.status = 'INACTIVE' and btrim(n) <> ''),
    'ministryDates', private.ministry_dates(),
    'staff', v_staff,
    'currentYear', v_cy);
end $$;

-- 交换节目：两组相关的事工换日期、改关联节目（旧版 swap_apply_ 第 2 步）；轮值表草稿照旧
create or replace function private.swap_apply(r public.program_swaps) returns text
language plpgsql set search_path = '' as $$
declare a public.events; b public.events; v_drafts int := 0; v_moved int := 0; d public.roster_drafts; c jsonb; changed boolean; w jsonb; i int; v jsonb;
        mm public.ministries; v_link text; v_pd date; v_day date; v_new_id text; v_from date;
begin
  select * into a from public.events where id = r.event_id for update;
  select * into b from public.events where id = r.target_id for update;
  if a.id is null or b.id is null then raise exception '其中一个节目已经被删除，不能交换。'; end if;
  if a.date is distinct from r.event_date or b.date is distinct from r.target_date
     or private.norm_group(a.grp) <> r.event_group or private.norm_group(b.grp) <> r.target_group then
    raise exception '申请之后节目的日期或负责组已经被改过，请取消这个申请，重新申请。';
  end if;
  update public.events set name = b.name, theme = b.theme, grp = b.grp, leader = b.leader, updated_at = now() where id = a.id;
  update public.events set name = a.name, theme = a.theme, grp = a.grp, leader = a.leader, updated_at = now() where id = b.id;

  -- 事工：A 组关联 A 节目（或没关联但计划日期是 A 的日期）→ 搬到 B 的日期；B 组反过来
  for mm in select * from public.ministries where status <> '已停用' for update loop
    v_link := btrim(mm.event_id); v_pd := mm.planned_date; v_day := null;
    if r.event_group <> '' and mm.grp = r.event_group and (v_link = a.id or (v_link = '' and v_pd = a.date)) then
      v_day := b.date; v_new_id := case when v_link <> '' then b.id else '' end; v_from := a.date;
    elsif r.target_group <> '' and mm.grp = r.target_group and (v_link = b.id or (v_link = '' and v_pd = b.date)) then
      v_day := a.date; v_new_id := case when v_link <> '' then a.id else '' end; v_from := b.date;
    end if;
    if v_day is null then continue; end if;
    update public.ministries set planned_date = v_day,
           event_id = case when v_new_id <> '' then v_new_id else event_id end,
           remark = case when remark <> '' then remark || '；' else '' end || '交换节目 ' || private.md(v_from) || ' → ' || private.md(v_day) || '（' || r.id || '）',
           updated_by = '系统（节目交换）', updated_at = now()
     where id = mm.id;
    v_moved := v_moved + 1;
  end loop;

  for d in select * from public.roster_drafts for update loop
    c := d.content; changed := false;
    for i in 0 .. coalesce(jsonb_array_length(c -> 'weeks'), 0) - 1 loop
      w := c -> 'weeks' -> i;
      if coalesce((w ->> 'suspended')::boolean, false) then continue; end if;
      v := case when w ->> 'date' = to_char(a.date, 'YYYY-MM-DD') then jsonb_build_object('n', b.name, 'g', b.grp, 'l', b.leader)
                when w ->> 'date' = to_char(b.date, 'YYYY-MM-DD') then jsonb_build_object('n', a.name, 'g', a.grp, 'l', a.leader) end;
      if v is null then continue; end if;
      w := jsonb_set(w, '{eventName}', v -> 'n');
      w := jsonb_set(w, '{assign}', coalesce(w -> 'assign', '{}'::jsonb) || jsonb_build_object('负责组', v -> 'g', '领会', v -> 'l'));
      c := jsonb_set(c, array['weeks', i::text], w);
      changed := true;
    end loop;
    if changed then update public.roster_drafts set content = c where id = d.id; v_drafts := v_drafts + 1; end if;
  end loop;
  return '已更新 ' || v_moved || ' 个相关事工的日期' || case when v_drafts > 0 then '，' || v_drafts || ' 份轮值表' else '' end || '。';
end $$;

/* ---------- 权限 ---------- */
do $$
declare f text;
begin
  foreach f in array array['public.save_ministry_meeting(jsonb)', 'public.get_ministry_system_data(int, int)', 'public.save_ministry_plan(jsonb)',
    'public.save_ministry_update(jsonb)', 'public.get_ministry_history(text)', 'public.save_ministry_stat(jsonb)',
    'public.submit_ministry_group_report(int, int, text, text)', 'public.set_ministry_group_submission_status(int, int, text, text, text)',
    'public.get_meeting_center_data(int)', 'public.get_ministry_report_source(int, int)', 'public.get_meeting_cover(int, int)',
    'public.save_meeting_cover(int, int, jsonb)', 'public.get_finance_report_preview(int, int)', 'public.get_finance_report_for_meeting(int, int)',
    'public.get_finance_signatures(int, int)', 'public.store_finance_signatures(int, int, jsonb)', 'public.save_generated_report(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
