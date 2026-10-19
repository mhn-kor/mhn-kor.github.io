/* 이전 자동빌드 화면(#auto-build-legacy): 사용자 저장소와 분리된 새 브라우저에서 PC/모바일 전체 흐름 검수.
   빌드 메뉴의 자동빌드 버튼은 메타 화면으로 가므로 이 화면은 주소로 연다. 메타 화면은 auto-build-meta-ui-test.js. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright'), assert = require('assert'), path = require('path'), os = require('os');
const { pathToFileURL } = require('url');
(async () => {
  // Edge가 없는 환경(클라우드 등)은 내장 Chromium으로 실행한다.
  const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch());
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
      await page.evaluate(() => { abState.scroll = scrollY; location.hash = 'auto-build-legacy'; });
      await page.waitForURL('**#auto-build-legacy');
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
      // 펼친 제안 카드 1장 + 접힌 카드. 칩은 터치 높이 확보.
      assert.strictEqual(await page.locator('.ab-card.open').count(), 1);
      const chips = await page.locator('.ab-card.open button.ab-chip').evaluateAll(nodes => nodes.map(el => el.getBoundingClientRect().height));
      assert.ok(chips.length >= 3 && chips.every(h => h >= 36));
      assert.notStrictEqual(fields.find(f => !f.disabled).background, fields.find(f => f.disabled).background);
      const field = page.locator('[data-ab="wt"]');
      await field.focus();
      assert.strictEqual(await field.evaluate(el => getComputedStyle(el).outlineWidth), '2px');
      await page.locator('.ab-weapon-settings').screenshot({path:path.join(os.tmpdir(),`mhn-auto-settings-${width}.png`)});
      // 록온은 근접 필수 칩. 누르면 끄고 원거리에는 없다.
      const lock = page.locator('[data-ab-chip="lock"]');
      assert.ok(!(await lock.getAttribute('class')).includes('off'));
      await lock.click();
      assert.ok((await page.locator('[data-ab-chip="lock"]').getAttribute('class')).includes('off'));
      for (const wt of ['light-gun', 'heavy-gun', 'bow']) {
        await page.locator('[data-ab="wt"]').selectOption(wt);
        assert.strictEqual(await page.locator('[data-ab-chip="lock"]').count(), 0);
      }
      await page.locator('[data-ab="wt"]').selectOption('long-sword');
      assert.ok(!(await page.locator('[data-ab-chip="lock"]').getAttribute('class')).includes('off'));
      // 실드태클: 규칙 스킬은 칩별로 끈다. 끈 스킬만 빠지고 나머지는 유지.
      await page.locator('[data-ab="wt"]').selectOption('lance');
      await page.locator('[data-ab="st"]').selectOption('1');
      assert.ok(await page.locator('[data-ab-dir="water"]').isVisible() || await page.locator('.ab-card.open').isVisible());
      await page.locator('[data-ab-chip="r:반사"]').click();
      assert.ok((await page.locator('[data-ab-chip="r:반사"]').getAttribute('class')).includes('off'));
      assert.deepStrictEqual(await page.evaluate(() => abState.styleOff), ['반사']);
      assert.ok((await page.locator('.ab-card.open').innerText()).includes('수정됨'));
      await page.locator('[data-ab-reset]').click();
      assert.deepStrictEqual(await page.evaluate(() => abState.styleOff), []);
      // 사용자 제외: 최대 3개, 칩에서 완전 제외 ↔ 겸용 허용.
      await page.locator('[data-ab-plus="ex"]').click();
      await page.locator('[data-ab-add="ex"]').selectOption('매진');
      await page.locator('[data-ab-chip="x:0"]').click();
      await page.locator('[data-ab-op="shared"]').click();
      assert.strictEqual(await page.evaluate(() => abState.exclude[0].shared), true);
      await page.locator('[data-ab-op="del"]').click();
      assert.strictEqual(await page.evaluate(() => abState.exclude.length), 0);
      await page.locator('[data-ab="wt"]').selectOption('long-sword');
      await page.locator('[data-ab="st"]').selectOption('1');
      await page.locator('[data-ab="style20"]').check();
      for (let i = 0; i < 3; i++) await page.locator(`[data-ab-param="${i}"]`).selectOption('crit');
      assert.ok((await page.locator('.ab-base').innerText()).includes('50%'));
      assert.ok((await page.locator('.ab-card.open').innerText()).includes('회심격'));
      assert.strictEqual(await page.evaluate(() => abState.direction), 'critical');
      // 칩 조정: 첫 투자 스킬 최소를 올리면 필수로 이동, 설정 변경은 사용자 수정을 보존.
      const firstSkill = await page.evaluate(() => abState.targets[0].s);
      await page.locator('[data-ab-chip="t:0"]').click();
      await page.locator('[data-ab-op="min+"]').click();
      assert.strictEqual(await page.evaluate(() => abState.targets[0].min), 1);
      await page.locator('[data-ab-param="0"]').selectOption('atk');
      assert.strictEqual(await page.evaluate(() => abState.targets[0].s), firstSkill, '설정 변경은 사용자 수정 보존');
      assert.ok((await page.locator('.ab-card.open').innerText()).includes('제안 새로 보기'));
      await page.locator('[data-ab-dir="water"]').click();
      await page.locator('[data-ab-search]').click();
      await page.waitForFunction(() => !abState.busy, { timeout: 60000 });
      assert.strictEqual(await page.locator('.ab-result').count(), 5);
      assert.strictEqual(await page.evaluate(() => abState.results.every(r=>new Map(bdTotals(r.b)).get('록온')>=1)), true);
      const scores = await page.locator('.ab-score').allTextContents();
      assert.strictEqual(+scores[0].replace(/\D/g, ''), Math.max(...scores.map(s => +s.replace(/\D/g, ''))));
      assert.strictEqual(await page.evaluate(() => new Set(abState.results.map(r => abSignature(r.b))).size), 5);
      // 연성 안 탭: 전환하면 가져오기 대상도 바뀐다.
      const tabbed = await page.evaluate(() => abState.results.findIndex(g => g.variants.length > 1));
      if (tabbed >= 0) {
        await page.locator(`[data-ab-variant="${tabbed}:1"]`).click();
        assert.ok((await page.locator('.ab-result').nth(tabbed).innerText()).includes('A 대비'));
        assert.ok((await page.locator(`[data-ab-import="${tabbed}"]`).innerText()).includes('B안'));
        await page.locator(`[data-ab-variant="${tabbed}:0"]`).click();
      }
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
      await page.evaluate(() => { abState.scroll = scrollY; location.hash = 'auto-build-legacy'; });
      await page.waitForURL('**#auto-build-legacy');
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
      await page.evaluate(() => { abState.scroll = scrollY; location.hash = 'auto-build-legacy'; });
      await page.waitForURL('**#auto-build-legacy');
      await page.locator('#ab-screen').waitFor({ state: 'visible' });
      await page.locator('[data-ab-dir="manual"]').click();
      assert.strictEqual(await page.evaluate(() => abState.targets.length), 0, '직접 구성은 빈 스킬에서 시작');
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
