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

-- ── 운영용 설정 ─────────────────────────────────────────────────────
-- 마스터 비밀번호(관리자용 강제 삭제)를 bcrypt 해시로 보관합니다.
-- RLS 를 켜고 정책을 하나도 만들지 않으므로 anon 은 읽지도 쓰지도 못합니다.
-- security definer 함수만 소유자 권한으로 읽습니다.
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon;

-- !! 실제 마스터 비밀번호는 이 파일에 넣지 마세요 !!
-- 저장소가 공개라 커밋하는 순간 누구나 남의 코드를 지울 수 있게 됩니다.
-- 아래를 SQL Editor 에서 값만 바꿔 직접 실행하세요 (README 참고):
--
--   insert into public.app_config (key, value)
--   values ('master_pw', extensions.crypt('여기에실제비밀번호', extensions.gen_salt('bf', 8)))
--   on conflict (key) do update set value = excluded.value;
--
-- 해제하려면:  delete from public.app_config where key = 'master_pw';

-- ── 삭제 ────────────────────────────────────────────────────────────
-- 본인 비밀번호가 맞거나, 마스터 비밀번호일 때 지웁니다.
-- 코드 존재 여부를 알려주지 않도록 틀린 비밀번호와 없는 코드 모두 false 입니다.
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
     and (
       -- 본인 비밀번호 (bcrypt: 해시에 담긴 salt 로 재계산)
       (pw_hash is not null and pw_hash = crypt(p_password, pw_hash))
       -- 또는 마스터 비밀번호. pw_hash 가 없는 예전 행도 이걸로 지울 수 있습니다.
       or exists (
            select 1 from public.app_config
             where key = 'master_pw' and value = crypt(p_password, value)
          )
     );
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- ── 끌어올리기 ──────────────────────────────────────────────────────
-- created_at 을 지금으로 갱신해 목록 맨 위로 올립니다. 3일에 한 번만 가능합니다.
-- 비밀번호를 먼저 확인하므로, 모르는 사람은 남은 시간도 알 수 없습니다.
create or replace function public.bump_friend_code(
  p_code text, p_password text
) returns json
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare r record; next_at timestamptz;
begin
  select id, created_at into r
    from public.friend_codes
   where code = p_code
     and pw_hash is not null
     and pw_hash = crypt(p_password, pw_hash);
  if not found then
    return json_build_object('ok', false, 'reason', 'BAD_PASSWORD');
  end if;

  next_at := r.created_at + interval '3 days';
  if now() < next_at then
    return json_build_object('ok', false, 'reason', 'TOO_SOON', 'next_at', next_at);
  end if;

  update public.friend_codes set created_at = now() where id = r.id;
  return json_build_object('ok', true);
end $$;

revoke all on function public.add_friend_code(text, text, text)    from public, anon;
revoke all on function public.delete_friend_code(text, text)       from public, anon;
revoke all on function public.bump_friend_code(text, text)         from public, anon;
grant execute on function public.add_friend_code(text, text, text) to anon;
grant execute on function public.delete_friend_code(text, text)    to anon;
grant execute on function public.bump_friend_code(text, text)      to anon;

-- 확인용: pw_hash 가 권한에서 막혔는지 보려면 아래를 anon 으로 호출해 보세요.
select count(*) from public.friend_codes;
