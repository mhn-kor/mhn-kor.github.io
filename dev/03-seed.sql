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
-- 실제 운영 비밀번호를 이 파일에 넣지 마세요. 저장소는 공개입니다.
insert into public.app_config (key, value)
values ('master_pw', extensions.crypt('devmaster', extensions.gen_salt('bf', 8)))
on conflict (key) do update set value = excluded.value;
