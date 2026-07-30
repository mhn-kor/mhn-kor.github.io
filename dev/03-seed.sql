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

-- 로컬 전용 마스터 비밀번호: devmaster
-- 실제 운영 비밀번호를 이 파일에 넣지 마세요. 저장소는 공개입니다.
insert into public.app_config (key, value)
values ('master_pw', extensions.crypt('devmaster', extensions.gen_salt('bf', 8)))
on conflict (key) do update set value = excluded.value;
