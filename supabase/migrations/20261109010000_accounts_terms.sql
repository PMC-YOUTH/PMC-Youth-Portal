-- 阶段 1：账号、任期、权限、操作记录、Email 队列
-- 规格来源：legacy/gas/src/AdminBackend.gs（登入、权限、账号与任期管理）
-- 所有资料表开 RLS、不给前端任何表权限；前端只能呼叫下面 grant 过的 public 函数。

/* ============================================================
   资料表
   ============================================================ */

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  note text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
insert into public.app_settings (key, value, note)
values ('current_year', to_jsonb(extract(year from (now() at time zone 'Asia/Kuala_Lumpur'))::int),
        '职员会当届年份（管理员在后台交接时更新）')
on conflict (key) do nothing;

create sequence public.profile_code_seq;
create sequence public.term_code_seq;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  code text not null unique default ('USR-' || lpad(nextval('public.profile_code_seq')::text, 4, '0')),
  name text not null check (char_length(name) between 1 and 40),
  email text not null unique,
  phone text not null default '' check (char_length(phone) <= 30),
  status text not null default 'PENDING' check (status in ('ACTIVE', 'PENDING', 'INACTIVE', 'REJECTED')),
  is_sys_admin boolean not null default false,
  view_as_role text,
  view_as_group text,
  created_at timestamptz not null default now(),
  last_login timestamptz
);
alter table public.profiles enable row level security;

create table public.terms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('TRM-' || lpad(nextval('public.term_code_seq')::text, 4, '0')),
  year int not null check (year between 2000 and 2100),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  grp text not null check (grp in ('行政组', '信仰组', '见证组', '宣教组', '公民组', '团契组', '财政', '文书', '查账')),
  role text not null check (role in ('管理员', '主席', '副主席', '财政', '查账', '文书', '职员')),
  status text not null check (status in ('待批准', '在任', '已卸任', '已辞职', '未通过', '已移除')),
  start_date date,
  end_date date,
  note text not null default '',
  created_at timestamptz not null default now()
);
alter table public.terms enable row level security;
-- 同一个人同一届：最多一个「在任」；「待批准 / 在任」合起来最多一个
create unique index terms_one_active_per_year on public.terms (user_id, year) where status = '在任';
create unique index terms_one_open_per_year on public.terms (user_id, year) where status in ('待批准', '在任');
create index terms_year_status on public.terms (year, status);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  name text not null default '',
  role text not null default '',
  action text not null,
  module text not null default '',
  data_id text not null default '',
  description text not null default ''
);
alter table public.audit_logs enable row level security;

