/* 몬스터헌터 나우 한국지부 — 친구 코드 QR 게시판 */

/* ── 설정 ──────────────────────────────────────────────────────────
   Supabase 프로젝트를 만든 뒤 아래 두 값을 채워주세요 (README.md 참고).
   그대로 두면 이 브라우저에만 저장되는 "체험 모드"로 동작합니다.

   키는 publishable(sb_publishable_...) 또는 레거시 anon(eyJ...) 둘 다 됩니다.
   공개용 키이니 커밋해도 되지만, secret/service_role 키는 절대 넣지 마세요. */
const SUPABASE_URL = 'https://frmpcahnrclrzfkaerbw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Oo1GKjPpnWscgER4691eRg_0cydOhwI';

const TABLE = 'friend_codes';
/* 목록은 한 번에 받아오고, 화면에 그리는 개수만 늘립니다.
   체크 여부가 기기 localStorage 에만 있어서 서버는 무엇이 미체크인지 모릅니다.
   서버에서 20개씩 끊어 오면, 앞쪽이 전부 체크된 재방문자는 빈 화면을 받고
   스크롤할 내용이 없어 다음 요청이 걸리지 않습니다.
   300행이라야 40KB 남짓이라 한 번에 받는 편이 요청 수도 적고 무료 플랜에 유리합니다. */
const FETCH = 200;          // 서버에서 한 번에 받아올 개수 (키셋 커서 방식)
const MAX = 1000;           // 한 세션에서 받아올 총 상한
const PAGE = 20;            // 한 번에 더 그리는 개수. PC 5열 기준 4줄
const BUMP_DAYS = 3;        // schema.sql 의 interval '3 days' 와 동일해야 합니다
const NICK_MAX = 20;
const QR_MAX_CSS = 300;     // style.css 의 .qr max-width 와 반드시 같아야 합니다
const QR_PREVIEW_CSS = 114; // style.css 의 .preview img 크기
const PW_MIN = 4;           // schema.sql 의 add_friend_code 검사와 동일해야 합니다

const $ = s => document.querySelector(s);

/* 배경을 눌러 창 닫기. click 만 보면 안 됩니다 — 자동완성 목록처럼 누른 뒤 사라지는
   요소가 있으면, 손을 뗀 자리가 배경이라 click 이 dialog 로 잡혀 안에서 시작한
   클릭에도 창이 닫힙니다. 누르기 시작한 자리까지 배경이어야 닫습니다. */
function closeOnBackdrop(dlg) {
  let from = null;
  dlg.addEventListener('pointerdown', e => { from = e.target; });
  dlg.addEventListener('click', e => { if (e.target === dlg && from === dlg) dlg.close(); });
}
/* 창마다 따로 붙이면 빠뜨립니다 — 실제로 추천빌드 창 4개가 빠져 있었습니다.
   스크립트는 전부 dialog 마크업 뒤에서 로드되므로 여기서 한 번에 겁니다. */
document.querySelectorAll('dialog').forEach(closeOnBackdrop);

/* 모바일에서 창이 열리자마자 입력칸에 포커스가 가면 키보드가 올라와 창의 절반을
   덮습니다. 목록에서 고르러 여는 창(장비 선택·빌드 고르기)은 칠 준비가 필요 없어
   방해만 됩니다. 칸을 채워야 넘어가는 창(등록·삭제 비밀번호)만 그대로 두고,
   나머지는 사용자가 칸을 눌렀을 때 키보드가 올라옵니다.

   showModal 을 한 번 감싸는 것은 브라우저가 스스로 주는 포커스까지 막기 위해서입니다
   — 명세상 창을 열면 안쪽 첫 요소에 포커스가 갑니다. «빌드 고르기» 는 그 첫 요소가
   검색칸이라, .focus() 호출을 지우는 것만으로는 안 걸립니다. 창은 11개고 여는 자리는
   그보다 많아, 부르는 쪽마다 막으면 새 창에서 또 빠뜨립니다. */
const KEEP_FOCUS = new Set(['reg', 'rk-reg', 'rc-add', 'ev-add', 'ev-join',
                            'del', 'rk-del', 'rc-del', 'ev-del']);   // 등록 · 삭제 비밀번호
const noAutoFocus = dlg => matchMedia('(max-width: 640px)').matches && !KEEP_FOCUS.has(dlg && dlg.id);
/* 창을 연 뒤 직접 포커스를 줄 때 씁니다. 어느 창인지는 요소가 들고 있습니다. */
const focusIn = el => { if (!noAutoFocus(el.closest('dialog'))) el.focus(); };
const dlgShowModal = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function (...a) {
  dlgShowModal.apply(this, a);
  const el = document.activeElement;
  if (noAutoFocus(this) && el && this.contains(el) && el.matches('input, textarea, select')) el.blur();
};

/* ── 목록을 조금씩 그리기 ──────────────────────────────────────────
   손안에 있는 배열에서 «화면에 얹는 양»만 나눕니다. 서버를 다시 부르지 않으므로
   왕관·명예의 전당처럼 전체를 봐야 맞는 계산과 «N건» 표시가 그대로 맞습니다.
   서버에서 끊어 받는 것은 다른 이야기입니다 — 친구 코드 탭의 loadChunk 를 보세요.

   일부러 «처음으로 되돌리기»를 두지 않았습니다. 필터를 바꿔도 이미 늘려 둔 만큼
   그리는데, 그건 사용자가 스크롤로 직접 요청한 양이고 최악이라도 지금과 같습니다. */
function makePager(step, redraw) {
  let n = step;
  const io = new IntersectionObserver(
    es => { if (es.some(e => e.isIntersecting)) { n += step; redraw(); } },
    { rootMargin: '600px' });
  return {
    take: rows => rows.slice(0, n),
    /* 마지막 카드가 다가오면 늘립니다. 따로 버튼을 두지 않아 감시 대상이 목록 안에
       있고, 그릴 때마다 마지막이 바뀌므로 다시 겁니다. 다 그렸으면 감시를 끊어
       스스로 멈춥니다. 앞에서부터 자르므로 카드에 박힌 번호(data-i)는 그대로입니다. */
    watch: (list, rows) => {
      io.disconnect();
      if (rows.length > n && list.lastElementChild) io.observe(list.lastElementChild);
    },
  };
}

