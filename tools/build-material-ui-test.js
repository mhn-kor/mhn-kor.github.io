const { chromium } = require('playwright'), assert = require('assert');
const path = require('path'), { pathToFileURL } = require('url');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href + '#build');
      await page.evaluate(() => {
        bdState = { builds: [{ ...bdNewBuild(), n: '첫 빌드' }, { ...bdNewBuild(), wt: 'bow', n: '활 빌드' }, { ...bdNewBuild(), wt: 'hammer', n: '해머 빌드' }], detail: false }; bdRender();
      });
      await page.locator('[data-build-filter="bow"]').click();
      assert.strictEqual(await page.locator('.bd-card').count(), 1);
      await page.locator('.bd-title').fill('활 수정');
      assert.strictEqual(await page.evaluate(() => bdState.builds[1].n), '활 수정');
      assert.strictEqual(await page.evaluate(() => bdState.builds[0].n), '첫 빌드');
      await page.locator('#bd-list').click();
      await page.locator('[data-move="2:-1"]').click();
      assert.strictEqual(await page.locator('#bd-modal').evaluate(e => e.open), true);
      await page.locator('[data-build-go="1"]').click();
      assert.strictEqual(await page.locator('#bd-modal').evaluate(e => e.open), false);
      assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.buildIndex), '1');
      assert.strictEqual(await page.evaluate(() => bdWeaponFilter), 'hammer');
      await page.locator('[data-build-filter="hammer"]').click();
      assert.strictEqual(await page.locator('.bd-card').count(), 3);
      await page.locator('[data-build-filter="bow"]').click();
      await page.locator('#bd-add').click();
      assert.strictEqual(await page.evaluate(() => bdState.builds[0].wt), 'bow');
      assert.strictEqual(await page.evaluate(() => bdWeaponFilter), '');
      assert.strictEqual(await page.locator('.bd-card').count(), 4);
      assert.strictEqual(await page.locator('[data-build-filter=""]').getAttribute('aria-pressed'), 'true');
      await page.evaluate(() => { location.hash = 'material'; showTab(); });
      await page.locator('[data-mat-fav-add]').click();
      await page.locator('[data-mat-fav-add]').click();
      assert.strictEqual(await page.locator('[data-mat-fav-go]').count(), 1);
      assert.ok((await page.locator('.mt-fav-count').innerText()).includes('×2'));
      const singleMoney = await page.evaluate(() => matTotals(matMon, matGear, matFrom, matTo).zenny);
      await page.locator('[data-gear="armor"]').click();
      await page.locator('[data-mat-fav-add]').click();
      const armorMoney = await page.evaluate(() => matTotals(matMon, matGear, matFrom, matTo).zenny);
      await page.locator('[data-mat-all]').click();
      assert.ok((await page.locator('#mt-result .zen b').innerText()).includes((singleMoney * 2 + armorMoney).toLocaleString()));
      await page.locator('[data-mat-fav-count="0:-1"]').click();
      assert.ok((await page.locator('#mt-result .zen b').innerText()).includes((singleMoney + armorMoney).toLocaleString()));
      await page.locator('[data-mat-fav-go="0"]').click();
      assert.strictEqual(await page.evaluate(() => matGear), 'weapon');
      assert.strictEqual(await page.evaluate(() => matAllFavorites), false);
      await page.reload();
      assert.strictEqual(await page.locator('[data-mat-fav-go]').count(), 2);
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator('[data-mat-fav-delete="0"]').click();
      await page.locator('[data-mat-fav-delete="0"]').click();
      assert.strictEqual(await page.locator('[data-mat-all]').isDisabled(), true);
      assert.deepStrictEqual(errors, []);
      await page.close();
    }
    console.log('빌드 필터·첨자·순서·목록 포커스·즐겨찾기 배수·합산·저장·삭제·모바일/PC 통과');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
