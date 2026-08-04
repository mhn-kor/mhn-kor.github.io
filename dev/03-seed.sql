-- 로컬 미리보기용 더미 데이터. 프로덕션과 무관합니다.
-- 등록 비밀번호는 모두 test1234 입니다.

select public.add_friend_code('보노보노 / 라보 / 양산',    '259644794620', 'test1234');
select public.add_friend_code('KAMINUS / 태도 / 서울',     '699984238607', 'test1234');
select public.add_friend_code('BIN / 라보,충곤 / 부산',     '639208491969', 'test1234');
select public.add_friend_code('메타몽 / 서울',             '677676607156', 'test1234');
select public.add_friend_code('KOKOA / 랜슥 / 목포',       '320764806942', 'test1234');
select public.add_friend_code('Babysoul / 조충곤 / 대구',  '418547943201', 'test1234');
select public.add_friend_code('donghu / 이쑤시개 / 파주',  '090918923018', 'test1234');
select public.add_friend_code('깊은곳헌터 / 활 / 제주',    '111122223333', 'test1234');

-- 앞의 3건은 4일 전으로 돌려 끌어올리기를 바로 시험할 수 있게 합니다.
-- (3일이 지나야 끌어올리기가 열립니다)
update public.friend_codes
   set created_at = now() - interval '4 days'
 where code in ('259644794620', '699984238607', '639208491969');

-- 비밀번호 기능 이전 행(pw_hash 없음) 재현 — 마스터키로만 지워집니다.
insert into public.friend_codes (nickname, code)
values ('예전행 / 무비번 / 인천', '555566667777');

-- ── 리더보드 더미 기록 ──────────────────────────────────────────────
-- 영상 ID 는 실재하지 않는 값입니다. 썸네일은 404 라 자동으로 숨겨지고,
-- 재생을 누르면 유튜브가 '동영상 없음'을 보여줍니다. 배치 확인용입니다.
select public.add_record('보노보노 / 라보', 'rathalos',  10, 'normal', 'long-sword',  '위합',
         45, 'https://www.youtube.com/watch?v=aaaaaaaaaaa', null, 'test1234');
select public.add_record('KAMINUS / 태도', 'rathalos',   10, 'normal', 'long-sword',  '기인 무쌍베기',
         51, 'https://www.youtube.com/watch?v=bbbbbbbbbbb', null, 'test1234');
select public.add_record('BIN / 대검',      'rathalos',   10, 'dim',    'great-sword', '격앙참',
         66, 'https://x.com/i/status/1780000000000000000', null, 'test1234');
select public.add_record('KOKOA / 랜스',    'diablos',     9, 'normal', 'lance',       '저스트 가드',
         99, 'https://www.youtube.com/watch?v=ccccccccccc', null, 'test1234');
select public.add_record('메타몽 / 활',     'nargacuga',   8, 'normal', 'bow',         '강연사',
         38, 'https://www.youtube.com/watch?v=ddddddddddd',
       'w%3Dnarg%2Cwt%3Dbow%2Cst%3D2%2Chelm%3Dnarg%2Cmail%3Dnarg%2Cgloves%3Dnarg%2Cbelt%3Dnarg%2Cgreaves%3Dnarg',
       'test1234');

-- 랭킹 탭 확인용. 같은 판(리오레우스 ★10 차원변이)에 5건이 쌓여 금·은·동과 4위 아래가 같이 보입니다.
-- 58초 두 건은 동률입니다 — 먼저 넣은 쪽이 은관을 가져가야 합니다(created_at 오름차순).
select public.add_record('보노보노 / 라보', 'rathalos', 10, 'dim', 'long-sword', '위합',
         52, 'https://www.youtube.com/watch?v=eeeeeeeeeee', null, 'test1234');
select public.add_record('KAMINUS / 태도', 'rathalos', 10, 'dim', 'long-sword', '기인 무쌍베기',
         58, 'https://www.youtube.com/watch?v=fffffffffff', null, 'test1234');
select public.add_record('KOKOA / 랜스',   'rathalos', 10, 'dim', 'lance', '저스트 가드',
         58, 'https://www.youtube.com/watch?v=ggggggggggg', null, 'test1234');
select public.add_record('donghu / 해머',  'rathalos', 10, 'dim', 'hammer', null,
         71, 'https://x.com/i/status/1780000000000000001', null, 'test1234');

