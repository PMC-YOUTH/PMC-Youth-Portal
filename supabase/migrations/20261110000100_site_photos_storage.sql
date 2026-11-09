-- 阶段 2：首页照片的储存空间（Supabase Storage）
-- 任何人都能看（首页是公开的）；只有当届在任职员可以上传；不开放修改和删除。
-- 本地测试的 Postgres 没有 storage schema，所以 Storage 部分只在 Supabase 上执行。

-- 给 Storage 规则用：目前登入者是不是当届在任职员（只回答自己，不透露别的资料）
create or replace function public.can_upload_site_photo() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return true;
exception when others then
  return false;
end $$;
revoke all on function public.can_upload_site_photo() from public, anon;
grant execute on function public.can_upload_site_photo() to authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $q$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('site-photos', 'site-photos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
      on conflict (id) do nothing
    $q$;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'site photos: staff upload') then
      execute $q$
        create policy "site photos: staff upload" on storage.objects
          for insert to authenticated
          with check (bucket_id = 'site-photos' and public.can_upload_site_photo())
      $q$;
    end if;
  end if;
end $$;
