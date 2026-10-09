/* 브라우저 설치가 필요하다. NODE_PATH에 playwright 경로를 지정해 실행한다. */
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path'), { pathToFileURL } = require('url');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href + '#build');
      await page.evaluate(() => {
        const set = BUILD.sets.find(s => s.name === '브라키디오스');
        if (!set) throw new Error('브라키디오스 없음');
        const b = { ...bdNewBuild(), w: set.key, wt: 'bow', st: 2 };
        bdState = { builds: [b, { ...bdNewBuild(), w: set.key, wt: 'bow' }], detail: true };
        bdRender();
      });
      const first = page.locator('.bd-card').nth(0);
      assert.strictEqual(await page.locator('.bd-bow-eff details').count(), 0);
      await first.locator('[data-bow-eff]').check();
      assert.strictEqual(await first.locator('details').getAttribute('open'), null);
      assert.ok((await first.locator('.bd-bow-check').innerText()).includes('×1.333'));
      await first.locator('summary').click();
      assert.ok((await first.locator('details').innerText()).includes('주 사용 화살: 2차지 · 연사 Lv4'));
      assert.ok((await first.locator('details').innerText()).includes('스타일: 강연사'));
      assert.strictEqual(await page.locator('.bd-card').nth(1).locator('[data-bow-eff]').isChecked(), false);
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem(BD_KEY)).builds[0].bowEfficiency);
      assert.strictEqual(stored, true);
      const param = await page.evaluate(() => bdShareParam(bdState.builds[0]));
      await page.reload();
      assert.strictEqual(await first.locator('[data-bow-eff]').isChecked(), true);
      assert.strictEqual(await first.locator('details').getAttribute('open'), null);
      await first.locator('summary').click();
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (width === 390) await page.screenshot({ path: path.join(require('os').tmpdir(), 'mhn-bow-eff-mobile.png'), fullPage: true });
      await first.locator('[data-bow-eff]').uncheck();
      assert.strictEqual(await first.locator('details').count(), 0);
      await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href + '?build=' + param + '#build');
      assert.strictEqual(await first.locator('[data-bow-eff]').isChecked(), true);
      await page.evaluate(() => { bdState.builds[0].st = 1; bdRender(); });
      assert.strictEqual(await first.locator('[data-bow-eff]').isDisabled(), true);
      assert.deepStrictEqual(errors, []);
      await page.close();
    }
    console.log('활 보정 체크·접기·카드 독립성·저장·공유·스타일 변경·390/1280px 통과');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
