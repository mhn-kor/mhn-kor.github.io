/* 리더보드 순수 함수 테스트 — 의존성 없이 `node tools/record-test.js`.

   영상 URL 해석과 시간 변환만 봅니다. 이 둘이 틀리면 잘못된 주소가 DB 에 들어가거나
   (스키마 CHECK 가 막아 등록이 통째로 실패) 순위가 어긋납니다.
   record.js 의 rkVid / rkCanon / rkParse / rkTime 을 고쳤다면 반드시 돌려보세요. */
const path = require('path');
const { rkVid, rkCanon, rkEmbed, rkThumb, rkShortLink, RK_SRC, rkTime, rkParse, rkBuildParam,
  rkOrder, rkKey, rkGroup, rkTopMap } = require(path.join(__dirname, '..', 'record.js'));

// supabase/schema.sql 의 video_url CHECK 와 같은 식입니다. 여기가 통과하면 DB 도 통과합니다.
const CHECK = /^https:\/\/(www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}|x\.com\/i\/status\/[0-9]{5,25}|www\.tiktok\.com\/@i\/video\/[0-9]{5,25})$/;

let fail = 0;
const ok = (what, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail++;
    console.error(`✗ ${what}\n    받음: ${JSON.stringify(got)}\n    기대: ${JSON.stringify(want)}`);
  }
};

/* ── URL → 영상 ─────────────────────────────────────────────── */
const YT = 'dQw4w9WgXcQ';
for (const url of [
  `https://www.youtube.com/shorts/${YT}`,
  `https://youtube.com/shorts/${YT}?feature=share`,
  `https://m.youtube.com/watch?v=${YT}`,
  `https://www.youtube.com/watch?app=desktop&v=${YT}&t=12s`,
  `https://youtu.be/${YT}`,
  `https://youtu.be/${YT}?si=abcdef`,
  `https://www.youtube.com/live/${YT}`,
  `  https://www.youtube.com/shorts/${YT}  `,           // 붙여넣기 공백
]) {
  ok(`유튜브: ${url.trim()}`, rkVid(url), { kind: 'yt', id: YT });
}

for (const url of [
  'https://x.com/hunter/status/1780000000000000000',
  'https://twitter.com/hunter/status/1780000000000000000',
  'https://mobile.twitter.com/hunter/status/1780000000000000000?s=20',
  'https://x.com/i/status/1780000000000000000',
]) {
  ok(`X: ${url}`, rkVid(url), { kind: 'x', id: '1780000000000000000' });
}

/* 틱톡. @아이디 자리는 뭐가 오든 숫자 id 만 뽑습니다 — 임베드도 정규 주소도 그것만 씁니다. */
const TT = '6718335390845095173';
for (const url of [
  `https://www.tiktok.com/@hunter/video/${TT}`,
  `https://www.tiktok.com/@hunter/video/${TT}?is_from_webapp=1&sender_device=pc`,
  `https://m.tiktok.com/@hunter.mh/video/${TT}`,
  `https://www.tiktok.com/@i/video/${TT}`,                        // 우리가 저장하는 형태를 되읽기
  `  https://www.tiktok.com/@hunter/video/${TT}  `,
]) {
  ok(`틱톡: ${url.trim()}`, rkVid(url), { kind: 'tt', id: TT });
}

for (const bad of [
  '', '  ', null, undefined, 'youtube.com/shorts/' + YT,          // 스킴 없음 → URL 파싱 실패
  'https://www.youtube.com/watch?v=short',                        // 11자가 아님
  'https://www.youtube.com/@channel',
  'https://vimeo.com/123456789',
  'https://example.com/x.com/i/status/1780000000000000000',       // 호스트를 경로에 숨긴 것
  'javascript:alert(1)//youtu.be/' + YT,
  'https://x.com/hunter/status/12',                               // 너무 짧은 id
  `https://vm.tiktok.com/ZMabcdefg/`,                             // 짧은 링크 — 도착지를 알 수 없음
  `https://vt.tiktok.com/ZSabcdefg/`,
  `https://www.tiktok.com/video/${TT}`,                           // @아이디가 없으면 틱톡도 404 로 보냅니다
  'https://www.tiktok.com/@hunter/photo/6718335390845095173',     // 사진 글은 영상이 아님
  `https://example.com/www.tiktok.com/@i/video/${TT}`,
]) {
  ok(`거부: ${String(bad).slice(0, 46)}`, rkVid(bad), null);
}

/* 짧은 링크는 «못 받는 주소» 가 아니라 «이렇게 바꿔 오세요» 로 안내해야 합니다. */
ok('짧은 링크로 알아봄', [
  rkShortLink('https://vm.tiktok.com/ZMabcdefg/'),
  rkShortLink('https://vt.tiktok.com/ZSabcdefg/'),
  rkShortLink(`https://www.tiktok.com/@hunter/video/${TT}`),
  rkShortLink('https://youtu.be/' + YT),
  rkShortLink(''),
], [true, true, false, false, false]);

/* 정규화 — 같은 영상은 어떤 주소로 넣어도 한 형태가 되어야 unique 가 듣습니다. */
ok('숏츠·일반·단축이 한 주소로', [
  rkCanon(rkVid(`https://www.youtube.com/shorts/${YT}`)),
  rkCanon(rkVid(`https://youtu.be/${YT}`)),
  rkCanon(rkVid(`https://www.youtube.com/watch?v=${YT}`)),
], Array(3).fill(`https://www.youtube.com/watch?v=${YT}`));
ok('X 는 i/status 로', rkCanon(rkVid('https://twitter.com/hunter/status/1780000000000000000')),
  'https://x.com/i/status/1780000000000000000');
