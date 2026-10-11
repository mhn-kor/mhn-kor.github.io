/* 사용자 저장소와 분리된 새 브라우저에서 PC/모바일 전체 흐름 검수. */
const { chromium } = require('playwright'), assert = require('assert'), path = require('path'), os = require('os');
const { pathToFileURL } = require('url');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [];
      if (width === 390) {
        const session = await page.context().newCDPSession(page);
        await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      }
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href + '#build');
      await page.evaluate(() => {
        bdState.builds = Array.from({ length: 8 }, (_, i) => ({ ...bdNewBuild(), w: 'mizu', wt: 'long-sword', n: '보존 ' + i }));
        bdWeaponFilter = 'long-sword'; bdSave(); bdRender(); window.scrollTo(0, 500);
      });
      const scroll = await page.evaluate(() => scrollY);
      await page.locator('#bd-auto').click();
      await page.waitForURL('**#auto-build');
      await page.locator('#ab-screen').waitFor({ state: 'visible' });
      assert.strictEqual(await page.locator('.tabs a[data-tab="build"]').getAttribute('aria-current'), '');
      assert.strictEqual(await page.locator('#bd-cards').isVisible(), false);
      assert.strictEqual(await page.locator('#panel-build > .bd-tools').isVisible(), false);
      assert.strictEqual(await page.locator('[data-ab="style20"]').isDisabled(), true);
      const fields = await page.locator('.ab-weapon-settings select').evaluateAll(nodes => nodes.map(el => ({
        height: el.getBoundingClientRect().height, background: getComputedStyle(el).backgroundColor,
        fontSize: getComputedStyle(el).fontSize, disabled: el.disabled
      })));
      assert.ok(fields.every(f => f.height >= 44 && f.fontSize === '16px'));
      const coreFields = await page.locator('.ab-core-settings select').evaluateAll(nodes => nodes.map(el => ({
        height: el.getBoundingClientRect().height, fontSize: getComputedStyle(el).fontSize,
        background: getComputedStyle(el).backgroundColor
      })));
      assert.strictEqual(coreFields.length, 9);
      assert.ok(coreFields.every(f => f.height >= 44 && f.fontSize === '16px' && f.background === fields[0].background));
      assert.notStrictEqual(fields.find(f => !f.disabled).background, fields.find(f => f.disabled).background);
      const field = page.locator('[data-ab="wt"]');
      await field.focus();
      assert.strictEqual(await field.evaluate(el => getComputedStyle(el).outlineWidth), '2px');
      await page.locator('.ab-weapon-settings').screenshot({path:path.join(os.tmpdir(),`mhn-auto-settings-${width}.png`)});
      assert.strictEqual(await page.locator('[data-ab="lockon"]').isChecked(), true);
      await page.locator('[data-ab="lockon"]').uncheck();
      for (const wt of ['light-gun', 'heavy-gun', 'bow']) {
        await page.locator('[data-ab="wt"]').selectOption(wt);
        assert.strictEqual(await page.locator('[data-ab="lockon"]').isDisabled(), true);
        assert.strictEqual(await page.locator('[data-ab="lockon"]').isChecked(), false);
      }
      await page.locator('[data-ab="wt"]').selectOption('long-sword');
      assert.strictEqual(await page.locator('[data-ab="lockon"]').isChecked(), true);
      assert.strictEqual(await page.locator('[data-ab="lockon"]').isDisabled(), false);
      await page.locator('[data-ab="st"]').selectOption('1');
      await page.locator('[data-ab="style20"]').check();
      for (let i = 0; i < 3; i++) await page.locator(`[data-ab-param="${i}"]`).selectOption('crit');
      assert.ok((await page.locator('.ab-base').innerText()).includes('50%'));
      assert.ok((await page.locator('[data-ab-dir]').first().innerText()).includes('회심 활용'));
      await page.locator('[data-ab-dir="critical"]').click();
      assert.strictEqual(await page.locator('[data-ab-skill="0"]').inputValue(), '회심격【속성】');
      await page.locator('[data-ab-skill="0"]').selectOption('연격');
      await page.locator('[data-ab-param="0"]').selectOption('atk');
      assert.strictEqual(await page.locator('[data-ab-skill="0"]').inputValue(), '연격', '설정 변경은 사용자 핵심 스킬 보존');
      await page.locator('[data-ab-dir="water"]').click();
      await page.locator('[data-ab-search]').click();
      await page.waitForFunction(() => !abState.busy, { timeout: 15000 });
      assert.strictEqual(await page.locator('.ab-result').count(), 5);
      assert.strictEqual(await page.evaluate(() => abState.results.every(r=>new Map(bdTotals(r.b)).get('록온')>=1)), true);
      await page.locator('[data-ab="order"]').selectOption('score');
      const scores = await page.locator('.ab-score').allTextContents();
      assert.strictEqual(+scores[0].replace(/\D/g, ''), Math.max(...scores.map(s => +s.replace(/\D/g, ''))));
      const first = page.locator('.ab-result').first();
      const pieces = await page.evaluate(() => BD_PARTS().map(p => ({ part:p.k, ...bdSet(abState.results[0].b[p.k]).pieces[p.k] })));
      for (const p of pieces) {
        const row = first.locator(`[data-ab-part="${p.part}"]`);
        assert.strictEqual(await row.isVisible(), true);
        const text = await row.innerText();
        assert.ok(text.includes(p.name));
        assert.ok(p.skills.every(s => text.includes(s.s) && text.includes(String(s.lv))));
      }
      assert.strictEqual(await first.locator('.ab-equipment button, .ab-equipment input').count(), 0);
      assert.ok(await first.locator('.ab-core').count() > 0);
      assert.ok(await first.locator('.bd-dot.on').count() > 0);
      assert.ok(await first.locator('.ab-drift-skill').count() > 0);
      assert.strictEqual(await first.locator('.ab-equipment .bd-sub, .ab-drift').count(), 0);
      await first.screenshot({path:path.join(os.tmpdir(),`mhn-auto-card-${width}.png`)});
      await page.locator('.ab-result details').first().locator('summary').click();
      assert.ok((await page.locator('.ab-result').first().innerText()).includes('요구 스킬 충족'));
      assert.ok((await page.locator('.ab-result').first().innerText()).includes('점수 계산 가정'));
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator('#ab-screen').screenshot({ path: path.join(os.tmpdir(), `mhn-auto-${width}.png`) });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(os.tmpdir(), `mhn-auto-screen-${width}.png`) });
      console.log('캡처:', path.join(os.tmpdir(), `mhn-auto-${width}.png`));
      await page.locator('[data-ab-back]').click();
      await page.waitForURL('**#build');
      await page.locator('#bd-cards').waitFor({ state: 'visible' });
      assert.strictEqual(await page.evaluate(() => bdWeaponFilter), 'long-sword');
      assert.strictEqual(await page.locator('#bd-cards').isVisible(), true);
      await page.waitForTimeout(100);
      // 클릭 시 버튼으로 스크롤되므로 저장 시점의 값과 복귀 값만 비교한다.
      assert.strictEqual(await page.evaluate(() => scrollY), await page.evaluate(() => abState.scroll));
      await page.locator('#bd-auto').click();
      await page.waitForURL('**#auto-build');
      await page.locator('#ab-screen').waitFor({ state: 'visible' });
      const score = await page.evaluate(() => abState.results[0].score);
      await page.locator('[data-ab-import="0"]').click();
      await page.waitForURL('**#build');
      await page.locator('#bd-cards').waitFor({ state: 'visible' });
      assert.strictEqual(await page.evaluate(() => bdState.builds.length), 9);
      assert.strictEqual(await page.evaluate(() => bdState.builds[1].n), '보존 0');
      assert.strictEqual(await page.evaluate(() => bdWeaponFilter), '');
      assert.strictEqual(await page.evaluate(() => bdStats(bdState.builds[0]).score), score);
      assert.strictEqual(await page.evaluate(() => new Map(bdTotals(bdState.builds[0])).get('록온') >= 1), true);
      await page.reload();
      assert.strictEqual(await page.evaluate(() => bdStats(bdState.builds[0]).score), score);
      await page.locator('#bd-auto').click();
      await page.waitForURL('**#auto-build');
      await page.locator('#ab-screen').waitFor({ state: 'visible' });
      await page.locator('[data-ab-dir="manual"]').click();
      await page.locator('[data-ab-search]').click();
      assert.ok((await page.locator('#ab-status').innerText()).includes('3개'));
      await page.locator('[data-ab-dir="water"]').click();
      await page.locator('[data-ab-search]').click();
      await page.locator('[data-ab-cancel]').click();
      assert.strictEqual(await page.locator('.ab-result').count(), 0);
      await page.waitForTimeout(150);
      assert.strictEqual(await page.evaluate(() => abState.busy), false);
      await page.reload();
      await page.locator('#ab-screen').waitFor({ state: 'visible' });
      assert.strictEqual(await page.locator('.tabs a[data-tab="build"]').getAttribute('aria-current'), '');
      await page.goBack();
      await page.locator('#bd-cards').waitFor({ state: 'visible' });
      assert.deepStrictEqual(errors, []);
      console.log(width, 'PC/모바일 검수 통과', scroll);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
