/* 빌드 카드 이미지 저장(2026-11-25 사용자)을 진짜 브라우저로 확인합니다.
 *
 *   node tools/build-shot-ui-test.js     (PLAYWRIGHT_MODULE 로 playwright 위치를 줄 수 있습니다)
 *
 * 이미지 변환은 그림 파일을 fetch 로 다시 읽어서 file:// 로는 돌 수 없습니다. 작은 http 서버를 띄웁니다.
 * 모든 카드에 버튼이 있고, PC 는 PNG(mhn-build-날짜-시각.png)를 바로 내려받고, 휴대폰은 미리보기 창을 띄우는지,
 * 상세 수치를 켠 긴 카드도 화면 높이와 상관없이 한 장인지 봅니다. */
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE || 'playwright'), assert = require('assert');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
const pngSize = buf => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
const setBuild = page => page.evaluate(() => {
  bdState.builds = [{ ...bdNewBuild(), n: '테스트 빌드', w: 'amat', wt: 'long-sword', helm: 'amat', mail: 'amat', gloves: 'amat', belt: 'amat', greaves: 'amat' }];
  bdState.detail = true; bdRender();
});

(async () => {
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch());
  try {
    // 공개 (2026-11-25): 주소에 아무것도 없어도 카드마다 버튼이 있다.
    { const page = await browser.newPage();
      await page.goto(base + '#build'); await setBuild(page);
      assert.strictEqual(await page.locator('[data-shot]').count(), 1, '카드마다 이미지 저장 버튼');
      await page.close(); }

    // PC: 누르면 «빌드 이름.png» 를 바로 내려받는다. 카드 전체가 2배로 한 장.
    { const ctx = await browser.newContext({ viewport: { width: 1280, height: 700 }, acceptDownloads: true }), page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(base + '#build'); await setBuild(page);
      const card = await page.locator('.bd-card').first().boundingBox();
      assert.ok(card.height > 700, '시험 카드는 화면보다 길다');
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-shot="0"]')]);
      assert.match(download.suggestedFilename(), /^mhn-build-\d{8}-\d{4}\.png$/);
      const png = fs.readFileSync(await download.path());
      assert.strictEqual(png.toString('latin1', 1, 4), 'PNG');
      const size = pngSize(png);
      // 스킬 합계까지만 담는다: 카드 맨 위 ~ 스킬 합계 끝 + 주소 줄. 화면(700)보다 긴 부분도 한 장에 들어가야 한다.
      const upToSkills = await page.evaluate(() => { const c = document.querySelector('.bd-card'), r = [...c.querySelectorAll('.bd-sum .bd-tr')].at(-1);
        return r.getBoundingClientRect().bottom - c.getBoundingClientRect().top - c.querySelector('.bd-bulk').offsetHeight; });
      assert.ok(Math.abs(size.w - card.width * 2) <= 4 && size.h > 700 * 2 && size.h < card.height * 2 - 300, `한 장 크기 ${size.w}×${size.h}`);
      assert.ok(Math.abs(size.h / 2 - upToSkills) < 80, `스킬 합계까지 + 주소 줄 (${size.h / 2} ≈ ${upToSkills})`);
      assert.strictEqual(await page.locator('.bd-card .bd-ic').count() > 0, true, '화면의 카드 버튼은 그대로');
      assert.deepStrictEqual(errors, []);
      await ctx.close(); }

    // 휴대폰: 미리보기 창에 이미지와 길게 눌러 저장 안내.
    { const ctx = await browser.newContext({ ...devices['iPhone 13'] }), page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(base + '#build'); await setBuild(page);
      await page.click('[data-shot="0"]');
      await page.locator('#bd-modal[data-view="shot"] .bd-shot-img').waitFor({ state: 'visible', timeout: 20000 });
      const shown = await page.evaluate(() => { const i = document.querySelector('.bd-shot-img'); return { w: i.naturalWidth, h: i.naturalHeight }; });
      assert.ok(shown.w > 600 && shown.h > shown.w, '세로로 긴 한 장');
      assert.match(await page.locator('.bd-shot-tip').innerText(), /길게 눌러 저장/);
      const over = await page.evaluate(() => document.querySelector('#bd-modal').scrollWidth > document.querySelector('#bd-modal').clientWidth + 1);
      assert.ok(!over, '미리보기 창 가로 넘침 없음');
      assert.deepStrictEqual(errors, []);
      await ctx.close(); }
    console.log('빌드 이미지 저장 PC/휴대폰 검수 통과');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