-- Email 队列：动作成功时在同一交易里排进来，由寄信程序（阶段 6）寄出
create table public.email_outbox (
  id bigint generated always as identity primary key,
  to_emails text[] not null,
  cc_emails text[] not null default '{}',
  subject text not null,
  lines text[] not null default '{}',
  hide_button boolean not null default false,
  status text not null default 'PENDING' check (status in ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.email_outbox enable row level security;
create index email_outbox_pending on public.email_outbox (created_at) where status = 'PENDING';

/* ============================================================
   内部工具（private，前端呼叫不到）
   ============================================================ */

create or replace function private.today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kuala_Lumpur')::date
$$;

create or replace function private.fmt_ts(t timestamptz) returns text
language sql stable set search_path = '' as $$
  select coalesce(to_char(t at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD HH24:MI'), '')
$$;

create or replace function private.fmt_date(d date) returns text
language sql immutable set search_path = '' as $$
  select coalesce(to_char(d, 'YYYY-MM-DD'), '')
$$;

create or replace function private.current_year() returns int
language sql stable set search_path = '' as $$
  select coalesce((select (value #>> '{}')::int from public.app_settings where key = 'current_year'),
                  extract(year from (now() at time zone 'Asia/Kuala_Lumpur'))::int)
$$;

create or replace function private.roles() returns text[]
language sql immutable set search_path = '' as $$
  select array['管理员', '主席', '副主席', '财政', '查账', '文书', '职员']
$$;

create or replace function private.groups() returns text[]
language sql immutable set search_path = '' as $$
  select array['行政组', '信仰组', '见证组', '宣教组', '公民组', '团契组', '财政', '文书', '查账']
$$;

-- 注册 / 申请时可选：主席、副主席 → 行政组；文书、财政、查账 → 各自职位；其他 → 该组职员
create or replace function private.choice_ok(p_choice text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_choice, '') = any (array['主席', '副主席', '文书', '财政', '查账', '信仰组', '见证组', '宣教组', '公民组', '团契组']
                                       || private.groups())
$$;

create or replace function private.choice_group(p_choice text) returns text
language sql immutable set search_path = '' as $$
  select case when p_choice in ('主席', '副主席') then '行政组' else p_choice end
$$;

create or replace function private.choice_role(p_choice text) returns text
language sql immutable set search_path = '' as $$
  select case when p_choice in ('主席', '副主席', '文书', '财政', '查账') then p_choice else '职员' end
$$;

create or replace function private.norm_group(g text) returns text
language sql immutable set search_path = '' as $$
  select case btrim(coalesce(g, ''))
    when '行政' then '行政组' when '信仰' then '信仰组' when '见证' then '见证组'
    when '宣教' then '宣教组' when '公民' then '公民组' when '团契' then '团契组'
    when 'ALL' then '全部' else btrim(coalesce(g, '')) end
$$;

/* ---------- 目前登入者的身份（等于旧版 auth_buildSession_ + 切换身份） ---------- */
create or replace function private.session() returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_cy int := private.current_year();
  p public.profiles;
  cur public.terms;
  past public.terms;
  v_role text; v_group text; v_ro boolean; v_view_year int; v_view_as boolean := false; v_real_group text;
  v_terms jsonb;
begin
  if v_uid is null then raise exception '登录已过期，请重新登录。' using errcode = '28000'; end if;
  select * into p from public.profiles where id = v_uid;
  if not found then raise exception '找不到你的账号资料，请联系管理员。' using errcode = '28000'; end if;
  if p.status = 'PENDING' then raise exception '你的账号还在等待管理员或主席批准，批准后会以 Email 通知你。' using errcode = '28000'; end if;
  if p.status <> 'ACTIVE' then raise exception '这个账号目前未启用，请联系管理员。' using errcode = '28000'; end if;

  select * into cur from public.terms where user_id = v_uid and year = v_cy and status = '在任' limit 1;
  if found then
    v_role := coalesce(nullif(btrim(cur.role), ''), '职员'); v_group := cur.grp; v_ro := false; v_view_year := v_cy;
  else
    select * into past from public.terms
      where user_id = v_uid and status in ('在任', '已卸任', '已辞职') and year <= v_cy
      order by year desc limit 1;
    if found then
      v_role := '卸任'; v_group := past.grp; v_ro := true; v_view_year := past.year;
    else
      v_role := '无任期'; v_group := ''; v_ro := true; v_view_year := v_cy;
    end if;
  end if;
  v_real_group := v_group;

  if p.is_sys_admin then
    v_role := '管理员'; v_ro := false; v_view_year := v_cy;
    if p.view_as_role is not null then
      v_role := p.view_as_role; v_group := coalesce(p.view_as_group, ''); v_ro := (p.view_as_role = '卸任'); v_view_as := true;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'year', t.year, 'group', t.grp, 'role', t.role, 'status', t.status)
                            order by t.year, t.created_at), '[]'::jsonb)
    into v_terms from public.terms t where t.user_id = v_uid;

  return jsonb_build_object(
    'userId', p.id, 'code', p.code, 'name', p.name, 'email', p.email, 'loginId', p.email,
    'termYear', v_cy, 'isSysAdmin', p.is_sys_admin, 'terms', v_terms,
    'role', v_role, 'group', v_group, 'realGroup', v_real_group, 'readOnly', v_ro,
    'viewYear', v_view_year, 'viewAs', v_view_as);
end $$;

/* ---------- 权限（规则照旧版 perm_*） ---------- */
create or replace function private.is_admin(s jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(not (s ->> 'readOnly')::boolean
    and (s ->> 'role' = '管理员' or ((s ->> 'isSysAdmin')::boolean and not (s ->> 'viewAs')::boolean)), false)
$$;

create or replace function private.is_exec(s jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(not (s ->> 'readOnly')::boolean and (
    private.is_admin(s)
    or s ->> 'role' = any (array['主席', '副主席', '文书', '财政', '查账'])
    or private.norm_group(s ->> 'group') = any (array['行政组', '文书', '财政', '查账'])), false)
$$;

create or replace function private.is_finance(s jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(not (s ->> 'readOnly')::boolean and (private.is_admin(s) or s ->> 'role' = any (array['财政', '查账'])), false)
$$;

create or replace function private.can_see_member_private(s jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(not (s ->> 'readOnly')::boolean
    and (private.is_admin(s) or s ->> 'role' = any (array['管理员', '主席', '副主席', '文书'])), false)
$$;

create or replace function private.perm_summary(s jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('admin', private.is_admin(s), 'exec', private.is_exec(s), 'finance', private.is_finance(s),
                            'memberPrivate', private.can_see_member_private(s), 'staff', not (s ->> 'readOnly')::boolean)
$$;

-- 当届在任职员（可以修改资料的人）
create or replace function private.require_staff() returns jsonb
language plpgsql stable set search_path = '' as $$
declare s jsonb := private.session();
begin
  if (s ->> 'readOnly')::boolean then raise exception '你目前没有当届任期，只能查看以前的资料。' using errcode = '42501'; end if;
  return s;
end $$;

-- 账号管理：管理员或当届主席
create or replace function private.require_account_manager() returns jsonb
language plpgsql stable set search_path = '' as $$
declare s jsonb := private.require_staff();
begin
  if not (s ->> 'role' = any (array['管理员', '主席'])) then
    raise exception '只有管理员或主席可以管理账号。' using errcode = '42501';
  end if;
  return s;
end $$;

-- 主席的限制：不能指派「管理员」、不能改职位是管理员的任期、不能改系统管理员的账号
create or replace function private.chair_guard(s jsonb, p_new_role text, p_term_role text, p_target_sys_admin boolean)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if private.is_admin(s) then return; end if;
  if p_new_role = '管理员' then raise exception '主席不能指派「管理员」职位，请联系系统管理员。' using errcode = '42501'; end if;
  if p_term_role = '管理员' then raise exception '这个任期是管理员，只有系统管理员可以修改。' using errcode = '42501'; end if;
  if coalesce(p_target_sys_admin, false) then raise exception '这是系统管理员的账号，主席不能修改。' using errcode = '42501'; end if;
end $$;

create or replace function private.log(s jsonb, p_action text, p_module text, p_data_id text, p_desc text)
returns void language sql set search_path = '' as $$
  insert into public.audit_logs (user_id, name, role, action, module, data_id, description)
  values (nullif(s ->> 'userId', '')::uuid, coalesce(s ->> 'name', ''), coalesce(s ->> 'role', ''),
          p_action, coalesce(p_module, ''), coalesce(p_data_id, ''), left(coalesce(p_desc, ''), 1000))
$$;

/* ---------- Email 队列与收件人（照旧版 notify_*） ---------- */
create or replace function private.notify(p_to text[], p_cc text[], p_subject text, p_lines text[], p_hide_button boolean default false)
returns void language plpgsql set search_path = '' as $$
declare v_to text[]; v_cc text[];
begin
  select coalesce(array_agg(distinct lower(btrim(e))), '{}') into v_to from unnest(coalesce(p_to, '{}')) e where btrim(coalesce(e, '')) <> '';
  select coalesce(array_agg(distinct lower(btrim(e))), '{}') into v_cc from unnest(coalesce(p_cc, '{}')) e
    where btrim(coalesce(e, '')) <> '' and not (lower(btrim(e)) = any (v_to));
  if cardinality(v_to) = 0 then v_to := v_cc; v_cc := '{}'; end if;
  if cardinality(v_to) = 0 then return; end if;
  insert into public.email_outbox (to_emails, cc_emails, subject, lines, hide_button)
  values (v_to, v_cc, p_subject, array(select l from unnest(coalesce(p_lines, '{}')) l where l is not null), coalesce(p_hide_button, false));
end $$;

-- 当届在任、职位符合的人（含「管理员」时也包括系统管理员）
create or replace function private.emails_by_role(p_roles text[]) returns text[]
language sql stable set search_path = '' as $$
  select coalesce(array_agg(distinct e), '{}') from (
    select lower(p.email) e from public.terms t join public.profiles p on p.id = t.user_id
     where t.year = private.current_year() and t.status = '在任' and t.role = any (p_roles) and p.status = 'ACTIVE'
    union
    select lower(p.email) from public.profiles p
     where '管理员' = any (p_roles) and p.is_sys_admin and p.status = 'ACTIVE'
  ) x
$$;

-- 当届在任、属于某一组的人
create or replace function private.emails_by_group(p_group text) returns text[]
language sql stable set search_path = '' as $$
  select coalesce(array_agg(distinct lower(p.email)), '{}') from public.terms t join public.profiles p on p.id = t.user_id
   where t.year = private.current_year() and t.status = '在任' and private.norm_group(t.grp) = p_group and p.status = 'ACTIVE'
$$;

/* ============================================================
   注册：Supabase Auth 建立用户时自动建账号资料 + 任期申请（等于旧版 registerAccount）
   前端用 supabase.auth.signUp({ email, password, options: { data: { name, phone, group, year } } })
   ============================================================ */
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text := left(btrim(coalesce(m ->> 'name', '')), 40);
  v_phone text := left(btrim(coalesce(m ->> 'phone', '')), 30);
  v_choice text := btrim(coalesce(m ->> 'group', ''));
  v_cy int := private.current_year();
  v_year int;
  v_email text := lower(btrim(coalesce(new.email, '')));
begin
  -- 不是从注册页建立的（例如在 Dashboard 手动建）：只建账号资料，等管理员处理
  if m ->> 'name' is null then
    insert into public.profiles (id, name, email, status) values (new.id, left(split_part(v_email, '@', 1), 40), v_email, 'PENDING');
    return new;
  end if;

  v_year := case when coalesce(m ->> 'year', '') ~ '^\d{4}$' then (m ->> 'year')::int else v_cy end;
  if v_name = '' then raise exception '请填写姓名。'; end if;
  if not private.choice_ok(v_choice) then raise exception '请选择你的组别 / 职位。'; end if;
  if v_year not in (v_cy, v_cy + 1) then raise exception '只能申请加入当届或下一届。'; end if;

  insert into public.profiles (id, name, email, phone, status) values (new.id, v_name, v_email, v_phone, 'PENDING');
  insert into public.terms (year, user_id, name, grp, role, status)
  values (v_year, new.id, v_name, private.choice_group(v_choice), private.choice_role(v_choice), '待批准');

  perform private.notify(private.emails_by_role(array['管理员', '主席']), '{}',
    '新账号等待批准：' || v_name || '（' || v_year || ' 届 ' || v_choice || '）',
    array_remove(array['有新的职员注册，等待你批准。', '', '姓名：' || v_name, 'Email：' || v_email,
          '申请加入：' || v_year || ' 届　' || v_choice,
          case when v_phone <> '' then '电话：' || v_phone end, '', '请到后台「账号管理」批准并确认职位。'], null));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

/* ============================================================
   给前端用的 API（public，security definer，第一行检查身份）
   ============================================================ */

-- 目前登入者的资料与权限（等于 adminLogin 后的 session / getAdminSession）
create or replace function public.get_my_session(p_login boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.session();
begin
  if p_login then update public.profiles set last_login = now() where id = (s ->> 'userId')::uuid; end if;
  return jsonb_build_object('success', true, 'user', s, 'perms', private.perm_summary(s));
end $$;

-- 已有账号的人申请加入当届或下一届（含卸任只读的人）
create or replace function public.apply_for_term(p_year int, p_choice text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.session(); v_cy int := private.current_year();
begin
  if p_year is null or p_year not in (v_cy, v_cy + 1) then raise exception '只能申请加入当届或下一届。'; end if;
  if not private.choice_ok(p_choice) then raise exception '请选择组别 / 职位。'; end if;
  if exists (select 1 from public.terms where user_id = (s ->> 'userId')::uuid and year = p_year and status in ('待批准', '在任')) then
    raise exception '你在 % 届已经有任期或申请了。', p_year;
  end if;
  insert into public.terms (year, user_id, name, grp, role, status)
  values (p_year, (s ->> 'userId')::uuid, s ->> 'name', private.choice_group(p_choice), private.choice_role(p_choice), '待批准');
  perform private.notify(private.emails_by_role(array['管理员', '主席']), '{}',
    (s ->> 'name') || ' 申请加入 ' || p_year || ' 届（' || p_choice || '）',
    array[(s ->> 'name') || '（' || (s ->> 'email') || '）申请加入 ' || p_year || ' 届　' || p_choice || '。', '', '请到后台「账号管理」批准。']);
  return jsonb_build_object('success', true, 'message', '已送出申请，管理员或主席批准后会通知你。');
end $$;

create or replace function public.list_accounts() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_account_manager(); v_full boolean := private.is_admin(s);
begin
  return jsonb_build_object(
    'success', true,
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object(
        'userId', p.id, 'code', p.code, 'name', p.name, 'email', p.email, 'phone', p.phone, 'status', p.status,
        'sysAdmin', p.is_sys_admin, 'hasPassword', true,
        'createdAt', private.fmt_ts(p.created_at), 'lastLogin', private.fmt_ts(p.last_login)) order by p.created_at), '[]'::jsonb)
      from public.profiles p),
    'terms', (select coalesce(jsonb_agg(jsonb_build_object(
        'termId', t.id, 'code', t.code, 'year', t.year, 'userId', t.user_id, 'name', t.name, 'group', t.grp, 'role', t.role,
        'status', t.status, 'start', private.fmt_date(t.start_date), 'end', private.fmt_date(t.end_date), 'note', t.note,
        'createdAt', private.fmt_ts(t.created_at)) order by t.year, t.created_at), '[]'::jsonb)
      from public.terms t),
    'currentYear', private.current_year(),
    'roles', to_jsonb(case when v_full then private.roles() else array_remove(private.roles(), '管理员') end),
    'groups', to_jsonb(private.groups()),
    'fullAdmin', v_full);
end $$;

create or replace function public.approve_term(p_term_id uuid, p_role text, p_group text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_account_manager(); t public.terms; u public.profiles; v_cy int := private.current_year();
begin
  if not (p_role = any (private.roles())) then raise exception '职位不正确。'; end if;
  if not (p_group = any (private.groups())) then raise exception '组别不正确。'; end if;
  select * into t from public.terms where id = p_term_id for update;
  if not found then raise exception '找不到这个任期。'; end if;
  select * into u from public.profiles where id = t.user_id for update;
  perform private.chair_guard(s, p_role, null, u.is_sys_admin);
  if exists (select 1 from public.terms where user_id = t.user_id and year = t.year and status = '在任' and id <> t.id) then
    raise exception '这个人在 % 届已经有在任的任期。', t.year;
  end if;
  update public.terms set status = '在任', role = p_role, grp = p_group,
         start_date = case when t.year = v_cy then private.today() else null end
   where id = t.id;
  if u.status <> 'ACTIVE' then update public.profiles set status = 'ACTIVE' where id = u.id; end if;
  perform private.log(s, '批准任期', '职员任期', t.code, t.year || '｜' || t.name || '｜' || p_group || '｜' || p_role);
  perform private.notify(array[u.email], '{}', '你已加入 ' || t.year || ' 届职员会',
    array['你好 ' || t.name || '，', '',
          (case when s ->> 'role' = '主席' then '主席 ' || (s ->> 'name') else '管理员' end) || ' 已批准你加入 ' || t.year || ' 届职员会。',
          '组别：' || p_group, '职位：' || p_role,
          case when t.year = v_cy then '现在就可以用你的 Email 和密码登入后台了。' else '这是下一届的任期，交接后会自动生效。' end]);
  return jsonb_build_object('success', true, 'message', '已批准。');
end $$;

create or replace function public.reject_term(p_term_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_account_manager(); t public.terms; u public.profiles;
begin
  select * into t from public.terms where id = p_term_id for update;
  if not found then raise exception '找不到这个任期。'; end if;
  select * into u from public.profiles where id = t.user_id for update;
  perform private.chair_guard(s, null, t.role, u.is_sys_admin);
  update public.terms set status = '未通过' where id = t.id;
  if u.status = 'PENDING' and not exists (
       select 1 from public.terms where user_id = u.id and id <> t.id and status in ('待批准', '在任', '已卸任', '已辞职')) then
    update public.profiles set status = 'REJECTED' where id = u.id;
  end if;
  perform private.log(s, '拒绝任期', '职员任期', t.code, t.year || '｜' || t.name);
  perform private.notify(array[u.email], '{}', '加入职员会的申请未通过',
    array['你好 ' || t.name || '，', '', '你申请加入 ' || t.year || ' 届职员会没有通过。如有疑问，请联系团契职员。'], true);
  return jsonb_build_object('success', true, 'message', '已拒绝。');
end $$;

create or replace function public.update_term(p_term_id uuid, p_changes jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_account_manager(); t public.terms; u public.profiles;
        v_role text := p_changes ->> 'role'; v_group text := p_changes ->> 'group';
begin
  select * into t from public.terms where id = p_term_id for update;
  if not found then raise exception '找不到这个任期。'; end if;
  select * into u from public.profiles where id = t.user_id;
  perform private.chair_guard(s, v_role, t.role, u.is_sys_admin);
  if v_role is not null and not (v_role = any (private.roles())) then raise exception '职位不正确。'; end if;
  if v_group is not null and not (v_group = any (private.groups())) then raise exception '组别不正确。'; end if;
  update public.terms set role = coalesce(v_role, role), grp = coalesce(v_group, grp) where id = t.id;
  perform private.log(s, '更新任期', '职员任期', t.code,
    jsonb_strip_nulls(jsonb_build_object('职位', v_role, '组别', v_group))::text);
  return jsonb_build_object('success', true, 'message', '任期已更新。');
end $$;

-- 辞职 / 替换 / 移除。p_opts：{ type: '辞职' | '移除', date: 'YYYY-MM-DD', note, replacementUserId }
create or replace function public.end_term(p_term_id uuid, p_opts jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s jsonb := private.require_account_manager(); t public.terms; u public.profiles; r public.profiles;
  v_note text := left(coalesce(p_opts ->> 'note', ''), 200);
  v_date date := private.today();
  v_busy public.terms;
begin
  select * into t from public.terms where id = p_term_id for update;
  if not found then raise exception '找不到这个任期。'; end if;
  select * into u from public.profiles where id = t.user_id;
  perform private.chair_guard(s, null, t.role, u.is_sys_admin);
  begin
    if coalesce(p_opts ->> 'date', '') <> '' then v_date := (p_opts ->> 'date')::date; end if;
  exception when others then v_date := private.today();
  end;

  if p_opts ->> 'type' = '移除' then
    update public.terms set status = '已移除', note = coalesce(nullif(v_note, ''), note) where id = t.id;
    perform private.log(s, '移除任期', '职员任期', t.code, t.year || '｜' || t.name);
    return jsonb_build_object('success', true, 'message', '任期已移除。');
  end if;

  if coalesce(p_opts ->> 'replacementUserId', '') <> '' then
    select * into r from public.profiles where id = (p_opts ->> 'replacementUserId')::uuid;
    if not found or r.status <> 'ACTIVE' then raise exception '接任的人必须是已启用的账号。'; end if;
    select * into v_busy from public.terms where user_id = r.id and year = t.year and status = '在任' and id <> t.id limit 1;
    if found then raise exception '% 在 % 届已经有在任的任期（%），请先调整。', r.name, t.year, v_busy.grp; end if;
  end if;

  update public.terms set status = '已辞职', end_date = v_date,
         note = (case when v_note <> '' then v_note || '；' else '' end) || (case when r.id is not null then '由 ' || r.name || ' 接任' else '' end)
   where id = t.id;

  if r.id is not null then
    -- 接任的人如果在这一届有待批准的申请，先关掉，避免重复
    update public.terms set status = '已移除', note = '由接任取代' where user_id = r.id and year = t.year and status = '待批准';
    insert into public.terms (year, user_id, name, grp, role, status, start_date, note)
    values (t.year, r.id, r.name, t.grp, t.role, '在任', v_date, '接任 ' || t.name);
    perform private.notify(array[r.email], '{}', '你已接任 ' || t.year || ' 届 ' || t.grp,
      array['你好 ' || r.name || '，', '', '你已接任 ' || t.name || ' 在 ' || t.year || ' 届的职务。',
            '组别：' || t.grp, '职位：' || t.role, '生效日期：' || private.fmt_date(v_date), '',
            '登入后台就可以看到这一组之前的事工与报告资料。']);
  end if;
  perform private.log(s, '辞职/替换', '职员任期', t.code, t.name || case when r.id is not null then ' → ' || r.name else '' end);
  return jsonb_build_object('success', true, 'message',
    case when r.id is not null then '已完成替换，' || r.name || ' 会收到 Email 通知。' else '已记录辞职。' end);
end $$;

-- 把某一届的在任名单复制到下一届
create or replace function public.copy_terms_to_year(p_from int, p_to int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_account_manager(); x public.terms; v_count int := 0;
begin
  if p_from is null or p_to is null or p_to <= p_from then raise exception '年份不正确。'; end if;
  for x in select * from public.terms where year = p_from and status in ('在任', '已卸任') order by created_at loop
    if exists (select 1 from public.terms where user_id = x.user_id and year = p_to and status not in ('已移除', '未通过')) then continue; end if;
    insert into public.terms (year, user_id, name, grp, role, status, note)
    values (p_to, x.user_id, x.name, x.grp, x.role, '在任', '从 ' || p_from || ' 届复制');
    v_count := v_count + 1;
  end loop;
  perform private.log(s, '复制任期', '职员任期', p_from || '→' || p_to, v_count || ' 人');
  return jsonb_build_object('success', true, 'message', '已复制 ' || v_count || ' 人到 ' || p_to || ' 届，请检查并修改换掉的人。');
end $$;

-- 换届交接：当届年份改成下一届，旧一届在任的人自动「已卸任」
create or replace function public.handover_to_year(p_new_year int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_account_manager(); v_cy int;
begin
  perform 1 from public.app_settings where key = 'current_year' for update;
  v_cy := private.current_year();
  if p_new_year is distinct from v_cy + 1 then raise exception '只能交接到下一届（%）。', v_cy + 1; end if;
  if not exists (select 1 from public.terms where year = p_new_year and status = '在任') then
    raise exception '% 届还没有任何在任的职员，请先批准或复制名单。', p_new_year;
  end if;
  update public.terms set status = '已卸任', end_date = private.today() where year = v_cy and status = '在任';
  update public.terms set start_date = private.today() where year = p_new_year and status = '在任' and start_date is null;
  insert into public.app_settings (key, value, note, updated_at)
  values ('current_year', to_jsonb(p_new_year), '职员会当届年份（管理员在后台交接时更新）', now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform private.log(s, '换届交接', '职员任期', p_new_year::text, v_cy || ' → ' || p_new_year || '（' || (s ->> 'name') || '）');
  return jsonb_build_object('success', true, 'message', '已交接到 ' || p_new_year || ' 届。');
end $$;

-- 账号启用 / 停用
create or replace function public.update_account(p_user_id uuid, p_changes jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_account_manager(); u public.profiles; v_status text := p_changes ->> 'status';
begin
  select * into u from public.profiles where id = p_user_id for update;
  if not found then raise exception '找不到这个账号。'; end if;
  perform private.chair_guard(s, null, null, u.is_sys_admin);
  if v_status is null or not (v_status = any (array['ACTIVE', 'PENDING', 'INACTIVE', 'REJECTED'])) then raise exception '状态不正确。'; end if;
  if u.id = (s ->> 'userId')::uuid and v_status <> 'ACTIVE' then raise exception '不能停用自己的账号。'; end if;
  update public.profiles set status = v_status where id = u.id;
  perform private.log(s, '更新账号状态', '用户', u.code, v_status);
  return jsonb_build_object('success', true, 'message', '账号已更新。');
end $$;

-- 管理员 / 主席帮人重设密码：检查权限并记录，回传 Email，由前端寄出 Supabase 重设密码链接
create or replace function public.prepare_password_reset(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_account_manager(); u public.profiles;
begin
  select * into u from public.profiles where id = p_user_id;
  if not found then raise exception '找不到这个账号。'; end if;
  perform private.chair_guard(s, null, null, u.is_sys_admin);
  if coalesce(u.email, '') = '' then raise exception '这个账号没有 Email，请对方重新注册。'; end if;
  perform private.log(s, '重设密码', '用户', u.code, u.email);
  return jsonb_build_object('success', true, 'email', u.email, 'name', u.name);
end $$;

-- 系统管理员「切换身份」测试权限
create or replace function public.switch_view_as(p_role text, p_group text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.session();
begin
  if not (s ->> 'isSysAdmin')::boolean then raise exception '只有系统管理员可以切换身份。' using errcode = '42501'; end if;
  if coalesce(p_role, '') in ('', '管理员') then
    update public.profiles set view_as_role = null, view_as_group = null where id = (s ->> 'userId')::uuid;
  else
    if p_role <> '卸任' and not (p_role = any (private.roles())) then raise exception '职位不正确。'; end if;
    if coalesce(p_group, '') <> '' and not (p_group = any (private.groups())) then raise exception '组别不正确。'; end if;
    update public.profiles set view_as_role = p_role, view_as_group = nullif(p_group, '') where id = (s ->> 'userId')::uuid;
  end if;
  s := private.session();
  return jsonb_build_object('success', true, 'user', s, 'perms', private.perm_summary(s));
end $$;

/* ---------- 只开放给登入者 ---------- */
do $$
declare f text;
begin
  foreach f in array array[
    'public.get_my_session(boolean)', 'public.apply_for_term(int, text)', 'public.list_accounts()',
    'public.approve_term(uuid, text, text)', 'public.reject_term(uuid)', 'public.update_term(uuid, jsonb)',
    'public.end_term(uuid, jsonb)', 'public.copy_terms_to_year(int, int)', 'public.handover_to_year(int)',
    'public.update_account(uuid, jsonb)', 'public.prepare_password_reset(uuid)', 'public.switch_view_as(text, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
