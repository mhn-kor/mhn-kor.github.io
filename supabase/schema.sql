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
--
-- 마스터 비밀번호는 «길고 무작위» 여야 합니다. 삭제 함수들이 «본인 비번 이거나 마스터»
-- 로 판정하고 참/거짓을 그대로 돌려주므로, 자기 글을 대상으로 후보를 넣어 보면 응답이
-- 그대로 마스터 비밀번호 판별기가 됩니다. 시도 횟수 제한은 없습니다 — 유일한 방어선이
-- 길이입니다. 사람이 외울 값이 아니니 20자 이상 무작위로 만드세요.
-- cost 12 는 한 번 맞춰 보는 데 드는 시간을 8보다 16배로 올립니다(로그인이 아니라
-- 삭제할 때만 쓰는 값이라 체감 지연이 없습니다).
--
--   insert into public.app_config (key, value)
--   values ('master_pw', extensions.crypt('여기에실제비밀번호', extensions.gen_salt('bf', 12)))
--   on conflict (key) do update set value = excluded.value;
--
-- 값을 짓기 귀찮으면 이렇게 만들고 결과를 따로 보관하세요:
--   select encode(extensions.gen_random_bytes(16), 'base64');
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

-- ── 리더보드 (토벌 기록) ───────────────────────────────────────────
-- 기록의 근거는 영상 하나뿐입니다. 그래서 URL 에 unique 를 걸어 같은 영상이
-- 여러 번 올라오는 것을 막습니다. 클라이언트가 URL 을 아래 형태 중 하나로
-- 정규화해서 보내므로(record.js 의 rkCanon), 검사식이 곧 화이트리스트입니다.
--   https://www.youtube.com/watch?v=<11자>
--   https://x.com/i/status/<숫자>
--   https://www.tiktok.com/@i/video/<숫자>
--   https://chzzk.naver.com/clips/<영숫자>        (치지직은 클립만. 다시보기는 임베드가 없습니다)
--   https://tv.naver.com/v/<숫자>
--   https://www.instagram.com/reel/<코드>/
-- 한 곳을 늘릴 때는 record.js 의 rkVid · RK_SRC 와 여기를 «같이» 고쳐야 합니다.
create table if not exists public.records (
  id         bigint generated always as identity primary key,
  nickname   text        not null check (char_length(btrim(nickname)) between 1 and 20),
  monster    text        not null check (monster ~ '^[a-z0-9_-]{1,32}$'),  -- MATERIAL.monsters[].id
  star       smallint    not null check (star between 8 and 10),
  variant    text        not null check (variant in ('normal', 'dim')),    -- 일반 / 차원변이
  weapon     text        not null check (weapon ~ '^[a-z-]{1,20}$'),       -- BUILD.weaponTypes[].k
  -- 스타일은 이름 그대로 담습니다. build-styles.js 의 순서가 바뀌어도 옛 기록이 살아 있어야 합니다.
  style      text        check (char_length(style) <= 24),
  -- 토벌 시간은 초 단위 정수입니다. 게임이 초 단위로 보여주고 사람도 그렇게 적습니다.
  time_sec   integer     not null check (time_sec between 1 and 3600),
  video_url  text        not null unique
             check (video_url ~ '^https://(www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}|x\.com/i/status/[0-9]{5,25}|www\.tiktok\.com/@i/video/[0-9]{5,25}|chzzk\.naver\.com/clips/[A-Za-z0-9_-]{6,24}|tv\.naver\.com/v/[0-9]{5,12}|www\.instagram\.com/reel/[A-Za-z0-9_-]{5,24}/)$'),
  -- 추천 빌드와 이어지는 자리. 빌드 탭 공유 링크의 ?build= 뒤쪽을 그대로 담아 두면
  -- 링크 하나로 그 빌드를 되살릴 수 있습니다 (build.js 의 bdShareParam).
  -- 길이는 recommended_builds.build 와 같은 이유로 큽니다.
  build      text        check (char_length(build) <= 8000),
  created_at timestamptz not null default now(),
  pw_hash    text        not null
);

-- create table if not exists 는 이미 만들어진 표를 손대지 않습니다. 600 자로 처음 만든
-- DB 를 위해 제약을 다시 겁니다(먼저 지우므로 여러 번 실행해도 안전합니다).
alter table public.records drop constraint if exists records_build_check;
alter table public.records
  add constraint records_build_check check (char_length(build) <= 8000);

-- 영상 화이트리스트도 같은 이유로 다시 겁니다 — 이미 만들어진 DB 는 유튜브·X 만 알고 있어서
-- 틱톡 주소가 오면 등록이 통째로 실패합니다. 옛 행은 전부 이 식을 이미 통과합니다(갈래만 늘었습니다).
alter table public.records drop constraint if exists records_video_url_check;
alter table public.records
  add constraint records_video_url_check
  check (video_url ~ '^https://(www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}|x\.com/i/status/[0-9]{5,25}|www\.tiktok\.com/@i/video/[0-9]{5,25}|chzzk\.naver\.com/clips/[A-Za-z0-9_-]{6,24}|tv\.naver\.com/v/[0-9]{5,12}|www\.instagram\.com/reel/[A-Za-z0-9_-]{5,24}/)$');