/* 같은 영상을 다른 계정 주소로 올려도 한 형태여야 unique 가 듣습니다. @i 는 틱톡이 원래
   주인에게 넘겨주는 공식 경로입니다(실제로 열어 확인). */
ok('틱톡은 @i/video 로', [
  rkCanon(rkVid(`https://www.tiktok.com/@hunter/video/${TT}?is_from_webapp=1`)),
  rkCanon(rkVid(`https://m.tiktok.com/@another/video/${TT}`)),
], Array(2).fill(`https://www.tiktok.com/@i/video/${TT}`));

for (const u of [`https://youtu.be/${YT}`, 'https://twitter.com/h/status/1780000000000000000',
  `https://www.tiktok.com/@hunter/video/${TT}`]) {
  if (!CHECK.test(rkCanon(rkVid(u)))) { fail++; console.error(`✗ 스키마 CHECK 불통과: ${u}`); }
}

ok('임베드는 nocookie', rkEmbed({ kind: 'yt', id: YT }).startsWith('https://www.youtube-nocookie.com/embed/'), true);
ok('틱톡 임베드', rkEmbed({ kind: 'tt', id: TT }), `https://www.tiktok.com/embed/v2/${TT}`);

/* 갈래마다 카드가 그릴 것이 있어야 합니다 — 썸네일이 없으면 로고를 깝니다.
   둘 다 없는 갈래를 넣으면 카드가 빈 검은 칸이 됩니다. */
for (const [k, s] of Object.entries(RK_SRC)) {
  ok(`${k}: 썸네일이든 로고든 하나는 있음`, !!(s.thumb('x') || s.mark), true);
  ok(`${k}: 이름이 있음`, !!(s.name && s.kor), true);
}

/* ── 시간 (초 단위 정수만. 소수점도 분:초도 받지 않습니다) ────── */
ok('45', rkParse('45'), 45);
ok('한 자리', rkParse('9'), 9);
ok('세 자리', rkParse('120'), 120);
ok('상한 3600', rkParse('3600'), 3600);
ok('앞뒤 공백', rkParse('  59  '), 59);
for (const bad of ['', '0', '3601', 'abc', '-5', '45.32', '45.', '1:23', '45초', null, undefined]) {
  ok(`거부: ${JSON.stringify(bad)}`, rkParse(bad), null);
}

ok('45 → 45초', rkTime(45), '45초');
ok('120 → 120초', rkTime(120), '120초');
ok('1 → 1초', rkTime(1), '1초');

/* ── 빌드 링크 ──────────────────────────────────────────────── */
ok('공유 링크에서 파라미터만',
  rkBuildParam('https://mhn-kor.github.io/?build=w%3Dnarg%2Cwt%3Dbow#build'), 'w%3Dnarg%2Cwt%3Dbow');
ok('로컬 주소도', rkBuildParam('http://localhost:8080/?build=w%3Dnarg#build'), 'w%3Dnarg');
ok('빌드가 아닌 링크', rkBuildParam('https://mhn-kor.github.io/#build'), null);
ok('빈 값', rkBuildParam(''), null);

/* ── 순위 (랭킹 탭 · 리더보드 왕관) ──────────────────────────────
   판은 «몬스터 · 난이도 · 종류»이고, 같은 시간이면 먼저 올린 쪽이 위입니다. */
const rec = (id, monster, star, variant, time_sec, created_at) =>
  ({ id, monster, star, variant, time_sec, created_at });

ok('판 이름', rkKey(rec(1, 'rathalos', 10, 'dim', 45, '')), 'rathalos|10|dim');

const rows = [
  rec(1, 'rathalos', 10, 'dim', 50, '2026-07-01T00:00:00Z'),
  rec(2, 'rathalos', 10, 'dim', 45, '2026-07-03T00:00:00Z'),   // 늦게 올렸지만 더 빠름 → 1위
  rec(3, 'rathalos', 10, 'dim', 50, '2026-06-01T00:00:00Z'),   // 50초 동률 중 가장 먼저 → 2위
  rec(4, 'rathalos', 10, 'normal', 30, '2026-07-01T00:00:00Z'),// 종류가 다르면 다른 판
  rec(5, 'rathalos', 8, 'dim', 30, '2026-07-01T00:00:00Z'),    // 난이도가 다르면 다른 판
  rec(6, 'diablos', 10, 'dim', 99, '2026-07-01T00:00:00Z'),
  rec(7, 'rathalos', 10, 'dim', 55, '2026-07-01T00:00:00Z'),
].sort(rkOrder);

ok('같은 시간이면 먼저 올린 쪽이 위', rows.filter(r => rkKey(r) === 'rathalos|10|dim').map(r => r.id),
  [2, 3, 1, 7]);
ok('판이 넷', [...rkGroup(rows).keys()].sort(),
  ['diablos|10|dim', 'rathalos|10|dim', 'rathalos|10|normal', 'rathalos|8|dim']);
ok('왕관은 판마다 3위까지', [...rkTopMap(rows)].sort((a, b) => a[0] - b[0]),
  [[1, 3], [2, 1], [3, 2], [4, 1], [5, 1], [6, 1]]);   // 7번은 4위라 왕관 없음

/* created_at 이 없는 옛 행이 섞여도 순서가 흔들리면 안 됩니다(그릴 때마다 1위가 바뀝니다). */
const same = [rec(9, 'm', 10, 'dim', 40), rec(8, 'm', 10, 'dim', 40)].sort(rkOrder);
ok('시간·시각이 같으면 id 순', same.map(r => r.id), [8, 9]);

console.log(fail ? `실패 ${fail}건` : '통과 — 영상 URL · 시간 · 빌드 링크 · 순위');
process.exit(fail ? 1 : 0);