/* 앱 친구추가 딥링크. 코드는 항상 숫자 12자리로 검증한 뒤에만 넣습니다. */
const addFriendUrl = code => 'mhnow:///ADDFRIEND?FRIEND_ID=' + code;

const isCode = c => typeof c === 'string' && /^[0-9]{12}$/.test(c);
const digits = s => s.replace(/[^0-9]/g, '').slice(0, 12);
const pretty = c => c.replace(/([0-9]{4})(?=[0-9])/g, '$1 ');
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = t => new Date(t).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });

/* 표시 크기(minPx)보다 원본이 항상 크도록 셀 크기를 모듈 수에서 역산합니다.
   원본이 표시 크기보다 작으면 확대되면서 모듈이 뭉개져 스캔이 실패합니다.
   URL 길이가 바뀌면 모듈 수도 바뀌므로 상수로 박아두면 안 됩니다.
   margin은 픽셀 단위 — QR 규격상 여백은 4모듈 이상이어야 안정적으로 읽힙니다. */
const qrURL = (text, minPx) => {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const cell = Math.max(2, Math.ceil(minPx / (q.getModuleCount() + 8)));
  return q.createDataURL(cell, cell * 4);
};

/* ── 저장소 ────────────────────────────────────────────────────── */
/* docker compose 로 띄운 로컬 PostgREST 를 쓰기 위한 갈고리. dev/nginx.conf 가
   index.html 에 window.MHNKR_API 를 끼워 넣습니다. 배포본에는 없으므로 그대로
   Supabase 를 씁니다. 로컬 PostgREST 는 apikey 를 무시하니 키는 아무 값이어도 됩니다. */
const API = (typeof window !== 'undefined' && window.MHNKR_API) || SUPABASE_URL;
const LIVE = API !== SUPABASE_URL
  || (!SUPABASE_URL.includes('YOUR-') && !SUPABASE_KEY.includes('YOUR-'));
const LOCAL_KEY = 'mhnkr.rows';

const rest = (path, opts = {}) => fetch(API + '/rest/v1/' + path, {
  ...opts,
  headers: {
    apikey: SUPABASE_KEY,
    /* Authorization 은 레거시 anon 키(JWT)일 때만 붙입니다.
       신규 publishable 키를 Bearer 로 보내면 JWT 파싱에 실패해 요청이 거부됩니다. */
    ...(SUPABASE_KEY.startsWith('eyJ') ? { Authorization: 'Bearer ' + SUPABASE_KEY } : null),
    'Content-Type': 'application/json',
    ...opts.headers,
  },
});

/* 쓰기는 전부 DB 함수를 거칩니다. 비밀번호 검증을 브라우저에서 하면
   anon 키로 REST DELETE 를 직접 부르는 것만으로 뚫리기 때문입니다.
   pw_hash 는 컬럼 권한으로 막혀 있어 select 로도 못 읽습니다. */
const store = LIVE ? {
  /* 키셋 커서(created_at 미만)로 끊어 옵니다. offset 방식은 끌어올리기로 순서가
     바뀌는 순간 행이 중복되거나 통째로 건너뛰어집니다. */
  async page({ before, limit, q }) {
    // select=* 로 바꾸지 마세요. pw_hash 는 컬럼 권한이 없어 전체 조회가 통째로 거부됩니다.
    /* 검색은 서버에서 겁니다. 받아온 200개 안에서만 걸면 아직 안 받은 코드는 안 잡힙니다.
       encodeURIComponent 는 * 를 남겨두므로 PostgREST 의 와일드카드로 그대로 동작합니다. */
    const path = `${TABLE}?select=nickname,code,created_at&order=created_at.desc&limit=${limit}`
      + (before ? `&created_at=lt.${encodeURIComponent(before)}` : '')
      + (q ? `&nickname=ilike.${encodeURIComponent(`*${q}*`)}` : '');
    const r = await rest(path, { headers: { Prefer: 'count=exact' } });
    if (!r.ok) throw new Error(await r.text());
    // "0-199/1234" 의 뒤쪽이 전체 개수. before 가 걸리면 필터된 개수라 첫 장에서만 씁니다.
    const total = Number((r.headers.get('content-range') || '').split('/')[1]);
    return { rows: await r.json(), total: Number.isFinite(total) ? total : null };
  },
  async add({ nickname, code, password }) {
    const r = await rest('rpc/add_friend_code', {
      method: 'POST',
      body: JSON.stringify({ p_nickname: nickname, p_code: code, p_password: password }),
    });
    if (!r.ok) {
      /* SQLSTATE 를 정확히 봅니다. 본문 전체를 문자열로 훑으면 details 안에 실린
         입력값 때문에 오판합니다 (예: 코드 123505123456 의 제약 위반이 중복으로 보임). */
      const e = await r.json().catch(() => ({}));
      throw new Error(e.code === '23505' ? 'DUP' : (e.message || `HTTP ${r.status}`));
    }
    return { nickname, code, created_at: new Date().toISOString() };
  },
  async remove(code, password) {
    const r = await rest('rpc/delete_friend_code', {
      method: 'POST',
      body: JSON.stringify({ p_code: code, p_password: password }),
    });
    if (!r.ok) throw new Error(await r.text());
    return await r.json() === true;      // 비밀번호 불일치·없는 코드 모두 false
  },
  async bump(code, password) {
    const r = await rest('rpc/bump_friend_code', {
      method: 'POST',
      body: JSON.stringify({ p_code: code, p_password: password }),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();                     // { ok } | { ok:false, reason, next_at? }
  },
} : {
  _all() {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]')
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  },
  _save(rows) { localStorage.setItem(LOCAL_KEY, JSON.stringify(rows)); },
  async page({ before, limit, q }) {
    let all = this._all();
    if (q) {
      const s = q.toLowerCase();
      all = all.filter(r => String(r.nickname).toLowerCase().includes(s));
    }
    const from = before ? all.findIndex(r => String(r.created_at) < before) : 0;
    return { rows: from < 0 ? [] : all.slice(from, from + limit), total: all.length };
  },
  async add({ nickname, code, password }) {
    const all = this._all();
    if (all.some(r => r.code === code)) throw new Error('DUP');
    // 체험 모드는 이 브라우저 안에서만 도는 더미 데이터라 비밀번호를 그대로 둡니다.
    const saved = { nickname, code, password, created_at: new Date().toISOString() };
    this._save([saved, ...all].slice(0, MAX));
    return saved;
  },
  async remove(code, password) {
    const all = this._all();
    const keep = all.filter(r => !(r.code === code && r.password === password));
    this._save(keep);
    return keep.length < all.length;
  },
  async bump(code, password) {
    const all = this._all();
    const row = all.find(r => r.code === code && r.password === password);
    if (!row) return { ok: false, reason: 'BAD_PASSWORD' };
    const next = new Date(row.created_at).getTime() + BUMP_DAYS * 864e5;
    if (Date.now() < next) return { ok: false, reason: 'TOO_SOON', next_at: new Date(next).toISOString() };
    row.created_at = new Date().toISOString();
    this._save(all);
    return { ok: true };
  },
};

/* ── 내 기기에만 남는 상태 ─────────────────────────────────────── */
const checked = new Set(JSON.parse(localStorage.getItem('mhnkr.checked') || '[]'));
const saveChecked = () => localStorage.setItem('mhnkr.checked', JSON.stringify([...checked]));
let autoCheck = localStorage.getItem('mhnkr.auto') !== '0';

/* ── 토스트 ────────────────────────────────────────────────────── */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
}