-- 처음 판은 1/100초(time_cs)로 담았습니다. 실제로는 초 단위로만 올리므로 컬럼을 옮깁니다.
-- 이미 옮겼거나 새로 만든 DB 에서는 아무 일도 하지 않습니다(이 파일은 여러 번 실행해도 안전합니다).
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'records' and column_name = 'time_cs') then
    alter table public.records drop constraint if exists records_time_cs_check;
    alter table public.records
      alter column time_cs type integer using greatest(1, round(time_cs / 100.0)::int);
    alter table public.records rename column time_cs to time_sec;
    alter table public.records
      add constraint records_time_sec_check check (time_sec between 1 and 3600);
  end if;
end $$;

-- 리더보드는 항상 (몬스터·성급·종류) 안에서 시간순으로 봅니다.
create index if not exists records_board_idx
  on public.records (monster, star, variant, time_sec);

alter table public.records enable row level security;

revoke all on public.records from anon;
grant select (id, nickname, monster, star, variant, weapon, style, time_sec, video_url, build, created_at)
  on public.records to anon;

drop policy if exists "public read" on public.records;
create policy "public read" on public.records for select to anon using (true);

-- 등록. 값 검사는 위 CHECK 가 전부 합니다(여기서 또 적으면 두 곳이 어긋납니다).
-- 새 id 를 돌려주므로 화면은 다시 받아오지 않고 바로 한 줄 그릴 수 있습니다.
-- drop 이 필요한 이유: create or replace 는 인자 «이름» 변경을 거부합니다(p_time_cs → p_time_sec).
drop function if exists public.add_record(text, text, int, text, text, text, int, text, text, text);
create or replace function public.add_record(
  p_nickname text, p_monster text, p_star int, p_variant text,
  p_weapon text, p_style text, p_time_sec int, p_video_url text,
  p_build text, p_password text
) returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare new_id bigint;
begin
  if p_password is null or char_length(p_password) < 4 then
    raise exception 'PASSWORD_TOO_SHORT';
  end if;
  insert into public.records
    (nickname, monster, star, variant, weapon, style, time_sec, video_url, build, pw_hash)
  values
    (btrim(p_nickname), p_monster, p_star, p_variant, p_weapon,
     nullif(btrim(coalesce(p_style, '')), ''), p_time_sec, p_video_url,
     nullif(btrim(coalesce(p_build, '')), ''),
     crypt(p_password, gen_salt('bf', 8)))
  returning id into new_id;
  return new_id;
end $$;

-- 삭제. 본인 비밀번호이거나 마스터 비밀번호일 때만. 친구 코드와 같은 규칙입니다.
create or replace function public.delete_record(
  p_id bigint, p_password text
) returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare n int;
begin
  delete from public.records
   where id = p_id
     and (
       pw_hash = crypt(p_password, pw_hash)
       or exists (
            select 1 from public.app_config
             where key = 'master_pw' and value = crypt(p_password, value)
          )
     );
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.add_record(text, text, int, text, text, text, int, text, text, text) from public, anon;
revoke all on function public.delete_record(bigint, text)                                          from public, anon;
grant execute on function public.add_record(text, text, int, text, text, text, int, text, text, text) to anon;
grant execute on function public.delete_record(bigint, text)                                          to anon;

-- 확인용: pw_hash 가 권한에서 막혔는지 보려면 아래를 anon 으로 호출해 보세요.
select count(*) from public.friend_codes;

-- ══════════════════════════════════════════════════════════════════════
-- 추천 빌드
-- ══════════════════════════════════════════════════════════════════════
-- 빌드 탭에서 만든 구성을 남들이 쓰라고 올려 두는 곳입니다. build 컬럼에는
-- 공유 링크의 ?build= 뒷부분을 그대로 담습니다 — 그것만 있으면 빌드가 되살아나고,
-- 장비 표가 바뀌어도 이름 기반이라 옛 등록이 살아 있습니다.

