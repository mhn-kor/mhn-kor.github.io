/* 이벤트 탭이 실제 브라우저에서 도는지 확인합니다.
 *
 *   docker compose up -d
 *   node tools/event-test.js            # 사이트는 http://localhost:8080 에서 서빙 중이어야 함
 *
 * 응모 전송은 Edge Function 이 하는 일이라 로컬에는 없습니다. 여기서는 «폼 검사를 다
 * 통과한 뒤 로컬 안내에서 멈추는지»까지만 봅니다 — 그 지점에 닿았다는 것은 검사가
 * 전부 지나갔다는 뜻입니다. 실제 디스코드 전송은 배포본에서 한 번 눌러 확인하세요.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8080';
const MASTER = process.env.MASTER || 'devmaster';   // dev/03-seed.sql 이 심는 값

let fail = 0;
const ok = (cond, what) => {
  console.log(`${cond ? '  ok  ' : '  FAIL'}  ${what}`);
  if (!cond) fail++;
};

(async () => {
  const browser = await chromium.launch();
  /* 시드 기간은 «하루의 처음~끝» 입니다(dev/03-seed.sql, DB 는 Asia/Seoul).
     보는 쪽 시간대가 다르면 00:00 이 아니게 되어 «날짜만» 표시가 안 걸립니다. */
  const TZ = { timezoneId: 'Asia/Seoul', locale: 'ko-KR' };
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ...TZ });
  page.on('pageerror', e => { console.log('  FAIL  페이지 오류:', e.message); fail++; });
  await page.goto(BASE + '#event', { waitUntil: 'networkidle' });
  // 공지 창이 모든 탭에서 뜹니다. 목록을 만지려면 먼저 치워야 합니다(창은 아래에서 따로 봅니다).
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById('ev-notice')?.close());

  // ── 목록 ──────────────────────────────────────────────────────────
  ok(!(await page.locator('#panel-event').isHidden()), '이벤트 탭이 보인다');
  const seeded = await page.locator('.ev-card').count();
  ok(seeded >= 5, `시드 이벤트가 그려진다 (${seeded}개)`);
  ok(/진행중 \d+개 · 전체 \d+개/.test(await page.locator('#ev-count').textContent()),
     '진행중 개수와 전체 개수가 표시된다');
  // 줄바꿈이 살아 있어야 합니다(.ev-body 의 pre-wrap).
  ok((await page.locator('.ev-card .ev-body').first().textContent()).includes('\n'),
     '본문 줄바꿈이 살아 있다');

  // ── 기간 ──────────────────────────────────────────────────────────
  // 시드는 진행중 2(기간 있음 · 상시) · 시작 전 1 · 선착순 마감 1 · 종료 1 입니다.
  ok(await page.locator('.ev-card.open').count() === 2, '진행중 이벤트가 2개다');
  ok(await page.locator('.ev-card.soon').count() === 1, '시작 전 이벤트가 1개다');
  ok(await page.locator('.ev-card.full').count() === 1, '선착순 마감 이벤트가 1개다');
  ok(await page.locator('.ev-card.done').count() === 1, '종료된 이벤트가 1개다');

  // 진행중이 먼저, 종료가 맨 뒤여야 합니다.
  const ORDER = ['open', 'soon', 'full', 'done'];
  const states = await page.locator('.ev-card').evaluateAll(
    (els, o) => els.map(e => o.findIndex(c => e.classList.contains(c))), ORDER);
  ok(states.every((v, i) => i === 0 || states[i - 1] <= v),
     `진행중 → 시작 전 → 선착순 마감 → 종료 순 (${states})`);

  // 참여 버튼은 진행중일 때만 눌립니다.
  ok(await page.locator('.ev-card.open [data-ev-join]').count() === 2, '진행중에만 참여 버튼이 있다');
  ok(await page.locator('.ev-card.soon .ev-act button:disabled').isDisabled(), '시작 전 버튼은 잠겨 있다');
  ok(await page.locator('.ev-card.done .ev-act button:disabled').isDisabled(), '종료 버튼은 잠겨 있다');
  ok((await page.locator('.ev-card.done .ev-state').textContent()) === '종료', '종료 배지가 붙는다');
  ok((await page.locator('.ev-card.full .ev-state').textContent()) === '선착순 마감',
     '선착순 마감 배지가 붙는다');
  ok(await page.locator('.ev-card.full .ev-act button:disabled').isDisabled(), '선착순 마감 버튼은 잠겨 있다');

  // ── 선착순 ────────────────────────────────────────────────────────
  const metas = await page.locator('.ev-meta').allTextContents();
  ok(metas.some(t => t.includes('상시')), '기간이 없으면 상시로 보인다');
  ok(metas.some(t => t.includes('~')), '기간이 있으면 시작 ~ 종료로 보인다');
  // 시드: 30명짜리에 24명이 들어가 있어 남은 자리 6.
  ok(metas.some(t => /참여 24 \/ 30명 · 남은 자리 6/.test(t)), '참여 인원과 남은 자리가 표시된다');
  // 인원 제한이 없어도 몇 명이 참여했는지는 보여야 합니다.
  ok(metas.some(t => /참여 0명/.test(t)), '무제한 이벤트도 참여 인원을 보여준다');
  ok((await page.locator('.ev-card.full .ev-seats').textContent()).includes('마감'),
     '자리가 다 차면 마감으로 보인다');
  // 인원 제한이 없으면 «/ N명» 없이 참여 인원만 보여줍니다.
  const noCap = page.locator('.ev-card').filter({ hasText: '표류연성 대박 자랑' });
  ok(!/\//.test(await noCap.locator('.ev-seats').textContent()),
     '무제한 이벤트에는 정원 표시가 없다');
  /* 시드 기간은 하루의 처음~끝입니다. 그럴 때는 «오전 12:00» 같은 글자를 붙이지 않습니다. */
  ok(!/오전|오후/.test(metas.join(' ')), `하루 단위 기간에는 시각이 안 붙는다 (${metas[1]})`);
  /* 끝난 이벤트가 «남은 자리 50» 이라고 말하면 아직 넣을 수 있는 것처럼 읽힙니다.
     정원은 남기되 남은 자리는 떼야 합니다. */
  const doneSeats = await page.locator('.ev-card.done .ev-seats').textContent();
  ok(doneSeats.includes('/ 50명') && !doneSeats.includes('남은 자리'),
     `끝난 이벤트는 남은 자리를 안 말한다 (${doneSeats})`);
  ok(!(await page.locator('.ev-card.soon .ev-seats').count()
    && (await page.locator('.ev-card.soon .ev-seats').textContent()).includes('남은 자리')),
     '시작 전 이벤트도 남은 자리를 안 말한다');

  // ── 공유 ──────────────────────────────────────────────────────────
  /* 마감·종료된 이벤트는 공유할 이유가 없습니다 — 링크를 받은 사람이 할 수 있는 일이
     없습니다. 시작 전은 «이런 게 열린다» 를 미리 알리는 쓸모가 있어 남깁니다. */
  for (const [st, want] of [['open', 2], ['soon', 1], ['full', 0], ['done', 0]]) {
    ok(await page.locator(`.ev-card.${st} [data-ev-link]`).count() === want
      && await page.locator(`.ev-card.${st} [data-ev-kakao]`).count() === want,
       `${st} 카드의 공유 버튼 ${want}개`);
  }
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const topId = await page.locator('.ev-card').first().getAttribute('data-ev');
  await page.locator('[data-ev-link]').first().click();
  await page.waitForTimeout(200);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  ok(copied.endsWith(`?ev=${topId}#event`), `링크 버튼이 «?ev=» 주소를 복사한다 (${copied})`);

  // ── 참여 창 ───────────────────────────────────────────────────────
  // 목록은 최신순이라 맨 위가 무엇인지는 시드 순서에 달려 있습니다. 이름을 박지 않고
  // 「누른 카드의 제목」과 「창이 말하는 제목」이 같은지만 봅니다.
  const topTitle = await page.locator('.ev-card .ev-title').first().textContent();
  await page.locator('[data-ev-join]').first().click();
  ok(await page.locator('#ev-join').isVisible(), '참여 창이 열린다');
  ok((await page.locator('#ev-join-what').textContent()).includes(topTitle),
     '참여 창이 고른 이벤트를 가리킨다');
  /* 중복 응모는 정원이 있는 이벤트만 막습니다. 맨 위(표류연성)는 무제한이라 안내가
     없어야 하고, 정원이 있는 이벤트에서는 보여야 합니다 — 응모하고 나서 «한 번뿐이었다»
     를 알면 늦습니다. */
  ok(await page.locator('#ev-j-nick-hint').isHidden(), '무제한 이벤트에는 중복 안내가 없다');
  await page.locator('#ev-join-cancel').click();
  await page.locator('.ev-card').filter({ hasText: '첫 사냥 인증 이벤트' })
    .locator('[data-ev-join]').click();
  ok(await page.locator('#ev-j-nick-hint').isVisible(), '선착순 이벤트에는 중복 안내가 보인다');

  // 빈 폼 → 제목부터 막힙니다.
  await page.locator('#ev-j-submit').click();
  ok(/제목/.test(await page.locator('#ev-j-err').textContent()), '빈 제목을 막는다');

  // 이미지 형식 검사 — 그림이 아닌 파일은 고르는 즉시 되돌립니다.
  const junk = path.join(os.tmpdir(), 'mhnkr-not-an-image.txt');
  fs.writeFileSync(junk, 'nope');
  await page.locator('#ev-j-img').setInputFiles(junk);
  ok(/PNG/.test(await page.locator('#ev-j-hint').textContent()), '이미지가 아닌 파일을 거른다');
  ok(await page.locator('#ev-j-img').inputValue() === '', '거른 파일은 비워둔다');

  // 진짜 PNG 는 미리보기가 붙습니다 (1x1 투명 픽셀).
  const png = path.join(os.tmpdir(), 'mhnkr-dot.png');
  fs.writeFileSync(png, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'));
  await page.locator('#ev-j-img').setInputFiles(png);
  ok(await page.locator('#ev-j-thumb').getAttribute('src') !== null, 'PNG 미리보기가 붙는다');

  // 다 채우면 검사를 전부 지나 «로컬에는 디스코드가 없다» 까지 갑니다.
  await page.locator('#ev-j-title').fill('제 첫 토벌입니다');
  await page.locator('#ev-j-nick').fill('보노보노 / 태도 / 서울');
  await page.locator('#ev-j-body').fill('★10 처음 잡았습니다!');
  await page.locator('#ev-j-submit').click();
  ok(/로컬/.test(await page.locator('#ev-j-err').textContent()),
     '폼 검사를 모두 통과하고 로컬 안내에서 멈춘다');
  await page.locator('#ev-join-cancel').click();

  // ── 운영자: 열기 · 닫기 ───────────────────────────────────────────
  await page.locator('#ev-open').click();
  ok(await page.locator('#ev-add').isVisible(), '이벤트 열기 창이 열린다');
  await page.locator('#ev-a-title').fill('시험용 이벤트');
  await page.locator('#ev-a-body').fill('첫 줄\n둘째 줄');
  await page.locator('#ev-a-pw').fill('틀린비번');
  await page.locator('#ev-a-submit').click();
  await page.waitForFunction(() => !document.getElementById('ev-a-err').hidden);
  ok(/마스터/.test(await page.locator('#ev-a-err').textContent()), '틀린 마스터 비번을 막는다');

  /* 달력 피커에는 «확인» 버튼이 없어서, 고르고 나면 반영이 됐는지 알 수가 없습니다.
     지금 값을 문장으로 되읽어 주는 줄이 그 자리를 대신합니다. */
  const period = () => page.locator('#ev-a-period').textContent();
  ok(/상시/.test(await period()), '기간을 안 채우면 «상시» 라고 되읽어 준다');
  await page.locator('[data-ev-span="7"]').click();
  ok(/7일간/.test(await period()), `«오늘부터 1주일» 은 오늘 포함 7일 (${await period()})`);
  // 시각은 하루의 처음과 끝이어야 합니다.
  ok((await page.locator('#ev-a-startt').inputValue()) === '00:00', '시작 시각이 00:00 이다');
  ok((await page.locator('#ev-a-endt').inputValue()) === '23:59', '종료 시각이 23:59 이다');
  ok(!/오전|오후/.test(await period()), `하루의 처음~끝이면 시각을 안 붙인다 (${await period()})`);
  await page.locator('[data-ev-span="30"]').click();
  ok(/30일간/.test(await period()), '«1개월» 이 기간을 채운다');
  await page.locator('[data-ev-span=""]').click();
  ok(/상시/.test(await period()) && (await page.locator('#ev-a-start').inputValue()) === ''
    && (await page.locator('#ev-a-startt').inputValue()) === '', '«비우기» 가 네 칸을 다 비운다');

  /* 달력에서 «날짜만» 고른 상황. datetime-local 이던 시절에는 시각 칸이 빈 동안 값이
     통째로 «빈 값» 이라 아무 일도 안 일어난 것처럼 보였습니다(달력에 확인 버튼이 없습니다).
     이제는 날짜를 넣는 순간 시각이 따라 붙어 그 자리에서 결과가 보여야 합니다. */
  await page.locator('#ev-a-start').fill('2026-09-01');
  ok((await page.locator('#ev-a-startt').inputValue()) === '00:00'
    && /9\. 1\./.test(await period()), `날짜만 골라도 바로 반영된다 (${await period()})`);
  await page.locator('#ev-a-end').fill('2026-09-30');
  ok((await page.locator('#ev-a-endt').inputValue()) === '23:59'
    && /30일간/.test(await period()), `종료 날짜만 골라도 바로 반영된다 (${await period()})`);
  // 시각을 직접 고치면 그쪽이 이기고, 화면에도 시각이 다시 나옵니다.
  await page.locator('#ev-a-startt').fill('20:00');
  ok(/오후 8:00/.test(await period()), `시각을 고치면 시각이 보인다 (${await period()})`);

  // 뒤집힌 기간은 서버에 가기 전에 걸러야 합니다. 되읽는 줄이 먼저 말해 줍니다.
  await page.locator('#ev-a-start').fill('2026-09-01');
  await page.locator('#ev-a-end').fill('2026-08-01');
  ok(/종료가 시작보다/.test(await period())
    && await page.locator('#ev-a-period').evaluate(e => e.classList.contains('bad')),
     '거꾸로 된 기간을 그 자리에서 빨갛게 알려준다');
  await page.locator('#ev-a-submit').click();
  ok(/종료가 시작보다/.test(await page.locator('#ev-a-err').textContent()),
     '종료가 시작보다 빠르면 막는다');

  // 인원은 1 이상의 정수여야 합니다.
  await page.locator('#ev-a-end').fill('2027-01-01');
  await page.locator('#ev-a-cap').fill('0');
  await page.locator('#ev-a-submit').click();
  ok(/선착순 인원/.test(await page.locator('#ev-a-err').textContent()), '인원 0 을 막는다');

  /* type=number 였을 때는 칸에 포커스가 있는 채로 휠을 굴리거나 ↑키를 누르면 «빈 값» 이
     min 인 1 로 바뀌었습니다 — 창이 길어 스크롤하다 걸리고, 인원을 안 정했는데
     «선착순 1명» 이벤트가 열렸습니다. 빈 칸은 무슨 짓을 해도 비어 있어야 합니다. */
  await page.locator('#ev-a-cap').fill('');
  await page.locator('#ev-a-cap').click();
  await page.mouse.wheel(0, -120);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');
  ok((await page.locator('#ev-a-cap').inputValue()) === '',
     '휠·화살표로 인원 칸에 값이 저절로 생기지 않는다');

  // 지금 진행중인 기간으로 고쳐 넣습니다.
  const day = ms => new Date(Date.now() + ms - new Date().getTimezoneOffset() * 6e4)
    .toISOString().slice(0, 10);
  await page.locator('#ev-a-start').fill(day(-864e5));
  await page.locator('#ev-a-end').fill(day(864e5));
  await page.locator('#ev-a-cap').fill('7');
  await page.locator('#ev-a-pw').fill(MASTER);
  await page.locator('#ev-a-submit').click();
  await page.waitForFunction(n => document.querySelectorAll('.ev-card').length === n, seeded + 1);
  ok(true, '마스터 비번으로 이벤트가 등록된다');
  ok((await page.locator('.ev-card .ev-title').first().textContent()) === '시험용 이벤트',
     '새 이벤트가 맨 위에 붙는다');
  ok(await page.locator('.ev-card').first().evaluate(e => e.classList.contains('open')),
     '지금 기간에 걸친 새 이벤트는 진행중이다');
  ok((await page.locator('.ev-meta').first().textContent()).includes('~'),
     '새 이벤트에 기간이 붙는다');
  ok(/참여 0 \/ 7명 · 남은 자리 7/.test(await page.locator('.ev-meta').first().textContent()),
     '새 이벤트는 참여 0명 · 남은 자리가 정원과 같다');

  // 뒷정리를 겸한 삭제 확인.
  await page.locator('[data-ev-del]').first().click();
  await page.locator('#ev-d-pw').fill(MASTER);
  await page.locator('#ev-d-submit').click();
  await page.waitForFunction(n => document.querySelectorAll('.ev-card').length === n, seeded);
  ok(true, '마스터 비번으로 이벤트가 삭제된다');

  // ── 탭 전환이 깨지지 않는지 ───────────────────────────────────────
  await page.goto(BASE + '#codes', { waitUntil: 'domcontentloaded' });
  ok(await page.locator('#panel-event').isHidden(), '다른 탭으로 가면 이벤트가 숨는다');
  await page.close();

  // ── 첫 화면 공지 창 ───────────────────────────────────────────────
  // localStorage 가 깨끗해야 하므로 새 컨텍스트에서 봅니다.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...TZ });
  const p2 = await ctx.newPage();
  p2.on('pageerror', e => { console.log('  FAIL  페이지 오류:', e.message); fail++; });
  /* about:blank 를 거치는 이유: 해시만 다른 주소로 가면 브라우저가 같은 문서 안에서
     이동만 하고 스크립트를 다시 읽지 않습니다. 그러면 앞서 열려 있던 창이 그대로
     남아 «다시 뜬 것» 처럼 보입니다. 매번 진짜로 새로 여는 것이 이 검사의 전제입니다. */
  const open2 = async (hash = '') => {
    await p2.goto('about:blank');
    await p2.goto(BASE + hash, { waitUntil: 'networkidle' });
    await p2.waitForTimeout(300);            // 목록을 받고 창을 여는 시간
    return p2.locator('#ev-notice').isVisible();
  };

  ok(await open2(), '첫 화면에서 이벤트 공지가 뜬다');

  /* 버튼 배치: «이벤트 바로가기» 는 한 줄을 통째로, 그 아래에 «오늘 하루 안 보기»(왼쪽)
     과 «닫기»(오른쪽). 오른쪽 위에는 X. */
  const box = async s => p2.locator(s).boundingBox();
  const [go, hide, close, x] = await Promise.all(
    ['#ev-n-go', '#ev-n-hide', '#ev-n-close', '#ev-n-x'].map(box));
  /* «서로 폭이 같다» 만 보면 세 버튼이 통째로 오른쪽에 몰려 있어도 통과합니다
     (실제로 그랬습니다). 창의 «본문 폭» 을 기준으로 봐야 합니다. */
  // 버튼이 사는 칸(menu)의 «안쪽 폭» 이 기준입니다. 패딩은 머리·본문·발이 따로 가집니다.
  const inner = await p2.locator('.ev-n menu').evaluate(e => {
    const b = e.getBoundingClientRect(), c = getComputedStyle(e);
    return { l: b.left + parseFloat(c.paddingLeft), r: b.right - parseFloat(c.paddingRight) };
  });
  ok(go.y + go.height <= hide.y + 1, '«이벤트 바로가기» 가 한 줄을 통째로 쓴다');
  ok(Math.abs(go.x - inner.l) < 1.5 && Math.abs(go.x + go.width - inner.r) < 1.5,
     '바로가기가 창 폭을 100% 채운다');
  ok(Math.abs(hide.x - inner.l) < 1.5, '«오늘 하루 안 보기» 가 왼쪽 끝이다');
  ok(Math.abs((close.x + close.width) - inner.r) < 1.5, '«닫기» 가 오른쪽 끝이다');
  ok(x.y < go.y && x.x > go.x, '오른쪽 위에 X 가 있다');

  /* 본문이 4000자까지 들어갑니다. 한 상자로 두면 무슨 이벤트인지도 «바로가기» 도 같이
     밀려 올라갑니다. 머리와 발은 붙박이고 가운데만 굴러가야 합니다. */
  const shortH = await p2.locator('.ev-n').evaluate(e => e.getBoundingClientRect().height);
  await p2.evaluate(() => {
    document.getElementById('ev-n-body').textContent =
      Array.from({ length: 60 }, (_, i) => `${i + 1}번째 줄입니다.`).join('\n');
  });
  const [headTop, goTop] = await p2.evaluate(() => [
    document.querySelector('.ev-n-head').getBoundingClientRect().top,
    document.querySelector('#ev-n-go').getBoundingClientRect().top,
  ]);
  ok(await p2.locator('.ev-n-scroll').evaluate(e => e.scrollHeight > e.clientHeight + 1),
     '본문이 길면 가운데에 스크롤이 생긴다');
  await p2.locator('.ev-n-scroll').evaluate(e => { e.scrollTop = 99999; });
  const [headTop2, goTop2] = await p2.evaluate(() => [
    document.querySelector('.ev-n-head').getBoundingClientRect().top,
    document.querySelector('#ev-n-go').getBoundingClientRect().top,
  ]);
  ok(Math.abs(headTop2 - headTop) < 1, '끝까지 굴려도 제목·기간이 제자리다');
  ok(Math.abs(goTop2 - goTop) < 1, '끝까지 굴려도 «바로가기» 가 제자리다');
  // 짧은 본문이면 창이 굳이 커지지 않아야 합니다.
  ok(shortH < 480, `본문이 짧으면 창도 작다 (${Math.round(shortH)}px)`);

  /* 페이지를 내린 채 창이 뜨면 잘려 보이던 일이 있었습니다. 원인은 dialog 에 position 을
     준 것 — 모달은 UA 가 position: fixed 로 화면 한가운데 띄우는데, 덮어쓰면 문서 흐름
     위치에 놓입니다. dialog 에 position 을 다시 주면 여기서 걸립니다. */
  await p2.locator('#ev-n-close').click();
  await open2();
  /* 준비 스크롤은 «즉시» 여야 합니다 — html { scroll-behavior: smooth } 라 기본
     scrollTo 는 애니메이션이고, 다 굴러가기 전에 재면 값이 들쭉날쭉합니다. */
  await p2.evaluate(() => { document.getElementById('ev-notice').close(); window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }); });
  await p2.evaluate(() => { localStorage.removeItem('mhnkr.evseen'); evNotice(); });
  await p2.waitForTimeout(200);
  const pos = await p2.evaluate(() => {
    const d = document.getElementById('ev-notice'), b = d.getBoundingClientRect();
    return { position: getComputedStyle(d).position, scrollY: Math.round(scrollY),
             cut: b.top < 0 || b.bottom > innerHeight,
             centered: Math.abs(b.top - (innerHeight - b.height) / 2) < 3 };
  });
  ok(pos.scrollY > 100, `페이지를 내린 상태를 만든다 (${pos.scrollY}px)`);
  ok(pos.position === 'fixed', `창이 화면에 고정된다 (${pos.position})`);
  ok(!pos.cut && pos.centered, '페이지를 내린 채 떠도 잘리지 않고 화면 한가운데다');
  // X 도 «닫기» 와 같은 일을 합니다 — 덮어 두지 않고 이번만 닫습니다.
  await p2.locator('#ev-n-x').click();
  ok(!(await p2.locator('#ev-notice').isVisible()), 'X 로 닫힌다');
  ok(await open2(), 'X 로 닫아도 다음 방문에 다시 뜬다');
  // 창이 열리면 포커스는 닫기가 아니라 «바로가기» 에 갑니다.
  ok(await p2.evaluate(() => document.activeElement.id) === 'ev-n-go',
     '열리면 «바로가기» 에 포커스가 간다');
  // 시드의 진행중 이벤트 중 가장 나중에 등록된 것은 «표류연성 대박 자랑» 입니다.
  ok((await p2.locator('#ev-n-title').textContent()) === '표류연성 대박 자랑',
     '가장 최근에 등록된 진행중 이벤트를 보여준다');
  ok((await p2.locator('#ev-n-body').textContent()).includes('\n'), '공지 본문 줄바꿈이 살아 있다');

  // 바로가기는 이벤트 탭으로 보냅니다. 없으면 창이 막다른 길이 됩니다.
  await p2.locator('#ev-n-go').click();
  await p2.waitForTimeout(200);
  ok(!(await p2.locator('#ev-notice').isVisible()) && new URL(p2.url()).hash === '#event'
     && !(await p2.locator('#panel-event').isHidden()), '바로가기가 이벤트 탭을 연다');

  /* 눌렀으면 목록 «맨 위»에서 시작해야 합니다. app.js 는 hashchange 에서 올려 주는데,
     창이 모든 탭에서 뜨므로 이미 #event 인 사람은 해시가 안 바뀌어 그 경로를 안 탑니다.
     html { scroll-behavior: smooth } 라 다 굴러갈 때까지 기다립니다. */
  for (const [what, hash] of [['이벤트 탭', '#event'], ['다른 탭', '#codes']]) {
    await open2(hash);
    await p2.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
    await p2.waitForTimeout(300);
    const before = await p2.evaluate(() => Math.round(scrollY));
    await p2.evaluate(() => { localStorage.removeItem('mhnkr.evseen'); evNotice(); });
    await p2.waitForTimeout(250);
    await p2.locator('#ev-n-go').click();
    await p2.waitForFunction(() => scrollY === 0, null, { timeout: 5000 }).catch(() => {});
    ok(await p2.evaluate(() => scrollY) === 0 && !(await p2.locator('#panel-event').isHidden()),
       `${what}에서 눌러도 이벤트 목록 맨 위로 간다 (${before}px 에서)`);
  }
  await p2.evaluate(() => localStorage.removeItem('mhnkr.evseen'));

  // 그냥 닫기만 하면 다음에 또 떠야 합니다.
  ok(await open2(), '닫기만 했으면 다음 방문에 다시 뜬다');
  await p2.locator('#ev-n-close').click();
  ok(await open2(), '닫기를 눌러도 다음 방문에 다시 뜬다');

  // «오늘 하루 안 보기» 는 하루 동안 덮습니다.
  await p2.locator('#ev-n-hide').click();
  ok(!(await open2()), '오늘 하루 안 보기를 누르면 안 뜬다');
  const saved = JSON.parse(await p2.evaluate(() => localStorage.getItem('mhnkr.evseen')));
  ok(saved && saved.until - Date.now() > 8e7, `하루쯤 뒤까지 덮는다 (${Math.round((saved.until - Date.now()) / 36e5)}시간)`);

  /* 이벤트 «번호»로 덮으므로, 그 사이에 새 이벤트가 열리면 다시 떠야 합니다.
     시간만 저장했다면 새 소식이 하루 동안 묻힙니다. */
  await p2.evaluate(u => localStorage.setItem('mhnkr.evseen',
    JSON.stringify({ id: '999999', until: u })), saved.until);
  ok(await open2(), '덮어 둔 사이에 새 이벤트가 열리면 다시 뜬다');

  // 기한이 지나면 같은 이벤트라도 다시 뜹니다.
  await p2.evaluate(id => localStorage.setItem('mhnkr.evseen',
    JSON.stringify({ id, until: Date.now() - 1000 })), saved.id);
  ok(await open2(), '하루가 지나면 다시 뜬다');

  // 이벤트 탭으로 바로 들어온 사람에게는 같은 내용을 창으로 또 덮지 않습니다.
  await p2.evaluate(() => localStorage.removeItem('mhnkr.evseen'));
  /* «모든 페이지에서 보여야 한다» — 어느 탭으로 들어오든 뜹니다. */
  for (const h of ['', '#codes', '#smelt', '#build', '#recommend', '#material', '#record', '#rank', '#event']) {
    ok(await open2(h), `${h || '(첫 화면)'} 에서 공지가 뜬다`);
    await p2.locator('#ev-n-close').click();
  }
  ok(await open2('?build=%EB%A6%AC%EC%98%A4#build'), '빌드 공유 링크에서도 뜬다');
  await p2.locator('#ev-n-close').click();

  /* 이벤트 공유 링크(?ev=)만 예외입니다 — 이미 그 이벤트를 보러 온 사람이고,
     evOpenFromUrl 이 그 카드로 데려다 줍니다. */
  const evId = await p2.evaluate(() => evRows.find(r => evState(r) === 'open').id);
  ok(!(await open2(`?ev=${evId}#event`)), '이벤트 공유 링크로 들어오면 공지 창이 안 뜬다');
  ok(await p2.locator(`.ev-card[data-ev="${evId}"].hl`).count() === 1,
     '이벤트 공유 링크가 그 카드를 짚어 준다');
  ok(new URL(p2.url()).hash === '#event', '이벤트 공유 링크가 이벤트 탭을 연다');
  /* 테두리만으로는 안 됩니다 — 진행중 카드는 원래 호박색 띠를 두르고 있어 묻힙니다.
     글자로 말하고, 나머지를 한 톤 낮춰야 «어느 것인지» 가 한눈에 보입니다. */
  ok((await p2.locator(`.ev-card[data-ev="${evId}"] .ev-shared`).textContent()).includes('링크로 받은'),
     '강조된 카드에 «링크로 받은 이벤트» 띠가 붙는다');
  ok(await p2.locator('.ev-shared').count() === 1, '띠는 그 카드에만 붙는다');
  const dim = await p2.locator('.ev-card:not(.hl)').first()
    .evaluate(e => parseFloat(getComputedStyle(e).opacity));
  const lit = await p2.locator('.ev-card.hl')
    .evaluate(e => parseFloat(getComputedStyle(e).opacity));
  ok(lit === 1 && dim < 0.5, `나머지 카드는 흐려진다 (강조 ${lit} · 나머지 ${dim})`);
  /* 강조는 «잠깐 반짝» 이 아니라 그대로 남아야 합니다. 링크를 받은 사람은 목록 어디를
     봐야 하는지 모르는 채로 들어오고, 몇 초 만에 걷히면 놓치면 그만입니다. */
  await p2.waitForTimeout(4200);           // 시선 끄는 애니메이션(1.15s × 3)이 끝나고도
  ok(await p2.locator('.ev-card.hl').count() === 1, '강조가 몇 초 뒤에도 남아 있다');
  await p2.evaluate(() => evRender());     // 목록을 다시 그려도 살아 있어야 합니다
  ok(await p2.locator(`.ev-card[data-ev="${evId}"].hl`).count() === 1,
     '목록을 다시 그려도 강조가 살아 있다');
  // 마감·종료된 이벤트 링크도 그 카드로 데려가야 합니다(공유 버튼만 없을 뿐입니다).
  const doneId = await p2.evaluate(() => evRows.find(r => evState(r) === 'done').id);
  await open2(`?ev=${doneId}#event`);
  ok(await p2.locator(`.ev-card[data-ev="${doneId}"].hl`).count() === 1,
     '종료된 이벤트 링크도 그 카드를 짚어 준다');

  /* 진행중인 이벤트가 하나도 없으면 창이 뜨면 안 됩니다. DB 를 건드리지 않고
     목록 응답만 «끝난 이벤트 하나» 로 바꿔 봅니다. */
  await p2.route('**/rest/v1/events?**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{
      id: 1, title: '끝난 것만 있음', body: '본문', capacity: null, entries: 0,
      starts_at: null, ends_at: new Date(Date.now() - 864e5).toISOString(),
      created_at: new Date(Date.now() - 1728e5).toISOString(),
    }]),
  }));
  ok(!(await open2()), '진행중인 이벤트가 없으면 창이 안 뜬다');
  await p2.unroute('**/rest/v1/events?**');
  await ctx.close();

  fs.unlinkSync(junk);
  fs.unlinkSync(png);
  await browser.close();
  console.log(fail ? `\n${fail}건 실패` : '\n모두 통과');
  process.exit(fail ? 1 : 0);
})();