/* ── 카드 ──────────────────────────────────────────────────────── */
const COPY_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M18 6l-1 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 6"/></svg>';
const BUMP_ICON  = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16M12 21V9M6.5 14.5 12 9l5.5 5.5"/></svg>';

const BUMP_MS = BUMP_DAYS * 864e5;
const bumpAt = row => new Date(row.created_at).getTime() + BUMP_MS;
/* 남은 시간을 사람이 읽는 형태로. 서버가 최종 판정이고 이건 안내용입니다. */
function untilBump(row) {
  const ms = bumpAt(row) - Date.now();
  if (ms <= 0) return null;
  const h = Math.ceil(ms / 36e5);
  return h >= 24 ? `${Math.ceil(h / 24)}일` : `${h}시간`;
}

/* QR 인코딩은 카드당 ~15ms. 화면에 들어올 때 만들되(전부 미리 만들면 수 초가 멈춤),
   생성 자체는 유휴 시간에 넘깁니다. 빠르게 스크롤하면 한 프레임에 여러 장이 몰려
   프레임이 300ms 넘게 멈추기 때문입니다. */
const idle = window.requestIdleCallback ? window.requestIdleCallback.bind(window) : (fn => setTimeout(fn, 1));

const qrLazy = new IntersectionObserver((entries, obs) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    obs.unobserve(en.target);
    const img = en.target;
    idle(() => { if (img.isConnected) img.src = qrURL(img.dataset.url, QR_MAX_CSS); });
  }
}, { rootMargin: '500px' });

function cardEl(row) {
  const url = addFriendUrl(row.code);
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.code = row.code;
  el.innerHTML = `
    <button class="qr" data-act="check" aria-label="체크 전환" title="탭하면 체크됩니다">
      <img width="212" height="212" data-url="${url}" alt="${esc(row.nickname)} 친구 추가 QR">
      <span class="tap">탭하면 체크</span>
    </button>
    <p class="nick">${esc(row.nickname)}</p>
    <div class="code-row">
      <span class="num">${pretty(row.code)}</span>
      <button class="icon danger" data-act="del" aria-label="친구 코드 삭제" title="삭제 (비밀번호 필요)">${TRASH_ICON}</button>
      <button class="icon bump" data-act="bump" aria-label="끌어올리기">${BUMP_ICON}</button>
      <button class="icon" data-act="copy" aria-label="친구 코드 복사" title="복사">${COPY_ICON}</button>
    </div>
    <!-- mhnow:// 는 앱이 가로채는 커스텀 스킴입니다. target=_blank 를 쓰면
         앱으로 넘어간 뒤 빈 탭이 남으므로 현재 탭에서 그대로 엽니다. -->
    <a class="btn ghost open" data-act="open" href="${url}">앱에서 등록</a>
    <time datetime="${esc(String(row.created_at))}">${when(row.created_at)}</time>
    <button class="del" data-act="del">삭제</button>`;
  qrLazy.observe(el.querySelector('.qr img'));
  return el;
}

/* ── 렌더 ──────────────────────────────────────────────────────── */
let rows = [];        // 서버에서 받아온 전체
let filtered = [];    // 필터를 통과한 것
let pageSize = PAGE;  // 그중 지금 그려둔 개수
const cards = new Map();

function render() {
  const grid = $('#grid');
  const filter = activeFilter();

  /* 필터를 먼저 걸고 나서 잘라야 합니다. 자르고 필터를 걸면 앞쪽이 전부
     체크된 사람은 20칸이 통째로 비어 아무것도 못 봅니다. */
  filtered = rows.filter(r => filter === 'all' || (filter === 'checked') === checked.has(r.code));
  const page = filtered.slice(0, pageSize);
  const live = new Set(page.map(r => r.code));

  // 페이지 밖으로 밀려났거나 남이 지운 카드는 DOM 에서 걷어냅니다.
  for (const [code, el] of cards) {
    if (!live.has(code)) { el.remove(); cards.delete(code); }
  }

  let prev = null;
  for (const row of page) {
    let el = cards.get(row.code);
    if (!el) {                                   // QR 생성은 카드당 딱 한 번
      el = cardEl(row);
      cards.set(row.code, el);
    }
    /* 끌어올리기로 순서가 바뀌므로 기존 카드도 자리를 다시 잡습니다.
       이미 제자리면 건드리지 않습니다(불필요한 DOM 이동 방지). */
    const want = prev ? prev.nextElementSibling : grid.firstElementChild;
    if (el !== want) prev ? prev.after(el) : grid.prepend(el);
    prev = el;

    el.classList.toggle('done', checked.has(row.code));

    // 끌어올리기 후 갱신된 등록일과 남은 시간을 캐시된 카드에도 반영합니다.
    const time = el.querySelector('time');
    if (time.dateTime !== String(row.created_at)) {
      time.dateTime = String(row.created_at);
      time.textContent = when(row.created_at);
    }
    const left = untilBump(row);
    const bump = el.querySelector('.icon.bump');
    bump.classList.toggle('wait', !!left);
    bump.title = left ? `${left} 뒤에 끌어올릴 수 있습니다` : '끌어올리기 (비밀번호 필요)';
  }

  const done = rows.filter(r => checked.has(r.code)).length;
  const shownTxt = page.length < filtered.length ? `${page.length}/${filtered.length}명 표시` : `${page.length}명 표시`;
  $('#count').textContent = query
    ? `'${query}' 검색 ${total ?? rows.length}명 · ${shownTxt}`
    : `${shownTxt} · 전체 ${total ?? rows.length}명 · 체크 ${done}명`;

  const more = $('#more');
  const rest = filtered.length - page.length;
  more.hidden = rest <= 0 && exhausted;
  more.textContent = rest > 0 ? `${rest}명 더 보기` : '더 불러오기';

  const state = $('#state');
  state.hidden = page.length > 0;
  if (!page.length) {
    state.textContent = query
      ? (rows.length
          // 검색은 걸렸는데 필터가 가린 경우. 왜 0건인지 알려줍니다.
          ? `'${query}' 검색 결과 ${rows.length}명이 있지만 '${$('#filter').selectedOptions[0].text}' 에 해당하지 않습니다. 보기를 '전체'로 바꿔보세요.`
          : `'${query}' 와 일치하는 닉네임이 없습니다.`)
      : rows.length === 0
        ? '아직 등록된 친구 코드가 없습니다. 첫 번째로 등록해 보세요!'
        : filter === 'unchecked'
          ? '모든 친구 코드를 등록하셨습니다. 새 코드가 올라오면 여기에 표시됩니다.'
          : '해당하는 친구 코드가 없습니다.';
  }
}