-- 고룡은 ★8 이 최고 등급이고 차원변이가 없습니다. 랭킹 탭에서 난이도 칩(★10)과 상관없이
-- 아래 두 건이 보여야 합니다.
select public.add_record('키린헌터 / 태도', 'kirin', 8, 'normal', 'long-sword', '위합',
         77, 'https://www.youtube.com/watch?v=hhhhhhhhhhh', null, 'test1234');
select public.add_record('크샬장인 / 활', 'kushala_daora', 8, 'normal', 'bow', '강연사',
         88, 'https://www.youtube.com/watch?v=iiiiiiiiiii', null, 'test1234');

-- 로컬 전용 마스터 비밀번호: devmaster
--
-- 이 파일은 공개 저장소에 커밋됩니다. 여기 적힌 값은 곧 «누구나 아는 값» 이므로
-- 운영(Supabase)의 master_pw 로는 절대 쓰지 마세요 — 같으면 누구나 친구 코드·기록·
-- 추천빌드·이벤트를 지울 수 있습니다. 운영 값은 대시보드에서만 넣습니다
-- (README 의 «마스터 비밀번호» 절).
insert into public.app_config (key, value)
values ('master_pw', extensions.crypt('devmaster', extensions.gen_salt('bf', 8)))
on conflict (key) do update set value = excluded.value;

-- 이벤트. 등록은 마스터 비밀번호로만 하므로 위에서 심은 devmaster 를 씁니다.
-- 기간은 화면에서 만드는 것과 같은 꼴(하루의 처음 00:00 ~ 끝 23:59)로 둡니다.
-- 진행중 · 선착순 마감 · 상시 · 시작 전 · 종료 다섯 갈래를 다 심어 두어야 상태 배지와
-- 잠긴 버튼을 한 화면에서 볼 수 있습니다 (tools/event-test.js 가 이것들을 셉니다).
select public.add_event(
  '첫 사냥 인증 이벤트',
  E'★10 몬스터를 처음 잡은 스크린샷을 올려주세요.\n\n- 보상: 추첨 3명 기프티콘\n- 참여하기를 눌러 제목·닉네임·내용을 적고 이미지를 붙이면 디스코드로 바로 응모됩니다.',
  date_trunc('day', now()) - interval '2 days', date_trunc('day', now()) + interval '23 hours 59 minutes' + interval '5 days', 30, 'devmaster');
select public.add_event(
  '표류연성 대박 자랑',
  E'표류석에서 원하는 스킬이 한 번에 붙은 순간을 자랑해 주세요.\n이미지 한 장이면 충분합니다.',
  null, null, null, 'devmaster');            -- 상시 · 인원 무제한
select public.add_event(
  '선착순 10명 기프티콘',
  E'선착순 10명입니다. 자리가 다 차면 참여 버튼이 잠깁니다.',
  null, null, 10, 'devmaster');
select public.add_event(
  '여름 특별 이벤트',
  E'다음 주에 시작합니다. 아직 응모할 수 없습니다.',
  date_trunc('day', now()) + interval '3 days', date_trunc('day', now()) + interval '23 hours 59 minutes' + interval '10 days', null, 'devmaster');
select public.add_event(
  '봄맞이 스크린샷 대회',
  E'끝난 이벤트입니다. 당첨자는 디스코드에서 발표했습니다.',
  date_trunc('day', now()) - interval '30 days', date_trunc('day', now()) + interval '23 hours 59 minutes' - interval '2 days', 50, 'devmaster');

-- 선착순이 «찬» 모습을 보려고 자리를 미리 채워 둡니다. 그리고 30명짜리에는 몇 자리만.
update public.events set entries = capacity where title = '선착순 10명 기프티콘';
update public.events set entries = 24       where title = '첫 사냥 인증 이벤트';

-- 자리를 잡는 함수는 프로덕션에서 service_role 만 부를 수 있습니다(schema.sql).
-- 로컬 PostgREST 는 언제나 anon 으로 도므로, 여기서만 열어 줍니다.
-- !! 이 두 줄은 로컬 전용입니다. schema.sql 로 옮기지 마세요 !!
grant execute on function public.claim_event_slot(bigint, text)   to anon;
grant execute on function public.release_event_slot(bigint, text) to anon;
