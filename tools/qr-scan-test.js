/* QR이 화면에 그려진 그대로 실제로 스캔되는지 확인합니다.
 *
 *   npx --yes playwright install chromium
 *   npm i -D playwright jsqr
 *   node tools/qr-scan-test.js            # 사이트는 http://localhost:8899 에서 서빙 중이어야 함
 *
 * 왜 필요한가: QR 원본보다 카드가 작으면 축소 과정에서 모듈이 뭉개져 디코딩이 실패합니다.
 * 눈으로는 멀쩡해 보이기 때문에 실제로 디코딩해 봐야만 잡힙니다.
 * (2열 모바일 레이아웃이 이 테스트에서 0/6으로 떨어져 1열로 바꾼 이력이 있습니다.)
 */
const { chromium } = require('playwright');
const jsQRPath = require.resolve('jsqr/dist/jsQR.js');

const BASE = process.env.BASE || 'http://localhost:8899';
const VIEWPORTS = [
  ['desktop 1280', 1280, 1000],
  ['wide 1600', 1600, 1000],
  ['tablet 768', 768, 1000],
  ['phone 390', 390, 844],
  ['small phone 360', 360, 780],
];

const rows = Array.from({ length: 8 }, (_, i) => ({
  nickname: '헌터' + i,
  code: String(100000000000 + i * 83719371),
  created_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
}));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript(r => localStorage.setItem('mhnkr.rows', JSON.stringify(r)), rows);
  let ok = true;

  for (const [label, width, height] of VIEWPORTS) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width, height });
    await page.goto(`${BASE}/index.html#codes`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.addScriptTag({ path: jsQRPath });

    const res = await page.evaluate(() => {
      const out = [];
      for (const img of document.querySelectorAll('.card:not([hidden]) .qr img')) {
        if (!img.currentSrc) continue;
        const r = img.getBoundingClientRect();
        const w = Math.round(r.width), h = Math.round(r.height);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.fillStyle = '#F4EEE2'; x.fillRect(0, 0, w, h);   // .qr 배경
        x.globalCompositeOperation = 'multiply';           // mix-blend-mode: multiply
        x.drawImage(img, 0, 0, w, h);
        const q = jsQR(x.getImageData(0, 0, w, h).data, w, h);
        // 디코딩된 문자열이 카드의 딥링크와 완전히 같아야 합니다.
        out.push({ size: `${w}px (원본 ${img.naturalWidth}px)`, pass: !!q && q.data === img.closest('.card').querySelector('a.open').href });
      }
      return out;
    });

    const bad = res.filter(r => !r.pass).length;
    console.log(`${label.padEnd(18)} ${res.length - bad}/${res.length} 디코딩  ${res[0]?.size ?? '카드 없음'}`);
    if (bad || !res.length) ok = false;
    await page.close();
  }

  await browser.close();
  console.log(ok ? '\n통과: 모든 화면에서 QR이 정확히 디코딩됩니다.' : '\n실패: 스캔되지 않는 QR이 있습니다.');
  process.exit(ok ? 0 : 1);
})();
