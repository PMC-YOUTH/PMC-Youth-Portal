-- 阶段 2：公开首页、网站设定、活动报告、节目、事奉、轮值表、节目交换、意见箱
-- 规格来源：legacy/gas/src/Code.gs（getPublicPortalData）、AdminBackend.gs（节目 / 事奉 / 轮值表 / 交换 / 意见箱 / 网站设定）
-- 回传给前端的物件沿用旧版的中文栏位名称（例如 '节目编号'、'日期'），后台页面不用改。
-- 资料编号沿用旧版格式（EVT-0001 等），方便之后汇入旧资料。

/* ============================================================
   资料表
   ============================================================ */

create sequence public.event_code_seq;
create table public.events (
  id text primary key default ('EVT-' || lpad(nextval('public.event_code_seq')::text, 4, '0')),
  date date,
  start_time text not null default '',
  end_time text not null default '',
  name text not null default '',
  theme text not null default '',
  content text not null default '',
  location text not null default '',
  speaker text not null default '',
  status text not null default 'ACTIVE' check (status in ('ACTIVE', '暂停', 'INACTIVE')),
  is_public boolean not null default true,
  cover_url text not null default '',
  grp text not null default '',
  leader text not null default '',
  verse text not null default '',
  singer text not null default '',
  piano text not null default '',
  computer text not null default '',
  usher text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.events enable row level security;
create index events_date on public.events (date);

-- 额外事奉岗位（音响、摄影等）
create sequence public.roster_code_seq;
create table public.roster_assignments (
  id text primary key default ('ROS-' || lpad(nextval('public.roster_code_seq')::text, 4, '0')),
  event_id text not null references public.events (id),
  date date,
  role text not null,
  name text not null,
  note text not null default '',
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.roster_assignments enable row level security;
create index roster_assignments_event on public.roster_assignments (event_id);

-- 轮值表：各岗位名单（整份存成一笔，保存时整份覆盖）
create table public.roster_pool (
  id int primary key default 1 check (id = 1),
  items jsonb not null default '[]'::jsonb,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.roster_pool enable row level security;
insert into public.roster_pool (id) values (1) on conflict (id) do nothing;

-- 轮值表草稿
create sequence public.roster_draft_code_seq;
create table public.roster_drafts (
  id text primary key default ('RST-' || lpad(nextval('public.roster_draft_code_seq')::text, 4, '0')),
  title text not null default '',
  start_date text not null default '',
  end_date text not null default '',
  content jsonb not null default '{"weeks": []}'::jsonb,
  status text not null default '草稿' check (status in ('草稿', '已发布')),
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  published_by text not null default '',
  published_at timestamptz
);
alter table public.roster_drafts enable row level security;

-- 节目交换申请
create sequence public.swap_code_seq;
create table public.program_swaps (
  id text primary key default ('SWP-' || lpad(nextval('public.swap_code_seq')::text, 4, '0')),
  requested_at timestamptz not null default now(),
  requester_name text not null,
  requester_id uuid,
  requester_group text not null default '',
  event_id text not null,
  event_date date,
  event_name text not null default '',
  event_group text not null default '',
  target_id text not null,
  target_date date,
  target_name text not null default '',
  target_group text not null default '',
  reason text not null default '',
  status text not null default '待批准' check (status in ('待批准', '已批准', '未通过', '已取消')),
  exec_by text not null default '',
  exec_at timestamptz,
  other_by text not null default '',
  other_at timestamptz,
  note text not null default '',
  done_at timestamptz
);
alter table public.program_swaps enable row level security;

-- 网站设定（首页大合照、标题、Instagram、Logo）
create table public.site_settings (
  key text primary key,
  value text not null default '',
  note text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;
insert into public.site_settings (key, note) values
  ('大合照', '首页最上面的大合照（图片链接）'),
  ('首页标题', '首页大合照上的大字'),
  ('首页副标题', '首页大合照上的小字'),
  ('Instagram 链接', 'Official Instagram URL'),
  ('logo', '网站 Logo（图片链接）')
on conflict (key) do nothing;

-- 活动报告
create sequence public.report_code_seq;
create table public.activity_reports (
  id text primary key default ('RPT-' || lpad(nextval('public.report_code_seq')::text, 4, '0')),
  event_id text not null default '',
  date date,
  title text not null,
  content text not null default '',
  cover_url text not null default '',
  album_url text not null default '',
  is_public boolean not null default false,
  created_by text not null default '',
  created_by_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,                -- 删除只做标记，资料保留（不小心删掉可以救回）
  deleted_by text not null default ''
);
alter table public.activity_reports enable row level security;

-- 意见箱
create sequence public.feedback_code_seq;
create table public.feedback (
  id text primary key default ('FB-' || lpad(nextval('public.feedback_code_seq')::text, 4, '0')),
  submitted_at timestamptz not null default now(),
  category text not null default '其他',
  content text not null,
  name text not null default '',
  contact text not null default '',
  status text not null default '新' check (status in ('新', '处理中', '已处理')),
  note text not null default '',
  handled_by text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
create index feedback_submitted on public.feedback (submitted_at);

/* ============================================================
   内部工具
   ============================================================ */

create or replace function private.roster_positions() returns text[]
language sql immutable set search_path = '' as $$
  select array['负责组', '领会', '经节手册', '领唱/助唱', '司琴/吉他手', '电脑控制员', '招待员']
$$;

create or replace function private.ministry_groups() returns text[]
language sql immutable set search_path = '' as $$
  select array['行政组', '信仰组', '见证组', '宣教组', '公民组', '团契组']
$$;

-- 旧版日期格式：后台 'yyyy-MM-ddTHH:mm:ss'，公开页 'yyyy-MM-dd HH:mm:ss'
create or replace function private.d_admin(d date) returns text
language sql immutable set search_path = '' as $$ select case when d is null then '' else to_char(d, 'YYYY-MM-DD') || 'T00:00:00' end $$;
create or replace function private.ts_admin(t timestamptz) returns text
language sql stable set search_path = '' as $$ select coalesce(to_char(t at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD"T"HH24:MI:SS'), '') $$;
create or replace function private.d_public(d date) returns text
language sql immutable set search_path = '' as $$ select case when d is null then '' else to_char(d, 'YYYY-MM-DD') || ' 00:00:00' end $$;
-- 'D/M/YYYY'
create or replace function private.md(d date) returns text
language sql immutable set search_path = '' as $$
  select case when d is null then '' else extract(day from d)::int || '/' || extract(month from d)::int || '/' || extract(year from d)::int end
$$;

create or replace function private.parse_date(v text) returns date
language plpgsql immutable set search_path = '' as $$
begin
  if v is null or btrim(v) = '' then return null; end if;
  return left(btrim(v), 10)::date;
exception when others then return null;
end $$;

create or replace function private.clip(v text, n int) returns text
language sql immutable set search_path = '' as $$ select left(btrim(coalesce(v, '')), n) $$;

create or replace function private.event_json(e public.events, p_public boolean default false) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    '节目编号', e.id,
    '日期', case when p_public then private.d_public(e.date) else private.d_admin(e.date) end,
    '开始时间', e.start_time, '结束时间', e.end_time, '节目名称', e.name, '主题', e.theme, '内容', e.content,
    '地点', e.location, '讲员', e.speaker, '状态', e.status, '公开显示', case when e.is_public then '是' else '否' end,
    '封面照片链接', e.cover_url, '负责组', e.grp, '领会', e.leader, '经节手册', e.verse, '领唱/助唱', e.singer,
    '司琴/吉他手', e.piano, '电脑控制员', e.computer, '招待员', e.usher,
    '建立时间', private.ts_admin(e.created_at), '更新日期', private.ts_admin(e.updated_at))
$$;

create or replace function private.event_assign(e public.events) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('负责组', e.grp, '领会', e.leader, '经节手册', e.verse, '领唱/助唱', e.singer,
                            '司琴/吉他手', e.piano, '电脑控制员', e.computer, '招待员', e.usher)
$$;

create or replace function private.report_json(r public.activity_reports) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('报告编号', r.id, '节目编号', r.event_id, '日期', private.d_admin(r.date), '标题', r.title,
    '内容', r.content, '封面照片链接', r.cover_url, '照片资料夹链接', r.album_url,
    '公开显示', case when r.is_public then 'TRUE' else 'FALSE' end, '建立者', r.created_by,
    '建立时间', private.ts_admin(r.created_at), '更新日期', private.ts_admin(r.updated_at))
$$;

create or replace function private.swap_json(r public.program_swaps) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('申请编号', r.id, '申请时间', private.ts_admin(r.requested_at), '申请人', r.requester_name,
    '申请人用户编号', coalesce(r.requester_id::text, ''), '申请人组别', r.requester_group,
    '节目编号', r.event_id, '节目日期', private.d_admin(r.event_date), '节目名称', r.event_name, '负责组', r.event_group,
    '对方节目编号', r.target_id, '对方日期', private.d_admin(r.target_date), '对方节目名称', r.target_name, '对方负责组', r.target_group,
    '原因', r.reason, '状态', r.status, '行政组批准人', r.exec_by, '行政组批准时间', private.ts_admin(r.exec_at),
    '对方组批准人', r.other_by, '对方组批准时间', private.ts_admin(r.other_at), '处理备注', r.note, '完成时间', private.ts_admin(r.done_at))
$$;

create or replace function private.swap_desc(r public.program_swaps) returns text
language sql immutable set search_path = '' as $$
  select private.md(r.event_date) || '「' || r.event_name || '」（' || coalesce(nullif(r.event_group, ''), '-') || '）⇄ ' ||
         private.md(r.target_date) || '「' || r.target_name || '」（' || coalesce(nullif(r.target_group, ''), '-') || '）'
$$;

-- 同一组（旧版 swap_inGroup_）
create or replace function private.in_group(s jsonb, p_group text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(not (s ->> 'readOnly')::boolean and coalesce(p_group, '') <> ''
                  and private.norm_group(s ->> 'group') = private.norm_group(p_group), false)
$$;

-- 改节目：行政组，或这个节目的负责组（旧版 perm_canEditEvent_）
create or replace function private.can_edit_event(s jsonb, p_group text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(not (s ->> 'readOnly')::boolean and (private.is_exec(s) or private.in_group(s, p_group)), false)
$$;

-- 轮值表：管理员、文书、财政、查账，或行政组（旧版 roster_canEdit_）
create or replace function private.can_edit_roster(s jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(not (s ->> 'readOnly')::boolean and (
    s ->> 'role' = any (array['管理员', '文书', '财政', '查账'])
    or s ->> 'group' = any (array['行政组', '文书', '财政', '查账'])), false)
$$;

create or replace function private.require_roster() returns jsonb
language plpgsql stable set search_path = '' as $$
declare s jsonb := private.require_staff();
begin
  if not private.can_edit_roster(s) then raise exception '只有文书、财政、查账和行政组可以编辑轮值表。' using errcode = '42501'; end if;
  return s;
end $$;

create or replace function private.swap_exec_emails() returns text[]
language sql stable set search_path = '' as $$
  select array(select distinct e from unnest(private.emails_by_role(array['主席', '副主席', '文书', '财政', '查账'])
                                             || private.emails_by_group('行政组')) e)
$$;

-- 清理一份轮值表草稿（旧版 roster_saveDraft_ 的清理规则）
create or replace function private.clean_roster_weeks(p_weeks jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'date', left(coalesce(w ->> 'date', ''), 10),
      'eventName', left(coalesce(w ->> 'eventName', ''), 60),
      'suspended', coalesce((w ->> 'suspended')::boolean, false),
      'note', left(coalesce(w ->> 'note', ''), 100),
      'assign', (select jsonb_object_agg(p, left(btrim(coalesce(w -> 'assign' ->> p, '')), 60))
                   from unnest(private.roster_positions()) p))
    order by ord), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_weeks) = 'array' then p_weeks else '[]'::jsonb end) with ordinality x(w, ord)
  where left(coalesce(w ->> 'date', ''), 10) ~ '^\d{4}-\d{2}-\d{2}$'
$$;

create or replace function private.save_roster_draft(s jsonb, p_draft jsonb, p_status text) returns public.roster_drafts
language plpgsql set search_path = '' as $$
declare v_weeks jsonb := private.clean_roster_weeks(p_draft -> 'weeks'); d public.roster_drafts; v_id text := nullif(p_draft ->> 'id', '');
begin
  if length(jsonb_build_object('weeks', v_weeks)::text) > 45000 then raise exception '轮值表太大了，请缩短期间。'; end if;
  if v_id is not null then
    update public.roster_drafts set title = left(coalesce(p_draft ->> 'title', ''), 60), start_date = coalesce(p_draft ->> 'start', ''),
           end_date = coalesce(p_draft ->> 'end', ''), content = jsonb_build_object('weeks', v_weeks), status = p_status,
           updated_by = coalesce(s ->> 'name', ''), updated_at = now()
     where id = v_id returning * into d;
  end if;
  if d.id is null then
    insert into public.roster_drafts (title, start_date, end_date, content, status, updated_by)
    values (left(coalesce(p_draft ->> 'title', ''), 60), coalesce(p_draft ->> 'start', ''), coalesce(p_draft ->> 'end', ''),
            jsonb_build_object('weeks', v_weeks), p_status, coalesce(s ->> 'name', ''))
    returning * into d;
  end if;
  return d;
end $$;

/* ============================================================
   公开首页（匿名可用，只回传公开资料）
   ============================================================ */

create or replace function public.get_public_portal_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.today();
  v_sun date := v_today - extract(dow from v_today)::int;              -- 星期日开始的本周
  v_mon date := v_today - ((extract(dow from v_today)::int + 6) % 7);  -- 星期一开始的本周
  v_m1 date := date_trunc('month', v_today)::date;
  v_labels text[] := array['上周', '本周', '下周', '下下周', '三周后', '四周后'];
  v_weeks jsonb := '[]'::jsonb;
  ws date; i int;
  st jsonb := (select coalesce(jsonb_object_agg(lower(key), value), '{}') from public.site_settings);
begin
  for i in -1..4 loop
    ws := v_mon + 7 * i;
    v_weeks := v_weeks || jsonb_build_object(
      'label', v_labels[i + 2], 'offset', i, 'start', to_char(ws, 'YYYY-MM-DD'), 'end', to_char(ws + 6, 'YYYY-MM-DD'),
      'events', (select coalesce(jsonb_agg(private.event_json(e, true) || jsonb_build_object('extraRoster',
                    (select coalesce(jsonb_agg(jsonb_build_object('role', r.role, 'name', r.name) order by r.created_at), '[]'::jsonb)
                       from public.roster_assignments r where r.event_id = e.id and r.status = 'ACTIVE'))
                  order by e.date, e.start_time), '[]'::jsonb)
                 from public.events e where e.date >= ws and e.date < ws + 7 and e.status in ('ACTIVE', '暂停') and e.is_public));
  end loop;

  return jsonb_build_object(
    'success', true,
    'weekEvents', (select coalesce(jsonb_agg(private.event_json(e, true) order by e.date, e.start_time), '[]'::jsonb)
                     from public.events e where e.date >= v_sun and e.date < v_sun + 7 and e.status = 'ACTIVE' and e.is_public),
    'monthEvents', (select coalesce(jsonb_agg(private.event_json(e, true) order by e.date, e.start_time), '[]'::jsonb)
                      from public.events e where e.date >= v_m1 and e.date < (v_m1 + interval '1 month')::date and e.status = 'ACTIVE' and e.is_public),
    'weeks', v_weeks,
    'reports', (select coalesce(jsonb_agg(j order by d desc nulls last), '[]'::jsonb) from (
                  select private.report_json(r) - '建立者' j, r.date d from public.activity_reports r
                   where r.is_public and r.deleted_at is null order by r.date desc nulls last limit 12) x),
    'logoUrl', coalesce(st ->> 'logo', ''),
    'bannerUrl', coalesce(st ->> '大合照', ''),
    'heroTitle', coalesce(st ->> '首页标题', ''),
    'heroSubtitle', coalesce(st ->> '首页副标题', ''),
    'instagram', coalesce(st ->> 'instagram 链接', ''));
end $$;

create or replace function public.get_portal_branding() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('success', true,
    'logoUrl', coalesce((select value from public.site_settings where key = 'logo'), ''),
    'bannerUrl', coalesce((select value from public.site_settings where key = '大合照'), ''),
    'termYear', private.current_year())
$$;

-- 意见箱（匿名可提交；有防机器人栏位和每小时上限）
create or replace function public.submit_feedback(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_content text := btrim(coalesce(p_data ->> 'content', '')); v_cat text := coalesce(p_data ->> 'category', '');
begin
  if btrim(coalesce(p_data ->> 'website', '')) <> '' then return jsonb_build_object('success', true, 'message', '谢谢你的意见！'); end if;
  if char_length(v_content) < 5 then return jsonb_build_object('success', false, 'message', '请写多一点内容（至少 5 个字）。'); end if;
  if char_length(v_content) > 2000 then return jsonb_build_object('success', false, 'message', '内容太长了，请控制在 2000 字以内。'); end if;
  if (select count(*) from public.feedback where submitted_at > now() - interval '1 hour') >= 60 then
    return jsonb_build_object('success', false, 'message', '目前提交的人太多，请稍后再试。');
  end if;
  if not (v_cat = any (array['建议', '感恩', '代祷', '问题反映', '其他'])) then v_cat := '其他'; end if;
  insert into public.feedback (category, content, name, contact)
  values (v_cat, v_content, private.clip(p_data ->> 'name', 40), private.clip(p_data ->> 'contact', 80));
  return jsonb_build_object('success', true, 'message', '谢谢你的意见！职员会认真阅读。');
end $$;

/* ============================================================
   后台：节目、事奉
   ============================================================ */

-- 节目、额外事奉、交换申请（等于旧版 getAdminEvents 的这三部分；契友、Claim 等之后的阶段各自有 API）
create or replace function public.get_admin_events() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := private.session(); v_staff boolean := not (s ->> 'readOnly')::boolean;
begin
  return jsonb_build_object(
    'success', true,
    'events', (select coalesce(jsonb_agg(private.event_json(e) order by e.date nulls last, e.id), '[]'::jsonb) from public.events e),
    'roster', (select coalesce(jsonb_agg(jsonb_build_object('排表编号', r.id, '节目编号', r.event_id, '日期', private.d_admin(r.date),
                 '事奉岗位', r.role, '契友姓名', r.name, '备注', r.note, '状态', r.status,
                 '建立时间', private.ts_admin(r.created_at), '更新日期', private.ts_admin(r.updated_at)) order by r.created_at), '[]'::jsonb)
               from public.roster_assignments r),
    'swaps', case when v_staff then (select coalesce(jsonb_agg(private.swap_json(x) order by x.requested_at), '[]'::jsonb) from (
               (select * from public.program_swaps where status = '待批准')
               union all
               (select * from (select * from public.program_swaps where status <> '待批准' order by requested_at desc limit 15) d)) x)
             else '[]'::jsonb end,
    'perms', private.perm_summary(s));
end $$;

-- 新增 / 修改节目。新增：只有行政组。修改：行政组或该节目负责组；日期、负责组、状态、公开显示只有行政组能改。
create or replace function public.save_event(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s jsonb := private.require_staff(); v_exec boolean := private.is_exec(s);
  v_id text := nullif(btrim(coalesce(p_data ->> 'eventId', '')), ''); e public.events;
  v_date date := private.parse_date(p_data ->> 'date');
begin
  if v_id is null then
    if not v_exec then raise exception '只有行政组可以新增节目。' using errcode = '42501'; end if;
    if v_date is null then raise exception '请填写日期。'; end if;
    insert into public.events (date) values (v_date) returning * into e;
  else
    select * into e from public.events where id = v_id for update;
    if not found then raise exception '找不到这个节目。'; end if;
    if not private.can_edit_event(s, e.grp) then raise exception '你只能修改自己组负责的节目。' using errcode = '42501'; end if;
  end if;

  update public.events set
    name     = case when p_data ? 'name'     then private.clip(p_data ->> 'name', 120)     else name end,
    location = case when p_data ? 'location' then private.clip(p_data ->> 'location', 120) else location end,
    leader   = case when p_data ? 'leader'   then private.clip(p_data ->> 'leader', 120)   else leader end,
    verse    = case when p_data ? 'verse'    then private.clip(p_data ->> 'verse', 120)    else verse end,
    singer   = case when p_data ? 'singer'   then private.clip(p_data ->> 'singer', 120)   else singer end,
    piano    = case when p_data ? 'piano'    then private.clip(p_data ->> 'piano', 120)    else piano end,
    computer = case when p_data ? 'computer' then private.clip(p_data ->> 'computer', 120) else computer end,
    usher    = case when p_data ? 'usher'    then private.clip(p_data ->> 'usher', 120)    else usher end,
    date      = case when v_exec and v_date is not null then v_date else date end,
    grp       = case when v_exec and p_data ? 'group' then private.clip(p_data ->> 'group', 30) else grp end,
    status    = case when v_exec then (case when p_data ->> 'status' in ('ACTIVE', '暂停', 'INACTIVE') then p_data ->> 'status' else 'ACTIVE' end) else status end,
    is_public = case when v_exec then coalesce(p_data ->> 'publicDisplay', '') <> '否' else is_public end,
    updated_at = now()
  where id = e.id returning * into e;

  perform private.log(s, case when v_id is null then '新增节目' else '更新节目' end, '节目', e.id, e.name);
  return jsonb_build_object('success', true, 'eventId', e.id);
end $$;

-- 额外事奉岗位：行政组或该节目负责组
create or replace function public.save_extra_roster(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); e public.events; r public.roster_assignments;
        v_role text := private.clip(p_data ->> 'role', 40); v_name text := private.clip(p_data ->> 'name', 60);
begin
  select * into e from public.events where id = p_data ->> 'eventId';
  if not found then raise exception '找不到这个节目。'; end if;
  if not private.can_edit_event(s, e.grp) then raise exception '你只能修改自己组负责的节目。' using errcode = '42501'; end if;
  if v_role = '' or v_name = '' then raise exception '请填写岗位和姓名。'; end if;
  if coalesce(p_data ->> 'rosterId', '') <> '' then
    select * into r from public.roster_assignments where id = p_data ->> 'rosterId' for update;
    if not found then raise exception '找不到这笔事奉资料。'; end if;
    if r.event_id <> e.id then raise exception '资料不一致。'; end if;
    update public.roster_assignments set role = v_role, name = v_name, date = e.date, status = 'ACTIVE', updated_at = now() where id = r.id;
  else
    insert into public.roster_assignments (event_id, date, role, name) values (e.id, e.date, v_role, v_name);
  end if;
  return jsonb_build_object('success', true);
end $$;

create or replace function public.delete_extra_roster(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); r public.roster_assignments; v_grp text;
begin
  select * into r from public.roster_assignments where id = p_id for update;
  if not found then raise exception '找不到这笔事奉资料。'; end if;
  select grp into v_grp from public.events where id = r.event_id;
  if not private.can_edit_event(s, v_grp) then raise exception '你只能修改自己组负责的节目。' using errcode = '42501'; end if;
  update public.roster_assignments set status = 'INACTIVE', updated_at = now() where id = r.id;
  return jsonb_build_object('success', true);
end $$;

-- 单一节目的事奉人员（「安排事奉」视窗）；负责组只有行政组能改
create or replace function public.save_event_roster(p_event_id text, p_assign jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); e public.events; v_exec boolean := private.is_exec(s); a jsonb := coalesce(p_assign, '{}'::jsonb);
begin
  select * into e from public.events where id = p_event_id for update;
  if not found then raise exception '找不到这个节目。'; end if;
  if not private.can_edit_event(s, e.grp) then raise exception '你只能修改自己组负责的节目。' using errcode = '42501'; end if;
  update public.events set
    grp      = case when v_exec and a ? '负责组' then private.clip(a ->> '负责组', 60) else grp end,
    leader   = case when a ? '领会'        then private.clip(a ->> '领会', 60)        else leader end,
    verse    = case when a ? '经节手册'    then private.clip(a ->> '经节手册', 60)    else verse end,
    singer   = case when a ? '领唱/助唱'   then private.clip(a ->> '领唱/助唱', 60)   else singer end,
    piano    = case when a ? '司琴/吉他手' then private.clip(a ->> '司琴/吉他手', 60) else piano end,
    computer = case when a ? '电脑控制员'  then private.clip(a ->> '电脑控制员', 60)  else computer end,
    usher    = case when a ? '招待员'      then private.clip(a ->> '招待员', 60)      else usher end,
    updated_at = now()
  where id = e.id;
  return jsonb_build_object('success', true);
end $$;

/* ============================================================
   轮值表
   ============================================================ */

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
    'members', '[]'::jsonb,        -- 阶段 3（契友）补上
    'inactive', '[]'::jsonb,       -- 阶段 3（契友）补上
    'ministryDates', '[]'::jsonb,  -- 阶段 5（事工）补上
    'staff', v_staff,
    'currentYear', v_cy);
end $$;

create or replace function public.get_roster_draft(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := private.require_roster(); d public.roster_drafts;
begin
  select * into d from public.roster_drafts where id = p_id;
  if not found then raise exception '找不到这份草稿。'; end if;
  return jsonb_build_object('success', true, 'draft', jsonb_build_object('id', d.id, 'title', d.title, 'start', d.start_date,
    'end', d.end_date, 'status', d.status, 'weeks', coalesce(d.content -> 'weeks', '[]'::jsonb)));
end $$;

-- 各岗位名单整份保存
create or replace function public.save_roster_pool(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_roster(); v_items jsonb; v_count int;
begin
  select coalesce(jsonb_agg(jsonb_build_object('position', r ->> 'position', 'name', left(btrim(r ->> 'name'), 40),
           'order', coalesce(case when coalesce(r ->> 'order', '') ~ '^\d+$' then (r ->> 'order')::int end, ord::int),
           'note', left(coalesce(r ->> 'note', ''), 100)) order by ord), '[]'::jsonb)
    into v_items
    from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) with ordinality x(r, ord)
   where r ->> 'position' = any (private.roster_positions()) and btrim(coalesce(r ->> 'name', '')) <> '';
  v_count := jsonb_array_length(v_items);
  insert into public.roster_pool (id, items, updated_by, updated_at) values (1, v_items, coalesce(s ->> 'name', ''), now())
  on conflict (id) do update set items = excluded.items, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('success', true, 'message', '名单已保存（' || v_count || ' 人次）。');
end $$;

create or replace function public.save_roster_draft(p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_roster(); d public.roster_drafts;
begin
  d := private.save_roster_draft(s, coalesce(p_draft, '{}'::jsonb), '草稿');
  return jsonb_build_object('success', true, 'id', d.id, 'message', '草稿已保存。');
end $$;

-- 发布：把轮值表写进节目。没有节目的日期自动建立；不排人的日期标为暂停（或照常的特别聚会）。
create or replace function public.publish_roster_draft(p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s jsonb := private.require_roster(); d public.roster_drafts; w jsonb; e public.events;
  v_date date; v_name text; v_pause boolean; a jsonb;
  v_updated int := 0; v_created int := 0; v_paused int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('roster_publish'));
  d := private.save_roster_draft(s, coalesce(p_draft, '{}'::jsonb), '已发布');
  update public.roster_drafts set published_by = coalesce(s ->> 'name', ''), published_at = now() where id = d.id;

  for w in select * from jsonb_array_elements(d.content -> 'weeks') loop
    v_date := (w ->> 'date')::date; a := w -> 'assign'; v_name := coalesce(w ->> 'eventName', '');
    select * into e from public.events where date = v_date and status <> 'INACTIVE' order by created_at, id limit 1 for update;
    if not found then
      insert into public.events (date, name, location, is_public) values (v_date, coalesce(nullif(v_name, ''), '青年团契聚会'), '播恩堂', true)
      returning * into e;
      v_created := v_created + 1;
    else
      v_updated := v_updated + 1;
    end if;

    if (w ->> 'suspended')::boolean then
      -- 节目名称是「暂停聚会」或空白 → 暂停；否则是照常的特别聚会，说明写在主题
      v_pause := v_name = '' or v_name = '暂停聚会';
      update public.events set status = case when v_pause then '暂停' else 'ACTIVE' end,
             theme = coalesce(nullif(w ->> 'note', ''), case when v_pause then '暂停聚会' else '' end),
             name = coalesce(nullif(v_name, ''), '暂停聚会'),
             grp = '', leader = '', verse = '', singer = '', piano = '', computer = '', usher = '', updated_at = now()
       where id = e.id;
      v_paused := v_paused + 1;
    else
      update public.events set status = 'ACTIVE',
             grp = coalesce(a ->> '负责组', ''), leader = coalesce(a ->> '领会', ''), verse = coalesce(a ->> '经节手册', ''),
             singer = coalesce(a ->> '领唱/助唱', ''), piano = coalesce(a ->> '司琴/吉他手', ''),
             computer = coalesce(a ->> '电脑控制员', ''), usher = coalesce(a ->> '招待员', ''),
             name = case when v_name <> '' then v_name else name end,
             theme = case when e.status = '暂停' and position('暂停' in e.theme) > 0 then '' else theme end,
             updated_at = now()
       where id = e.id;
    end if;
  end loop;
  -- 新建立的节目也算在「不排人」之外；跟旧版一样，更新 + 新增 = 总周数
  perform private.log(s, '发布轮值表', '节目', d.id, d.title || '｜更新 ' || v_updated || '，新增 ' || v_created || '，暂停 ' || v_paused);
  return jsonb_build_object('success', true, 'id', d.id,
    'message', '已发布：更新 ' || v_updated || ' 个节目，新增 ' || v_created || ' 个，不排人 ' || v_paused || ' 个。公开页面和节目列表已同步。');
end $$;

/* ============================================================
   节目交换
   1. 申请 → 通知行政组和对方负责组。
   2. 行政组一人 + 对方负责组一人批准（对方没有负责组或同一组就只要行政组）。
   3. 两边都批准后自动对调两天的「节目名称、主题、负责组、领会」，轮值表草稿一起更新。
      （事工日期一起搬：阶段 5 有事工资料表后补上）
   ============================================================ */

create or replace function public.request_program_swap(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s jsonb := private.require_staff(); a public.events; b public.events; r public.program_swaps;
  v_ga text; v_gb text; v_need boolean; v_busy text; v_to text[];
begin
  perform pg_advisory_xact_lock(hashtext('program_swap'));
  select * into a from public.events where id = p_data ->> 'eventId';
  select * into b from public.events where id = p_data ->> 'targetId';
  if a.id is null or b.id is null then raise exception '找不到节目，请重新载入后再试。'; end if;
  if a.id = b.id then raise exception '请选择另一个日期的节目。'; end if;
  if a.status in ('INACTIVE', '暂停') then raise exception '「%」已停用或暂停，不能交换。', a.name; end if;
  if b.status in ('INACTIVE', '暂停') then raise exception '「%」已停用或暂停，不能交换。', b.name; end if;
  if a.date < private.today() or b.date < private.today() then raise exception '已经过去的节目不能交换。'; end if;
  v_ga := private.norm_group(a.grp); v_gb := private.norm_group(b.grp);
  if not private.is_exec(s) and not private.in_group(s, v_ga) then
    raise exception '只有「%」的职员或行政组可以申请交换这个节目。', coalesce(nullif(v_ga, ''), '负责组') using errcode = '42501';
  end if;
  select id into v_busy from public.program_swaps
   where status = '待批准' and (event_id in (a.id, b.id) or target_id in (a.id, b.id)) limit 1;
  if v_busy is not null then raise exception '这两个节目其中一个已经有等待批准的交换申请（%），请等那个处理完。', v_busy; end if;

  v_need := v_gb <> '' and v_gb <> v_ga;
  insert into public.program_swaps (requester_name, requester_id, requester_group, event_id, event_date, event_name, event_group,
                                    target_id, target_date, target_name, target_group, reason, other_by)
  values (s ->> 'name', (s ->> 'userId')::uuid, coalesce(s ->> 'group', ''), a.id, a.date, a.name, v_ga,
          b.id, b.date, b.name, v_gb, left(coalesce(p_data ->> 'reason', ''), 300), case when v_need then '' else '（不需要）' end)
  returning * into r;
  perform private.log(s, '申请交换节目', '节目交换', r.id, private.swap_desc(r));

  v_to := private.swap_exec_emails() || case when v_need then private.emails_by_group(v_gb) else '{}'::text[] end;
  v_to := array(select x from unnest(v_to) x where x <> lower(s ->> 'email'));
  perform private.notify(v_to, '{}', '节目交换申请：' || private.md(a.date) || ' ⇄ ' || private.md(b.date),
    array_remove(array[(s ->> 'name') || '（' || coalesce(s ->> 'group', '') || '）申请交换节目：', '', private.swap_desc(r),
      case when r.reason <> '' then '原因：' || r.reason end, '',
      case when v_need then '需要：行政组其中一人批准，以及「' || v_gb || '」其中一人批准。' else '需要：行政组其中一人批准。' end,
      '请到后台「节目事奉」页上方的「节目交换申请」批准或不批准。'], null));
  return jsonb_build_object('success', true, 'id', r.id,
    'message', '已送出申请，行政组' || case when v_need then '和「' || v_gb || '」' else '' end || '会收到 Email。批准后节目会自动交换。');
end $$;

create or replace function private.swap_apply(r public.program_swaps) returns text
language plpgsql set search_path = '' as $$
declare a public.events; b public.events; v_drafts int := 0; d public.roster_drafts; c jsonb; changed boolean; w jsonb; i int; v jsonb;
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

  -- 轮值表草稿：这两天的节目名称、负责组、领会也一起换
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
  return case when v_drafts > 0 then '已更新 ' || v_drafts || ' 份轮值表。' else '' end;
end $$;

-- 批准：自动判断是以「行政组」还是「对方负责组」身份批准；两边都批准后马上交换
create or replace function public.approve_program_swap(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); r public.program_swaps; v_as text[] := '{}'; v_note text; v_req text; v_waiting text;
begin
  select * into r from public.program_swaps where id = p_id for update;
  if not found then raise exception '找不到这个申请。'; end if;
  if r.status <> '待批准' then raise exception '这个申请已经是「%」。', r.status; end if;
  if r.requester_id = (s ->> 'userId')::uuid then raise exception '不能批准自己的申请，要由其他人批准。'; end if;
  if r.exec_by = '' and private.is_exec(s) then
    update public.program_swaps set exec_by = s ->> 'name', exec_at = now() where id = r.id; v_as := v_as || '行政组'::text;
  end if;
  if r.other_by = '' and private.in_group(s, r.target_group) then
    update public.program_swaps set other_by = s ->> 'name', other_at = now() where id = r.id; v_as := v_as || r.target_group;
  end if;
  if cardinality(v_as) = 0 then
    raise exception '你不需要批准这个申请（要由行政组或「%」批准，或你那一份已经批准了）。', coalesce(nullif(r.target_group, ''), '对方负责组');
  end if;
  select * into r from public.program_swaps where id = r.id;
  perform private.log(s, '批准交换节目', '节目交换', r.id, array_to_string(v_as, '、'));
  select email into v_req from public.profiles where id = r.requester_id;

  if r.exec_by <> '' and r.other_by <> '' then
    v_note := private.swap_apply(r);
    update public.program_swaps set status = '已批准', done_at = now(), note = v_note where id = r.id;
    perform private.log(s, '交换节目', '节目', r.event_id || '⇄' || r.target_id, private.swap_desc(r));
    perform private.notify(array[v_req] || private.emails_by_group(r.event_group)
                             || case when r.target_group <> '' then private.emails_by_group(r.target_group) else '{}'::text[] end,
      private.swap_exec_emails(), '节目已交换：' || private.md(r.event_date) || ' ⇄ ' || private.md(r.target_date),
      array['节目交换申请已批准，系统已经交换好了：', '', private.swap_desc(r), '',
            '行政组批准：' || r.exec_by || case when r.other_by <> '（不需要）' then '　' || r.target_group || '批准：' || r.other_by else '' end,
            v_note, '', '节目列表和公开首页已经更新。排轮值表的同工请到「轮值表」按「同步节目」。']);
    return jsonb_build_object('success', true, 'applied', true, 'message', '已批准，节目已经交换。' || v_note);
  end if;
  v_waiting := case when r.exec_by = '' then '行政组' else r.target_group end;
  perform private.notify(array[v_req], '{}', '交换申请：' || array_to_string(v_as, '、') || ' 已批准',
    array['你的节目交换申请：', private.swap_desc(r), '', (s ->> 'name') || '（' || array_to_string(v_as, '、') || '）已批准，现在等待「' || v_waiting || '」批准。']);
  return jsonb_build_object('success', true, 'applied', false, 'message', '已批准，还要等「' || v_waiting || '」批准。');
end $$;

create or replace function public.reject_program_swap(p_id text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); r public.program_swaps; v_note text := left(coalesce(p_note, ''), 200); v_req text;
begin
  select * into r from public.program_swaps where id = p_id for update;
  if not found then raise exception '找不到这个申请。'; end if;
  if r.status <> '待批准' then raise exception '这个申请已经是「%」。', r.status; end if;
  if not private.is_exec(s) and not private.in_group(s, r.target_group) then
    raise exception '只有行政组或「%」可以不批准。', coalesce(nullif(r.target_group, ''), '对方负责组') using errcode = '42501';
  end if;
  update public.program_swaps set status = '未通过', note = (s ->> 'name') || ' 不批准' || case when v_note <> '' then '：' || v_note else '' end,
         done_at = now() where id = r.id;
  perform private.log(s, '不批准交换节目', '节目交换', r.id, v_note);
  select email into v_req from public.profiles where id = r.requester_id;
  perform private.notify(array[v_req], '{}', '交换申请未通过',
    array['你的节目交换申请：', private.swap_desc(r), '', (s ->> 'name') || ' 不批准。' || case when v_note <> '' then '原因：' || v_note else '' end, '节目维持原来的日期。']);
  return jsonb_build_object('success', true, 'message', '已记录不批准，申请人会收到 Email。');
end $$;

create or replace function public.cancel_program_swap(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); r public.program_swaps;
begin
  select * into r from public.program_swaps where id = p_id for update;
  if not found then raise exception '找不到这个申请。'; end if;
  if r.status <> '待批准' then raise exception '这个申请已经是「%」。', r.status; end if;
  if r.requester_id is distinct from (s ->> 'userId')::uuid and not private.is_admin(s) then
    raise exception '只有申请人自己可以取消。' using errcode = '42501';
  end if;
  update public.program_swaps set status = '已取消', note = (s ->> 'name') || ' 取消', done_at = now() where id = r.id;
  return jsonb_build_object('success', true, 'message', '申请已取消。');
end $$;

/* ============================================================
   网站设定、活动报告
   ============================================================ */

create or replace function public.get_site_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := private.session(); st jsonb := (select coalesce(jsonb_object_agg(key, value), '{}') from public.site_settings);
begin
  return jsonb_build_object('success', true, 'canEdit', not (s ->> 'readOnly')::boolean,
    'settings', jsonb_build_object('banner', coalesce(st ->> '大合照', ''), 'heroTitle', coalesce(st ->> '首页标题', ''),
                                   'heroSubtitle', coalesce(st ->> '首页副标题', ''), 'instagram', coalesce(st ->> 'Instagram 链接', ''),
                                   'logo', coalesce(st ->> 'logo', '')),
    'reports', (select coalesce(jsonb_agg(private.report_json(r) order by r.date desc nulls last, r.id desc), '[]'::jsonb)
                  from public.activity_reports r where r.deleted_at is null));
end $$;

create or replace function public.save_site_settings(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); k text; v_map jsonb := jsonb_build_object(
  'banner', '大合照', 'heroTitle', '首页标题', 'heroSubtitle', '首页副标题', 'instagram', 'Instagram 链接', 'logo', 'logo');
begin
  for k in select jsonb_object_keys(v_map) loop
    if p_data ? k then
      update public.site_settings set value = left(coalesce(p_data ->> k, ''), 1000), updated_at = now() where key = v_map ->> k;
    end if;
  end loop;
  perform private.log(s, '修改网站设定', '系统设置', '', s ->> 'name');
  return jsonb_build_object('success', true, 'message', '已保存，首页重新整理就会看到。');
end $$;

create or replace function public.save_activity_report(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); r public.activity_reports; v_title text := btrim(coalesce(p_data ->> 'title', ''));
begin
  if v_title = '' then raise exception '请填写标题。'; end if;
  if coalesce(p_data ->> 'id', '') <> '' then
    select * into r from public.activity_reports where id = p_data ->> 'id' and deleted_at is null for update;
    if not found then raise exception '找不到这份报告。'; end if;
    if not private.is_exec(s) and r.created_by_id is distinct from (s ->> 'userId')::uuid then
      raise exception '只有建立这份报告的人或行政组可以修改。' using errcode = '42501';
    end if;
    update public.activity_reports set event_id = coalesce(p_data ->> 'eventId', ''),
           date = coalesce(private.parse_date(p_data ->> 'date'), private.today()), title = left(v_title, 200),
           content = left(coalesce(p_data ->> 'content', ''), 20000), cover_url = left(coalesce(p_data ->> 'cover', ''), 1000),
           album_url = left(coalesce(p_data ->> 'album', ''), 1000), is_public = coalesce((p_data ->> 'isPublic')::boolean, false),
           updated_at = now()
     where id = r.id returning * into r;
  else
    insert into public.activity_reports (event_id, date, title, content, cover_url, album_url, is_public, created_by, created_by_id)
    values (coalesce(p_data ->> 'eventId', ''), coalesce(private.parse_date(p_data ->> 'date'), private.today()), left(v_title, 200),
            left(coalesce(p_data ->> 'content', ''), 20000), left(coalesce(p_data ->> 'cover', ''), 1000),
            left(coalesce(p_data ->> 'album', ''), 1000), coalesce((p_data ->> 'isPublic')::boolean, false),
            s ->> 'name', (s ->> 'userId')::uuid)
    returning * into r;
  end if;
  perform private.log(s, '保存活动报告', '活动报告', r.id, r.title);
  return jsonb_build_object('success', true, 'id', r.id, 'message', '已保存。');
end $$;

create or replace function public.delete_activity_report(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); r public.activity_reports;
begin
  select * into r from public.activity_reports where id = p_id and deleted_at is null for update;
  if not found then raise exception '找不到这份报告。'; end if;
  if not private.is_exec(s) and r.created_by_id is distinct from (s ->> 'userId')::uuid then
    raise exception '只有建立这份报告的人或行政组可以删除。' using errcode = '42501';
  end if;
  update public.activity_reports set deleted_at = now(), deleted_by = coalesce(s ->> 'name', '') where id = r.id;
  perform private.log(s, '删除活动报告', '活动报告', r.id, r.title);
  return jsonb_build_object('success', true);
end $$;

/* ============================================================
   意见箱（后台）
   ============================================================ */

create or replace function public.list_feedback() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := private.session(); v_exec boolean := private.is_exec(s);
begin
  if (s ->> 'readOnly')::boolean then return jsonb_build_object('success', true, 'feedback', '[]'::jsonb); end if;
  return jsonb_build_object('success', true, 'feedback', (select coalesce(jsonb_agg(
    jsonb_build_object('意见编号', f.id, '提交时间', private.ts_admin(f.submitted_at), '类别', f.category, '内容', f.content,
                       '称呼', f.name, '状态', f.status, '处理备注', f.note, '处理人', f.handled_by, '更新时间', private.ts_admin(f.updated_at))
    || case when v_exec then jsonb_build_object('联络方式', f.contact) else '{}'::jsonb end
    order by f.submitted_at), '[]'::jsonb) from public.feedback f));
end $$;

create or replace function public.update_feedback(p_id text, p_status text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff();
begin
  if coalesce(p_status, '') <> '' and not (p_status = any (array['新', '处理中', '已处理'])) then raise exception '状态不正确。'; end if;
  update public.feedback set status = coalesce(nullif(p_status, ''), status),
         note = case when p_note is not null then left(p_note, 1000) else note end,
         handled_by = coalesce(s ->> 'name', ''), updated_at = now()
   where id = p_id;
  if not found then raise exception '找不到这则意见。'; end if;
  return jsonb_build_object('success', true);
end $$;

/* ---------- 权限 ---------- */
do $$
declare f text;
begin
  foreach f in array array['public.get_public_portal_data()', 'public.get_portal_branding()', 'public.submit_feedback(jsonb)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.get_admin_events()', 'public.save_event(jsonb)', 'public.save_extra_roster(jsonb)', 'public.delete_extra_roster(text)',
    'public.save_event_roster(text, jsonb)', 'public.get_roster_data()', 'public.get_roster_draft(text)', 'public.save_roster_pool(jsonb)',
    'public.save_roster_draft(jsonb)', 'public.publish_roster_draft(jsonb)', 'public.request_program_swap(jsonb)',
    'public.approve_program_swap(text)', 'public.reject_program_swap(text, text)', 'public.cancel_program_swap(text)',
    'public.get_site_settings()', 'public.save_site_settings(jsonb)', 'public.save_activity_report(jsonb)',
    'public.delete_activity_report(text)', 'public.list_feedback()', 'public.update_feedback(text, text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