create table if not exists public.recommended_builds (
  id         bigint generated always as identity primary key,
  nickname   text        not null check (char_length(btrim(nickname)) between 1 and 20),
  title      text        check (char_length(title) <= 30),
  -- 길이가 큰 이유: 공유 파라미터는 encodeURIComponent 를 거친 뒤라 한글 한 글자가
  -- 9자를 먹습니다(«약점 특효» = 45자). 표류석을 부위마다 두 개씩 끼운 빌드가
  -- 2000자에 가깝습니다. 600 으로 뒀더니 표류석을 낀 빌드는 전부 등록에 실패했습니다.
  -- 실측 최악(표류석 10칸 2035자 + 조건부 스킬 24개 2161자)이 4316자라 넉넉히 8000 으로 둡니다.
  build      text        not null check (char_length(build) between 1 and 8000),
  weapon     text        not null check (weapon ~ '^[a-z-]{1,20}$'),   -- BUILD.weaponTypes[].k
  tier       text        not null check (tier in ('beginner', 'expert')),
  -- 필드사냥 field / 요격전 intercept / 대량출현 swarm / 대연속 chain / 고룡토벌 elder
  scenes     text[]      not null default '{}' check (scenes <@ array['field','intercept','swarm','chain','elder']),
  -- 개인전 solo / 파티사냥 party
  party      text[]      not null default '{}' check (party  <@ array['solo','party']),
  -- 이번 시즌 파밍이 쉬운 소재인지. 초보자 빌드일 때 추천도를 크게 올립니다.
  easy_farm  boolean     not null default false,
  up         int         not null default 0,
  down       int         not null default 0,
  created_at timestamptz not null default now(),
  pw_hash    text        not null
);

-- create table if not exists 는 이미 만들어진 표를 손대지 않습니다. 600 자로 처음 만든
-- DB 를 위해 제약을 다시 겁니다(먼저 지우므로 여러 번 실행해도 안전합니다).
alter table public.recommended_builds drop constraint if exists recommended_builds_build_check;
alter table public.recommended_builds
  add constraint recommended_builds_build_check check (char_length(build) between 1 and 8000);

create index if not exists recommended_builds_weapon_idx on public.recommended_builds (weapon);

-- 한 빌드에 한 사람 한 표. voter 는 IP 와 기기 식별자를 함께 해싱한 값입니다.
-- IP 만으로 막으면 통신사 NAT 뒤의 모바일 사용자 수만 명이 한 표를 나눠 갖게 되고,
-- 기기만으로 막으면 브라우저를 바꿔 얼마든지 누를 수 있어 둘을 같이 씁니다.
create table if not exists public.recommended_votes (
  build_id   bigint      not null references public.recommended_builds(id) on delete cascade,
  voter      text        not null,
  v          smallint    not null check (v in (1, -1)),
  created_at timestamptz not null default now(),
  primary key (build_id, voter)
);
-- voter 는 기기값이 섞인 해시라 브라우저가 마음대로 바꿀 수 있습니다 — 그것만으로는
-- 중복을 못 막습니다. 위조할 수 없는 축(IP)을 따로 두고 한 IP 가 만들 수 있는 표 수를
-- 제한합니다. create table if not exists 는 이미 있는 표를 안 건드리므로 alter 로 얹습니다.
alter table public.recommended_votes add column if not exists ip_hash text;
create index if not exists recommended_votes_ip_idx
  on public.recommended_votes (build_id, ip_hash);

-- 빌드에 달리는 댓글. «차지액스로도 쓸만해요» 같은 한두 줄짜리라 답글은 두지
-- 않았습니다. 필요해지면 parent_id 한 컬럼을 얹으면 됩니다.
-- 삭제 규칙은 이 저장소의 다른 글과 같습니다 — 등록할 때 정한 비밀번호이거나 마스터.
create table if not exists public.recommended_comments (
  id         bigint      generated always as identity primary key,
  build_id   bigint      not null references public.recommended_builds(id) on delete cascade,
  nickname   text        not null check (char_length(btrim(nickname)) between 1 and 20),
  body       text        not null check (char_length(btrim(body)) between 1 and 300),
  created_at timestamptz not null default now(),
  pw_hash    text        not null
);

-- 한 빌드의 댓글을 시간순으로 읽는 것이 유일한 조회 방식입니다.
create index if not exists recommended_comments_build_idx
  on public.recommended_comments (build_id, created_at);

alter table public.recommended_builds   enable row level security;
alter table public.recommended_votes    enable row level security;
alter table public.recommended_comments enable row level security;

-- pw_hash 는 클라이언트로 나가면 안 됩니다. 컬럼 권한으로 막습니다.
revoke all on public.recommended_builds   from anon;
revoke all on public.recommended_votes    from anon;
revoke all on public.recommended_comments from anon;

-- 읽기는 pw_hash 를 뺀 뷰로만. 빌드 목록과 같은 이유로 컬럼을 하나하나 적습니다.
create or replace view public.recommended_comments_public as
select c.id, c.build_id, c.nickname, c.body, c.created_at
  from public.recommended_comments c;

grant select on public.recommended_comments_public to anon;

