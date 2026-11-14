/* 공식 뉴스에서 파밍 혜택이 있는 이벤트 일정을 뽑아 schedule-data.js 를 만듭니다 (일정 탭).
 *
 *   node tools/fetch-events.js          최근 기사를 읽어 두 달 전 ~ 앞으로의 일정으로 다시 만듭니다
 *   (화·금 12:13 KST 에 .github/workflows/schedule-update.yml 이 자동으로 돌립니다)
 *
 * 기사 본문은 옮기지 않고 제목·기간·혜택 이름과 한 줄 요약·공식 링크만 담습니다.
 * 기간은 기사의 '일시' 칸, 혜택은 '이벤트 효과' 목록과 갈무리·교환소 소제목에서 읽습니다.
 * 분류하지 못한 효과 이름은 끝에 알려 줍니다 — 공식 문구가 바뀌었다는 신호입니다.
 * '(현지 시각)'은 한국 시간, '(UTC)'는 UTC 로 읽습니다.
 */
const fs = require('fs');
const path = require('path');

const BASE = 'https://monsterhunternow.com';
const KEEP_DAYS = 62;                 // 끝난 지 두 달까지 남긴다 (2026-11-10 사용자)
const STOP_DAYS = 150;                // 게시일이 이보다 오래된 쪽까지 오면 목록 읽기를 멈춘다

/* 필터 칩으로 보여 줄 파밍 혜택 (2026-11-10 사용자, 표류석은 같은 날 추가). 효과 이름·소제목에 맞춰 분류한다. */
const CATS = [
  { k: 'hunt2', n: '대연속 2배', re: /대연속 사냥 보수 증가/ },
  { k: 'elder2', n: '고룡 2배', re: /고룡영격전 보수 증가/ },
  { k: 'break2', n: '부파 2배', re: /부위 파괴 보수 증가/ },
  { k: 'range', n: '산책 구슬', re: /접근 (?:가능 )?범위/ },
  { k: 'carve2', n: '갈무리 2회', re: /갈무리 나이프 (?:를 )?두 번/ },
  { k: 'zenny', n: '제니', re: /빛나는 알|제니/ },
  { k: 'exchange', n: '교환소', re: /교환소/ },
  { k: 'stone', n: '표류석', re: /표류석 보너스/ },
];
/* 칩은 없지만 요약에 같이 보여 주는 파밍 혜택. */
const EXTRA = [/그룹 사냥 보수 (?:증가|추가)/, /몬스터 토벌 보수 증가/, /채집 포인트 획득 소재/, /일일 퀘스트 보수 증가/];
/* 파밍과 무관해 버리는 효과 이름. 여기에도 없고 위에도 없으면 '분류 못 한 효과'로 알린다. */
const IGNORE = [/^기타$/, /출현율 상승/, /차원 링크/, /활발화/, /특정 구역/, /장비 부스트/, /거점 요격전/, /몬스터 출현$/];

const get = async (url) => {
  const r = await fetch(BASE + url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
};
const unescape = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));

/* 본문을 줄 단위로: 소제목은 '#', 목록 항목은 '•'로 표시한다. */
function lines(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '')
    .replace(/<h[1-6][^>]*>/g, '\n# ').replace(/<li[^>]*>/g, '\n• ');
  return unescape(body.replace(/<[^>]+>/g, '\n')).split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/* '2026년 11월 16일(월) 9:00〜11월 22일(일) 23:59 (현지 시각)' → 시작·끝 ISO. 끝이 없는 기간(업데이트 공지)은 버린다. */
