/* 별도 테스트 브라우저를 사용하므로 사용자 빌드·브라우저 저장값에는 접근하지 않는다. */
const { chromium } = require('playwright'), assert = require('assert');
const path = require('path'), { pathToFileURL } = require('url');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const url = pathToFileURL(path.join(__dirname, '../index.html')).href;
      await page.goto(url + '#build');
      await page.evaluate(() => {
        const b = { ...bdNewBuild(), w: 'puke', wt: 'shield-sword' };
        bdState = { builds: [b, bdNewBuild()], detail: true }; bdRender();
      });
      const card = page.locator('.bd-card').first(), slots = card.locator('[data-param]');
      const style20 = card.locator('[data-style20]');
      assert.strictEqual(await style20.isDisabled(), true);
      assert.strictEqual(await slots.count(), 3);
      await card.locator('[data-style]').click();
      await page.locator('#bd-modal-body [data-v="1"]').click();
      assert.strictEqual(await style20.isDisabled(), false);
      assert.strictEqual(await slots.first().isDisabled(), true);
      await style20.check();
      for (const [i, stat] of ['atk', 'ele', 'crit'].entries()) {
        await slots.nth(i).click();
        assert.ok((await page.locator('#bd-modal-title').innerText()).includes('Lv' + [10, 15, 20][i]));
        await page.locator(`#bd-modal-body [data-param-choice="${stat}"]`).click();
        assert.ok((await slots.nth(i).getAttribute('class')).includes(stat));
      }
      assert.strictEqual(await card.locator('.bd-style-controls details').count(), 0);
      const weaponStats = await card.locator('.bd-stat').innerText();
      assert.ok(weaponStats.includes('2112') && weaponStats.includes('507') && weaponStats.includes('10%'));
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const bounds = await slots.last().boundingBox();
      assert.ok(bounds.x + bounds.width <= width);
      if (width === 390) await card.screenshot({ path: path.join(require('os').tmpdir(), 'mhn-style20-mobile.png') });
      await style20.uncheck();
      assert.strictEqual(await slots.first().isDisabled(), true);
      assert.ok((await slots.first().getAttribute('class')).includes('atk'));
      await style20.check();
      const param = await page.evaluate(() => bdShareParam(bdState.builds[0]));
      await page.reload();
      assert.strictEqual(await style20.isChecked(), true);
      assert.ok((await slots.nth(2).getAttribute('class')).includes('crit'));
      await page.goto(url + '?build=' + param + '#build');
      assert.strictEqual(await style20.isChecked(), true);
      await card.locator('[data-style]').click();
      await page.locator('#bd-modal-body [data-v="0"]').click();
      assert.strictEqual(await style20.isDisabled(), true);
      assert.strictEqual(await style20.isChecked(), false);
      await page.evaluate(() => { bdState.builds[0].w = 'spring-26'; bdState.builds[0].wt = 'light-gun'; bdState.builds[0].st = 1; bdNormalizeParams(bdState.builds[0]); bdRender(); });
      await style20.check();
      await slots.first().click();
      assert.strictEqual(await page.locator('#bd-modal-body [data-param-choice="crit"]').count(), 0);
      assert.strictEqual(await page.locator('#bd-modal-body [data-param-choice="ele"]').count(), 0);
      await page.locator('#bd-modal-body [data-param-choice=""]').click();
      assert.ok((await slots.first().getAttribute('class')).includes('empty'));
      for (const [w, wt] of [['rathi', 'great-sword'], ['barr', 'charge-blade'], ['barr', 'long-sword'], ['puke', 'gunlance']]) {
        await page.evaluate(({ w, wt }) => {
          bdState.builds[0] = { ...bdNewBuild(), w, wt }; bdRender();
        }, { w, wt });
        assert.strictEqual(await card.locator('[data-style]').isDisabled(), false);
        await card.locator('[data-style]').click();
        await page.locator('#bd-modal-body [data-v="1"]').click();
        assert.strictEqual(await page.evaluate(() => bdState.builds[0].st), 1);
        assert.strictEqual(await style20.isDisabled(), false);
        await style20.check();
        await slots.first().click();
        await page.locator('#bd-modal-body [data-param-choice="atk"]').click();
        await page.reload();
        assert.strictEqual(await page.evaluate(() => bdState.builds[0].st), 1);
        assert.strictEqual(await style20.isChecked(), true);
        assert.ok((await slots.first().getAttribute('class')).includes('atk'));
      }
      assert.deepStrictEqual(errors, []);
      await page.close();
    }
    console.log('스타일20 비활성화·보석 선택·색상·해제·저장·공유·특수 선택지·모바일/PC 통과');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
