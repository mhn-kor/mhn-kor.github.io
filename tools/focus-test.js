/* 창을 열 때 모바일에서 키보드가 올라오지 않는지 확인합니다.
 *
 *   node tools/focus-test.js            # 사이트는 http://localhost:8080 에서 서빙 중이어야 함
 *
 * 왜 필요한가: 창이 열리면 명세상 안쪽 첫 요소에 포커스가 갑니다. «빌드 고르기» 는
 * 그 첫 요소가 검색칸이라 .focus() 호출을 지우는 것만으로는 키보드가 계속 올라옵니다.
 * app.js 가 showModal 을 감싸 막는데, 이건 실제 브라우저에서만 확인됩니다 —
 * 창을 하나씩 열어 포커스를 읽습니다. 등록·삭제 창은 칸을 채워야 넘어가므로
 * 반대로 포커스가 살아 있어야 합니다.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8080';
/* 창을 열면 입력칸에 포커스가 가던 것들. 나머지 창은 첫 요소가 버튼이라 원래 조용합니다. */
const TYPES = ['reg', 'rk-reg', 'rc-add', 'del', 'rk-del', 'rc-del', 'rc-pickdlg', 'bd-modal'];

/* bd-modal 은 검색칸 포커스를 bdOpen 이 직접 줍니다(첫 요소는 닫기 버튼).
   showModal 만 불러서는 그 경로를 지나지 않으므로 실제로 여는 함수를 부릅니다. */
const openIn = id => (id === 'bd-modal'
  ? `bdOpenGear(0, 'helm')`
  : `document.getElementById(${JSON.stringify(id)}).showModal()`);

(async () => {
  const browser = await chromium.launch();
  let fail = 0;

  for (const [label, w, h, mobile] of [['phone 390', 390, 844, true], ['desktop 1280', 1280, 900, false]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => showTab('build'));       // 빌드 탭을 그려 둡니다(bd-modal 용)
    /* 예외 목록은 app.js 것을 그대로 읽습니다 — 사본을 두면 한쪽만 늘어납니다. */
    const KEEP = await page.evaluate(() => [...KEEP_FOCUS]);

    for (const id of TYPES) {
      const tag = await page.evaluate(([id, open]) => {
        const dlg = document.getElementById(id);
        if (dlg.open) dlg.close();
        eval(open);
        const el = document.activeElement;
        const t = el && dlg.contains(el) ? el.tagName.toLowerCase() : 'none';
        dlg.close();
        return t;
      }, [id, openIn(id)]);

      const typed = tag === 'input' || tag === 'textarea';
      const want = !mobile || KEEP.includes(id);
      if (typed !== want) {
        fail++;
        console.log(`✗ ${label} · ${id} — 포커스 ${tag}, ${want ? '입력칸이어야' : '입력칸이 아니어야'} 합니다`);
      }
    }
    await page.close();
  }

  await browser.close();
  console.log(fail ? `실패 ${fail}건` : `모두 통과 — 창 ${TYPES.length}개 × 화면 2종`);
  process.exit(fail ? 1 : 0);
})();
