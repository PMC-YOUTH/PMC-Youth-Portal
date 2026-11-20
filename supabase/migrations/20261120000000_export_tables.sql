-- 网站设定「导出资料（CSV）」：给管理员手动备份。
-- 只有管理员（职位管理员，或没在「切换身份」的系统管理员；卸任只读不行）可以用。
-- 一次只回传一张表（前端逐张呼叫后打包成 ZIP），表名只能是下面清单里的，每次导出都记进操作记录。
-- 不导出：寄信队列、系统设定（app_settings）、签名图片。

create or replace function private.export_tables() returns text[]
language sql immutable set search_path = '' as $$
  select array['members', 'events', 'roster_assignments', 'roster_pool', 'roster_drafts', 'program_swaps',
               'ministries', 'ministry_updates', 'ministry_stats', 'ministry_submissions', 'ministry_meetings',
               'offerings', 'finance_txns', 'budgets', 'claims', 'meeting_docs', 'activity_reports', 'feedback',
               'site_settings', 'profiles', 'terms', 'audit_logs']
$$;

create or replace function public.export_table(p_table text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); v_rows jsonb;
begin
  if not private.is_admin(s) then raise exception '只有管理员可以导出资料。' using errcode = '42501'; end if;
  if p_table is null or not (p_table = any (private.export_tables())) then raise exception '不能导出这张表。'; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t', p_table) into v_rows;
  perform private.log(s, '导出资料', '系统设置', p_table, jsonb_array_length(v_rows) || ' 笔');
  return jsonb_build_object('success', true, 'table', p_table, 'rows', v_rows);
end $$;

create or replace function public.export_table_list() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff();
begin
  if not private.is_admin(s) then raise exception '只有管理员可以导出资料。' using errcode = '42501'; end if;
  return jsonb_build_object('success', true, 'tables', to_jsonb(private.export_tables()));
end $$;

revoke all on function public.export_table(text) from public, anon;
revoke all on function public.export_table_list() from public, anon;
grant execute on function public.export_table(text) to authenticated;
grant execute on function public.export_table_list() to authenticated;