-- ── 추천도 ──────────────────────────────────────────────────────────
-- 오래될수록 낮아지고(3주에 절반), 좋아요는 올리고 싫어요는 더 크게 내립니다.
-- 초보자 빌드이면서 파밍이 쉬우면 크게 올립니다 — 갓 시작한 사람에게 실제로
-- 만들 수 있는 빌드를 먼저 보여 주자는 것이 이 목록의 목적입니다.
-- security_invoker 를 켜지 않으면 뷰가 소유자 권한으로 돌아 pw_hash 까지 새어 나가므로
-- 컬럼을 하나하나 적습니다.
create or replace view public.recommended_ranked as
select b.id, b.nickname, b.title, b.build, b.weapon, b.tier,
       b.scenes, b.party, b.easy_farm, b.up, b.down, b.created_at,
       round((
         (1 + b.up * 2 - b.down * 3)::numeric
         * (1.0 / (1.0 + extract(epoch from (now() - b.created_at)) / 86400 / 21))
         * (case when b.tier = 'beginner' and b.easy_farm then 1.8 else 1.0 end)
       ), 2) as score,
       /* 카드에 «댓글 3» 을 붙이려고 같이 셉니다. 목록이 300줄이라 줄마다 세도
          부담이 없고, 따로 부르면 목록 요청이 두 번이 됩니다.
          create or replace view 는 «맨 뒤에 컬럼 추가» 만 허용하므로 여기 끝에 둡니다. */
       (select count(*) from public.recommended_comments c where c.build_id = b.id) as comments
  from public.recommended_builds b;

grant select on public.recommended_ranked to anon;

-- ── 등록 ────────────────────────────────────────────────────────────
create or replace function public.add_recommended_build(
  p_nickname text, p_title text, p_build text, p_weapon text,
  p_tier text, p_scenes text[], p_party text[], p_easy_farm boolean,
  p_password text
) returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare new_id bigint;
begin
  if p_password is null or char_length(p_password) < 4 then
    raise exception 'PASSWORD_TOO_SHORT';
  end if;
  insert into public.recommended_builds
    (nickname, title, build, weapon, tier, scenes, party, easy_farm, pw_hash)
  values
    (btrim(p_nickname), nullif(btrim(coalesce(p_title, '')), ''), p_build, p_weapon,
     p_tier, coalesce(p_scenes, '{}'), coalesce(p_party, '{}'), coalesce(p_easy_farm, false),
     crypt(p_password, gen_salt('bf', 8)))
  returning id into new_id;
  return new_id;
end $$;

-- 삭제. 본인 비밀번호이거나 마스터 비밀번호일 때만.
create or replace function public.delete_recommended_build(
  p_id bigint, p_password text
) returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare n int;
begin
  delete from public.recommended_builds
   where id = p_id
     and (
       pw_hash = crypt(p_password, pw_hash)
       or exists (select 1 from public.app_config
                   where key = 'master_pw' and value = crypt(p_password, value))
     );
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- ── 요청한 사람의 IP ────────────────────────────────────────────────
-- x-forwarded-for 는 프록시가 «뒤에» 덧붙이는 헤더입니다. 그래서 맨 앞 요소는
-- 클라이언트가 직접 채워 보낼 수 있고(위조 가능), 가장 가까운 프록시가 붙인
-- 맨 뒤 요소만 믿을 수 있습니다. 전용 헤더가 있으면 그쪽을 먼저 씁니다.
create or replace function public.client_ip() returns text
language plpgsql stable
set search_path = public, extensions, pg_temp
as $$
declare h json; xff text;
begin
  h := coalesce(current_setting('request.headers', true)::json, '{}'::json);
  xff := coalesce(h ->> 'x-forwarded-for', '');
  return coalesce(
    nullif(btrim(coalesce(h ->> 'cf-connecting-ip', '')), ''),
    nullif(btrim(coalesce(h ->> 'true-client-ip', '')), ''),
    nullif(btrim(coalesce(h ->> 'x-real-ip', '')), ''),
    nullif(btrim(split_part(xff, ',', array_length(string_to_array(xff, ','), 1))), ''),
    '');
end $$;

-- 위 IP 가 사람을 가르는 값인지. 프록시 안쪽 주소만 보이는 환경이면 모든 방문자가
-- 같은 값이 되어 상한이 «사이트 전체 3표» 가 되어 버립니다. 그때는 상한을 걸지
-- 않습니다 — 막지 못하는 편이, 아무도 투표하지 못하는 것보다 낫습니다.
create or replace function public.ip_is_distinguishing(ip text) returns boolean
language sql immutable as $$
  select ip <> '' and ip !~ '^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|::1$|fc|fd)'
$$;

-- ── 좋아요 / 싫어요 ─────────────────────────────────────────────────
-- 같은 걸 다시 누르면 취소, 반대를 누르면 갈아탑니다.
-- p_device 는 브라우저가 정하는 값이라 신뢰하지 않습니다. 표를 «가르는» 데만 쓰고,
-- «막는» 일은 아래 IP 당 상한이 합니다.

