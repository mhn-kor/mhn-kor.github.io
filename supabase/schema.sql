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

-- ── 리더보드 (토벌 기록) ───────────────────────────────────────────
-- 기록의 근거는 영상 하나뿐입니다. 그래서 URL 에 unique 를 걸어 같은 영상이
-- 여러 번 올라오는 것을 막습니다. 클라이언트가 URL 을 아래 두 형태 중 하나로
-- 정규화해서 보내므로(record.js 의 rkCanon), 검사식이 곧 화이트리스트입니다.
--   https://www.youtube.com/watch?v=<11자>   |   https://x.com/i/status/<숫자>
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
             check (video_url ~ '^https://(www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}|x\.com/i/status/[0-9]{5,25})$'),
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

alter table public.recommended_builds enable row level security;
alter table public.recommended_votes  enable row level security;

-- pw_hash 는 클라이언트로 나가면 안 됩니다. 컬럼 권한으로 막습니다.
revoke all on public.recommended_builds from anon;
revoke all on public.recommended_votes  from anon;

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
       ), 2) as score
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

-- ── 좋아요 / 싫어요 ─────────────────────────────────────────────────
-- 같은 걸 다시 누르면 취소, 반대를 누르면 갈아탑니다.
-- IP 는 PostgREST 가 넘겨주는 요청 헤더에서 읽습니다. 클라이언트가 보내는 값이
-- 아니라 프록시가 붙이는 값이라 브라우저에서 위조할 수 없습니다.
create or replace function public.vote_recommended_build(
  p_id bigint, p_vote smallint, p_device text
) returns json
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  ip   text;
  who  text;
  cur  smallint;
  r    record;
begin
  if p_vote not in (1, -1) then
    raise exception 'BAD_VOTE';
  end if;
  ip := split_part(coalesce(
          current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
  who := encode(digest(coalesce(btrim(ip), '') || '|' || coalesce(btrim(p_device), ''), 'sha256'), 'hex');

  select v into cur from public.recommended_votes where build_id = p_id and voter = who;

  if cur is null then
    insert into public.recommended_votes (build_id, voter, v) values (p_id, who, p_vote);
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

  return json_build_object('up', r.up, 'down', r.down,
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
  ip := split_part(coalesce(
          current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
  who := encode(digest(coalesce(btrim(ip), '') || '|' || coalesce(btrim(p_device), ''), 'sha256'), 'hex');
  return coalesce((select json_object_agg(build_id, v)
                     from public.recommended_votes
                    where voter = who and build_id = any(coalesce(p_ids, '{}'))), '{}'::json);
end $$;

revoke all on function public.add_recommended_build(text, text, text, text, text, text[], text[], boolean, text) from public, anon;
revoke all on function public.delete_recommended_build(bigint, text)              from public, anon;
revoke all on function public.vote_recommended_build(bigint, smallint, text)      from public, anon;
revoke all on function public.my_recommended_votes(bigint[], text)                from public, anon;
grant execute on function public.add_recommended_build(text, text, text, text, text, text[], text[], boolean, text) to anon;
grant execute on function public.delete_recommended_build(bigint, text)           to anon;
grant execute on function public.vote_recommended_build(bigint, smallint, text)   to anon;
grant execute on function public.my_recommended_votes(bigint[], text)             to anon;
