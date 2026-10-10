/* 별도 브라우저에서 포격 시안 UI를 검증한다. 사용자 저장 빌드와 분리한다. */
const { chromium } = require('playwright'), assert = require('assert');
const path = require('path'), os = require('os'), { pathToFileURL } = require('url');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href + '#build');
      await page.evaluate(() => {
        bdState = { builds: [{ ...bdNewBuild(), n: '포격 UI 확인', w: 'tobi', wt: 'gunlance' }], detail: false }; bdRender();
      });
      const shell = page.locator('.bd-shell').first();
      const fullWidth = await shell.evaluate(el => {
        const parent = el.parentElement;
        return getComputedStyle(el).gridColumn === '1 / -1' && el.getBoundingClientRect().width >= parent.getBoundingClientRect().width - 24;
      });
      assert.strictEqual(fullWidth, true, '포격 영역은 스킬 합계 그리드 전체 폭을 사용해야 함');
      assert.ok((await shell.innerText()).includes('2,522'));
      assert.strictEqual(await shell.locator('.bd-shell-result span').count(), 0);
      await shell.locator('[data-shell$=":normal"]').click();
      assert.ok((await shell.innerText()).includes('1,054'));
      await page.reload();
      assert.strictEqual(await page.evaluate(() => bdState.builds[0].shellMode), 'normal');
      await shell.locator('[data-shell$=":burst"]').click();
      assert.ok((await shell.innerText()).includes('3,162'));
      await shell.locator('summary').click();
      assert.ok((await shell.innerText()).includes('발당 올림'));
      for (const mode of ['normal', 'charged', 'burst']) {
        await shell.locator(`[data-shell$=":${mode}"]`).click();
        assert.strictEqual(await shell.locator('details').getAttribute('open'), '');
      }
      await page.reload();
      assert.strictEqual(await shell.locator('details').getAttribute('open'), '');
      await shell.locator('summary').click();
      await shell.locator('[data-shell$=":normal"]').click();
      assert.strictEqual(await shell.locator('details').getAttribute('open'), null);
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await shell.screenshot({ path: path.join(os.tmpdir(), `mhn-shell-${width}.png`) });
      console.log('캡처:', path.join(os.tmpdir(), `mhn-shell-${width}.png`));
      await page.evaluate(() => {
        BUILD.sets.push({ key: 'shell-ui-test', name: '테스트', weapons: [], weaponSkills: [],
          pieces: { helm: { name: '테스트', skills: [{ s: '기습', lv: 1 }], slot: 0 } } });
        bdState.builds[0].helm = 'shell-ui-test'; bdState.detail = true; bdRender();
      });
      const before = await shell.locator('.bd-shell-result b').innerText();
      await shell.locator('summary').click();
      await page.locator('[data-cond$=":기습"]').check();
      assert.notStrictEqual(await shell.locator('.bd-shell-result b').innerText(), before);
      assert.strictEqual(await shell.locator('details').getAttribute('open'), '');
      assert.ok((await shell.innerText()).includes('대미지 버프 합계:'));
      assert.strictEqual(await shell.locator('.bd-shell-buffs').count(), 1);
      await page.locator('[data-cond$=":기습"]').uncheck();
      assert.strictEqual(await shell.locator('.bd-shell-result b').innerText(), before);
      await page.evaluate(() => { bdState.builds[0].wt = 'shield-sword'; bdRender(); });
      assert.strictEqual(await page.locator('.bd-shell').count(), 0);
      assert.deepStrictEqual(errors, []);
      await page.close();
    }
    console.log('포격 시안 모바일/PC·탭 변경·저장·계산 근거·타 무기 제외 통과');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
