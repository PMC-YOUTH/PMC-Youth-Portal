-- PMC Youth Portal：基础设定
-- 原则：预设什么都不开放。前端（anon / authenticated）只能用明确 grant 过的函数，
-- 不能直接读写任何资料表。内部函数放 private schema，API 呼叫不到。

-- 1. 内部函数用的 schema（等于 GAS 版以 _ 结尾的函数）
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

-- 2. 预设权限：之后在 public 建的表、序列、函数，anon / authenticated 一律没有权限，
--    要用的函数必须在 migration 里明确 grant execute。
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;

-- 3. 连线检查（首页和测试用），不碰任何资料
create or replace function public.ping()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'app', 'PMC Youth Portal', 'server_time', now());
$$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
