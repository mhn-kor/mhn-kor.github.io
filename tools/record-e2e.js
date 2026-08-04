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
   «이미 등록된 영상입니다» 로 막히지 않습니다. 초 단위 시각이면 충분히 안 겹칩니다. */
const N = String(Date.now());                                     // 13자리

/* 갈래마다 한 바퀴씩 돕니다. paste 는 사람이 실제로 붙여넣는 «지저분한» 주소이고,
   canon 은 DB 에 들어가야 하는 형태, embed 는 재생 때 iframe 에 걸려야 하는 주소입니다.
   여기 한 줄을 더하는 것이 새 갈래를 붙일 때 마지막 할 일입니다.
   ※ id 는 형식만 맞는 가짜입니다 — 이 테스트는 남의 서버에 붙지 않습니다(느리고 흔들립니다).
      임베드가 «진짜로 재생되는가» 는 사람이 한 번 눈으로 봐야 합니다. */
const SOURCES = [
  { kind: 'tt', name: 'TikTok', kor: '틱톡',
    paste: `https://www.tiktok.com/@e2e.hunter/video/${N}000000?is_from_webapp=1&sender_device=pc`,
    canon: `https://www.tiktok.com/@i/video/${N}000000`,
    embed: `https://www.tiktok.com/embed/v2/${N}000000` },
  { kind: 'cz', name: '치지직', kor: '치지직',
    paste: `https://chzzk.naver.com/clips/e2e${N}?from=list`,
    canon: `https://chzzk.naver.com/clips/e2e${N}`,
    embed: `https://chzzk.naver.com/embed/clip/e2e${N}` },
  { kind: 'ig', name: '인스타', kor: '인스타 릴스',
    paste: `https://www.instagram.com/p/e2e${N}/?igsh=MXQwZmZ1bTk5`,   // 일반 글 주소로 넣어도 reel 로 모여야 합니다
    canon: `https://www.instagram.com/reel/e2e${N}/`,
    embed: `https://www.instagram.com/reel/e2e${N}/embed` },
  { kind: 'nv', name: '네이버TV', kor: '네이버TV',
    paste: `https://tv.naver.com/h/${N.slice(0, 9)}`,              // 숏폼 주소로 붙여넣어도 /v/ 로 모여야 합니다
    canon: `https://tv.naver.com/v/${N.slice(0, 9)}`,
    embed: `https://tv.naver.com/embed/${N.slice(0, 9)}` },
];

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
  /* 진행중인 이벤트가 있으면 첫 화면에 공지 창이 뜹니다(event.js 의 evNotice).
     «오늘 하루 안 보기» 는 이벤트 번호로 덮는 것이라 번호를 모르는 여기서는 못 씁니다
     (새 이벤트는 덮어 둔 사이에도 떠야 하니 그게 맞습니다). 여기서 볼 것은 리더보드라
     열리는 족족 닫습니다 — 창 자체는 tools/event-test.js 가 봅니다. */
  await page.addInitScript(() => addEventListener('DOMContentLoaded', () => {
    const d = document.getElementById('ev-notice');
    if (d) new MutationObserver(() => d.open && d.close()).observe(d, { attributes: true });
  }));

  await page.goto(`${BASE}/#record`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#rk-list .rk-item', { timeout: 15000 });

  /* 0. 이미 있는 유튜브·X 기록이 그대로인지 — 삼항을 표(RK_SRC)로 바꾸면서 깨지기 쉬운 곳입니다.
        시드 순서는 시간순이라 무엇이 맨 위인지 모릅니다. 갈래별로 찾아 봅니다. */
  const seeded = await page.evaluate(() => {
    const by = name => [...document.querySelectorAll('#rk-list .rk-item')]
      .find(li => li.querySelector('.rk-src').getAttribute('aria-label') === name);
    const yt = by('유튜브'), x = by('X');
    return {
      ytThumb: yt && (yt.querySelector('.rk-play img') || {}).src || '',
      xLogo: x ? !!x.querySelector('.rk-logo svg') : null,
      ytBadge: yt ? !!yt.querySelector('.rk-src svg') : null,
    };
  });
  ok('시드 유튜브 카드: 갈래 배지가 로고', seeded.ytBadge, true);
  ok('시드 유튜브 카드: 썸네일이 붙음', seeded.ytThumb.startsWith('https://i.ytimg.com/vi/'), true);
  ok('시드 X 카드: 로고가 깔림', seeded.xLogo, true);

  /* 1. 틱톡 짧은 링크는 «왜 안 되는지» 를 말해 줘야 합니다. */
  await page.click('#rk-open');
  await page.waitForSelector('#rk-reg[open]');
  await page.fill('#rk-url', 'https://vm.tiktok.com/ZMabcdefg/');
  await page.waitForTimeout(150);
  const short = await page.$eval('#rk-preview', b => ({ cls: b.className, txt: b.textContent.trim() }));
  ok('짧은 링크는 인식 안 함', short.cls, 'preview');
  ok('짧은 링크 안내가 뜸', /vm\.tiktok\.com.*받을 수 없|@아이디\/video/.test(short.txt), true);

  /* 받지 않는 곳은 확실히 막혀야 합니다. 카카오TV 는 서비스가 종료됐고,
     치지직 다시보기는 임베드 경로가 없습니다 — 둘 다 카드가 빈 칸이 됩니다. */
  for (const [what, url] of [
    ['카카오TV(서비스 종료)', 'https://tv.kakao.com/v/450000000'],
    ['치지직 다시보기', 'https://chzzk.naver.com/video/14509130'],
  ]) {
    await page.fill('#rk-url', url);
    await page.waitForTimeout(150);
    ok(`${what} 은 거부`, await page.$eval('#rk-preview', b => b.className), 'preview');
  }
  await page.click('#rk-cancel');

  /* 2~7. 갈래마다 등록 → 목록 → 재생 → 삭제를 한 바퀴씩. 새 갈래의 CHECK 가 빠져 있으면
          그 갈래만 «등록 성공» 에서 넘어집니다. */
  for (const s of SOURCES) {
    console.log(`\n── ${s.name}`);
    await page.click('#rk-open');
    await page.waitForSelector('#rk-reg[open]');

    await page.fill('#rk-url', s.paste);
    await page.waitForTimeout(150);
    const prev = await page.$eval('#rk-preview', b => ({ cls: b.className, txt: b.textContent.trim() }));
    ok('붙여넣자마자 알아봄', prev.cls, 'preview ok');
    ok(`미리보기가 «${s.kor}» 이라고 함`, prev.txt.includes(s.kor), true);

    /* 몬스터·무기는 아이콘 격자 모달에서 첫 칸을 고릅니다. */
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

    /* 등록창이 닫히면 성공입니다. 안 닫히면 #rk-err 에 이유가 남습니다 —
       «등록에 실패했습니다» 면 대개 DB 의 CHECK 가 이 갈래를 모르는 것입니다. */
    const closed = await dialogClosed(page, '#rk-reg');
    if (!closed) console.error('    등록창 오류:', await page.$eval('#rk-err', e => e.textContent) || '(빈 오류)');
    ok('등록 성공 (DB CHECK 통과)', closed, true);
    if (!closed) { await page.click('#rk-cancel'); continue; }

    /* DB 에 «정규화된» 주소로 들어갔는가. 찾을 때도 이 주소로 찾습니다 —
       닉네임으로 찾으면 앞선 실행이 남긴 줄이나 다른 갈래의 줄을 집습니다. */
    const stored = await page.evaluate(async (canon) => {
      const r = await fetch(`${location.origin}/rest/v1/records?video_url=eq.${encodeURIComponent(canon)}&select=id,video_url`);
      return (await r.json())[0] || null;
    }, s.canon);
    ok('DB 에 정규 주소로 저장', stored && stored.video_url, s.canon);
    if (!stored) continue;

    /* 목록에 그 갈래 카드로 섰는가. 썸네일이 없는 갈래는 로고가 깔려야 합니다. */
    const mine = await page.evaluate(id => {
      const li = document.querySelector(`#rk-list .rk-item[data-id="${id}"]`);
      return li && {
        nick: li.querySelector('.rk-nick span').textContent,
        /* 배지는 로고 그림입니다 — 갈래 이름은 aria-label 로만 남습니다(읽어주는 기기용). */
        src: li.querySelector('.rk-src').getAttribute('aria-label'),
        srcLogo: !!li.querySelector('.rk-src svg'),
        time: li.querySelector('.rk-t').textContent,
        logo: !!li.querySelector('.rk-logo'),
        img: !!li.querySelector('.rk-play img'),
      };
    }, stored.id);
    ok('내 카드가 목록에 있음', !!mine, true);
    ok(`갈래 배지가 «${s.kor}» 로고`, mine && [mine.src, mine.srcLogo], [s.kor, true]);
    ok('닉네임·시간이 그대로', mine && [mine.nick, mine.time], ['E2E헌터', '42초']);
    ok('썸네일 대신 로고를 깖', mine && [mine.logo, mine.img], [true, false]);

    /* 재생 — 눌러야 iframe 이 붙습니다(목록에 미리 깔면 스크롤이 버벅입니다). */
    await page.click(`#rk-list .rk-item[data-id="${stored.id}"] .rk-play`);
    await page.waitForSelector('#rk-view[open] iframe');
    const play = await page.evaluate(() => ({
      cls: document.querySelector('#rk-v-body').className,
      src: document.querySelector('#rk-v-body iframe').src,
      orig: document.querySelector('#rk-v-src').href,
    }));
    ok('임베드 주소', play.src, s.embed);
    ok('갈래별 상자 클래스', play.cls, `rk-v-body ${s.kind}`);
    ok('«원본 열기» 는 정규 주소', play.orig, s.canon);
    await page.click('#rk-v-close');

    /* 뒷정리 — 비밀번호로 지웁니다. 안 지우면 다음 실행에 쓰레기가 남습니다. */
    await page.click(`#rk-list .rk-item[data-id="${stored.id}"] [data-act="del"]`);
    await page.waitForSelector('#rk-del[open]');
    await page.fill('#rk-d-pw', PW);
    await page.click('#rk-del-submit');
    ok('삭제창이 닫힘', await dialogClosed(page, '#rk-del', 10000), true);
    ok('삭제되어 목록에서 사라짐', await page.$(`#rk-list .rk-item[data-id="${stored.id}"]`), null);
  }

  await browser.close();
  console.log(fail ? `\n실패 ${fail}건` : `\n통과 — ${SOURCES.length}개 갈래 각각 등록 · 목록 · 재생 · 삭제 한 바퀴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E 중단:', e.message); process.exit(1); });
