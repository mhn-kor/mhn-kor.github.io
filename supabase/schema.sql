-- 몬스터헌터 나우 한국지부 — 친구 코드 테이블
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 실행하세요.
-- 여러 번 실행해도 안전합니다. 기존 테이블이 있어도 그대로 적용됩니다.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.friend_codes (
  id         bigint generated always as identity primary key,
  nickname   text        not null check (char_length(btrim(nickname)) between 1 and 20),
  code       text        not null unique check (code ~ '^[0-9]{12}$'),
  created_at timestamptz not null default now()
);

-- 삭제용 비밀번호의 bcrypt 해시. 비밀번호 기능 이전에 등록된 행은 null 이라
-- 사이트에서 삭제할 수 없습니다(대시보드에서 직접 지우세요).
alter table public.friend_codes add column if not exists pw_hash text;

create index if not exists friend_codes_created_at_idx
  on public.friend_codes (created_at desc);

alter table public.friend_codes enable row level security;

-- ── 권한 ────────────────────────────────────────────────────────────
-- pw_hash 가 절대 클라이언트로 나가면 안 됩니다. 정책만으로는 컬럼을 못 가리므로
-- 테이블 권한을 회수하고 컬럼 단위로 다시 부여합니다.
-- (public read 정책이 select * 를 허용해도 pw_hash 는 권한에서 막힙니다.)
revoke all on public.friend_codes from anon;
grant select (nickname, code, created_at) on public.friend_codes to anon;

-- 쓰기는 전부 아래 함수를 통해서만. 직접 insert/delete 는 권한이 없어 거부됩니다.
drop policy if exists "public insert" on public.friend_codes;
drop policy if exists "public read"   on public.friend_codes;
create policy "public read" on public.friend_codes for select to anon using (true);

-- ── 등록 ────────────────────────────────────────────────────────────
-- 비밀번호는 평문으로 받아 DB 안에서 해싱합니다. 클라이언트가 해시를 만들면
-- 그 해시 자체가 곧 삭제 자격증명이 되어 버립니다.
create or replace function public.add_friend_code(
  p_nickname text, p_code text, p_password text
) returns void
language plpgsql
security definer                              -- anon 에게 없는 insert 권한으로 실행
set search_path = public, extensions, pg_temp -- security definer 함수의 search_path 주입 방지
as $$
begin
  if p_password is null or char_length(p_password) < 4 then
    raise exception 'PASSWORD_TOO_SHORT';
  end if;
  insert into public.friend_codes (nickname, code, pw_hash)
  values (btrim(p_nickname), p_code, crypt(p_password, gen_salt('bf', 8)));
end $$;

-- ── 삭제 ────────────────────────────────────────────────────────────
-- 비밀번호가 맞을 때만 지웁니다. 코드 존재 여부를 알려주지 않도록
-- 틀린 비밀번호와 없는 코드 모두 false 를 반환합니다.
create or replace function public.delete_friend_code(
  p_code text, p_password text
) returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare n int;
begin
  delete from public.friend_codes
   where code = p_code
     and pw_hash is not null
     and pw_hash = crypt(p_password, pw_hash);   -- bcrypt: 해시에 담긴 salt 로 재계산
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.add_friend_code(text, text, text)    from public, anon;
revoke all on function public.delete_friend_code(text, text)       from public, anon;
grant execute on function public.add_friend_code(text, text, text) to anon;
grant execute on function public.delete_friend_code(text, text)    to anon;

-- 확인용: pw_hash 가 권한에서 막혔는지 보려면 아래를 anon 으로 호출해 보세요.
select count(*) from public.friend_codes;
