/* 이벤트 탭 — 운영자가 연 이벤트와, 거기에 응모하는 창.
 *
 * 목록: Supabase 의 public.events (supabase/schema.sql). 등록·삭제는 마스터
 * 비밀번호로만 합니다 — 이벤트를 여는 사람이 운영자 한 사람뿐이라 개인 비밀번호를
 * 두지 않았습니다.
 *
 * 응모: 서버에 «남지 않습니다». 폼을 그대로 Edge Function 으로 보내면 거기서
 * 디스코드 채팅방으로 흘려보냅니다 (supabase/functions/discord-entry).
 * 이미지도 마찬가지로 저장소를 거치지 않습니다. 그래서 이 탭에는 응모 목록이 없고,
 * 응모한 사람은 디스코드에서 자기 글을 확인합니다.
 *
 * app.js 의 $ / esc / toast / rest / when / TRASH_ICON / makePager / lastNick 을
 * 함수 안에서만 씁니다.
 */

const EV_LIMIT = 100;
const EV_TITLE_MAX = 60;
const EV_BODY_MAX = 1000;          // discord-entry 의 BODY_MAX 와 같아야 합니다
const EV_CAP_MAX = 100000;         // schema.sql 의 events_capacity_check 와 같아야 합니다
const EV_IMG_MAX = 8 * 1024 * 1024;
const EV_IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/* 함수는 Supabase 에만 있습니다. 로컬 미리보기(docker compose)는 PostgREST 뿐이라
   여기로 보내면 404 가 납니다 — 그게 맞습니다. 로컬만 따로 빠져나가게 만들면 그 길이
   시험되지 않은 채 남고, 배포본에서 처음 도는 코드가 됩니다.
   주소를 API 로 잡는 이유도 같습니다: 로컬에서 실수로 «진짜» 채팅방에 쏘지 않습니다. */
const EV_FN = API + '/functions/v1/discord-entry';
/* 이벤트 이미지는 Storage 로 갑니다(응모 이미지는 디스코드로만 가고 남지 않습니다).
   마스터 확인 뒤 service_role 로 올리는 함수라, 여기서도 마스터 비밀번호를 실어 보냅니다. */
const EV_IMGFN = API + '/functions/v1/event-image';
const EV_EIMG_MAX = 3 * 1024 * 1024;   // event-image 의 IMG_MAX · 버킷 file_size_limit 와 같아야 합니다
const EV_LOCAL = API !== SUPABASE_URL;

const EV_ERR = {
  TOO_MANY: '잠시 뒤에 다시 시도해 주세요. 짧은 시간에 너무 여러 번 보냈습니다.',
  IMG_TOO_BIG: '이미지는 8MB 이하만 첨부할 수 있습니다.',
  IMG_TYPE: '이미지는 PNG · JPG · GIF · WEBP 만 첨부할 수 있습니다.',
  NO_EVENT: '이 이벤트가 방금 삭제되었습니다. 목록을 새로고침해 주세요.',
  NOT_STARTED: '아직 시작하지 않은 이벤트입니다.',
  ENDED: '방금 종료된 이벤트입니다. 목록을 새로고침해 주세요.',
  FULL: '방금 선착순 인원이 다 찼습니다. 아깝게 놓치셨습니다.',
  DUP: '이 닉네임으로 이미 응모하셨습니다. 선착순 이벤트는 한 번만 참여할 수 있습니다.',
  NO_WEBHOOK: '디스코드 연결이 아직 설정되지 않았습니다. 운영자에게 알려주세요.',
  /* 함수 자체가 없을 때. 이걸 «전송에 실패했습니다» 로 뭉뚱그리면 원인을 찾을 수 없습니다
     — 실제로 배포 때 한참 헤맸습니다. */
  NO_FUNCTION: '디스코드 연결이 아직 배포되지 않았습니다. 운영자에게 알려주세요.',
};

/* 이벤트가 지금 어느 상태인가. 여기 시계와 숫자는 «받아온 시점» 의 것이라 안내용입니다 —
   실제로 응모를 받을지는 discord-entry 가 DB 안에서 다시 판정합니다. */
const EV_STATE = { open: '진행중', soon: '시작 전', full: '선착순 마감', done: '종료' };
function evState(r) {
  const now = Date.now();
  if (r.starts_at && now < Date.parse(r.starts_at)) return 'soon';
  if (r.ends_at && now > Date.parse(r.ends_at)) return 'done';
  if (r.capacity != null && r.entries >= r.capacity) return 'full';
  return 'open';
}

/* 「참여 24 / 30명 · 남은 자리 6」 · 인원 제한이 없으면 「참여 12명」.
   끝났거나 아직 시작 전이면 «남은 자리» 는 뗍니다 — 끝난 이벤트가 «남은 자리 50» 이라고
   말하면 아직 넣을 수 있는 것처럼 읽힙니다. 참여한 사람 수는 그때도 남깁니다. */