const RANGE = /(?:(전반|후반|[^\s:：]{1,6})\s*[:：]\s*)?(\d{4})년\s*(\d+)월\s*(\d+)일\([^)]*\)\s*(\d+):(\d+)\s*(?:\((현지 시각|UTC)\))?\s*[〜~～]\s*(?:(\d{4})년\s*)?(\d+)월\s*(\d+)일\([^)]*\)\s*(\d+):(\d+)\s*\((현지 시각|UTC)\)/;
const iso = (y, mo, d, h, mi, zone) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}${zone === 'UTC' ? 'Z' : '+09:00'}`;
function parsePeriod(line) {
  const m = RANGE.exec(line);
  if (!m) return null;
  const [, label, y, mo, d, h, mi, z1, y2, mo2, d2, h2, mi2, z2] = m;
  const zone = z1 || z2, endYear = y2 ? +y2 : +mo2 < +mo ? +y + 1 : +y;
  return { label: label && /전반|후반|[1-9]부/.test(label) ? label : '', start: iso(+y, +mo, +d, +h, +mi, zone), end: iso(endYear, +mo2, +d2, +h2, +mi2, zone) };
}

/* 달력 막대용 짧은 이름: 따옴표 안 이름 → 【…】·앞 문장 떼기 → '개최!' 떼기. */
function shortTitle(title) {
  const quoted = /["“]([^"”]{3,})["”]/.exec(title);
  if (quoted) return quoted[1].trim();
  const parts = title.replace(/【[^】]*】/g, '').trim().split(/!\s+/).filter(Boolean);
  return (parts.at(-1) || title).replace(/\s*(?:이벤트\s*)?개최[!！]?$|[!！]$/g, '').trim() || title;
}
function classify(name) {
  const cat = CATS.find(c => c.re.test(name));
  if (cat) return cat.k;
  if (EXTRA.some(re => re.test(name))) return 'extra';
  return IGNORE.some(re => re.test(name)) ? null : undefined;
}

/* 기사 한 건 → { title, periods, effects, unknown }. effects: { cat, name, detail } (cat 'extra'는 칩 없는 파밍 혜택). */
function parseArticle(html) {
  const title = unescape((/<title>([^<]*)/.exec(html) || [])[1] || '').replace(/\s*[–|-]\s*Monster Hunter Now\s*$/, '').trim();
  const published = ((/"datePublished"\s*:\s*"([^"]+)"/.exec(html) || [])[1] || '').slice(0, 10);
  const L = lines(html), periods = [], effects = [], unknown = [];
  const when = L.findIndex(l => /^# 일시$/.test(l));
  if (when >= 0) for (let i = when + 1; i < L.length && !L[i].startsWith('#'); i++) {
    const p = parsePeriod(L[i]);
    if (p) periods.push(p);
  }
  const add = (name, detail = '') => {
    const cat = classify(name);
    if (cat === undefined) { unknown.push(name); return; }
    if (cat && !effects.some(e => e.name === name)) effects.push({ cat, name, detail });
  };
  // '이벤트 효과': 이름 목록이 먼저, 같은 이름이 다시 나오면 그 뒤 '•' 줄이 자세한 내용이다.
  const head = L.findIndex(l => /^# 이벤트 효과$/.test(l));
  if (head >= 0) {
    const names = [];
    let i = head + 1;
    for (; i < L.length && !L[i].startsWith('#') && !L[i].startsWith('•') && !names.includes(L[i]); i++) names.push(L[i]);
    const detail = {};
    for (; i < L.length && !L[i].startsWith('#'); i++) if (names.includes(L[i]) && L[i + 1]?.startsWith('•')) detail[L[i]] = L[i + 1].slice(2);
    for (const n of names) add(n, detail[n] || '');
  }
  // 캠페인·교환소는 '이벤트 효과' 밖의 소제목이나 짧은 줄로 나온다.
  // 교환소는 '교환소【이름】'만 하나씩 뽑고, 이름이 없으면 소제목 그대로. 퀘스트 소제목, 상시인 표류석 조각 교환소,
  // 외형만 바꾸는 덧입는 장비 교환소(파밍과 무관, 2026-11-10 사용자)는 뺀다.
  const shops = [];
  for (const l of L) {
    const t = l.replace(/^# /, '').replace(/^캠페인\s*/, '').replace(/^["“]|["”]$/g, '');
    if (/갈무리 나이프 (?:를 )?두 번 사용 가능/.test(t) && t.length < 40) add(t);
    if (!l.startsWith('# ') || !/교환소/.test(t) || /표류석 조각 교환소|^기간 한정 퀘스트|덧입는 장비/.test(t)) continue;
    const named = t.match(/교환소【[^】]+】/g);
    for (const n of named || [t]) if (!shops.includes(n)) shops.push(n);
  }
  for (const n of shops.some(s => s.includes('【')) ? shops.filter(s => s.includes('【')) : shops) add(n.startsWith('교환소') ? '이벤트 ' + n : n);
  return { title, published, periods, effects, unknown };
}

async function main() {
  const now = Date.now(), keepFrom = now - KEEP_DAYS * 864e5, stopBefore = now - STOP_DAYS * 864e5;
  const events = [], unknown = new Map();
  for (let page = 1; page <= 40; page++) {
    const slugs = [...new Set([...(await get(`/ko/news?page=${page}`)).matchAll(/href="\/ko\/news\/([a-z0-9_-]+)"/g)].map(m => m[1]))];
    if (!slugs.length) break;
    let fresh = false;
    for (const slug of slugs) {
      const a = parseArticle(await get(`/ko/news/${slug}`));
      if (!a.published || Date.parse(a.published) >= stopBefore) fresh = true;
      for (const n of a.unknown) unknown.set(n, slug);
      if (!a.periods.length || !a.effects.length) continue;
      if (Math.max(...a.periods.map(p => Date.parse(p.end))) < keepFrom) continue;
      events.push({ id: slug, title: a.title, short: shortTitle(a.title), url: `${BASE}/ko/news/${slug}`, published: a.published, periods: a.periods, effects: a.effects });
    }
    process.stderr.write(`뉴스 ${page}쪽: 누적 ${events.length}건\n`);
    if (!fresh) break;
  }
  events.sort((x, y) => x.periods[0].start.localeCompare(y.periods[0].start));
  const data = { updatedAt: new Date().toISOString(), source: BASE + '/ko/news', keepDays: KEEP_DAYS,
    cats: CATS.map(({ k, n }) => ({ k, n })), events };
  fs.writeFileSync(path.join(__dirname, '..', 'schedule-data.js'),
    '/* tools/fetch-events.js 로 생성. 공식 뉴스의 제목·기간·혜택 요약만 담는다. */\nconst SCHEDULE = ' + JSON.stringify(data) + ';\n');
  console.log(`일정 ${events.length}건 저장`);
  if (unknown.size) console.log('분류 못 한 효과 (CATS·EXTRA·IGNORE에 추가 필요):', [...unknown].map(([n, s]) => `${n} (${s})`).join(' / '));
}

if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
else module.exports = { parseArticle, parsePeriod, classify, shortTitle, CATS };