create or replace function public.vote_recommended_build(
  p_id bigint, p_vote smallint, p_device text
) returns json
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  ip   text;
  iph  text;
  who  text;
  cur  smallint;
  r    record;
  VOTE_PER_IP constant int := 3;   -- 한 IP 가 한 빌드에 만들 수 있는 표 수
begin
  if p_vote not in (1, -1) then
    raise exception 'BAD_VOTE';
  end if;
  ip  := public.client_ip();
  iph := encode(digest(ip, 'sha256'), 'hex');
  who := encode(digest(coalesce(btrim(ip), '') || '|' || coalesce(btrim(p_device), ''), 'sha256'), 'hex');

  select v into cur from public.recommended_votes where build_id = p_id and voter = who;

  if cur is null then
    /* 새 표입니다. p_device 를 갈아 끼우며 부르면 voter 가 매번 달라져 여기로 오므로,
       위조할 수 없는 IP 쪽에서 셉니다. 한 집·한 사무실에서 몇 사람이 누르는 것은
       막지 않되, 혼자 수백 표를 넣는 것은 막습니다. */
    if public.ip_is_distinguishing(ip)
       and (select count(*) from public.recommended_votes
             where build_id = p_id and ip_hash = iph) >= VOTE_PER_IP then
      raise exception 'VOTE_LIMIT';
    end if;
    insert into public.recommended_votes (build_id, voter, v, ip_hash) values (p_id, who, p_vote, iph);
  elsif cur = p_vote then
    delete from public.recommended_votes where build_id = p_id and voter = who;
  else
    update public.recommended_votes set v = p_vote, created_at = now()
     where build_id = p_id and voter = who;
  end if;

  /* 집계는 매번 다시 셉니다. 표가 수천 건을 넘길 규모가 아니고,
     증감으로 관리하면 한 번 어긋났을 때 되돌릴 방법이 없습니다. */
  update public.recommended_builds b
     set up   = (select count(*) from public.recommended_votes where build_id = p_id and v = 1),
         down = (select count(*) from public.recommended_votes where build_id = p_id and v = -1)
   where b.id = p_id
   returning b.up, b.down into r;

  /* score 는 up/down 에서 나오는 값이라 표가 바뀌면 반드시 같이 바뀝니다. 안 돌려주면
     화면이 ▲ 숫자만 고치고 옆의 추천도 배지는 옛 값으로 남습니다. 뷰와 같은 식을
     두 번 적지 않도록 뷰에서 그대로 읽습니다. */
  return json_build_object('up', r.up, 'down', r.down,
    'score', (select score from public.recommended_ranked where id = p_id),
    'mine', (select v from public.recommended_votes where build_id = p_id and voter = who));
end $$;

-- 내가 이 빌드들에 무엇을 눌렀는지. 화면에서 눌린 상태를 보여 주는 용도입니다.
create or replace function public.my_recommended_votes(
  p_ids bigint[], p_device text
) returns json
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare ip text; who text;
begin
  -- vote_recommended_build 와 반드시 같은 방식으로 만들어야 «내가 누른 표» 가 맞습니다.
  ip := public.client_ip();
  who := encode(digest(coalesce(btrim(ip), '') || '|' || coalesce(btrim(p_device), ''), 'sha256'), 'hex');
  return coalesce((select json_object_agg(build_id, v)
                     from public.recommended_votes
                    where voter = who and build_id = any(coalesce(p_ids, '{}'))), '{}'::json);
end $$;

-- ── 댓글 ────────────────────────────────────────────────────────────
create or replace function public.add_recommended_comment(
  p_build_id bigint, p_nickname text, p_body text, p_password text
) returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare new_id bigint;
begin
  if p_password is null or char_length(p_password) < 4 then
    raise exception 'PASSWORD_TOO_SHORT';
  end if;
  insert into public.recommended_comments (build_id, nickname, body, pw_hash)
  values (p_build_id, btrim(p_nickname), btrim(p_body),
          crypt(p_password, gen_salt('bf', 8)))
  returning id into new_id;
  return new_id;
end $$;

-- 빌드 삭제와 같은 규칙 — 본인 비밀번호이거나 마스터일 때만.
create or replace function public.delete_recommended_comment(
  p_id bigint, p_password text
) returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare n int;
begin
  delete from public.recommended_comments
   where id = p_id
     and (
       pw_hash = crypt(p_password, pw_hash)
       or exists (select 1 from public.app_config
                   where key = 'master_pw' and value = crypt(p_password, value))
     );
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- 도우미는 security definer 함수 안에서만 씁니다. RPC 로 직접 부를 이유가 없습니다.
revoke all on function public.client_ip()                from public, anon;
revoke all on function public.ip_is_distinguishing(text) from public, anon;
revoke all on function public.add_recommended_build(text, text, text, text, text, text[], text[], boolean, text) from public, anon;
revoke all on function public.delete_recommended_build(bigint, text)              from public, anon;
revoke all on function public.vote_recommended_build(bigint, smallint, text)      from public, anon;
revoke all on function public.my_recommended_votes(bigint[], text)                from public, anon;
revoke all on function public.add_recommended_comment(bigint, text, text, text)   from public, anon;
revoke all on function public.delete_recommended_comment(bigint, text)            from public, anon;
grant execute on function public.add_recommended_build(text, text, text, text, text, text[], text[], boolean, text) to anon;
grant execute on function public.delete_recommended_build(bigint, text)           to anon;
grant execute on function public.vote_recommended_build(bigint, smallint, text)   to anon;
grant execute on function public.my_recommended_votes(bigint[], text)             to anon;
grant execute on function public.add_recommended_comment(bigint, text, text, text) to anon;
grant execute on function public.delete_recommended_comment(bigint, text)         to anon;