/* ── 받아오기 (서버 200개씩, 화면 20개씩) ──────────────────────── */
const valid = r => isCode(r.code) && typeof r.nickname === 'string' && r.nickname.trim();

let cursor = null;      // 마지막으로 받아온 created_at (키셋 커서)
let exhausted = false;  // 서버에 더 없음
let total = null;       // 서버가 알려준 전체 개수
let loading = null;
let query = '';         // 닉네임 검색어 (서버에서 ilike 로 거릅니다)

async function loadChunk() {
  if (exhausted || rows.length >= MAX) { exhausted = true; return; }
  const { rows: got, total: t } = await store.page({ before: cursor, limit: FETCH, q: query });
  if (cursor === null && t != null) total = t;
  const have = new Set(rows.map(r => r.code));
  rows.push(...got.filter(valid).filter(r => !have.has(r.code)));
  if (got.length) cursor = got[got.length - 1].created_at;
  if (got.length < FETCH || rows.length >= MAX) exhausted = true;
}

/* 검색 중에도 선택한 필터를 그대로 적용합니다. 이미 체크한 사람을 이름으로 찾으면
   '미체크만' 상태에서는 0건이 되므로, 그때는 안내 문구로 이유를 알려줍니다. */
const activeFilter = () => $('#filter').value;

const countFiltered = () => {
  const f = activeFilter();
  return rows.reduce((n, r) => n + (f === 'all' || (f === 'checked') === checked.has(r.code) ? 1 : 0), 0);
};

/* 그릴 게 n개 모일 때까지 서버에서 끌어옵니다. 앞쪽이 전부 체크된 사람은
   200개를 받아도 화면에 0개일 수 있어, 여기서 멈추면 스크롤할 내용이 없어
   다음 요청이 영영 안 걸립니다. */
async function ensure(n) {
  while (countFiltered() < n && !exhausted) await loadChunk();
}

/* 더 그리기. 화면이 아직 안 찼으면 찰 때까지 이어서 늘립니다
   (관찰 대상이 계속 보이는 상태면 IntersectionObserver 가 다시 안 울립니다). */
async function showMore() {
  if (loading) return loading;
  loading = (async () => {
    await ensure(pageSize + PAGE);
    /* 여기서 일찍 빠져나가면 안 됩니다. filtered 는 render() 안에서만 다시 계산되므로
       방금 ensure() 가 받아온 행이 반영되기 전 값이고, 그걸 보고 건너뛰면 받아온 행이
       영영 안 그려집니다. 게다가 #more 의 hidden 도 render() 에서만 갱신되어 버튼이
       남고, 아래 rAF 가 매 프레임 자신을 다시 부릅니다. */
    pageSize += PAGE;
    render();
  })().catch(err => { console.error(err); toast('더 불러오지 못했습니다'); })
      .finally(() => { loading = null; });
  await loading;
  requestAnimationFrame(() => {
    if (!$('#more').hidden && $('#more').getBoundingClientRect().top < innerHeight) showMore();
  });
}

$('#more').addEventListener('click', showMore);
new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) showMore(); }, { rootMargin: '600px' })
  .observe($('#more'));

function setChecked(code, on) {
  on ? checked.add(code) : checked.delete(code);
  saveChecked();
  render();
}

/* ── 이벤트 ────────────────────────────────────────────────────── */
/* 이미지를 끌면 반투명 유령 이미지가 따라옵니다. QR·아이콘을 살짝 밀기만 해도 튀어나와
   길게 누르기나 스크롤을 방해하므로 전부 막습니다. CSS 의 -webkit-user-drag 는
   파이어폭스에서 안 먹고, 이 한 줄이면 새로 그려지는 이미지까지 같이 걸립니다. */
document.addEventListener('dragstart', e => { if (e.target.tagName === 'IMG') e.preventDefault(); });

/* 좁은 화면의 햄버거 메뉴. 토글을 누르면 열고 닫고, 그 밖의 어디를 눌러도 닫힙니다 —
   탭을 고른 뒤 저절로 닫히는 동작과 바깥 클릭 닫기가 이 한 줄로 같이 처리됩니다. */
document.addEventListener('click', e => {
  const open = !!e.target.closest('#nav-toggle') && !document.body.classList.contains('nav-open');
  document.body.classList.toggle('nav-open', open);
  $('#nav-toggle').setAttribute('aria-expanded', open);
});

/* 길게 누르기 / 우클릭 → 삭제 버튼 노출 ─────────────────────────── */
const disarm = () => document.querySelectorAll('.card.armed').forEach(c => c.classList.remove('armed'));
function arm(card) { disarm(); card.classList.add('armed'); }

