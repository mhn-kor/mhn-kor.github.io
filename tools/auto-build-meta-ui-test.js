/* 메타 자동빌드 화면(#auto-build): 메타 후보 계산 → 선택 → 메타별 가로 넘김 결과 → 가져오기. PC/모바일. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright'), assert = require('assert'), path = require('path'), os = require('os');
const { pathToFileURL } = require('url');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch());
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href + '#build');
      await page.evaluate(() => {
        bdState.builds = Array.from({ length: 8 }, (_, i) => ({ ...bdNewBuild(), w: 'mizu', wt: 'long-sword', n: '보존 ' + i }));
        bdSave(); bdRender();
      });
      await page.locator('#bd-auto').click();
      await page.waitForURL('**#auto-build');
      await page.locator('#abm-screen').waitFor({ state: 'visible' });
      assert.strictEqual(await page.locator('#ab-screen').isVisible(), false, '이전 화면은 숨김');
      assert.strictEqual(await page.locator('#bd-cards').isVisible(), false);
      // 메타 후보: 예상 점수순 최대 8개, 1위 자동 선택, 최대 4개 선택.
      await page.locator('.abm-meta').first().waitFor({ timeout: 30000 });
      const metas = await page.locator('.abm-meta').count();
      assert.ok(metas >= 2 && metas <= 8, '메타 후보 수 ' + metas);
      assert.strictEqual(await page.locator('.abm-meta[aria-pressed="true"]').count(), 1);
      for (let i = 1; i < Math.min(metas, 6); i++) if (!(await page.locator('.abm-meta').nth(i).isDisabled())) await page.locator('.abm-meta').nth(i).click();
      assert.strictEqual(await page.locator('.abm-meta[aria-pressed="true"]').count(), Math.min(4, metas));
      assert.ok(await page.locator('.abm-meta[aria-pressed="false"]').first().isDisabled() || metas <= 4, '4개 선택 후 잠금');
      while (await page.locator('.abm-meta[aria-pressed="true"]').count() > 2) await page.locator('.abm-meta[aria-pressed="true"]').last().click();
      assert.ok((await page.locator('[data-abm-search]').innerText()).includes('최대 10초'));
      // 메타별 결과 5장 가로 넘김.
      await page.locator('[data-abm-search]').click();
      await page.locator('[data-abm-cancel]').waitFor();
      await page.locator('[data-abm-cancel]').waitFor({ state: 'detached', timeout: 40000 });
      assert.strictEqual(await page.locator('.abm-group').count(), 2);
      const group = page.locator('.abm-group').first(), slides = group.locator('.abm-slide');
      assert.ok(await slides.count() >= 1 && await slides.count() <= 5);
      assert.strictEqual(await group.locator('.abm-count').innerText(), `1/${await slides.count()}`);
      assert.strictEqual(await slides.first().locator('.abm-reason li').count(), 4, '근거 4줄');
      const [slideW, trackW] = await group.evaluate(g => [g.querySelector('.abm-slide').offsetWidth, g.querySelector('.abm-track').clientWidth]);
      if (width === 390) assert.ok(slideW < trackW * .9 && slideW > trackW * .8, '다음 카드가 보이는 폭');
      if (await slides.count() > 1) {
        await group.locator('.abm-track').evaluate(t => { t.style.scrollBehavior = 'auto'; t.scrollLeft = t.children[1].offsetLeft - t.offsetLeft; });
        await page.waitForTimeout(200);
        assert.strictEqual(await group.locator('.abm-count').innerText(), `2/${await slides.count()}`);
        assert.strictEqual(await group.locator('.abm-dots span.on').count(), 1);
      }
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '페이지 가로 스크롤 없음');
      await page.locator('#abm-screen').screenshot({ path: path.join(os.tmpdir(), `mhn-meta-${width}.png`) });
      console.log('캡처:', path.join(os.tmpdir(), `mhn-meta-${width}.png`));
      // 메타 주축 스킬 확보: 첫 메타의 메타 주축 스킬이 결과 빌드에서 최소 레벨 이상.
      assert.ok(await page.evaluate(() => abmState.results.every(({ meta, builds }) => builds.every(r => {
        const lv = new Map(bdTotals(r.b)); return meta.skeleton.every(t => (lv.get(t.s) || 0) >= t.min);
      }))), '메타 주축 스킬 레벨 확보');
      // 가져오기: 기존 빌드 보존, 점수 유지.
      const score = await page.evaluate(() => abmState.results[0].builds[0].score);
      await page.locator('[data-abm-import]').first().click();
      await page.waitForURL('**#build');
      await page.locator('#bd-cards').waitFor({ state: 'visible' });
      assert.strictEqual(await page.evaluate(() => bdState.builds.length), 9);
      assert.strictEqual(await page.evaluate(() => bdState.builds[1].n), '보존 0');
      assert.strictEqual(await page.evaluate(() => bdStats(bdState.builds[0]).score), score);
      assert.strictEqual(await page.evaluate(() => Object.keys(bdState.builds[0]).some(k => k.startsWith('_ab'))), false);
      // 이전 화면은 주소로 열리고 두 화면이 함께 보이지 않는다.
      await page.evaluate(() => { location.hash = 'auto-build-legacy'; });
      await page.locator('#ab-screen').waitFor({ state: 'visible' });
      assert.strictEqual(await page.locator('#abm-screen').isVisible(), false);
      await page.evaluate(() => { location.hash = 'auto-build'; });
      await page.locator('#abm-screen').waitFor({ state: 'visible' });
      assert.strictEqual(await page.locator('#ab-screen').isVisible(), false);
      await page.locator('[data-abm-back]').click();
      await page.locator('#bd-cards').waitFor({ state: 'visible' });
      assert.deepStrictEqual(errors, []);
      console.log(width, '메타 화면 검수 통과');
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