-- ══════════════════════════════════════════════════════════════════════
-- 이벤트
-- ══════════════════════════════════════════════════════════════════════
-- 운영자가 이벤트를 열어 두면, 방문자가 «참여하기» 로 응모합니다.
-- 응모 «내용» 은 여기에 남지 않습니다 — 곧장 디스코드 채팅방으로 갑니다
-- (supabase/functions/discord-entry). 이 표에 남는 것은 이벤트와 «응모 건수» 뿐입니다.
-- 선착순을 세려면 숫자 하나는 있어야 하고, 그 숫자에는 누가 무엇을 냈는지가 없습니다.
--
-- 등록·삭제는 마스터 비밀번호로만 합니다. 개인 비밀번호를 따로 두지 않는 이유는
-- 이벤트를 여는 사람이 운영자 한 사람뿐이기 때문입니다. app_config 에 master_pw 가
-- 없으면 crypt 비교가 성립하지 않아 «아무도 못 연다» 로 닫힙니다(fail closed).

create table if not exists public.events (
  id         bigint generated always as identity primary key,
  title      text        not null check (char_length(btrim(title)) between 1 and 60),
  -- 줄바꿈을 그대로 보여 주므로(.ev-body 의 pre-wrap) 여러 문단을 담을 수 있습니다.
  body       text        not null check (char_length(btrim(body)) between 1 and 4000),
  -- 기간. 둘 다 null 이면 «상시» 입니다. 시작만 있으면 그때부터 계속,
  -- 종료만 있으면 지금부터 그때까지. 응모를 받을지는 이 두 값이 정합니다.
  starts_at  timestamptz,
  ends_at    timestamptz,
  -- 선착순 인원. null 이면 무제한입니다. entries 가 여기 닿으면 더 안 받습니다.
  capacity   int,
  entries    int         not null default 0,
  -- 카드에 얹는 그림(선택). Storage 의 event-img 버킷 공개 주소가 들어옵니다
  -- (supabase/functions/event-image 가 올리고 주소를 돌려줍니다).
  image_url  text,
  created_at timestamptz not null default now()
);

-- create table if not exists 는 이미 만들어진 표를 손대지 않습니다.
-- 먼저 만든 DB 를 위해 컬럼과 제약을 따로 얹습니다(여러 번 실행해도 안전합니다).
alter table public.events add column if not exists starts_at timestamptz;
alter table public.events add column if not exists ends_at   timestamptz;
alter table public.events add column if not exists capacity  int;
alter table public.events add column if not exists entries   int not null default 0;
alter table public.events drop constraint if exists events_period_check;
alter table public.events add constraint events_period_check
  check (starts_at is null or ends_at is null or ends_at > starts_at);
alter table public.events drop constraint if exists events_capacity_check;
alter table public.events add constraint events_capacity_check
  check (capacity is null or capacity between 1 and 100000);
alter table public.events drop constraint if exists events_entries_check;
alter table public.events add constraint events_entries_check check (entries >= 0);
alter table public.events add column if not exists image_url text;
-- 주소는 event-image 함수만 만들지만(마스터 확인 뒤), 값이 <img src> 로 그대로 들어가므로
-- https 주소 꼴만 받게 못 박아 둡니다.
alter table public.events drop constraint if exists events_image_url_check;
alter table public.events add constraint events_image_url_check
  check (image_url is null or (image_url ~ '^https://' and char_length(image_url) <= 500));

create index if not exists events_created_at_idx on public.events (created_at desc);

alter table public.events enable row level security;

-- 숨길 컬럼이 없습니다. pw_hash 를 두지 않았으므로 표 전체를 읽게 둡니다.
-- entries 도 보여줍니다 — «남은 자리» 를 그리려면 있어야 하고, 셈만 담긴 값입니다.
revoke all on public.events from anon;
grant select (id, title, body, starts_at, ends_at, capacity, entries, image_url, created_at)
  on public.events to anon;

drop policy if exists "public read" on public.events;
create policy "public read" on public.events for select to anon using (true);