let press = null;         // 길게 누르는 중인 카드
let swallowClick = false; // 길게 누른 뒤 따라오는 click 이 체크를 토글하지 않도록

$('#grid').addEventListener('pointerdown', e => {
  /* 삼킬 click 은 반드시 이 pointerdown 을 앞세웁니다. 여기서 풀어야, 길게 누른 뒤
     click 이 아예 오지 않는 경우(손가락으로 밀어 스크롤하고 떼기, 안드로이드 롱프레스)
     표시가 켜진 채 남아 다음 탭 한 번을 통째로 먹는 일이 없습니다. */
  swallowClick = false;
  const card = e.target.closest('.card');
  if (!card || e.button === 2) return;
  press = { x: e.clientX, y: e.clientY, t: setTimeout(() => { press = null; swallowClick = true; arm(card); }, 550) };
});
$('#grid').addEventListener('pointermove', e => {
  // 스크롤이나 손떨림으로 취소되지 않도록 10px 여유를 둡니다.
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) { clearTimeout(press.t); press = null; }
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
  $('#grid').addEventListener(ev, () => { if (press) { clearTimeout(press.t); press = null; } });
}
$('#grid').addEventListener('contextmenu', e => {
  const card = e.target.closest('.card');
  if (!card) return;
  e.preventDefault();
  arm(card);
});
// 카드 밖을 누르면 해제. capture 로 먼저 돌지만 armed 카드 내부 클릭은 살려둡니다.
document.addEventListener('click', e => { if (!e.target.closest('.card.armed')) disarm(); }, true);

$('#grid').addEventListener('click', e => {
  if (swallowClick) { swallowClick = false; return; }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const code = btn.closest('.card').dataset.code;

  if (btn.dataset.act === 'del') {
    askPassword('del', code);
  } else if (btn.dataset.act === 'bump') {
    // 아직 3일이 안 됐으면 비밀번호를 묻지 않고 남은 시간만 알려줍니다.
    const left = untilBump(rows.find(r => r.code === code) || {});
    left ? toast(`${left} 뒤에 끌어올릴 수 있습니다`) : askPassword('bump', code);
  } else if (btn.dataset.act === 'check') {
    const on = !checked.has(code);
    setChecked(code, on);
    toast(on ? '체크했습니다' : '체크를 해제했습니다');
  } else if (btn.dataset.act === 'copy') {
    navigator.clipboard.writeText(code)
      .then(() => toast('친구 코드를 복사했습니다'))
      .catch(() => toast('복사에 실패했습니다. 코드를 길게 눌러 복사해 주세요'));
  } else if (btn.dataset.act === 'open' && autoCheck && !checked.has(code)) {
    setChecked(code, true);                      // 링크는 그대로 열리게 둡니다
    toast('앱에서 등록 후 자동 체크됨');
  }
});

$('#filter').addEventListener('change', () => { pageSize = PAGE; window.scrollTo(0, 0); render(); });

$('#auto-check').addEventListener('change', e => {
  autoCheck = e.target.checked;
  localStorage.setItem('mhnkr.auto', autoCheck ? '1' : '0');
});

/* ── 등록 ──────────────────────────────────────────────────────── */
const reg = $('#reg');
const fCode = $('#f-code');
const fErr = $('#f-err');

$('#open-reg').addEventListener('click', () => { fErr.hidden = true; reg.showModal(); focusIn($('#f-nick')); });
$('#reg-cancel').addEventListener('click', () => reg.close());

fCode.addEventListener('input', () => {
  const raw = digits(fCode.value);
  fCode.value = pretty(raw);
  const img = $('#f-qr');
  if (isCode(raw)) {
    img.src = qrURL(addFriendUrl(raw), QR_PREVIEW_CSS);
    $('#f-hint').innerHTML = 'QR이 준비되었습니다. <b>등록하기</b>를 눌러주세요.';
  } else {
    img.removeAttribute('src');
    $('#f-hint').innerHTML = `길드카드의 <b>내 친구 코드</b> 12자리를 입력하면 QR이 만들어집니다. (${raw.length}/12)`;
  }
});

$('#reg-form').addEventListener('submit', async e => {
  e.preventDefault();
  const nickname = $('#f-nick').value.trim().replace(/\s+/g, ' ');
  const code = digits(fCode.value);
  const password = $('#f-pw').value;

  const bad = !nickname ? '닉네임을 입력해 주세요.'
    : nickname.length > NICK_MAX ? `닉네임은 ${NICK_MAX}자 이내로 입력해 주세요.`
    : !isCode(code) ? '친구 코드는 숫자 12자리입니다.'
    : password.length < PW_MIN ? `삭제용 비밀번호는 ${PW_MIN}자 이상 입력해 주세요.`
    : null;
  if (bad) { fErr.textContent = bad; fErr.hidden = false; return; }

  const submit = $('#reg-submit');
  submit.disabled = true;
  fErr.hidden = true;
  try {
    const saved = await store.add({ nickname, code, password });
    rows.unshift(saved || { nickname, code, created_at: new Date().toISOString() });
    /* total 은 서버가 준 전체 개수라 아직 안 받아온 행까지 셉니다. 같이 늘리지 않으면
       «10명 표시 · 전체 9명» 처럼 표시수가 전체수를 넘어섭니다. */
    if (total != null) total++;
    render();
    reg.close();
    $('#reg-form').reset();
    $('#f-qr').removeAttribute('src');
    toast('등록되었습니다!');
    if (location.hash !== '#codes') location.hash = '#codes';
  } catch (err) {
    fErr.textContent = err.message === 'DUP'
      ? '이미 등록된 친구 코드입니다.'
      : '등록에 실패했습니다. 잠시 후 다시 시도해 주세요.';
    fErr.hidden = false;
    if (err.message !== 'DUP') console.error(err);
  } finally {
    submit.disabled = false;
  }
});

/* ── 삭제 / 끌어올리기 (같은 비밀번호 확인 창을 씁니다) ────────── */
const del = $('#del');
const dErr = $('#d-err');
let pending = null;      // { mode, code }

