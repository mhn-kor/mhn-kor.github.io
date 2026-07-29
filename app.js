/* 몬스터헌터 나우 한국지부 — 친구 코드 QR 게시판 */

/* ── 설정 ──────────────────────────────────────────────────────────
   Supabase 프로젝트를 만든 뒤 아래 두 값을 채워주세요 (README.md 참고).
   그대로 두면 이 브라우저에만 저장되는 "체험 모드"로 동작합니다.

   키는 publishable(sb_publishable_...) 또는 레거시 anon(eyJ...) 둘 다 됩니다.
   공개용 키이니 커밋해도 되지만, secret/service_role 키는 절대 넣지 마세요. */
const SUPABASE_URL = 'https://frmpcahnrclrzfkaerbw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Oo1GKjPpnWscgER4691eRg_0cydOhwI';

const TABLE = 'friend_codes';
const LIMIT = 300;          // 무료 플랜 배려: 최신 300개만 표시
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
  async list() {
    // select=* 로 바꾸지 마세요. pw_hash 는 컬럼 권한이 없어 전체 조회가 통째로 거부됩니다.
    const r = await rest(`${TABLE}?select=nickname,code,created_at&order=created_at.desc&limit=${LIMIT}`);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async add({ nickname, code, password }) {
    const r = await rest('rpc/add_friend_code', {
      method: 'POST',
      body: JSON.stringify({ p_nickname: nickname, p_code: code, p_password: password }),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(t.includes('23505') ? 'DUP' : t);   // unique_violation
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
} : {
  async list() { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); },
  async add({ nickname, code, password }) {
    const rows = await this.list();
    if (rows.some(r => r.code === code)) throw new Error('DUP');
    // 체험 모드는 이 브라우저 안에서만 도는 더미 데이터라 비밀번호를 그대로 둡니다.
    const saved = { nickname, code, password, created_at: new Date().toISOString() };
    localStorage.setItem(LOCAL_KEY, JSON.stringify([saved, ...rows].slice(0, LIMIT)));
    return saved;
  },
  async remove(code, password) {
    const rows = await this.list();
    const keep = rows.filter(r => !(r.code === code && r.password === password));
    localStorage.setItem(LOCAL_KEY, JSON.stringify(keep));
    return keep.length < rows.length;
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

/* QR 인코딩은 카드당 ~9ms. 300장을 한 번에 만들면 3초를 멈추므로 화면에 들어올 때 만듭니다. */
const qrLazy = new IntersectionObserver((entries, obs) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    en.target.src = qrURL(en.target.dataset.url, QR_MAX_CSS);
    obs.unobserve(en.target);
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
let rows = [];
const cards = new Map();

function render() {
  const grid = $('#grid');
  const filter = $('#filter').value;
  let shown = 0, prev = null;

  for (const row of rows) {
    let el = cards.get(row.code);
    if (!el) {                                   // QR 생성은 카드당 딱 한 번
      el = cardEl(row);
      cards.set(row.code, el);
      prev ? prev.after(el) : grid.prepend(el);
    }
    prev = el;
    const done = checked.has(row.code);
    el.classList.toggle('done', done);
    el.hidden = !(filter === 'all' || (filter === 'checked') === done);
    if (!el.hidden) shown++;
  }

  const done = rows.filter(r => checked.has(r.code)).length;
  $('#count').textContent = `${shown}명 표시 · 전체 ${rows.length}명 · 체크 ${done}명`;

  const state = $('#state');
  state.hidden = shown > 0;
  if (!shown) {
    state.textContent = rows.length === 0
      ? '아직 등록된 친구 코드가 없습니다. 첫 번째로 등록해 보세요!'
      : filter === 'unchecked'
        ? '모든 친구 코드를 등록하셨습니다. 새 코드가 올라오면 여기에 표시됩니다.'
        : '해당하는 친구 코드가 없습니다.';
  }
}

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
    askDelete(code);
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

$('#filter').addEventListener('change', render);

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

/* ── 삭제 ──────────────────────────────────────────────────────── */
const del = $('#del');
const dErr = $('#d-err');
let pendingCode = null;

function askDelete(code) {
  pendingCode = code;
  $('#d-code').textContent = pretty(code);
  $('#d-pw').value = '';
  dErr.hidden = true;
  del.showModal();
  $('#d-pw').focus();
}

$('#del-cancel').addEventListener('click', () => del.close());
del.addEventListener('click', e => { if (e.target === del) del.close(); });

$('#del-form').addEventListener('submit', async e => {
  e.preventDefault();
  const password = $('#d-pw').value;
  if (!password) { dErr.textContent = '비밀번호를 입력해 주세요.'; dErr.hidden = false; return; }

  const btn = $('#del-submit');
  btn.disabled = true;
  dErr.hidden = true;
  try {
    /* 서버가 참/거짓만 돌려줍니다. 비밀번호가 틀렸는지 코드가 없는지는
       구분해 주지 않으므로 목록에 없는 코드를 캐낼 수 없습니다. */
    if (!await store.remove(pendingCode, password)) {
      dErr.textContent = '비밀번호가 일치하지 않습니다.';
      dErr.hidden = false;
      return;
    }
    rows = rows.filter(r => r.code !== pendingCode);
    cards.get(pendingCode)?.remove();
    cards.delete(pendingCode);
    checked.delete(pendingCode);
    saveChecked();
    disarm();
    render();
    del.close();
    toast('삭제되었습니다');
  } catch (err) {
    console.error(err);
    dErr.textContent = '삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.';
    dErr.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

/* ── 탭 ────────────────────────────────────────────────────────── */
function showTab() {
  const tab = location.hash === '#codes' ? 'codes' : 'notice';
  $('#panel-notice').hidden = tab !== 'notice';
  $('#panel-codes').hidden = tab !== 'codes';
  for (const a of document.querySelectorAll('.tabs a')) {
    a.toggleAttribute('aria-current', a.dataset.tab === tab);
  }
}
window.addEventListener('hashchange', () => { showTab(); window.scrollTo(0, 0); });

/* ── 시작 ──────────────────────────────────────────────────────── */
showTab();
$('#auto-check').checked = autoCheck;

store.list()
  .then(list => {
    rows = list.filter(r => isCode(r.code) && typeof r.nickname === 'string' && r.nickname.trim());
    render();
    if (!LIVE) toast('체험 모드 — 이 브라우저에만 저장됩니다');
  })
  .catch(err => {
    console.error(err);
    $('#state').hidden = false;
    $('#state').textContent = '목록을 불러오지 못했습니다. 새로고침해 주세요.';
  });
