/* 빌드 공유 링크가 «저장해 둔 내 빌드» 를 지우지 않는지 진짜 브라우저로 확인합니다.
 *
 *   docker compose up -d
 *   node tools/build-share-e2e.js         # 기본 http://localhost:8080
 *
 * 왜 필요한가: 공유 URL(?build=…#build)로 들어오면 예전 코드가 bdState 를 링크의 빌드
 * 하나로 갈아끼웠습니다. 그 화면에서 아무 편집이든 하는 순간 bdSave() 가 그 상태를
 * localStorage 에 통째로 써서, 저장해 둔 빌드가 전부 지워졌습니다. 상태 갈아끼우기와
 * 저장이 다른 곳에 있어 단위 테스트로는 안 잡히고, 브라우저에서 «열고 → 편집하고 →
 * 새로고침» 을 실제로 해 봐야 잡힙니다.
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

/* 저장해 둔 빌드 흉내. drawBuild 가 bdNewBuild 기본값과 합쳐 주므로 필요한 칸만 적습니다. */
const savedBuilds = n => ({
  detail: false,
  builds: Array.from({ length: n }, (_, i) => ({ n: `내빌드${i + 1}`, wt: 'great-sword', w: 'g-jagr', helm: 'g-jagr' })),
});

/* 진행중인 이벤트가 있으면 첫 화면에 공지 창이 떠 카드 클릭을 가로챕니다.
   record-e2e 와 같은 방법으로 열리는 족족 닫습니다. */
async function openCtx(browser) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => addEventListener('DOMContentLoaded', () => {
    const d = document.getElementById('ev-notice');
    if (d) new MutationObserver(() => d.open && d.close()).observe(d, { attributes: true });
  }));
  return ctx;
}

const cards = page => page.locator('#bd-cards .bd-card').count();
const names = page => page.evaluate(() => bdState.builds.map(b => b.n));
const storedNames = page => page.evaluate(k => (JSON.parse(localStorage.getItem(k) || '{}').builds || []).map(b => b.n), KEY);
/* 토스트는 1.9초 뒤 숨지만 textContent 는 남습니다. 문구로 기다립니다. */
const sawToast = (page, msg) =>
  page.waitForFunction(m => document.querySelector('#toast').textContent === m, msg, { timeout: 5000 })
    .then(() => true).catch(() => false);

/* 페이지 스크립트로 공유 파라미터를 만듭니다 — 만들기(bdShareParam)와 풀기(bdParse)를
   같은 코드로 왕복시켜야 «공유한 그대로 열리는가» 를 재는 것이 됩니다. */
async function makeParam(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/#build`, { waitUntil: 'load' });
  const out = await page.evaluate(() => {
    const g = bdStones()[0];
    const b = bdNewBuild();
    b.wt = 'insect-glaive'; b.w = 'kulu'; b.st = 1;
    for (const { k } of BUILD.parts) b[k] = 'g-jagr';
    b.ds.helm[0] = { c: g.group, s: g.skills[0].name };
    b.cond['공격 활성'] = true;
    return { param: bdShareParam(b), stone: { c: g.group, s: g.skills[0].name } };
  });
  await page.close();
  return out;
}