function askPassword(mode, code) {
  pending = { mode, code };
  const bump = mode === 'bump';
  $('#d-title').textContent = bump ? '친구 코드 끌어올리기' : '친구 코드 삭제';
  $('#d-what').textContent = bump
    ? '등록할 때 정한 비밀번호를 입력하면 목록 맨 위로 올라갑니다.'
    : '등록할 때 정한 비밀번호를 입력하세요. 삭제하면 되돌릴 수 없습니다.';
  $('#d-code').textContent = pretty(code);
  const sub = $('#del-submit');
  sub.textContent = bump ? '끌어올리기' : '삭제하기';
  sub.classList.toggle('danger', !bump);
  sub.classList.toggle('primary', bump);
  $('#d-pw').value = '';
  dErr.hidden = true;
  del.showModal();
  focusIn($('#d-pw'));
}

$('#del-cancel').addEventListener('click', () => del.close());

const fail = msg => { dErr.textContent = msg; dErr.hidden = false; };

$('#del-form').addEventListener('submit', async e => {
  e.preventDefault();
  const password = $('#d-pw').value;
  if (!password) return fail('비밀번호를 입력해 주세요.');

  const btn = $('#del-submit');
  btn.disabled = true;
  dErr.hidden = true;
  try {
    if (pending.mode === 'bump') {
      const res = await store.bump(pending.code, password);
      if (!res.ok) {
        return fail(res.reason === 'TOO_SOON'
          ? `아직 끌어올릴 수 없습니다. ${BUMP_DAYS}일에 한 번만 가능합니다.`
          : '비밀번호가 일치하지 않습니다.');
      }
      del.close();
      disarm();
      await refresh();          // 맨 위로 올라간 순서를 서버 기준으로 다시 받습니다
      window.scrollTo(0, 0);
      toast('맨 위로 끌어올렸습니다');
      return;
    }

    /* 삭제는 서버가 참/거짓만 돌려줍니다. 비밀번호가 틀렸는지 코드가 없는지
       구분해 주지 않으므로 목록에 없는 코드를 캐낼 수 없습니다. */
    if (!await store.remove(pending.code, password)) return fail('비밀번호가 일치하지 않습니다.');
    rows = rows.filter(r => r.code !== pending.code);
    if (total != null) total--;
    cards.get(pending.code)?.remove();
    cards.delete(pending.code);
    checked.delete(pending.code);
    saveChecked();
    disarm();
    render();
    del.close();
    toast('삭제되었습니다');
  } catch (err) {
    console.error(err);
    fail(pending.mode === 'bump'
      ? '끌어올리기에 실패했습니다. 잠시 후 다시 시도해 주세요.'
      : '삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  } finally {
    btn.disabled = false;
  }
});

/* ── 목록 새로고침 ─────────────────────────────────────────────── */
let refreshing = null;

/* 친구 코드 탭에 들어올 때마다 처음부터 다시 받습니다. 끌어올리기로 순서가
   바뀌기 때문에 이어받기는 의미가 없습니다. 동시 호출은 하나로 합칩니다. */
function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const before = new Set(rows.map(r => r.code));
    const keep = { rows, cursor, exhausted, total };
    rows = []; cursor = null; exhausted = false; pageSize = PAGE;
    try {
      await ensure(pageSize);
    } catch (err) {
      // 통신 실패로 이미 보고 있던 목록을 날리지 않습니다.
      ({ rows, cursor, exhausted, total } = keep);
      throw err;
    }
    render();
    const added = rows.filter(r => !before.has(r.code)).length;
    if (added && before.size) toast(`새 친구 코드 ${added}개`);
  })()
    .catch(err => {
      console.error(err);
      if (rows.length) return toast('새로고침에 실패했습니다');
      $('#state').hidden = false;
      $('#state').textContent = '목록을 불러오지 못했습니다. 새로고침해 주세요.';
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

/* ── 닉네임 검색 ───────────────────────────────────────────────── */
let qSeq = 0;
let qChain = Promise.resolve();
let qTimer;

async function doSearch(q) {
  query = q;
  rows = []; cursor = null; exhausted = false; total = null; pageSize = PAGE;
  cards.forEach(el => el.remove());
  cards.clear();
  $('#more').hidden = true;
  $('#state').hidden = false;
  $('#state').textContent = q ? '검색 중…' : '불러오는 중…';
  try {
    await ensure(pageSize);
  } catch (err) {
    console.error(err);
    toast('검색에 실패했습니다');
  }
  render();
  window.scrollTo(0, 0);
}

/* 입력이 겹쳐도 순서가 꼬이지 않도록 직렬화하고, 낡은 검색은 건너뜁니다.
   rows/cursor 를 공유하기 때문에 동시에 돌면 목록이 섞입니다. */
function search(q) {
  const mine = ++qSeq;
  qChain = qChain.then(() => (mine === qSeq ? doSearch(q) : undefined));
  return qChain;
}

$('#q').addEventListener('input', e => {
  const q = e.target.value.trim();
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { if (q !== query) search(q); }, 300);
});

/* ── 표류연성 ──────────────────────────────────────────────────── */
/* 데이터는 smelt-data.js 의 SMELT. 설명 펼치기는 <details> 로 처리해 JS 가 필요 없습니다. */
let smeltDrawn = false;

function drawSmelt() {
  if (smeltDrawn || typeof SMELT === 'undefined') return;
  smeltDrawn = true;

  /* 레벨별 설명은 표로. 레벨이 하나뿐이면 표가 과해서 문장만 보여줍니다. */
  const body = s => {
    if (!s.levels) return '<p class="one">레벨별 정보를 확인하지 못했습니다.</p>';
    if (s.levels.length === 1) return `<p class="one">${esc(s.levels[0][1])}</p>`;
    return `<table><thead><tr><th>Lv</th><th>효과</th></tr></thead><tbody>${
      s.levels.map(([lv, d]) => `<tr><td>${esc(lv)}</td><td>${esc(d)}</td></tr>`).join('')
    }</tbody></table>`;
  };

  const card = g => `
    <article class="stone" style="--c:${g.color}">
      <h3>
        <img class="sicon" src="assets/stone/${esc(g.icon)}.png" width="26" height="26" alt="" loading="lazy">
        ${esc(g.group)}<i>${esc(g.en)}</i>
        ${g.monsters.length ? `<button class="monbtn" data-mon="${esc(g.group)}">몬스터 ${g.monsters.length}</button>` : ''}
      </h3>
      <p class="stone-label">${esc(g.label)}</p>
      <div class="sk">${g.skills.map(s => `
        <details${s.levels ? '' : ' class="nodesc"'}>
          <summary>
            <span class="star">${s.star ? '★' : ''}</span>
            <span class="n">${esc(s.name)}</span>
            ${s.levels && s.levels.length > 1 ? `<span class="lvmax">Lv${s.levels.length}</span>` : ''}
            <span class="r">${esc(s.rate)}</span>
          </summary>
          <div class="lv">${body(s)}</div>
        </details>`).join('')}</div>
      ${g.monsters.length ? `
        <p class="stone-label">드롭 몬스터 <i>${g.monsters.length}</i></p>
        <div class="mons">${g.monsters.map(m => `
          <img src="assets/monster/${esc(m.key)}.png" width="34" height="34" loading="lazy"
               alt="${esc(m.name)}" title="${esc(m.name)}">`).join('')}</div>` : ''}
    </article>`;

  $('#stones-color').innerHTML = SMELT.groups.filter(g => !g.mystery).map(card).join('');
  $('#stones-mystery').innerHTML = SMELT.groups.filter(g => g.mystery).map(card).join('');
}

/* 드롭 몬스터 모달 — 아이콘만으로는 누가 누군지 몰라서 이름을 붙여 한눈에 보여줍니다. */
const monDlg = $('#mon');

$('#panel-smelt').addEventListener('click', e => {
  const btn = e.target.closest('.monbtn');
  if (!btn) return;
  const g = SMELT.groups.find(x => x.group === btn.dataset.mon);
  if (!g) return;
  $('#mon-title').innerHTML =
    `<img src="assets/stone/${esc(g.icon)}.png" width="24" height="24" alt="">`
    + `표류석【${esc(g.group)}】<i>드롭 몬스터 ${g.monsters.length}</i>`;
  $('#mon-list').innerHTML = g.monsters.map(m => `
    <li>
      <img src="assets/monster/${esc(m.key)}.png" width="40" height="40" alt="" loading="lazy">
      <span>${esc(m.name)}</span>
    </li>`).join('');
  monDlg.style.setProperty('--c', g.color);
  monDlg.showModal();
});

$('#mon-close').addEventListener('click', () => monDlg.close());

/* ── 닉네임 자동완성 (추천빌드 · 리더보드 등록창 공용) ──────────────
   친구 코드에 등록해 둔 닉네임을 그대로 씁니다. 같은 사람이 탭마다 다른 이름을 쓰면
   누가 올린 기록·빌드인지 알아보기 어렵습니다.
   <datalist> 는 위치도 너비도 브라우저가 정해 버려 입력칸과 어긋나 보이고, 포커스만 해도
   목록 전체를 쏟아냅니다. 그래서 직접 그립니다 — 대신 키보드 조작(↑↓ Enter Esc)도 직접 합니다.

   필요한 마크업:
     <div class="rc-ac">
       <input id="…" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="…-list">
       <ul class="rc-ac-list" id="…-list" role="listbox" hidden></ul>
     </div>
     <small id="…-hint" hidden>친구 코드에 등록된 닉네임입니다.</small>

   opt 로 닉네임 말고 다른 것도 채울 수 있습니다(빌드 탭 스킬 검색이 씁니다).
     list(q) → 후보 배열. 주면 서버 대신 이걸 씁니다. 손안에 있으니 기다리지 않고 곧바로 그립니다.
     pick(v) → 골랐을 때. hintSel 은 null 이면 없는 대로 둡니다.                    */
function nickAuto(inputSel, listSel, hintSel, opt = {}) {
  const inp = $(inputSel), box = $(listSel), hint = hintSel ? $(hintSel) : null;
  /* 배포 직후 10분은 옛 index.html 과 새 스크립트가 섞일 수 있습니다(위 캐시 주석).
     그때 목록 요소가 없으면 여기서 던져, 뒤에 오는 최상위 문장이 통째로 등록되지
     않습니다 — 모달을 열고도 닫지 못하게 됩니다. */
  if (!inp || !box) return;
  let timer, items = [], at = -1;

  const close = () => { box.hidden = true; inp.setAttribute('aria-expanded', 'false'); at = -1; };
  const show = list => {
    items = list;
    if (!list.length) return close();
    box.innerHTML = list.map((n, i) =>
      `<li role="option" data-i="${i}" aria-selected="${i === at}">${esc(n)}</li>`).join('');
    box.hidden = false;
    inp.setAttribute('aria-expanded', 'true');
  };
  const pick = i => {
    if (!items[i]) return;
    inp.value = items[i];
    if (hint) hint.hidden = false;
    close();
    if (opt.pick) opt.pick(items[i]);
  };
  const move = d => {
    if (box.hidden || !items.length) return;
    /* at 이 -1 이면 «아직 아무것도 안 골랐다» 는 뜻이라 그대로 셈에 넣으면 안 됩니다.
       ↑ 를 처음 누를 때 마지막이 아니라 끝에서 두 번째로 가 버립니다. */
    at = at < 0 ? (d > 0 ? 0 : items.length - 1) : (at + d + items.length) % items.length;
    for (const li of box.children) {
      const on = +li.dataset.i === at;
      li.setAttribute('aria-selected', on);
      li.classList.toggle('on', on);
      if (on) li.scrollIntoView({ block: 'nearest' });
    }
  };

  inp.addEventListener('input', () => {
    clearTimeout(timer);
    const q = inp.value.trim();
    if (hint) hint.hidden = true;
    at = -1;
    if (!q) return close();
    /* 손안의 목록은 기다릴 이유가 없습니다. 한 글자마다 곧바로 그립니다. */
    if (opt.list) return show(opt.list(q));
    /* 글자마다 부르면 요청이 쏟아집니다. 손을 멈춘 뒤에 한 번만 묻습니다. */
    timer = setTimeout(async () => {
      try {
        const r = await rest(`${TABLE}?select=nickname&nickname=ilike.${encodeURIComponent('*' + q + '*')}&limit=40`);
        if (!r.ok) return;
        /* 한 사람이 코드를 여러 개 올렸을 수 있어 같은 이름은 하나로 접습니다. */
        const seen = [];
        for (const row of await r.json()) {
          const n = String(row.nickname || '').trim();
          if (n && !seen.includes(n)) seen.push(n);
          if (seen.length >= 8) break;
        }
        if (inp.value.trim() !== q) return;        // 그새 더 쳤으면 버립니다
        show(seen);
        if (hint) hint.hidden = !seen.includes(q);
      } catch (e) { /* 자동완성은 없어도 등록에 지장이 없습니다 */ }
    }, 250);
  });

  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Escape') {
      /* 목록이 열려 있으면 Esc 는 목록만 닫습니다. preventDefault 가 없으면
         브라우저가 dialog 까지 닫아 버려 입력하던 내용이 사라집니다. */
      if (!box.hidden) { e.preventDefault(); e.stopPropagation(); close(); }
    } else if (e.key === 'Enter' && at >= 0 && !box.hidden) {
      e.preventDefault();                          // 고르는 중에는 제출하지 않습니다
      pick(at);
    }
  });
  /* 마우스는 pointerdown 에서 골라야 합니다. click 은 blur 뒤에 와서 목록이 이미 닫힙니다.
     손가락은 여기서 잡으면 닿자마자 골라져 목록을 훑어 내릴 수 없습니다. 그래서 뗄 때
     고릅니다 — 훑어 내리기 시작하면 브라우저가 화면 넘기기를 가져가며 pointercancel 을
     보내므로, 훑는 도중에 골라지지 않습니다. */
  let onBox = false;
  box.addEventListener('pointerdown', e => {
    /* 마우스는 바로 아래에서 고르고 닫으므로 이 표시가 필요 없습니다. 켜 두면 목록이
       사라진 자리로 pointerup 이 안 와서 표시가 켜진 채 굳고, 그 뒤로 blur 가 목록을
       영영 닫지 못합니다. */
    onBox = e.pointerType !== 'mouse';
    if (e.pointerType !== 'mouse') return;
    const li = e.target.closest('[data-i]');
    if (!li) return;
    e.preventDefault();
    pick(+li.dataset.i);
  });
  box.addEventListener('pointerup', e => {
    onBox = false;
    if (e.pointerType === 'mouse') return;
    const li = e.target.closest('[data-i]');
    if (li) pick(+li.dataset.i);
  });
  box.addEventListener('pointercancel', () => { onBox = false; });
  /* 손가락으로 고르면 목록이 그 자리에서 사라져, 브라우저가 같은 좌표를 다시 짚어
     밑에 깔린 버튼으로 click 을 흘려보냅니다(몬스터 고르는 창이 겹쳐 열리거나 칩이
     같이 켜집니다). pointerup 을 막는 것으로는 안 되고 touchend 를 막아야 합니다. */
  box.addEventListener('touchend', e => {
    if (e.target.closest('[data-i]')) e.preventDefault();
  }, { passive: false });
  /* 손가락이 목록에 닿으면 입력칸이 초점을 잃습니다. 그대로 닫으면 훑는 도중에
     목록이 사라지므로, 손이 목록에 있는 동안은 닫지 않습니다. */
  inp.addEventListener('blur', () => setTimeout(() => { if (!onBox) close(); }, 120));
}

