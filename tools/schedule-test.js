/* 일정 탭: 공식 기사 해석(tools/fetch-events.js)과 저장된 schedule-data.js 형식 검사. 네트워크 없이 돈다. */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const { parseArticle, parsePeriod, shortTitle, CATS } = require('./fetch-events.js');

// 기간: 현지 시각은 한국 시간, UTC 는 UTC. 끝 연도가 없으면 시작 연도, 달이 줄면 다음 해.
assert.deepStrictEqual(parsePeriod('2026년 11월 16일(월) 9:00〜11월 22일(일) 23:59 (현지 시각)'),
  { label: '', start: '2026-11-16T09:00+09:00', end: '2026-11-22T23:59+09:00' });
assert.strictEqual(parsePeriod('2026년 9월 14일(월) 0:00〜9월 16일(수) 23:59 (UTC)').start, '2026-09-14T00:00Z');
assert.strictEqual(parsePeriod('2026년 12월 28일(월) 9:00〜1월 3일(일) 23:59 (현지 시각)').end, '2027-01-03T23:59+09:00');
assert.strictEqual(parsePeriod('전반: 2026년 10월 26일(월) 9:00〜11월 2일(월) 8:59 (현지 시각)').label, '전반');
assert.strictEqual(parsePeriod('2026년 8월 17일(월) 9:00 (현지 시각)〜'), null, '끝이 없는 업데이트 공지는 버림');

// 기사 구조: '일시' 소제목 → 기간, '이벤트 효과' 이름 목록 → 같은 이름 뒤 '•' 줄이 요약, 교환소【이름】만 하나씩.
const html = `<title>【부위 파괴 보수 2배!】 "테스트 축제 2026" 개최! – Monster Hunter Now</title>
<script>{"datePublished":"2026-10-20T01:00:00.000Z"}</script>
<h1>일시</h1><p>전반: 2026년 10월 26일(월) 9:00〜11월 2일(월) 8:59 (현지 시각)</p><p>후반: 2026년 11월 2일(월) 9:00〜11월 8일(일) 23:59 (현지 시각)</p>
<h3>이벤트 효과</h3><p>대연속 사냥 보수 증가</p><p>부위 파괴 보수 증가</p><p>표류석 보너스</p><p>기타</p><p>접근 가능 범위 1.5배</p>
<p>대연속 사냥 보수 증가</p><ul><li>기본 보수 1번 및 2번 슬롯의 소재를 2개 획득</li></ul><p>부위 파괴 보수 증가</p><ul><li>보수 개수 2배</li></ul>
<h3>기간 한정 퀘스트 "교환소 특별 퀘스트"</h3><h2>2종류의 이벤트 교환소【테스트】과 【테스트 EX】 등장!</h2><h3>이벤트 교환소【테스트】</h3><h3>후반부터 이벤트 교환소【테스트 EX】</h3>
<h3>표류석 조각 교환소에 신규 표류순석</h3><p>캠페인 “특제 갈무리 나이프 두 번 사용 가능”</p>`;
const a = parseArticle(html);
assert.strictEqual(a.title, '【부위 파괴 보수 2배!】 "테스트 축제 2026" 개최!'); assert.strictEqual(a.published, '2026-10-20');
assert.deepStrictEqual(a.periods.map(p => p.label), ['전반', '후반']);
assert.deepStrictEqual(a.effects.map(e => e.cat), ['hunt2', 'break2', 'stone', 'range', 'carve2', 'exchange', 'exchange']);
assert.strictEqual(a.effects[0].detail, '기본 보수 1번 및 2번 슬롯의 소재를 2개 획득');
assert.deepStrictEqual(a.effects.filter(e => e.cat === 'exchange').map(e => e.name), ['이벤트 교환소【테스트】', '이벤트 교환소【테스트 EX】'], '퀘스트·표류석 조각 교환소 제외');
assert.deepStrictEqual(a.unknown, []);
assert.deepStrictEqual(parseArticle('<h3>이벤트 효과</h3><p>새로운 혜택 이름</p>').unknown, ['새로운 혜택 이름'], '모르는 효과는 알림');
assert.strictEqual(shortTitle('차원 임계 몬스터에 도전하세요! 강화 러쉬 퀘스트 개최!'), '강화 러쉬 퀘스트');
assert.strictEqual(shortTitle(a.title), '테스트 축제 2026');

// 저장된 데이터: 칩 8개, 모든 일정에 기간과 파밍 혜택, 아는 분류만.
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'schedule-data.js'), 'utf8').replace('const SCHEDULE', 'SCHEDULE'), ctx);
const data = ctx.SCHEDULE, keys = new Set([...CATS.map(c => c.k), 'extra']);
assert.deepStrictEqual(Array.from(data.cats, c => c.k), CATS.map(c => c.k));
assert.strictEqual(data.cats.length, 8);
for (const ev of data.events) {
  assert.ok(ev.periods.length && ev.periods.every(p => Date.parse(p.start) < Date.parse(p.end)), `기간: ${ev.id}`);
  assert.ok(ev.effects.length && ev.effects.every(e => keys.has(e.cat)), `혜택: ${ev.id}`);
  assert.ok(ev.url.startsWith('https://monsterhunternow.com/ko/news/'), `공식 링크: ${ev.id}`);
}
console.log('일정 해석·데이터 검사 통과', { events: data.events.length });