-- 인자가 늘어날 때마다 옛 판을 지웁니다. create or replace 는 «인자 추가» 를 새
-- 오버로드로 만들 뿐이라, 남겨 두면 anon 이 기간·인원 없이 부를 수 있습니다.
drop function if exists public.add_event(text, text, text);
drop function if exists public.add_event(text, text, timestamptz, timestamptz, text);
drop function if exists public.add_event(text, text, timestamptz, timestamptz, int, text);
create or replace function public.add_event(
  p_title text, p_body text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_capacity int, p_master text, p_image_url text default null
) returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare new_id bigint;
begin
  if not exists (select 1 from public.app_config
                  where key = 'master_pw' and value = crypt(p_master, value)) then
    raise exception 'BAD_MASTER';
  end if;
  -- 값의 앞뒤·범위는 events_period_check · events_capacity_check ·
  -- events_image_url_check 가 봅니다 (여기서 또 적으면 두 곳이 어긋납니다).
  insert into public.events (title, body, starts_at, ends_at, capacity, image_url)
  values (btrim(p_title), btrim(p_body), p_starts_at, p_ends_at, p_capacity, nullif(btrim(coalesce(p_image_url, '')), ''))
  returning id into new_id;
  return new_id;
end $$;

-- 이벤트 그림 올리기(event-image 함수)가 마스터 비밀번호를 먼저 확인할 때 씁니다.
-- anon 에게 주지 않습니다 — 참/거짓을 그대로 주는 함수라, 열어 두면 마스터 비밀번호
-- 판별기가 됩니다(add_event 로도 되지만 굳이 문을 하나 더 낼 이유가 없습니다).
create or replace function public.check_master(p_master text) returns boolean
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (select 1 from public.app_config
                  where key = 'master_pw' and value = crypt(p_master, value));
$$;