/* 마지막에 쓴 닉네임. 등록창을 열 때 미리 채워 두면 매번 다시 치지 않아도 됩니다. */
const NICK_KEY = 'mhnkr.nick';
const lastNick = () => localStorage.getItem(NICK_KEY) || '';
const saveNick = n => localStorage.setItem(NICK_KEY, n);

/* ── 탭 ────────────────────────────────────────────────────────── */
function showTab() {
  const h = location.hash.slice(1);
  const tab = ['codes', 'smelt', 'build', 'material', 'record', 'rank', 'recommend', 'event'].includes(h) ? h : 'notice';
  for (const t of ['notice', 'codes', 'smelt', 'build', 'material', 'record', 'rank', 'recommend', 'event']) $('#panel-' + t).hidden = tab !== t;
  if (tab === 'smelt') drawSmelt();
  // build.js 는 app.js 의 $ / esc / toast 를 쓰므로 뒤에 로드됩니다.
  // 첫 호출 시점에는 아직 없을 수 있어 확인 후 부릅니다(로드 직후 스스로 한 번 그립니다).
  if (tab === 'build' && typeof drawBuild === 'function') drawBuild();
  if (tab === 'material') drawMaterial();
  if (tab === 'record') drawRecord();
  if (tab === 'rank') drawRank();          // 리더보드와 같은 목록을 record.js 가 같이 그립니다
  if (tab === 'recommend' && typeof drawRecommend === 'function') drawRecommend();
  if (tab === 'event' && typeof drawEvent === 'function') drawEvent();
  for (const a of document.querySelectorAll('.tabs a')) {
    a.toggleAttribute('aria-current', a.dataset.tab === tab);
  }
  if (tab === 'codes') refresh();
  /* 탭은 해시만 바꾸므로 공유 링크로 들어왔을 때 ?build= · ?rec= 가 다른 탭까지 따라옵니다.
     그 주소를 복사해 나눠 주면 남의 빌드·기록이 딸려 가고, 그 자리에서 새로고침하면
     저장해 둔 내 빌드 대신 링크의 빌드가 다시 열립니다. 그 값을 읽는 탭에서만 남깁니다.
     주소만 갈아 끼웁니다(replaceState) — 뒤로 가기 기록은 건드리지 않습니다. */
  const url = new URL(location);
  if (tab !== 'build') url.searchParams.delete('build');
  if (tab !== 'record' && tab !== 'rank') url.searchParams.delete('rec');
  if (tab !== 'event') url.searchParams.delete('ev');
  if (url.href !== location.href) history.replaceState(null, '', url);
}
window.addEventListener('hashchange', () => { showTab(); window.scrollTo(0, 0); });
// 이미 친구 코드 탭에 있을 때 탭을 다시 눌러도 새로고침되도록 (hashchange 가 안 뜸)
document.querySelector('.tabs a[data-tab="codes"]').addEventListener('click', refresh);

/* ── 시작 ──────────────────────────────────────────────────────── */
showTab();
$('#auto-check').checked = autoCheck;

refresh().then(() => { if (!LIVE) toast('체험 모드 — 이 브라우저에만 저장됩니다'); });
