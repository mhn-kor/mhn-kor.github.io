/* 무기 선택 창의 상세 필터 칩(벌레 타입·탄 종류·화살 Lv4…)을 진짜 브라우저로 확인합니다.
 *
 *   docker compose up -d
 *   node tools/build-filter-e2e.js        # 기본 http://localhost:8080
 *
 * 무엇을 지키나: 칩은 부가정보(x)를 정규식으로 대조합니다. 특히 «산탄» 은 화염산탄은
 * 잡되 확산탄·수냉확산탄은 잡으면 안 됩니다 — 글자가 겹쳐서(«확_산탄») 정규식이
 * 미묘하고, 깨져도 화면만 봐서는 티가 안 납니다. 칩 하나만 걸리는 것, 다시 눌러
 * 풀리는 것, 검색과 겹쳐 쓰는 것, 방어구 창에는 안 뜨는 것도 함께 봅니다.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8080';
const KEY = 'mhnkr.builds';

let fail = 0;
const ok = (what, got, want = true) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) { fail++; console.error(`✗ ${what}\n    받음: ${JSON.stringify(got)}\n    기대: ${JSON.stringify(want)}`); }
  else console.log(`✓ ${what}`);
};

const rows = page => page.locator('#bd-modal-body .bd-lr.gear').count();
const chipNames = page => page.evaluate(() => [...document.querySelectorAll('#bd-wf .bd-wfc')].map(c => c.textContent));
const clickChip = (page, n) => page.click(`#bd-wf [data-wf="${n}"]`);
/* 화면에 보이는 각 줄의 부가정보 칩 문구 배열 */
const shownX = page => page.evaluate(() =>
  [...document.querySelectorAll('#bd-modal-body .bd-lr.gear')].map(r => [...r.querySelectorAll('.bd-lx i')].map(i => i.textContent)));
