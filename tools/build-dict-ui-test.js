/* 스킬 사전(빌드 탭 «스킬 사전» 버튼, 2026-11-14 사용자)을 진짜 브라우저로 PC/모바일 확인합니다.
 *
 *   node tools/build-dict-ui-test.js     (PLAYWRIGHT_MODULE 로 playwright 위치를 줄 수 있습니다)
 *
 * 목록 → 검색(이름·설명) → 상세(레벨표 + 얻는 곳) → ‹ 로 검색어 그대로 복귀,
 * 장비 고르기 검색의 사전 줄, 합계에서 연 창의 «얻는 곳», 사전 칩이 표류석을 건드리지 않는지 봅니다. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright'), assert = require('assert'), path = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch());
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href + '#build');
      await page.evaluate(() => { bdState.builds = [{ ...bdNewBuild(), wt: 'long-sword', helm: 'amat' }]; bdRender(); });
      const title = () => page.locator('#bd-modal-title').innerText();
      const stones = () => page.evaluate(() => JSON.stringify(bdState.builds[0].ds)), before = await stones();

      await page.click('#bd-dict');
      assert.strictEqual(await page.locator('#bd-modal-count').innerText(), `${await page.evaluate(() => bdDictNames().length)}종`);
      assert.match(await page.locator('#bd-modal-body .bd-sgl').first().innerText(), /^ㄱ/, '초성별 목록');
      await page.fill('#bd-q', '회심');
      assert.deepStrictEqual((await page.locator('#bd-modal-body .bd-sgl').allInnerTexts()).map(t => t.split(' ')[0]), ['이름에', '설명에']);

      await page.click('[data-sd="간파"]');
      assert.match(await title(), /간파[\s\S]*MAX Lv5/);
      assert.strictEqual(await page.locator('#bd-modal-body .lv.bd-lvcur').count(), 0, '사전은 MAX 줄 강조');
      assert.ok(await page.locator('#bd-modal-body .bd-gh').count() >= 1, '얻는 곳');
      assert.strictEqual(await page.evaluate(() => $('#bd-modal-body').scrollTop), 0);
      assert.strictEqual(await stones(), before, '사전 칩은 표류석을 바꾸지 않음');
      await page.click('[data-sd-back]');
      assert.strictEqual(await page.inputValue('#bd-q'), '회심', '‹ 는 검색어 그대로 목록으로');
      assert.ok(await page.locator('[data-sd="간파"]').isVisible());
      if (width === 390) {
        const over = await page.evaluate(() => [...document.querySelectorAll('#bd-modal, #bd-modal-body')].some(el => el.scrollWidth > el.clientWidth + 1));
        assert.ok(!over, '모바일 가로 넘침 없음');
      }
      await page.keyboard.press('Escape');

      // 장비 고르기: 스킬 이름을 치면 맨 위에 사전 줄 → 상세 → ‹ 로 장비 목록(검색어 유지).
      await page.evaluate(() => bdOpenGear(0, 'helm'));
      await page.fill('#bd-q', '무심');
      assert.match(await page.locator('#bd-modal-body > :first-child').innerText(), /스킬 사전[\s\S]*무심/);
      await page.click('.bd-dict-go');
      assert.match(await title(), /무심/);
      await page.click('[data-sd-back]');
      assert.strictEqual(await page.inputValue('#bd-q'), '무심');
      assert.strictEqual(await page.evaluate(() => bdPick.kind), 'gear');
      await page.keyboard.press('Escape');

      // 합계에서 연 창: 지금 레벨 줄 강조는 그대로, 아래에 얻는 곳.
      await page.evaluate(() => bdOpenSkill('무심', 2));
      assert.match(await page.locator('#bd-modal-body .lv.bd-lvcur tr.on').innerText(), /^2/);
      assert.ok(await page.locator('#bd-modal-body .bd-src').count() >= 1);
      assert.strictEqual(await page.locator('[data-sd-back]').count(), 0, '합계에서 연 창은 돌아갈 곳이 없음');
      assert.deepStrictEqual(errors, []);
      await page.close();
    }
    console.log('스킬 사전 PC/모바일 검수 통과');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
