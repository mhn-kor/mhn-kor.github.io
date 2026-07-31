/* 리더보드 순수 함수 테스트 — 의존성 없이 `node tools/record-test.js`.

   영상 URL 해석과 시간 변환만 봅니다. 이 둘이 틀리면 잘못된 주소가 DB 에 들어가거나
   (스키마 CHECK 가 막아 등록이 통째로 실패) 순위가 어긋납니다.
   record.js 의 rkVid / rkCanon / rkParse / rkTime 을 고쳤다면 반드시 돌려보세요. */
const path = require('path');
const { rkVid, rkCanon, rkEmbed, rkTime, rkParse, rkBuildParam } = require(path.join(__dirname, '..', 'record.js'));

// supabase/schema.sql 의 video_url CHECK 와 같은 식입니다. 여기가 통과하면 DB 도 통과합니다.
const CHECK = /^https:\/\/(www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}|x\.com\/i\/status\/[0-9]{5,25})$/;

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

for (const bad of [
  '', '  ', null, undefined, 'youtube.com/shorts/' + YT,          // 스킴 없음 → URL 파싱 실패
  'https://www.youtube.com/watch?v=short',                        // 11자가 아님
  'https://www.youtube.com/@channel',
  'https://vimeo.com/123456789',
  'https://example.com/x.com/i/status/1780000000000000000',       // 호스트를 경로에 숨긴 것
  'javascript:alert(1)//youtu.be/' + YT,
  'https://x.com/hunter/status/12',                               // 너무 짧은 id
]) {
  ok(`거부: ${String(bad).slice(0, 46)}`, rkVid(bad), null);
}

/* 정규화 — 같은 영상은 어떤 주소로 넣어도 한 형태가 되어야 unique 가 듣습니다. */
ok('숏츠·일반·단축이 한 주소로', [
  rkCanon(rkVid(`https://www.youtube.com/shorts/${YT}`)),
  rkCanon(rkVid(`https://youtu.be/${YT}`)),
  rkCanon(rkVid(`https://www.youtube.com/watch?v=${YT}`)),
], Array(3).fill(`https://www.youtube.com/watch?v=${YT}`));
ok('X 는 i/status 로', rkCanon(rkVid('https://twitter.com/hunter/status/1780000000000000000')),
  'https://x.com/i/status/1780000000000000000');

for (const u of [`https://youtu.be/${YT}`, 'https://twitter.com/h/status/1780000000000000000']) {
  if (!CHECK.test(rkCanon(rkVid(u)))) { fail++; console.error(`✗ 스키마 CHECK 불통과: ${u}`); }
}

ok('임베드는 nocookie', rkEmbed({ kind: 'yt', id: YT }).startsWith('https://www.youtube-nocookie.com/embed/'), true);

/* ── 시간 ───────────────────────────────────────────────────── */
ok('83.45', rkParse('83.45'), 8345);
ok('1:23.45', rkParse('1:23.45'), 8345);
ok('1:23', rkParse('1:23'), 8300);
ok('45', rkParse('45'), 4500);
ok('45.3 → 45.30', rkParse('45.3'), 4530);
ok('쉼표도 소수점', rkParse('45,30'), 4530);
ok('앞뒤 공백', rkParse('  59.99  '), 5999);
for (const bad of ['', '0.5', 'abc', '3600.01', '-5', '1:2:3', '45.', null]) {
  ok(`거부: ${JSON.stringify(bad)}`, rkParse(bad), null);
}

ok('8345 → 1:23.45', rkTime(8345), '1:23.45');
ok('4530 → 45.30', rkTime(4530), '45.30');
ok('6000 → 1:00.00', rkTime(6000), '1:00.00');
ok('100 → 1.00', rkTime(100), '1.00');

// 왕복: 화면에 찍힌 시간을 그대로 다시 넣어도 같은 값이어야 합니다.
for (const cs of [100, 4530, 6000, 8345, 35999, 360000]) {
  ok(`왕복 ${cs}`, rkParse(rkTime(cs)), cs);
}

/* ── 빌드 링크 ──────────────────────────────────────────────── */
ok('공유 링크에서 파라미터만',
  rkBuildParam('https://mhn-kor.github.io/qr/?build=w%3Dnarg%2Cwt%3Dbow#build'), 'w%3Dnarg%2Cwt%3Dbow');
ok('로컬 주소도', rkBuildParam('http://localhost:8080/?build=w%3Dnarg#build'), 'w%3Dnarg');
ok('빌드가 아닌 링크', rkBuildParam('https://mhn-kor.github.io/qr/#build'), null);
ok('빈 값', rkBuildParam(''), null);

console.log(fail ? `실패 ${fail}건` : '통과 — 영상 URL · 시간 · 빌드 링크');
process.exit(fail ? 1 : 0);