/* 데이터에서 센 기대값 — 화면과 같은 조건으로 무기 종류·부가정보를 겁니다 */
const countBy = (page, wt, re) => page.evaluate(([wt, src, flags]) => {
  const m = src ? new RegExp(src, flags) : null;
  return BUILD.sets.filter(s => {
    const w = s.weapons.find(w => w.t === wt);
    return w && (!m || (w.x || []).some(e => m.test(e)));
  }).length;
}, [wt, re ? re.source : null, re ? re.flags : '']);

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => addEventListener('DOMContentLoaded', () => {
    const d = document.getElementById('ev-notice');
    if (d) new MutationObserver(() => d.open && d.close()).observe(d, { attributes: true });
  }));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#notice`, { waitUntil: 'load' });
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify({
    detail: false,
    builds: [{ n: '조충곤', wt: 'insect-glaive' }, { n: '라보', wt: 'light-gun' }, { n: '활', wt: 'bow' },
      { n: '피리', wt: 'hunting-horn' }],
  })]);
  await page.goto(`${BASE}/#build`, { waitUntil: 'load' });

  /* 1) 조충곤 — 칩 목록, 걸기, 풀기, 검색과 조합 */
  await page.click('[data-pick="0:weapon"]');
  ok('조충곤: 칩 목록', await chipNames(page), ['비상형', '공투형', '가루형', '절단', '타격']);
  const igAll = await countBy(page, 'insect-glaive', null);
  ok('조충곤: 처음엔 전체', await rows(page), igAll);
  await clickChip(page, '타격');
  const igBlunt = await countBy(page, 'insect-glaive', /^타격$/);
  ok('조충곤: «타격» 칩 = 타격 벌레만', await rows(page), igBlunt);
  ok('조충곤: 남은 줄 전부에 타격 표시', (await shownX(page)).every(x => x.includes('타격')));
  /* 하나만 걸립니다 — 다른 칩을 누르면 갈아탑니다 */
  await clickChip(page, '가루형');
  ok('조충곤: 칩은 하나만(가루형으로 갈아탐)', await page.evaluate(() =>
    [...document.querySelectorAll('#bd-wf .bd-wfc.on')].map(c => c.textContent)), ['가루형']);
  await clickChip(page, '가루형');
  ok('조충곤: 다시 누르면 풀림', await rows(page), igAll);
  await clickChip(page, '타격');
  await page.fill('#bd-q', '쿠루루');
  await page.dispatchEvent('#bd-q', 'input');
  ok('조충곤: 칩 + 검색 조합(타격·쿠루루)', await shownX(page), [['비상형', '타격', '퀵', '추격 빈도 UP']]);
  await page.click('#bd-modal-close');

  /* 2) 라이트보우건 — «산탄» 이 확산탄을 잡지 않는 것 */
  await page.click('[data-pick="1:weapon"]');
  await clickChip(page, '산탄');
  const lgSpread = await countBy(page, 'light-gun', /(^|[^확])산탄/);
  ok('라보: «산탄» 칩 = 산탄 계열만', await rows(page), lgSpread);
  ok('라보: 확산탄만 있는 무기는 걸리지 않음', (await shownX(page)).every(x => x.some(e => /(^|[^확])산탄/.test(e))));
  /* 확산탄 무기가 실제로 있어야 위 검사가 의미 있습니다 */
  ok('라보: 확산탄 무기가 데이터에 존재', await countBy(page, 'light-gun', /확산탄/) > 0);
  await page.click('#bd-modal-close');

  /* 3) 활 — Lv4 종류 필터 */
  await page.click('[data-pick="2:weapon"]');
  ok('활: 칩 목록', await chipNames(page), ['Lv4 연사', 'Lv4 관통', 'Lv4 확산', '독병', '마비병', '수면병', '폭파병']);
  await clickChip(page, 'Lv4 관통');
  ok('활: «Lv4 관통» 칩', await rows(page), await countBy(page, 'bow', /^Lv4 관통$/));
  ok('활: 남은 줄 전부 Lv4 관통', (await shownX(page)).every(x => x.includes('Lv4 관통')));
  await page.click('#bd-modal-close');

  /* 4) 수렵피리 — 곡명이 아니라 계열 칩. «공격력UP» 이 속성 공격력UP 을 잡으면 안 됩니다 */
  await page.click('[data-pick="3:weapon"]');
  ok('피리: 칩 목록', await chipNames(page),
    ['공격력UP', '회심률UP', '속성치UP', '속성 공격력UP', 'SP게이지 가속', '고주파 충격파', '방어력UP', '청각 보호', '무효·내성']);
  await clickChip(page, '공격력UP');
  ok('피리: «공격력UP» 칩 = 공격력UP 곡만', await rows(page), await countBy(page, 'hunting-horn', /^공격력UP/));
  ok('피리: 남은 줄 전부에 공격력UP 곡', (await shownX(page)).every(x => x.some(e => /^공격력UP/.test(e))));
  /* 속성 공격력UP «만» 가진 피리가 있어야 앵커 검사가 의미 있습니다 */
  ok('피리: 속성 공격력UP 곡이 데이터에 존재', await countBy(page, 'hunting-horn', /^(불|물|번개|얼음|용)속성 공격력UP/) > 0);
  await clickChip(page, '무효·내성');
  ok('피리: «무효·내성» 칩', await rows(page), await countBy(page, 'hunting-horn', /무효|내성/));
  await page.click('#bd-modal-close');

  /* 5) 방어구 창에는 칩이 없고, 무기 창의 칩이 새지 않습니다 */
  await page.click('[data-pick="0:helm"]');
  ok('방어구 창: 필터 칩 숨김', await page.evaluate(() => document.querySelector('#bd-wf').hidden));
  await page.click('#bd-modal-close');
  await page.click('[data-pick="0:weapon"]');
  ok('무기 창을 다시 열면 필터는 풀린 채로 시작', await rows(page), igAll);

  await browser.close();
  if (fail) { console.error(`\n실패 ${fail}건`); process.exit(1); }
  console.log('\n모두 통과');
}

main().catch(e => { console.error('실패:', e); process.exit(1); });
