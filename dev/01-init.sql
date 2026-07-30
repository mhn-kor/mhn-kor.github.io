-- Supabase 환경 흉내. supabase/schema.sql 보다 먼저 실행됩니다.
-- Supabase 는 pgcrypto 를 extensions 스키마에 두고 anon 롤을 기본 제공합니다.
create schema if not exists extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;

grant usage on schema public, extensions to anon;
