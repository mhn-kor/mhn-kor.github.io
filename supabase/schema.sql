-- 몬스터헌터 나우 한국지부 — 친구 코드 테이블
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 실행하세요.
-- 여러 번 실행해도 안전합니다 (if not exists / drop policy if exists).

create table if not exists public.friend_codes (
  id         bigint generated always as identity primary key,
  nickname   text        not null check (char_length(btrim(nickname)) between 1 and 20),
  code       text        not null unique check (code ~ '^[0-9]{12}$'),
  created_at timestamptz not null default now()
);

-- 목록은 항상 최신순으로 읽습니다.
create index if not exists friend_codes_created_at_idx
  on public.friend_codes (created_at desc);

-- 브라우저 검증은 우회할 수 있으므로 위 check 제약이 최종 방어선입니다. 지우지 마세요.
alter table public.friend_codes enable row level security;

-- 누구나 읽고 추가할 수 있게. update/delete 는 정책이 없으므로 자동으로 거부됩니다.
drop policy if exists "public read"   on public.friend_codes;
drop policy if exists "public insert" on public.friend_codes;

create policy "public read"
  on public.friend_codes for select to anon using (true);

create policy "public insert"
  on public.friend_codes for insert to anon with check (true);

grant select, insert on public.friend_codes to anon;

-- 확인용: 아래가 0을 반환하면 정상입니다.
select count(*) from public.friend_codes;
