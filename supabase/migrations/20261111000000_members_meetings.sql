-- 阶段 3：契友资料、会议记录（档案）、轮值表补上契友名单
-- 规格来源：legacy/gas/src/AdminBackend.gs（saveAdminMember、member_autoAgeOut_、uploadMeetingDoc、getRosterData）
-- 注意：这个档案不用任何删除类的指令（Supabase 会要求确认，用户在手机上看不到确认框）。

/* ============================================================
   资料表
   ============================================================ */

create sequence public.member_code_seq;
create table public.members (
  id text primary key default ('CY-' || lpad(nextval('public.member_code_seq')::text, 4, '0')),
  name text not null check (char_length(name) between 1 and 60),
  english_name text not null default '',
  nickname text not null default '',
  phone text not null default '',
  email text not null default '',
  gender text not null default '',
  birthday date,
  grp text not null default '',            -- 小组
  position text not null default '',       -- 职位
  membership text not null default '未入会', -- 入会状态
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  status_reason text not null default '',
  needs_care boolean not null default false,
  photo_url text not null default '',
  join_date date,
  remark text not null default '',         -- 备注：只有管理员、主席、副主席、文书看得到
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.members enable row level security;

create sequence public.meeting_doc_code_seq;
create table public.meeting_docs (
  id text primary key default ('MTG-' || lpad(nextval('public.meeting_doc_code_seq')::text, 4, '0')),
  meeting_date date,
  name text not null,
  doc_type text not null default '',
  file_path text not null default '',      -- Storage「meeting-docs」里的路径（档案不公开）
  file_url text not null default '',       -- 旧资料的外部链接（例如 Google Drive）
  uploaded_by text not null default '',
  created_at timestamptz not null default now()
);
alter table public.meeting_docs enable row level security;

-- 契友年龄上限（0 = 不自动处理）。例如设 30：满 31 岁的活跃契友会自动改成不活跃（原因：超龄）。
insert into public.app_settings (key, value, note)
values ('member_age_limit', '0'::jsonb, '契友年龄上限（0 = 不自动处理）')
on conflict (key) do nothing;

/* ============================================================
   内部工具
   ============================================================ */

create or replace function private.member_age_limit() returns int
language sql stable set search_path = '' as $$
  select coalesce((select (value #>> '{}')::int from public.app_settings where key = 'member_age_limit'), 0)
$$;

create or replace function private.age(p_birthday date) returns int
language sql stable set search_path = '' as $$
  select case when p_birthday is null then null else extract(year from age(private.today(), p_birthday))::int end
$$;

-- 马来西亚手机号码统一成 012-3456789 的格式（旧版 member_phone_）
create or replace function private.member_phone(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare s text := btrim(coalesce(p, '')); d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d ~ '^0?1\d{8,9}$' then
    if left(d, 1) <> '0' then d := '0' || d; end if;
    return left(d, 3) || '-' || substr(d, 4);
  end if;
  return left(s, 30);
end $$;

create or replace function private.member_json(m public.members, p_private boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    '契友编号', m.id, '姓名', m.name, '英文名', m.english_name, '称呼', m.nickname, '电话号码', m.phone, '电邮', m.email,
    '性别', m.gender, '生日', private.d_admin(m.birthday), '年龄', coalesce(private.age(m.birthday)::text, ''),
    '小组', m.grp, '职位', m.position, '入会状态', m.membership, '状态', m.status, '状态原因', m.status_reason,
    '需要关心', case when m.needs_care then '是' else '' end, '照片链接', m.photo_url, '加入日期', private.d_admin(m.join_date),
    '建立时间', private.ts_admin(m.created_at), '更新日期', private.ts_admin(m.updated_at))
  || case when p_private then jsonb_build_object('备注', m.remark) else '{}'::jsonb end
$$;

-- 超龄的活跃契友自动改成不活跃（旧版 member_autoAgeOut_）
create or replace function private.member_age_out() returns int
language plpgsql set search_path = '' as $$
declare v_limit int := private.member_age_limit(); v_count int;
begin
  if v_limit <= 0 then return 0; end if;
  update public.members set status = 'INACTIVE', status_reason = '超龄', updated_at = now()
   where status = 'ACTIVE' and birthday is not null and private.age(birthday) > v_limit;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

/* ============================================================
   契友
   ============================================================ */

-- 契友名单：只有当届职员看得到；「备注」只给管理员、主席、副主席、文书
create or replace function public.list_members() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.session(); v_priv boolean;
begin
  if (s ->> 'readOnly')::boolean then
    return jsonb_build_object('success', true, 'members', '[]'::jsonb, 'ageLimit', private.member_age_limit());
  end if;
  perform private.member_age_out();
  v_priv := private.can_see_member_private(s);
  return jsonb_build_object('success', true, 'ageLimit', private.member_age_limit(),
    'members', (select coalesce(jsonb_agg(private.member_json(m, v_priv) order by m.id), '[]'::jsonb) from public.members m));
end $$;

create or replace function public.save_member(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s jsonb := private.require_staff(); m public.members;
  v_id text := nullif(btrim(coalesce(p_data ->> 'memberId', '')), '');
  v_name text := private.clip(p_data ->> 'name', 60);
  v_active boolean := coalesce((p_data ->> 'active')::boolean, true);
  v_priv boolean := private.can_see_member_private(s);
begin
  if v_name = '' then raise exception '华文姓名必填。'; end if;
  if v_id is not null then
    select * into m from public.members where id = v_id for update;
    if not found then raise exception '找不到这位契友。'; end if;
  else
    insert into public.members (name) values (v_name) returning * into m;
  end if;
  update public.members set
    name = v_name, nickname = v_name,
    english_name = private.clip(p_data ->> 'englishName', 60),
    phone = private.member_phone(p_data ->> 'phone'),
    gender = private.clip(p_data ->> 'gender', 10),
    birthday = private.parse_date(p_data ->> 'birthday'),
    grp = private.clip(p_data ->> 'group', 40),
    membership = coalesce(nullif(private.clip(p_data ->> 'status', 20), ''), '未入会'),
    status = case when v_active then 'ACTIVE' else 'INACTIVE' end,
    status_reason = case when v_active then '' else private.clip(p_data ->> 'reason', 60) end,
    needs_care = coalesce((p_data ->> 'care')::boolean, false),
    remark = case when v_priv then left(coalesce(p_data ->> 'remark', ''), 500) else remark end,  -- 没权限的人保存时保留原本的备注
    updated_at = now()
  where id = m.id;
  perform private.log(s, case when v_id is null then '新增契友' else '更新契友' end, '契友', m.id, '');
  return jsonb_build_object('success', true, 'memberId', m.id);
end $$;

/* ============================================================
   会议记录（档案放在 Storage「meeting-docs」，不公开）
   ============================================================ */

create or replace function public.list_meeting_docs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := private.session();
begin
  return jsonb_build_object('success', true, 'meetings', (select coalesce(jsonb_agg(jsonb_build_object(
    '记录编号', d.id, '会议日期', private.d_admin(d.meeting_date), '会议名称', d.name, '档案类型', d.doc_type,
    '档案路径', d.file_path, '档案链接', d.file_url, '建立时间', private.ts_admin(d.created_at)) order by d.meeting_date, d.id), '[]'::jsonb)
    from public.meeting_docs d));
end $$;

create or replace function public.save_meeting_doc(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); d public.meeting_docs; v_path text := btrim(coalesce(p_data ->> 'path', ''));
begin
  if private.clip(p_data ->> 'name', 200) = '' then raise exception '请填写会议名称。'; end if;
  if v_path = '' or v_path !~ '^[0-9]{4}/[A-Za-z0-9._-]+$' then raise exception '档案路径不正确，请重新上传。'; end if;
  insert into public.meeting_docs (meeting_date, name, doc_type, file_path, uploaded_by)
  values (private.parse_date(p_data ->> 'date'), private.clip(p_data ->> 'name', 200), private.clip(p_data ->> 'type', 40),
          v_path, coalesce(s ->> 'name', ''))
  returning * into d;
  perform private.log(s, '上传会议记录', '会议记录', d.id, d.name);
  return jsonb_build_object('success', true, 'id', d.id, 'message', '会议档案已成功上传。');
end $$;

/* ---------- 给 Storage 规则用：只回答「我自己」 ---------- */
create or replace function public.is_current_staff() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return true;
exception when others then
  return false;
end $$;

create or replace function public.is_signed_in_member() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.session();
  return true;
exception when others then
  return false;
end $$;

/* ============================================================
   轮值表：补上契友名单和不活跃名单（自动排表时跳过不活跃的人）
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
    'members', (select coalesce(jsonb_agg(m.name order by m.id), '[]'::jsonb) from public.members m where m.status = 'ACTIVE'),
    'inactive', (select coalesce(jsonb_agg(distinct n), '[]'::jsonb) from public.members m,
                   unnest(array[m.name, m.nickname]) n where m.status = 'INACTIVE' and btrim(n) <> ''),
    'ministryDates', '[]'::jsonb,  -- 阶段 5（事工）补上
    'staff', v_staff,
    'currentYear', v_cy);
end $$;

/* ---------- 权限 ---------- */
do $$
declare f text;
begin
  foreach f in array array['public.list_members()', 'public.save_member(jsonb)', 'public.list_meeting_docs()',
                           'public.save_meeting_doc(jsonb)', 'public.is_current_staff()', 'public.is_signed_in_member()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

/* ---------- Storage：会议记录档案（不公开；职员上传，有登入的职员 / 卸任职员可以看） ---------- */
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $q$
      insert into storage.buckets (id, name, public, file_size_limit)
      values ('meeting-docs', 'meeting-docs', false, 26214400)
      on conflict (id) do nothing
    $q$;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'meeting docs: staff upload') then
      execute $q$
        create policy "meeting docs: staff upload" on storage.objects
          for insert to authenticated
          with check (bucket_id = 'meeting-docs' and public.is_current_staff())
      $q$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'meeting docs: members read') then
      execute $q$
        create policy "meeting docs: members read" on storage.objects
          for select to authenticated
          using (bucket_id = 'meeting-docs' and public.is_signed_in_member())
      $q$;
    end if;
  end if;
end $$;