-- ── 이벤트 그림 버킷 ────────────────────────────────────────────────
-- 읽기는 공개(주소만 알면 CDN 으로 받음), 쓰기는 아무에게도 열지 않습니다 —
-- 올리는 곳은 service_role 로 도는 event-image 함수 하나뿐입니다.
-- 로컬 미리보기(docker compose)에는 storage 스키마가 없어 있을 때만 만듭니다.
do $$ begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('event-img', 'event-img', true, 3145728,
            array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end $$;

create or replace function public.delete_event(
  p_id bigint, p_master text
) returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare n int;
begin
  delete from public.events
   where id = p_id
     and exists (select 1 from public.app_config
                  where key = 'master_pw' and value = crypt(p_master, value));
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- ── 중복 응모 막기 ──────────────────────────────────────────────────
-- 인원 제한이 있는 이벤트에서만, 한 닉네임이 한 번만 응모하게 합니다.
-- 정원이 없는 이벤트는 그대로 둡니다 — «표류연성 자랑» 처럼 여러 장 올릴 만한 것이
-- 있고, 막아서 얻는 것도 없습니다.
--
-- 여기에 남는 것은 «닉네임을 이벤트 번호와 함께 해싱한 값» 하나뿐입니다. 제목도 내용도
-- 이미지도 없고, 목록을 읽어도 누가 무엇을 냈는지 알 수 없습니다. 그래도 같은 닉네임이면
-- 같은 값이 나오므로 두 번째 응모를 막을 수 있습니다.
-- 이벤트 번호를 섞는 이유: 안 섞으면 한 사람의 값이 이벤트마다 같아, 이 표만으로
-- «이 사람이 어느 이벤트에 참여했는지» 가 드러납니다.
--
-- 닉네임을 바꿔 다시 내면 막지 못합니다. 그건 이 표로 풀 수 있는 문제가 아니고
-- (로그인이 없습니다), 상품은 어차피 닉네임으로 나갑니다.
create table if not exists public.event_claims (
  event_id  bigint not null references public.events(id) on delete cascade,
  who_hash  text   not null,
  primary key (event_id, who_hash)
);

alter table public.event_claims enable row level security;
-- anon 은 읽지도 쓰지도 못합니다. security definer 함수만 소유자 권한으로 봅니다.
revoke all on public.event_claims from anon;

-- ── 선착순 자리 ─────────────────────────────────────────────────────
-- «세고 나서 늘리면» 안 됩니다. 두 사람이 동시에 마지막 자리를 누르면 둘 다 «아직
-- 자리 있음» 을 읽고 둘 다 늘려 정원을 넘깁니다. 선착순은 그 순간을 위한 기능이라
-- 그렇게 만들면 있으나 마나입니다.
--
-- 그래서 검사와 증가를 «한 문장» 안에 둡니다. update ... where 는 행을 잠그고
-- 조건을 다시 본 뒤에 쓰므로, 동시에 들어와도 정확히 한 쪽만 갱신됩니다.
-- 기간도 여기서 같이 봅니다 — 자리를 주는 판정이 한 곳에만 있어야 어긋나지 않습니다.
-- 인자가 늘었습니다. 옛 1인자 판이 남아 있으면 중복 검사 없이 자리를 줍니다.
drop function if exists public.claim_event_slot(bigint);
create or replace function public.claim_event_slot(p_id bigint, p_who text default '') returns json
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare r record; e record; h text;
begin
  update public.events
     set entries = entries + 1
   where id = p_id
     and (capacity  is null or entries < capacity)
     and (starts_at is null or now() >= starts_at)
     and (ends_at   is null or now() <= ends_at)
  returning title, entries, capacity into r;

  if found then
    /* 정원이 있는 이벤트만 한 닉네임 한 번입니다. 자리를 «잡은 뒤» 에 넣는 이유:
       먼저 넣고 자리가 없으면, 응모하지도 못한 사람이 영영 막힙니다.
       동시에 같은 닉네임 둘이 들어와도 unique 가 한 쪽만 통과시키고, 진 쪽은
       방금 늘린 자리를 그대로 되돌립니다. */
    if r.capacity is not null and coalesce(btrim(p_who), '') <> '' then
      h := encode(digest(p_id::text || '|' || lower(btrim(p_who)), 'sha256'), 'hex');
      begin
        insert into public.event_claims (event_id, who_hash) values (p_id, h);
      exception when unique_violation then
        update public.events set entries = greatest(0, entries - 1) where id = p_id;
        return json_build_object('ok', false, 'reason', 'DUP');
      end;
    end if;
    return json_build_object('ok', true, 'title', r.title,
                             'entries', r.entries, 'capacity', r.capacity);
  end if;

  -- 못 준 이유를 알려줍니다. «없는 이벤트» 와 «자리가 없다» 를 뭉뚱그리면
  -- 응모자에게 엉뚱한 안내가 나가고 원인을 찾을 수 없습니다.
  select * into e from public.events where id = p_id;
  if not found then
    return json_build_object('ok', false, 'reason', 'NO_EVENT');
  elsif e.starts_at is not null and now() < e.starts_at then
    return json_build_object('ok', false, 'reason', 'NOT_STARTED');
  elsif e.ends_at is not null and now() > e.ends_at then
    return json_build_object('ok', false, 'reason', 'ENDED');
  else
    return json_build_object('ok', false, 'reason', 'FULL',
                             'entries', e.entries, 'capacity', e.capacity);
  end if;
end $$;

-- 자리를 잡아 두고 디스코드 전송이 실패했을 때 되돌립니다. 안 되돌리면 아무도
-- 응모하지 않은 자리가 영영 잠깁니다. greatest 로 0 아래로는 안 내려갑니다.
-- 중복 표시도 같이 지웁니다 — 안 지우면 실패한 사람이 다시 낼 수 없게 됩니다.
drop function if exists public.release_event_slot(bigint);
create or replace function public.release_event_slot(p_id bigint, p_who text default '') returns void
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  update public.events set entries = greatest(0, entries - 1) where id = p_id;
  delete from public.event_claims
   where event_id = p_id
     and who_hash = encode(digest(p_id::text || '|' || lower(btrim(coalesce(p_who, ''))), 'sha256'), 'hex');
$$;

revoke all on function public.add_event(text, text, timestamptz, timestamptz, int, text, text) from public, anon;
revoke all on function public.delete_event(bigint, text)                                       from public, anon;
grant execute on function public.add_event(text, text, timestamptz, timestamptz, int, text, text) to anon;
grant execute on function public.delete_event(bigint, text)                                       to anon;
-- check_master 는 event-image 함수(service_role)만 씁니다 — anon 에게 열면 판별기가 됩니다.
revoke all on function public.check_master(text) from public, anon;
do $$
begin
  grant execute on function public.check_master(text) to service_role;
exception when undefined_object then
  raise notice 'service_role 롤이 없습니다 — 로컬 개발 환경으로 보고 넘어갑니다.';
end $$;

-- 자리를 잡고 되돌리는 일은 «Edge Function 만» 할 수 있어야 합니다. anon 에게 열어 두면
-- 응모하지도 않고 claim 만 반복해 선착순 30명짜리를 30번 요청으로 채워 버릴 수 있습니다.
-- 그래서 service_role 에게만 줍니다 — 그 키는 브라우저에 나가지 않습니다.
revoke all on function public.claim_event_slot(bigint, text)   from public, anon;
revoke all on function public.release_event_slot(bigint, text) from public, anon;
do $$
begin
  grant execute on function public.claim_event_slot(bigint, text)   to service_role;
  grant execute on function public.release_event_slot(bigint, text) to service_role;
exception when undefined_object then
  -- 로컬 미리보기(docker compose)에는 service_role 롤이 없습니다. dev/03-seed.sql 이
  -- 대신 anon 에게 열어 줍니다 — 그 파일은 프로덕션에서 돌지 않습니다.
  raise notice 'service_role 롤이 없습니다 — 로컬 개발 환경으로 보고 넘어갑니다.';
end $$;