function evSeats(r, st) {
  const n = r.entries || 0;
  if (r.capacity == null) return `<span class="ev-seats">참여 <b>${n}</b>명</span>`;
  const left = Math.max(0, r.capacity - r.entries);
  const tail = st === 'done' || st === 'soon' ? ''
    : left ? ` · 남은 자리 <b>${left}</b>` : ' · <b>마감</b>';
  return `<span class="ev-seats${left ? '' : ' none'}">참여 <b>${n}</b> / ${r.capacity}명${tail}</span>`;
}

/* 하루의 처음(00:00)이나 끝(23:59)이면 시각을 떼고 날짜만 보여 줍니다. 이벤트는 대부분
   이 꼴이라, 그대로 두면 «26. 8. 4. 오전 12:00» 처럼 읽는 사람을 헷갈리게 하는 글자가
   붙습니다. 시각을 직접 고친 이벤트(예: 오후 8시 시작)는 그대로 보여 줍니다. */
function evAt(t) {
  const d = new Date(t);
  const h = d.getHours(), m = d.getMinutes();
  return (h === 0 && m === 0) || (h === 23 && m === 59)
    ? d.toLocaleDateString('ko-KR', { dateStyle: 'short' })
    : when(t);
}

/* 「8. 1. ~ 8. 31.」 · 「8. 31. 까지」 · 「8. 1. 부터」 · 「상시」 */
function evPeriod(r) {
  if (r.starts_at && r.ends_at) return `${evAt(r.starts_at)} ~ ${evAt(r.ends_at)}`;
  if (r.ends_at) return `${evAt(r.ends_at)} 까지`;
  if (r.starts_at) return `${evAt(r.starts_at)} 부터`;
  return '상시';
}

/* 하루의 처음과 끝. 이벤트는 «8월 4일부터 11일까지» 처럼 날짜로 말하지 시각으로 말하지
   않습니다. 날짜만 고르면 이 값이 붙습니다. 시각 칸을 고치면 그쪽이 이깁니다. */
const EV_T0 = '00:00';
const EV_T1 = '23:59';

/* 날짜칸 + 시각칸 → ISO. 날짜가 비면 null 입니다(«상시»).
   date/time 값은 둘 다 «지역 시각, 시간대 없음» 이라 new Date 가 이 기기의 시간대로
   읽고 toISOString 이 UTC 로 바꿔 보냅니다. */
const evWhenValue = (dateSel, timeSel, fallback) => {
  const d = $(dateSel).value;
  if (!d) return null;
  return new Date(`${d}T${$(timeSel).value || fallback}`).toISOString();
};
const evStartsAt = () => evWhenValue('#ev-a-start', '#ev-a-startt', EV_T0);
const evEndsAt = () => evWhenValue('#ev-a-end', '#ev-a-endt', EV_T1);

/* 반대 방향 — 날짜칸에 넣을 «YYYY-MM-DD». toISOString 은 UTC 라 그냥 쓰면 자정 언저리에
   날짜가 하루 어긋납니다. 시간대 차이만큼 미리 밀어 두면 UTC 로 찍힌 글자가 곧 지역
   날짜가 됩니다. */
const evFillDate = d => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

/* 달력 피커에는 «확인» 버튼이 없습니다 — 날짜를 고르면 창이 그냥 닫힙니다. 그래서
   ① 날짜를 누르는 순간 시각을 채워 값이 완성되게 하고(비어 있으면 반영이 안 된 것처럼
   보입니다), ② 지금 값을 카드와 «같은 문장»으로 되읽어 줍니다.
   사람이 확인할 것은 버튼이 아니라 결과입니다. */
function evAddPeriod() {
  const out = $('#ev-a-period');
  // 날짜를 골랐는데 시각이 비어 있으면 하루의 처음·끝으로 채웁니다. 날짜를 지우면 같이 비웁니다.
  for (const [d, t, v] of [['#ev-a-start', '#ev-a-startt', EV_T0], ['#ev-a-end', '#ev-a-endt', EV_T1]]) {
    if ($(d).value && !$(t).value) $(t).value = v;
    if (!$(d).value) $(t).value = '';
  }
  const starts_at = evStartsAt();
  const ends_at = evEndsAt();
  if (starts_at && ends_at && ends_at <= starts_at) {
    out.className = 'ev-period-out bad';
    out.textContent = '종료가 시작보다 빠릅니다.';
    return;
  }
  out.className = 'ev-period-out';
  if (!starts_at && !ends_at) { out.textContent = '상시 — 지울 때까지 계속 받습니다.'; return; }
  const days = starts_at && ends_at
    ? Math.round((Date.parse(ends_at) - Date.parse(starts_at)) / 864e5) : 0;
  out.textContent = evPeriod({ starts_at, ends_at }) + (days ? ` · ${days}일간` : '');
}

/* 좁은 화면에서는 «링크» 글자를 감추고 그림만 남깁니다(.ev-act .lbl).
   카카오 모양은 추천빌드·리더보드와 같은 것을 씁니다 — build.js 의 BD_I.kakao. */
