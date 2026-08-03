/* 리더보드 «등록 → 목록 → 재생 → 삭제» 를 진짜 브라우저로 한 바퀴 돕니다.
 *
 *   docker compose up -d                  # 스키마를 고쳤으면 먼저 다시 넣으세요:
 *                                         #   docker compose exec -T db psql -U postgres < supabase/schema.sql
 *   node tools/record-e2e.js              # 기본 http://localhost:8080
 *
 * 왜 필요한가: 영상 주소의 화이트리스트가 세 곳에 따로 있습니다 — record.js 의 rkVid,
 * 같은 파일의 RK_SRC, 그리고 supabase/schema.sql 의 video_url CHECK. 셋이 어긋나면
 * tools/record-test.js 는 전부 통과하는데 «등록하기» 만 누르면 실패합니다. DB 를 함께
 * 지나가는 이 테스트에서만 잡힙니다. 지원하는 곳을 늘렸다면 반드시 돌려보세요.
 *
 * 리눅스에서 chrome-headless-shell 이 libasound.so.2 를 못 찾으면 그 라이브러리가 있는
 * 곳을 LD_LIBRARY_PATH 로 알려주고 부르세요.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8080';
const PW = 'e2e-test-1234';
/* 영상 주소에는 unique 가 걸려 있습니다. 실행할 때마다 다른 id 를 써야 앞 판이 덜 지워졌어도
   «이미 등록된 영상입니다» 로 막히지 않습니다. 틱톡 id 는 19자리입니다. */
const TT_ID = String(Date.now()) + '000000';
const TT_URL = `https://www.tiktok.com/@e2e.hunter/video/${TT_ID}?is_from_webapp=1&sender_device=pc`;
const TT_CANON = `https://www.tiktok.com/@i/video/${TT_ID}`;

let fail = 0;
const ok = (what, got, want) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) { fail++; console.error(`✗ ${what}\n    받음: ${JSON.stringify(got)}\n    기대: ${JSON.stringify(want)}`); }
  else console.log(`✓ ${what}`);
};

/* 닫힌 <dialog> 는 display:none 이라 waitForSelector 의 기본값(visible)으로는 영영 안 잡힙니다.
   열림/닫힘은 선택자가 아니라 .open 으로 봐야 합니다. */