async function main() {
  const browser = await chromium.launch();
  const { param, stone } = await (async () => {
    const c = await openCtx(browser);
    const r = await makeParam(c);
    await c.close();
    return r;
  })();

  /* 1) 핵심 회귀 — 저장 2개 + 공유 링크 → 편집 → 새로고침 뒤에도 2개가 살아 있어야 */
  {
    const ctx = await openCtx(browser);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#notice`, { waitUntil: 'load' });
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(savedBuilds(2))]);
    await page.goto(`${BASE}/?build=${param}#build`, { waitUntil: 'load' });
    ok('공유 링크: 저장 2개 + 링크 카드 = 3장', await cards(page), 3);
    /* 링크를 연 목적이 그 빌드라 링크 카드가 맨 앞, 내 빌드는 그 뒤에 그대로. */
    ok('공유 링크: 링크 카드가 맨 앞, 저장 빌드는 뒤에 남는다', await names(page), ['', '내빌드1', '내빌드2']);
    ok('공유 링크: 링크 카드 무기 = 쿠루루 조충곤',
      await page.evaluate(() => [bdState.builds[0].wt, bdState.builds[0].w]), ['insect-glaive', 'kulu']);
    ok('공유 링크: 주소에서 build= 를 지운다', await page.evaluate(() => location.search.includes('build=')), false);
    /* 구경만 한 링크가 저장 목록에 쌓이면 안 됩니다 — 저장은 첫 편집 때 함께 됩니다. */
    ok('공유 링크: 보기만 하면 저장되지 않는다', await storedNames(page), ['내빌드1', '내빌드2']);

    /* 같은 링크를 다시 클릭(=재탐색)해도 카드가 쌓이지 않습니다 */
    await page.goto(`${BASE}/?build=${param}#build`, { waitUntil: 'load' });
    ok('같은 링크 재클릭: 여전히 3장', await cards(page), 3);

    /* 편집(복제)으로 bdSave 를 태우고 새로고침 — 예전 코드는 여기서 내빌드1·2 가 사라졌습니다 */
    await page.click('#bd-cards .bd-card:nth-child(1) [data-copy]');
    ok('복제 뒤 4장', await cards(page), 4);
    ok('편집하면 링크 카드까지 함께 저장된다', await storedNames(page), ['', '', '내빌드1', '내빌드2']);
    await page.goto(`${BASE}/#build`, { waitUntil: 'load' });
    ok('편집 후 새로고침: 내 빌드가 그대로 남는다', await names(page), ['', '', '내빌드1', '내빌드2']);

    /* 그 자리 새로고침 — build= 를 지웠으니 카드가 또 늘면 안 됩니다 */
    await page.reload({ waitUntil: 'load' });
    ok('새로고침해도 카드가 늘지 않는다', await cards(page), 4);
    await ctx.close();
  }

  /* 2) 저장이 없을 때 — 빈 카드 없이 링크 카드 한 장만 */
  {
    const ctx = await openCtx(browser);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?build=${param}#build`, { waitUntil: 'load' });
    ok('빈 상태: 링크 카드 한 장', await cards(page), 1);
    const b = await page.evaluate(() => bdState.builds[0]);
    ok('빈 상태: 무기·스타일·방어구 복원', [b.wt, b.w, b.st, b.helm, b.greaves], ['insect-glaive', 'kulu', 1, 'g-jagr', 'g-jagr']);
    ok('빈 상태: 표류석 복원', b.ds.helm[0], stone);
    ok('빈 상태: 조건부 스킬 복원', b.cond, { '공격 활성': true });
    ok('빈 상태: 보기만 하면 저장소는 빈 채로 남는다',
      await page.evaluate(k => localStorage.getItem(k), KEY), null);
    await ctx.close();
  }

  /* 3) 깨진 링크 — 알리되 저장값은 건드리지 않는다 */
  {
    const ctx = await openCtx(browser);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#notice`, { waitUntil: 'load' });
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(savedBuilds(2))]);
    await page.goto(`${BASE}/?build=%ZZ#build`, { waitUntil: 'load' });
    ok('깨진 링크: 안내 토스트', await sawToast(page, '빌드를 읽지 못했습니다'));
    ok('깨진 링크: 저장 빌드 2장 그대로', await cards(page), 2);
    ok('깨진 링크: 저장값 무사', await storedNames(page), ['내빌드1', '내빌드2']);
    await ctx.close();
  }

  /* 4) 카드가 꽉 찼을 때(BD_MAX=100) — 거절하되 잃지 않는다 */
  {
    const ctx = await openCtx(browser);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#notice`, { waitUntil: 'load' });
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(savedBuilds(100))]);
    await page.goto(`${BASE}/?build=${param}#build`, { waitUntil: 'load' });
    ok('꽉 참: 안내 토스트', await sawToast(page, '빌드는 100개까지입니다'));
    ok('꽉 참: 100장 그대로', await cards(page), 100);
    ok('꽉 참: 저장값도 100개 그대로', await page.evaluate(k => JSON.parse(localStorage.getItem(k)).builds.length, KEY), 100);
    await ctx.close();
  }

  await browser.close();
  if (fail) { console.error(`\n실패 ${fail}건`); process.exit(1); }
  console.log('\n모두 통과');
}

main().catch(e => { console.error('실패:', e); process.exit(1); });