const EV_I = {
  link: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13.5a4 4 0 0 0 6 .5l2.5-2.5a4 4 0 0 0-5.7-5.7L11.5 7"/><path d="M14 10.5a4 4 0 0 0-6-.5L5.5 12.5a4 4 0 0 0 5.7 5.7L12.5 17"/></svg>',
  get kakao() { return typeof BD_I === 'object' ? BD_I.kakao : '카톡'; },
};

let evRows = [];
let evLoaded = false;
let evPager = null;
let evPending = null;              // 참여·삭제 창이 어느 이벤트를 가리키는지
let evHlId = null;                 // 공유 링크(?ev=)로 들어온 이벤트. 목록에서 계속 짚어 둡니다

function drawEvent() {
  if (evLoaded) { evRender(); return; }
  evLoaded = true;
  evLoad();
}

async function evLoad() {
  const box = $('#ev-list');
  box.innerHTML = '<p class="bd-empty">불러오는 중…</p>';
  try {
    const r = await rest(`events?select=id,title,body,starts_at,ends_at,capacity,entries,image_url,created_at`
      + `&order=created_at.desc&limit=${EV_LIMIT}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    evRows = await r.json();
  } catch (e) {
    // 실패는 «받아왔음» 이 아닙니다. 되돌려 놔야 탭을 다시 열 때 다시 받아옵니다.
    evLoaded = false;
    box.innerHTML = '<p class="bd-empty">목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.</p>';
    /* 조용히 넘어가면 «공지 창이 안 뜬다» 로만 보입니다. 대개 원인은 supabase/schema.sql
       의 events 절을 아직 안 돌린 것입니다(그러면 여기가 404). 콘솔에 남깁니다. */
    console.error('이벤트 목록을 못 받았습니다 — supabase/schema.sql 을 실행했는지 확인하세요.', e);
    return;
  }
  evRender();
}

/* 진행중 → 시작 전 → 종료 순. 끝난 이벤트가 지금 응모할 수 있는 것보다 위에 있으면
   목록의 쓸모가 없습니다. 같은 상태 안에서는 받아온 순서(최신순)가 그대로입니다. */
const EV_ORDER = { open: 0, soon: 1, full: 2, done: 3 };
const evSorted = () => evRows
  .map((r, i) => [r, i])
  .sort((a, b) => EV_ORDER[evState(a[0])] - EV_ORDER[evState(b[0])] || a[1] - b[1])
  .map(x => x[0]);

function evRender() {
  const rows = evSorted();
  // 개수는 «지금 응모할 수 있는 것» 을 먼저 말합니다. 그게 이 탭에 온 이유입니다.
  const open = rows.filter(r => evState(r) === 'open').length;
  $('#ev-count').textContent = `진행중 ${open}개 · 전체 ${rows.length}개`;
  if (!evPager) evPager = makePager(10, evRender);
  const list = $('#ev-list');
  list.innerHTML = rows.length
    ? evPager.take(rows).map(evCard).join('')
    : '<p class="bd-empty">아직 열린 이벤트가 없습니다.</p>';
  // 링크로 들어왔으면 나머지를 한 톤 낮춥니다. 하나만 밝히는 것이 가장 빨리 눈에 띕니다.
  list.classList.toggle('has-hl', evHlId != null && rows.some(r => String(r.id) === String(evHlId)));
  evPager.watch(list, rows);
}

function evCard(r) {
  const st = evState(r);
  const OFF = { soon: '아직 시작 전입니다', full: '선착순 마감되었습니다', done: '종료된 이벤트입니다' };
  // disabled 는 안내입니다 — 실제 판정은 discord-entry 가 DB 안에서 다시 합니다.
  const btn = st === 'open'
    ? `<button class="btn primary" data-ev-join="${r.id}">참여하기</button>`
    // 누를 수 없는 버튼은 ghost 로 둡니다. primary 는 흐려도 «누르는 것» 으로 읽힙니다.
    : `<button class="btn ghost" disabled>${OFF[st]}</button>`;
  /* 마감·종료된 이벤트는 공유할 이유가 없습니다 — 링크를 받은 사람이 할 수 있는 일이
     없습니다. 시작 전은 남깁니다(«이런 게 열린다» 를 미리 알리는 것이 공유의 쓸모입니다). */
  const share = st === 'full' || st === 'done' ? '' : `
      <button class="btn ghost" data-ev-link="${r.id}" title="이 이벤트 링크 복사"
              aria-label="이 이벤트 링크 복사">${EV_I.link}<span class="lbl">링크</span></button>
      <button class="btn ghost ev-kakao" data-ev-kakao="${r.id}" title="카카오톡 공유"
              aria-label="카카오톡으로 공유">${EV_I.kakao}</button>`;
  /* 공유 링크로 들어온 이벤트. 다시 그려도 살아 있어야 하므로 여기서 붙입니다.
     테두리만으로는 부족합니다 — 진행중 카드는 원래 호박색 띠를 두르고 있어 묻힙니다.
     «이 카드가 그 이벤트입니다» 라고 글자로 말하는 것이 가장 확실합니다. */
  const on = String(r.id) === String(evHlId);
  const hl = on ? ' hl' : '';
  return `<article class="ev-card ${st}${hl}" data-ev="${r.id}">
    ${on ? `<p class="ev-shared">${EV_I.link} 링크로 받은 이벤트입니다</p>` : ''}
    <header>
      <span class="ev-state ${st}">${EV_STATE[st]}</span>
      <b class="ev-title">${esc(r.title)}</b>
      <button class="icon danger" data-ev-del="${r.id}" aria-label="이벤트 삭제"
              title="삭제 (마스터 비밀번호 필요)">${TRASH_ICON}</button>
    </header>
    <p class="ev-meta">${esc(evPeriod(r))}${evSeats(r, st)}</p>
    ${r.image_url ? `<img class="ev-img" src="${esc(r.image_url)}" alt="" loading="lazy">` : ''}
    <p class="ev-body">${esc(r.body)}</p>
    <div class="ev-act">${share}${btn}</div>
  </article>`;
}

/* ── 공유 ─────────────────────────────────────────────────────────
   카카오 SDK 준비·링크 복사는 빌드 탭 것을 그대로 씁니다(bdKakaoReady/bdCopyLink).
   같은 일을 두 벌 두면 키를 바꿀 때 한쪽만 낡습니다. 리더보드(rkShare)와 같은 구조입니다. */
const evShareUrl = r => `${location.origin}${location.pathname}?ev=${r.id}#event`;
/* 카카오로 나가는 링크는 받는 사람이 열 수 있어야 하므로 배포 절대 주소를 씁니다
   (BD_BASE 는 og:url). 배포 환경에서는 위와 같은 값입니다. */
const evShareAbs = r => (typeof BD_BASE === 'string' ? BD_BASE : location.origin + location.pathname)
  + `?ev=${r.id}#event`;

/* 카톡 카드에 들어갈 한 줄. 기간과 남은 자리는 «지금 갈까» 를 정하는 정보라 앞에 둡니다. */
function evShareDesc(r) {
  const seats = r.capacity != null
    ? ` · 선착순 ${r.capacity}명 중 ${Math.max(0, r.capacity - r.entries)}자리` : '';
  return evPeriod(r) + seats + '\n' + r.body.split('\n')[0].slice(0, 80);
}

async function evShare(id) {
  const r = evRows.find(x => String(x.id) === String(id));
  if (!r) return;
  const url = evShareAbs(r);
  const desc = evShareDesc(r);
  const link = { mobileWebUrl: url, webUrl: url };

  if (typeof bdKakaoReady === 'function' && await bdKakaoReady()) {
    try {
      /* 빌드용 리스트 템플릿은 방어구 5줄짜리라 이벤트에는 안 맞습니다.
         그림 한 장 + 글인 feed 를 씁니다(리더보드 공유와 같습니다). */
      window.Kakao.Share.sendDefault({
        objectType: 'feed',
        content: {
          title: `[이벤트] ${r.title}`, description: desc,
          /* 이벤트 이미지가 있으면 그걸 씁니다 — Storage 공개 주소라 카카오 서버가 받아갈
             수 있습니다. 없으면 지금까지처럼 사이트 대표 이미지(og)입니다. */
          imageUrl: r.image_url || (typeof BD_OG === 'string' ? BD_OG : ''), link,
        },
        buttons: [{ title: '이벤트 보기', link }],
      });
      return;
    } catch (e) { toast('카카오톡 공유에 실패했습니다'); }
  }
  if (navigator.share) {
    try { await navigator.share({ title: r.title, text: desc, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }   // 사용자가 취소한 건 실패가 아닙니다
  }
  /* 카카오 키도 공유 시트도 없는 환경(대개 PC). 링크를 붙여넣으면 카톡이 og 태그로
     카드를 만들어 주므로 그 방법을 알려 줍니다. */
  bdCopyLink(evShareUrl(r), '링크 복사됨 · 카카오톡에 붙여넣으세요');
}

/* ?ev=<id> 로 들어오면 그 이벤트로 데려다 줍니다. 창을 띄우지는 않습니다 — 마감·종료된
   이벤트일 수도 있고, 링크를 받은 사람이 먼저 볼 것은 «무슨 이벤트인가» 입니다.
   강조는 «잠깐 반짝» 이 아니라 그대로 둡니다. 링크를 받은 사람은 목록 어디를 봐야 하는지
   모르는 채로 들어오고, 몇 초 만에 걷히면 놓치면 그만입니다. */
let evFromUrlDone = false;
function evOpenFromUrl() {
  if (evFromUrlDone) return;
  evFromUrlDone = true;
  const id = new URLSearchParams(location.search).get('ev');
  if (!id || !evRows.some(x => String(x.id) === String(id))) return;
  if (location.hash !== '#event') location.hash = '#event';
  evHlId = id;
  evRender();                              // 강조는 카드를 그릴 때 붙습니다
  /* ponytail: 목록이 길어 그 이벤트가 아직 안 그려졌으면(makePager) 스크롤은 못 합니다.
     강조는 나중에 그려질 때 붙습니다. 진행중 이벤트가 열 개를 넘으면 그때 손보세요. */
  const card = document.querySelector(`.ev-card[data-ev="${CSS.escape(id)}"]`);
  if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ── 참여 ─────────────────────────────────────────────────────────── */
function evOpenJoin(id) {
  const row = evRows.find(x => String(x.id) === String(id));
  if (!row) return;
  evPending = row;
  $('#ev-join-what').innerHTML = `<b>${esc(row.title)}</b> 에 응모합니다.`
    + (row.ends_at ? `<br>${esc(when(row.ends_at))} 까지 받습니다.` : '')
    + (row.capacity != null
      ? `<br>선착순 ${row.capacity}명 · 남은 자리 ${Math.max(0, row.capacity - row.entries)}` : '');
  // 중복 응모는 정원이 있는 이벤트만 막습니다(schema.sql 의 claim_event_slot).
  $('#ev-j-nick-hint').hidden = row.capacity == null;
  $('#ev-j-err').hidden = true;
  $('#ev-j-nick').value = lastNick();
  evPreview();                              // 앞서 고른 이미지가 남아 있지 않도록
  $('#ev-join').showModal();
  focusIn($('#ev-j-title'));
}

/* 고른 이미지를 창 안에서 바로 보여 줍니다. 크기·형식이 어긋나면 보내기 전에 말합니다. */
function evPreview() {
  const f = $('#ev-j-img').files[0];
  const img = $('#ev-j-thumb');
  const hint = $('#ev-j-hint');
  if (img.src) URL.revokeObjectURL(img.src);   // 창을 여닫을 때마다 쌓이지 않게
  if (!f) {
    img.removeAttribute('src');
    hint.textContent = '이미지는 선택입니다. PNG · JPG · GIF · WEBP, 8MB 이하.';
    return;
  }
  const bad = !EV_IMG_TYPES.includes(f.type) ? EV_ERR.IMG_TYPE
    : f.size > EV_IMG_MAX ? EV_ERR.IMG_TOO_BIG : null;
  if (bad) {
    $('#ev-j-img').value = '';
    img.removeAttribute('src');
    hint.textContent = bad;
    return;
  }
  img.src = URL.createObjectURL(f);
  hint.innerHTML = `<b>${esc(f.name)}</b><br>${(f.size / 1024 / 1024).toFixed(1)}MB`;
}

async function evJoin(e) {
  e.preventDefault();
  const err = $('#ev-j-err');
  const title = $('#ev-j-title').value.trim();
  const nickname = $('#ev-j-nick').value.trim().replace(/\s+/g, ' ');
  const body = $('#ev-j-body').value.trim();
  const file = $('#ev-j-img').files[0];

  const bad = !evPending ? '이벤트를 다시 골라주세요.'
    : !title ? '제목을 입력해 주세요.'
    : title.length > EV_TITLE_MAX ? `제목은 ${EV_TITLE_MAX}자 이내로 입력해 주세요.`
    : !nickname ? '닉네임을 입력해 주세요.'
    : nickname.length > NICK_MAX ? `닉네임은 ${NICK_MAX}자 이내로 입력해 주세요.`
    : !body ? '내용을 입력해 주세요.'
    : body.length > EV_BODY_MAX ? `내용은 ${EV_BODY_MAX}자 이내로 입력해 주세요.`
    : null;
  if (bad) { err.textContent = bad; err.hidden = false; return; }

  /* 응모는 이미지까지 실어 보내므로 몇 초가 걸립니다. 버튼이 잠기기만 하면 «먹통인가»
     싶어 다시 누르게 되므로, 지금 무엇을 하고 있는지 글자로 말해 줍니다. */
  const btn = $('#ev-j-submit');
  const label = btn.textContent;
  btn.disabled = true;
  btn.classList.add('busy');
  btn.textContent = file ? '이미지 올리는 중…' : '보내는 중…';
  err.hidden = true;
  const fd = new FormData();
  fd.append('event_id', evPending.id);
  fd.append('title', title);
  fd.append('nickname', nickname);
  fd.append('body', body);
  if (file) fd.append('image', file);

  try {
    /* rest() 는 /rest/v1 아래로만 갑니다. 함수는 /functions/v1 이라 직접 부릅니다.
       Content-Type 은 넣지 않습니다 — FormData 의 boundary 를 브라우저가 붙입니다. */
    const r = await fetch(EV_FN, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY },
      body: fd,
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.error || (r.status === 404 ? 'NO_FUNCTION' : `HTTP ${r.status}`));
    /* 남은 자리는 서버가 세어 돌려줍니다. 여기서 1 을 빼면 그 사이에 남이 넣은 응모가
       빠져 화면 숫자가 실제와 어긋납니다. 목록을 다시 받아올 필요도 없습니다. */
    if (out.entries != null) { evPending.entries = out.entries; evRender(); }
    saveNick(nickname);
    $('#ev-join').close();
    $('#ev-join-form').reset();
    evPreview();
    toast(out.capacity != null
      ? `응모 완료! 남은 자리 ${Math.max(0, out.capacity - out.entries)}`
      : '응모가 디스코드로 전달되었습니다!');
  } catch (e2) {
    err.textContent = EV_ERR[e2.message] || '전송에 실패했습니다. 잠시 후 다시 시도해 주세요.';
    err.hidden = false;
    if (!EV_ERR[e2.message]) console.error(e2);
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
    btn.textContent = label;
  }
}

/* ── 운영자: 이벤트 열기 · 닫기 ───────────────────────────────────── */
async function evAdd(e) {
  e.preventDefault();
  const err = $('#ev-a-err');
  const title = $('#ev-a-title').value.trim();
  const body = $('#ev-a-body').value.trim();
  const starts_at = evStartsAt();
  const ends_at = evEndsAt();
  const capRaw = $('#ev-a-cap').value.trim();
  const capacity = capRaw ? Number(capRaw) : null;   // 비우면 무제한
  const master = $('#ev-a-pw').value;
  const file = $('#ev-a-img').files[0] || null;

  const bad = !title ? '이벤트명을 입력해 주세요.'
    : title.length > EV_TITLE_MAX ? `이벤트명은 ${EV_TITLE_MAX}자 이내로 입력해 주세요.`
    : !body ? '내용을 입력해 주세요.'
    // 뒤집힌 기간은 DB 의 events_period_check 도 막지만, 여기서 먼저 말해 줍니다.
    : starts_at && ends_at && ends_at <= starts_at ? '종료가 시작보다 빠릅니다.'
    : capacity != null && !(Number.isInteger(capacity) && capacity >= 1 && capacity <= EV_CAP_MAX)
      ? `선착순 인원은 1 ~ ${EV_CAP_MAX} 사이의 정수로 적어주세요.`
    : file && !EV_IMG_TYPES.includes(file.type) ? EV_ERR.IMG_TYPE
    : file && file.size > EV_EIMG_MAX ? '이벤트 이미지는 3MB 이하만 올릴 수 있습니다.'
    : !master ? '마스터 비밀번호를 입력해 주세요.'
    : null;
  if (bad) { err.textContent = bad; err.hidden = false; return; }

  const btn = $('#ev-a-submit');
  const label = btn.textContent;
  btn.disabled = true;
  err.hidden = true;
  try {
    /* 그림이 있으면 먼저 Storage 로 올려 주소를 받습니다. 마스터가 틀리면 여기서
       걸리므로, 그림 없는 이벤트가 «절반만» 만들어지는 일은 없습니다. */
    let image_url = null;
    if (file) {
      btn.classList.add('busy');
      btn.textContent = '이미지 올리는 중…';
      const fd = new FormData();
      fd.append('master', master);
      fd.append('image', file);
      /* 함수가 배포되지 않았으면 404 인데, 프로덕션(교차 출처)에서는 preflight 가
         CORS 헤더 없이 404 라 fetch 자체가 던집니다 — 그 경우도 미배포 안내로 모읍니다.
         (로컬은 같은 출처라 404 응답이 그대로 옵니다.) */
      const ur = await fetch(EV_IMGFN, { method: 'POST', headers: { apikey: SUPABASE_KEY }, body: fd })
        .catch(() => null);
      if (!ur) throw new Error('NO_IMGFN');
      const uo = await ur.json().catch(() => ({}));
      if (!ur.ok) throw new Error(uo.error || (ur.status === 404 ? 'NO_IMGFN' : `HTTP ${ur.status}`));
      image_url = uo.url;
    }
    const r = await rest('rpc/add_event', {
      method: 'POST',
      body: JSON.stringify({
        p_title: title, p_body: body, p_starts_at: starts_at, p_ends_at: ends_at,
        p_capacity: capacity, p_master: master, p_image_url: image_url,
      }),
    });
    if (!r.ok) {
      const e2 = await r.json().catch(() => ({}));
      throw new Error(/BAD_MASTER/.test(e2.message || '') ? 'BAD_MASTER' : `HTTP ${r.status}`);
    }
    evRows.unshift({
      id: await r.json(), title, body, starts_at, ends_at, capacity, entries: 0, image_url,
      created_at: new Date().toISOString(),
    });
    evRender();
    $('#ev-add').close();
    $('#ev-add-form').reset();
    evAddPeriod();                 // reset() 은 칸만 비웁니다. 되읽는 줄도 되돌립니다.
    toast('이벤트가 등록되었습니다!');
  } catch (e3) {
    const M = {
      BAD_MASTER: '마스터 비밀번호가 아닙니다.',
      /* 함수가 없을 때를 «실패했습니다» 로 뭉뚱그리지 않습니다 — discord-entry 의
         NO_FUNCTION 과 같은 이유이고, 그림만 빼면 등록은 되니 그 길도 알려 줍니다. */
      NO_IMGFN: '이미지 올리기(event-image)에 연결하지 못했습니다 — 함수가 아직 배포되지 않았을 수 있습니다. 이미지를 빼면 등록됩니다.',
      IMG_TOO_BIG: '이벤트 이미지는 3MB 이하만 올릴 수 있습니다.',
      IMG_TYPE: EV_ERR.IMG_TYPE,
      TOO_MANY: EV_ERR.TOO_MANY,
    };
    err.textContent = M[e3.message] || '등록에 실패했습니다. 잠시 후 다시 시도해 주세요.';
    err.hidden = false;
    if (!M[e3.message]) console.error(e3);
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
    btn.textContent = label;
  }
}

async function evDelete(e) {
  e.preventDefault();
  const err = $('#ev-d-err');
  const master = $('#ev-d-pw').value;
  if (!master) { err.textContent = '마스터 비밀번호를 입력해 주세요.'; err.hidden = false; return; }

  const btn = $('#ev-d-submit');
  btn.disabled = true;
  err.hidden = true;
  try {
    const r = await rest('rpc/delete_event', {
      method: 'POST',
      body: JSON.stringify({ p_id: Number(evPending), p_master: master }),
    });
    if (!r.ok) throw new Error(await r.text());
    if (await r.json() !== true) {
      err.textContent = '마스터 비밀번호가 아닙니다.';
      err.hidden = false;
      return;
    }
    evRows = evRows.filter(x => String(x.id) !== String(evPending));
    evRender();
    $('#ev-del').close();
    $('#ev-del-form').reset();
    toast('이벤트를 삭제했습니다.');
  } catch (e2) {
    err.textContent = '삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.';
    err.hidden = false;
    console.error(e2);
  } finally {
    btn.disabled = false;
  }
}

/* ── 연결 ─────────────────────────────────────────────────────────── */
$('#panel-event').addEventListener('click', e => {
  const join = e.target.closest('[data-ev-join]');
  if (join) { evOpenJoin(join.dataset.evJoin); return; }
  const kakao = e.target.closest('[data-ev-kakao]');
  if (kakao) { evShare(kakao.dataset.evKakao); return; }
  const link = e.target.closest('[data-ev-link]');
  if (link) {
    const r = evRows.find(x => String(x.id) === String(link.dataset.evLink));
    if (r) bdCopyLink(evShareUrl(r));
    return;
  }
  const del = e.target.closest('[data-ev-del]');
  if (del) {
    const row = evRows.find(x => String(x.id) === String(del.dataset.evDel));
    evPending = del.dataset.evDel;
    $('#ev-del-what').innerHTML = row ? `<b>${esc(row.title)}</b>` : '';
    $('#ev-d-err').hidden = true;
    $('#ev-del').showModal();
  }
});

$('#ev-open').addEventListener('click', () => {
  $('#ev-a-err').hidden = true;
  evAddPeriod();
  $('#ev-add').showModal();
  focusIn($('#ev-a-title'));
});

/* 흔한 기간은 달력을 열 것도 없이 버튼 하나로 채웁니다. 시각은 «오늘 00:00 부터
   N일 뒤 23:59 까지» — 이벤트는 날짜로 말하지 시각으로 말하지 않습니다. */
/* 로컬 미리보기의 마스터 비밀번호는 프로덕션과 다릅니다 — dev/03-seed.sql 이 «devmaster»
   를 심습니다(진짜 값은 공개 저장소에 둘 수 없습니다). 창에서 알려 주지 않으면 «마스터
   비밀번호가 아닙니다» 만 보고 한참 헤맵니다. */
if (EV_LOCAL) {
  $('#ev-a-pw-hint').innerHTML =
    '로컬 미리보기입니다. 마스터 비밀번호는 <b>devmaster</b> 입니다 (dev/03-seed.sql).';
}

$('#ev-a-quick').addEventListener('click', e => {
  const b = e.target.closest('[data-ev-span]');
  if (!b) return;
  const days = Number(b.dataset.evSpan);
  const now = Date.now();
  /* «오늘부터 1주일» 은 오늘을 포함한 7일입니다 — 마지막 날은 +7 이 아니라 +6.
     시각이 00:00 ~ 23:59 이므로 +7 로 두면 8일이 됩니다. */
  $('#ev-a-start').value = days ? evFillDate(new Date(now)) : '';
  $('#ev-a-end').value = days ? evFillDate(new Date(now + (days - 1) * 864e5)) : '';
  $('#ev-a-startt').value = days ? EV_T0 : '';
  $('#ev-a-endt').value = days ? EV_T1 : '';
  evAddPeriod();
});
for (const id of ['#ev-a-start', '#ev-a-startt', '#ev-a-end', '#ev-a-endt']) {
  // change 만 보면 키보드로 고칠 때 반응이 늦습니다.
  $(id).addEventListener('input', evAddPeriod);
  $(id).addEventListener('change', evAddPeriod);
}

$('#ev-j-img').addEventListener('change', evPreview);
$('#ev-join-form').addEventListener('submit', evJoin);
$('#ev-add-form').addEventListener('submit', evAdd);
$('#ev-del-form').addEventListener('submit', evDelete);
$('#ev-join-cancel').addEventListener('click', () => $('#ev-join').close());
$('#ev-add-cancel').addEventListener('click', () => $('#ev-add').close());
$('#ev-del-cancel').addEventListener('click', () => $('#ev-del').close());

/* ── 첫 화면 공지 ─────────────────────────────────────────────────
   진행중인 이벤트가 있으면 한 번 알려 줍니다. 이벤트 탭은 아홉 개 중 하나라,
   들어온 사람이 알아서 눌러 주기를 기다리면 공지가 되지 않습니다.

   «오늘 하루 안 보기» 는 그 이벤트 하나를 하루 동안 덮습니다. 시간만 저장하면
   그 사이에 «새» 이벤트가 열려도 같이 묻혀 버립니다 — 알리려고 만든 창이 새 소식을
   가리면 안 되므로 이벤트 번호를 함께 둡니다. */
const EV_SEEN_KEY = 'mhnkr.evseen';       // { id, until }
const EV_HIDE_MS = 864e5;                 // 하루

function evNoticeSeen() {
  try { return JSON.parse(localStorage.getItem(EV_SEEN_KEY) || 'null'); } catch (e) { return null; }
}

function evNotice() {
  /* 어느 탭에서 들어오든 뜹니다. 공유 링크로 들어온 사람에게는 띄우지 않았었는데,
     «모든 페이지에서 보여야 한다» 는 요구에 맞춰 걷었습니다.
     이벤트 공유 링크(?ev=)로 들어온 경우만 빼는데, 그건 이미 그 이벤트를 보러 온
     사람이고 evOpenFromUrl 이 그 카드로 데려다 주기 때문입니다. */
  if (new URLSearchParams(location.search).has('ev')) return;
  // 진행중인 것 중 «가장 최근에 등록된» 하나. evSorted 가 진행중을 앞으로 보내고,
  // 그 안에서는 받아온 순서(최신순)가 그대로입니다.
  const r = evSorted().find(x => evState(x) === 'open');
  if (!r) return;

  const seen = evNoticeSeen();
  if (seen && String(seen.id) === String(r.id) && Date.now() < seen.until) return;

  $('#ev-n-title').textContent = r.title;
  $('#ev-n-meta').innerHTML = esc(evPeriod(r)) + evSeats(r, 'open');
  const img = $('#ev-n-img');
  img.hidden = !r.image_url;
  if (r.image_url) img.src = r.image_url; else img.removeAttribute('src');
  $('#ev-n-body').textContent = r.body;
  $('#ev-n-hide').dataset.evId = r.id;
  $('#ev-notice').showModal();
  /* 창을 열면 명세상 안쪽 첫 요소에 포커스가 갑니다 — 여기서는 오른쪽 위 X 입니다.
     닫기 버튼에 테두리가 켜진 채로 열리면 그쪽이 먼저 눈에 띄고, 키보드로 Enter 를
     치면 창이 닫힙니다. 이 창이 바라는 것은 «이벤트 보러 가기» 입니다. */
  $('#ev-n-go').focus();
}

$('#ev-n-go').addEventListener('click', () => {
  $('#ev-notice').close();
  location.hash = '#event';
  /* 맨 위로 직접 올립니다. app.js 는 hashchange 에서 올려 주는데, 창이 «모든 탭»에서
     뜨므로 이미 #event 인 사람은 해시가 안 바뀌어 hashchange 가 안 뜹니다 — 페이지를
     한참 내려 둔 채 눌렀다면 목록 중간에 그대로 남습니다. */
  window.scrollTo(0, 0);
});
// 아래 «닫기» 와 오른쪽 위 X 는 같은 일을 합니다 — 덮어 두지 않고 이번만 닫습니다.
for (const id of ['#ev-n-close', '#ev-n-x']) {
  $(id).addEventListener('click', () => $('#ev-notice').close());
}
$('#ev-n-hide').addEventListener('click', e => {
  localStorage.setItem(EV_SEEN_KEY, JSON.stringify({
    id: e.currentTarget.dataset.evId, until: Date.now() + EV_HIDE_MS,
  }));
  $('#ev-notice').close();
});

/* 어느 탭으로 들어오든 목록을 한 번 받습니다. 공지 창을 띄우려면 «지금 진행중인 것이
   있는지» 를 알아야 하고, 그 판정은 목록 없이는 못 합니다. 같은 목록을 이벤트 탭에서도
   쓰므로 탭을 열 때 다시 받지 않습니다. 탭이 이벤트인 채로 로드됐다면 app.js 의
   showTab 이 이 파일보다 먼저 돌았으므로 여기 evRender 가 첫 그리기입니다.
   ponytail: 목록을 100건까지 받습니다. 공지에는 진행중 한 건이면 충분하니, 이벤트가
   수백 건 쌓여 첫 화면이 무거워지면 limit 를 줄이세요. */
evLoaded = true;
evLoad().then(() => { evOpenFromUrl(); evNotice(); });
