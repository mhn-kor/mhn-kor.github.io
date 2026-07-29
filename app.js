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
const LIVE = !SUPABASE_URL.includes('YOUR-') && !SUPABASE_KEY.includes('YOUR-');
const LOCAL_KEY = 'mhnkr.rows';

const rest = (path, opts = {}) => fetch(SUPABASE_URL + '/rest/v1/' + path, {
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
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M18 6l-1 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 6"/></svg>';
const BUMP_ICON  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16M12 21V9M6.5 14.5 12 9l5.5 5.5"/></svg>';

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
  $('#filter').disabled = !!query;      // 검색 중에는 체크 필터를 쓰지 않습니다

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
    ? `'${query}' 검색 ${total ?? rows.length}명`
    : `${shownTxt} · 전체 ${total ?? rows.length}명 · 체크 ${done}명`;

  const more = $('#more');
  const rest = filtered.length - page.length;
  more.hidden = rest <= 0 && exhausted;
  more.textContent = rest > 0 ? `${rest}명 더 보기` : '더 불러오기';

  const state = $('#state');
  state.hidden = page.length > 0;
  if (!page.length) {
    state.textContent = query
      ? `'${query}' 와 일치하는 닉네임이 없습니다.`
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

/* 검색 중에는 체크 필터를 무시합니다. 이미 추가한 사람을 이름으로 찾는 경우가
   대부분인데 '미체크만' 이 걸려 있으면 결과가 0건으로 보입니다. */
const activeFilter = () => (query ? 'all' : $('#filter').value);

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
    if (pageSize >= filtered.length && exhausted) return;
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
/* 길게 누르기 / 우클릭 → 삭제 버튼 노출 ─────────────────────────── */
const disarm = () => document.querySelectorAll('.card.armed').forEach(c => c.classList.remove('armed'));
function arm(card) { disarm(); card.classList.add('armed'); }

let press = null;         // 길게 누르는 중인 카드
let swallowClick = false; // 길게 누른 뒤 따라오는 click 이 체크를 토글하지 않도록

$('#grid').addEventListener('pointerdown', e => {
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

$('#open-reg').addEventListener('click', () => { fErr.hidden = true; reg.showModal(); $('#f-nick').focus(); });
$('#reg-cancel').addEventListener('click', () => reg.close());
reg.addEventListener('click', e => { if (e.target === reg) reg.close(); });   // 배경 클릭

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
  $('#d-pw').focus();
}

$('#del-cancel').addEventListener('click', () => del.close());
del.addEventListener('click', e => { if (e.target === del) del.close(); });

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

/* ── 탭 ────────────────────────────────────────────────────────── */
function showTab() {
  const tab = location.hash === '#codes' ? 'codes' : 'notice';
  $('#panel-notice').hidden = tab !== 'notice';
  $('#panel-codes').hidden = tab !== 'codes';
  for (const a of document.querySelectorAll('.tabs a')) {
    a.toggleAttribute('aria-current', a.dataset.tab === tab);
  }
  if (tab === 'codes') refresh();
}
window.addEventListener('hashchange', () => { showTab(); window.scrollTo(0, 0); });
// 이미 친구 코드 탭에 있을 때 탭을 다시 눌러도 새로고침되도록 (hashchange 가 안 뜸)
document.querySelector('.tabs a[data-tab="codes"]').addEventListener('click', refresh);

/* ── 시작 ──────────────────────────────────────────────────────── */
showTab();
$('#auto-check').checked = autoCheck;

refresh().then(() => { if (!LIVE) toast('체험 모드 — 이 브라우저에만 저장됩니다'); });