const dialogClosed = (page, sel, timeout = 15000) =>
  page.waitForFunction(s => !document.querySelector(s).open, sel, { timeout })
    .then(() => true).catch(() => false);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', e => { fail++; console.error('✗ 페이지 예외:', e.message); });

  await page.goto(`${BASE}/#record`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#rk-list .rk-item', { timeout: 15000 });

  /* 0. 이미 있는 유튜브·X 기록이 그대로인지 — 삼항을 표(RK_SRC)로 바꾸면서 깨지기 쉬운 곳입니다.
        시드 순서는 시간순이라 무엇이 맨 위인지 모릅니다. 갈래별로 찾아 봅니다. */
  const seeded = await page.evaluate(() => {
    const by = name => [...document.querySelectorAll('#rk-list .rk-item')]
      .find(li => li.querySelector('.rk-src').textContent === name);
    const yt = by('YouTube'), x = by('X');
    return {
      ytThumb: yt && (yt.querySelector('.rk-play img') || {}).src || '',
      xLogo: x ? !!x.querySelector('.rk-logo svg') : null,
    };
  });
  ok('시드 유튜브 카드: 썸네일이 붙음', seeded.ytThumb.startsWith('https://i.ytimg.com/vi/'), true);
  ok('시드 X 카드: 로고가 깔림', seeded.xLogo, true);

  /* 1. 등록창 — 짧은 링크는 «왜 안 되는지» 를 말해 줘야 합니다. */
  await page.click('#rk-open');
  await page.waitForSelector('#rk-reg[open]');

  await page.fill('#rk-url', 'https://vm.tiktok.com/ZMabcdefg/');
  await page.waitForTimeout(150);
  const short = await page.$eval('#rk-preview', b => ({ cls: b.className, txt: b.textContent.trim() }));
  ok('짧은 링크는 인식 안 함', short.cls, 'preview');
  ok('짧은 링크 안내가 뜸', /vm\.tiktok\.com.*받을 수 없|@아이디\/video/.test(short.txt), true);

  /* 2. 제대로 된 틱톡 주소 → 그 자리에서 «틱톡» 으로 알아봐야 합니다. */
  await page.fill('#rk-url', TT_URL);
  await page.waitForTimeout(150);
  const prev = await page.$eval('#rk-preview', b => ({ cls: b.className, txt: b.textContent.trim() }));
  ok('틱톡 주소를 인식', prev.cls, 'preview ok');
  ok('미리보기가 «틱톡» 이라고 함', prev.txt.includes('틱톡'), true);

  /* 3. 나머지 칸을 채우고 등록. 몬스터·무기는 아이콘 격자 모달에서 첫 칸을 고릅니다. */
  await page.fill('#rk-nick', 'E2E헌터');
  for (const btn of ['#rk-mon', '#rk-wp']) {
    await page.click(btn);
    await page.waitForSelector('#bd-modal[open] .bd-gi');
    await page.click('#bd-modal .bd-gi:not(.rk-any)');
    await page.waitForSelector('#bd-modal[open]', { state: 'hidden' });
  }
  await page.fill('#rk-time', '42');
  await page.fill('#rk-pw', PW);
  await page.click('#rk-submit');

  /* 등록창이 닫히면 성공입니다. 실패하면 #rk-err 에 이유가 남습니다 —
     여기서 «등록에 실패했습니다» 가 뜨면 대개 DB 의 CHECK 가 틱톡을 모르는 것입니다. */
  const closed = await dialogClosed(page, '#rk-reg');
  if (!closed) console.error('    등록창 오류:', await page.$eval('#rk-err', e => e.textContent) || '(빈 오류)');
  ok('등록 성공 (DB CHECK 통과)', closed, true);
  if (!closed) { await browser.close(); process.exit(1); }

  /* 4. DB 에 «정규화된» 주소로 들어갔는가 — 계정 이름과 ?is_from_webapp 이 떨어져야 합니다.
        찾을 때도 이 주소로 찾습니다. 닉네임으로 찾으면 앞선 실행이 남긴 줄을 집습니다. */
  const stored = await page.evaluate(async (canon) => {
    const r = await fetch(`${location.origin}/rest/v1/records?video_url=eq.${encodeURIComponent(canon)}&select=id,video_url`);
    return (await r.json())[0] || null;
  }, TT_CANON);
  ok('DB 에 @i/video 형태로 저장', stored && stored.video_url, TT_CANON);
  if (!stored) { await browser.close(); process.exit(1); }

  /* 5. 목록에 틱톡 카드로 섰는가. 썸네일이 없으니 로고가 깔려야 합니다. */
  const mine = await page.evaluate(id => {
    const li = document.querySelector(`#rk-list .rk-item[data-id="${id}"]`);
    return li && {
      nick: li.querySelector('.rk-nick span').textContent,
      src: li.querySelector('.rk-src').textContent,
      time: li.querySelector('.rk-t').textContent,
      logo: !!li.querySelector('.rk-logo svg'),
      img: !!li.querySelector('.rk-play img'),
    };
  }, stored.id);
  ok('내 카드가 목록에 있음', !!mine, true);
  ok('이름표가 TikTok', mine && mine.src, 'TikTok');
  ok('닉네임·시간이 그대로', mine && [mine.nick, mine.time], ['E2E헌터', '42초']);
  ok('썸네일 대신 로고를 깖', mine && [mine.logo, mine.img], [true, false]);

  /* 6. 재생 — 눌러야 iframe 이 붙습니다(목록에 미리 깔면 스크롤이 버벅입니다). */
  await page.click(`#rk-list .rk-item[data-id="${stored.id}"] .rk-play`);
  await page.waitForSelector('#rk-view[open] iframe');
  const play = await page.evaluate(() => ({
    cls: document.querySelector('#rk-v-body').className,
    src: document.querySelector('#rk-v-body iframe').src,
    orig: document.querySelector('#rk-v-src').href,
  }));
  ok('임베드 주소', play.src, `https://www.tiktok.com/embed/v2/${TT_ID}`);
  ok('틱톡 전용 상자 클래스', play.cls, 'rk-v-body tt');
  ok('«원본 열기» 는 정규 주소', play.orig, TT_CANON);
  await page.click('#rk-v-close');

  /* 7. 뒷정리 — 비밀번호로 지웁니다. 실패하면 다음 실행에 쓰레기가 남습니다. */
  await page.click(`#rk-list .rk-item[data-id="${stored.id}"] [data-act="del"]`);
  await page.waitForSelector('#rk-del[open]');
  await page.fill('#rk-d-pw', PW);
  await page.click('#rk-del-submit');
  ok('삭제창이 닫힘', await dialogClosed(page, '#rk-del', 10000), true);
  const gone = await page.$(`#rk-list .rk-item[data-id="${stored.id}"]`);
  ok('삭제되어 목록에서 사라짐', gone, null);

  await browser.close();
  console.log(fail ? `\n실패 ${fail}건` : '\n통과 — 등록 · 목록 · 재생 · 삭제 한 바퀴');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E 중단:', e.message); process.exit(1); });
