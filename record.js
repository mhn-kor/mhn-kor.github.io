/* 리더보드 탭 — 몬스터별 최속 토벌 기록과 그 근거 영상.
 *
 * 데이터: Supabase 의 public.records (supabase/schema.sql).
 * 읽기는 한 번에 다 받아오고 거르기·순위는 브라우저에서 합니다. 기록은 많아야
 * 수백 행이라 필터를 바꿀 때마다 서버를 다시 부르는 것보다 이쪽이 빠르고 요청도 적습니다.
 * 쓰기는 친구 코드와 같은 방식 — RPC 안에서 비밀번호를 해싱합니다.
 *
 * app.js 의 $ / esc / toast / rest / TRASH_ICON 을 함수 안에서만 씁니다(=호출 시점).
 * 몬스터는 material-data.js 의 MATERIAL, 무기·스타일은 build-data.js /
 * build-styles.js 를 그대로 씁니다. 같은 목록을 두 벌 두면 한쪽만 낡습니다.
 *
 * 순수 함수(URL 해석·시간 변환)는 node 로도 검증합니다 → tools/record-test.js
 */

const RK_LIMIT = 500;                                   // 한 번에 받아올 상한
const RK_VARIANT = { normal: '일반', dim: '차원변이' };
const RK_STARS = [8, 9, 10];
/* 고룡은 ★6 과 ★8 만 있고 ★8 이 가장 높습니다. 최속 기록은 최고 난이도에서만 뜻이 있으므로
   ★6 은 아예 받지 않고, 등록도 랭킹도 ★8 하나로 고정합니다. */
const RK_ELDER_STAR = 8;

/* ── 영상 URL ──────────────────────────────────────────────────────
   유튜브(숏츠·일반)와 X 만 받습니다. 지원하지 않는 주소는 null 이라 등록에서 막힙니다. */
function rkVid(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^(www|m|mobile)\./, '');
  const yt = id => (/^[A-Za-z0-9_-]{11}$/.test(id || '') ? { kind: 'yt', id } : null);

  if (host === 'youtu.be') return yt(u.pathname.slice(1).split('/')[0]);
  if (host === 'youtube.com') {
    // /shorts/ID, /live/ID, /embed/ID 는 경로에, 일반 영상은 ?v= 에 있습니다.
    const m = u.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/);
    return yt(m ? m[1] : u.searchParams.get('v'));
  }
  if (host === 'x.com' || host === 'twitter.com') {
    const m = u.pathname.match(/\/status(?:es)?\/(\d{5,25})/);
    return m ? { kind: 'x', id: m[1] } : null;
  }
  return null;
}

/* 저장은 항상 이 두 형태로만. 같은 영상을 숏츠 주소와 일반 주소로 각각 올리는 것을
   DB 의 unique 하나로 막을 수 있고, 스키마의 CHECK 가 곧 화이트리스트가 됩니다.
   x.com/i/status/<id> 는 X 가 원래 글로 넘겨주는 공식 경로입니다. */
const rkCanon = v => (v.kind === 'yt'
  ? `https://www.youtube.com/watch?v=${v.id}`
  : `https://x.com/i/status/${v.id}`);

const rkThumb = v => (v.kind === 'yt' ? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` : '');

/* 재생을 누른 뒤에야 iframe 을 끼웁니다. 목록에 처음부터 iframe 을 깔면
   한 화면에 유튜브 플레이어가 여러 개 올라와 스크롤이 버벅입니다.
   nocookie 도메인은 재생 전까지 추적 쿠키를 심지 않습니다. */
const rkEmbed = v => (v.kind === 'yt'
  ? `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0&playsinline=1`
  : `https://platform.twitter.com/embed/Tweet.html?id=${v.id}&theme=dark`);

/* ── 시간 ─────────────────────────────────────────────────────────
   초 단위 정수만 씁니다. 게임이 초로 보여주고 사람도 그렇게 적습니다.
   소수점을 받으면 어떤 사람은 45, 어떤 사람은 45.32 로 올려 목록이 들쭉날쭉해집니다. */
const rkTime = sec => sec + '초';

/* '45' 만 받습니다(1~3600). 범위 밖이거나 소수점이 붙으면 null → 등록에서 막힙니다. */
const rkParse = txt => {
  const m = String(txt == null ? '' : txt).trim().match(/^(\d{1,4})$/);
  const sec = m ? Number(m[1]) : 0;
  return sec >= 1 && sec <= 3600 ? sec : null;
};

/* 빌드 탭에서 복사한 링크(?build=… #build)에서 파라미터만 떼어냅니다.
   나중에 만들 '추천 빌드'가 이 값으로 기록과 빌드를 잇습니다. */
const rkBuildParam = raw => {
  const m = String(raw || '').trim().match(/[?&]build=([^&#\s]+)/);
  return m && m[1].length <= 8000 ? m[1] : null;
};

/* ── 순위 ──────────────────────────────────────────────────────────
   순위를 두 곳(랭킹 탭 · 리더보드 왕관)이 쓰므로 세는 규칙은 여기 한 벌만 둡니다.

   한 «판»은 몬스터 · 난이도 · 종류입니다 — ★8 일반과 ★10 차원변이는 같은 사냥이 아니라
   한 줄에 세울 수 없습니다(DB 인덱스 records_board_idx 도 같은 조합입니다).
   같은 시간이면 먼저 올린 쪽이 위입니다. 그래도 같으면 id 로 갈라 순서를 못 박습니다 —
   비기면 그릴 때마다 1위가 바뀌는 목록이 됩니다. */
const rkOrder = (a, b) => a.time_sec - b.time_sec
  || String(a.created_at || '').localeCompare(String(b.created_at || ''))
  || a.id - b.id;

const rkKey = r => `${r.monster}|${r.star}|${r.variant}`;

/* 판별로 묶습니다. 넣은 순서를 그대로 두므로 rkRows(=rkOrder 로 정렬됨)를 주면 각 판도 순위순입니다. */
function rkGroup(rows) {
  const g = new Map();
  for (const r of rows) {
    const k = rkKey(r);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(r);
  }
  return g;
}

/* 기록 id → 그 판에서의 순위. 왕관은 3위까지라 거기까지만 담습니다. */
function rkTopMap(rows) {
  const top = new Map();
  for (const list of rkGroup(rows).values()) list.slice(0, 3).forEach((r, i) => top.set(r.id, i + 1));
  return top;
}

if (typeof module !== 'undefined') {
  module.exports = { rkVid, rkCanon, rkEmbed, rkTime, rkParse, rkBuildParam, rkOrder, rkKey, rkGroup, rkTopMap };
}

/* 금 · 은 · 동 왕관. 리더보드 카드 왼쪽 위와 랭킹 탭이 같이 씁니다.
   viewBox 만 있는 SVG 는 CSS 가 늦으면 부풀어 오르므로 width/height 를 붙입니다. */
const RK_CROWN = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M2.4 6.6 7 10.2 12 3.4l5 6.8 4.6-3.6-1.8 10.1H4.2zM4.4 18.6h15.2v2.1H4.4z"/></svg>';
const rkCrown = n => (n ? `<span class="rk-crown c${n}" title="${n}위">${RK_CROWN}<b>${n}</b></span>` : '');

/* ── 상태 ──────────────────────────────────────────────────────────── */
let rkRows = [];
let rkTop = new Map();      // 기록 id → 판 안에서의 순위(1~3). 데이터가 바뀔 때만 다시 셉니다.
let rkFailed = false;
let rkDrawn = false;
const rkF = { star: 0, variant: '', monster: '', weapon: '', style: '' };

const rkMons = () => (typeof MATERIAL === 'undefined' ? [] : MATERIAL.monsters);
const rkMon = id => rkMons().find(m => m.id === id) || null;
const rkWeapons = () => (typeof BUILD === 'undefined' ? [] : BUILD.weaponTypes);
const rkWeaponName = k => (rkWeapons().find(w => w.k === k) || {}).n || k;
const rkStyles = wt => (typeof BD_STYLES !== 'undefined' && BD_STYLES[wt]) || [];

/* 등록창에서 고른 몬스터·무기. 선택칸이 아니라 모달이라 값은 여기에 둡니다.
   기본값을 두지 않는 이유: 첫 몬스터가 미리 골라져 있으면 그대로 올라옵니다. */
const rkForm = { monster: null, weapon: null };

/* 모달 격자에 올릴 항목. 몬스터는 재료 탭 아이콘, 무기는 빌드 탭 아이콘을 그대로 씁니다. */
const rkPickItems = kind => (kind === 'monster'
  ? rkMons().map(m => ({ v: m.id, n: m.name, img: `assets/monster/${m.icon}.png` }))
  : rkWeapons().map(w => ({ v: w.k, n: w.n, img: `assets/part/${w.k}.png` })));
const rkPickItem = (kind, v) => (v ? rkPickItems(kind).find(x => x.v === v) : null) || null;

/* 고르기 버튼 속. 아무것도 안 골랐으면 아이콘 없이 안내 문구만 둡니다. */
const rkPickHtml = (kind, v, empty) => {
  const it = rkPickItem(kind, v);
  return (it ? `<img src="${esc(it.img)}" width="26" height="26" alt="" loading="lazy">` : '')
    + `<b${it ? '' : ' class="empty"'}>${esc(it ? it.n : empty)}</b>`;
};

const rkPass = r => (!rkF.star || r.star === rkF.star)
  && (!rkF.variant || r.variant === rkF.variant)
  && (!rkF.monster || r.monster === rkF.monster)
  && (!rkF.weapon || r.weapon === rkF.weapon)
  && (!rkF.style || r.style === rkF.style);

/* ── 목록 ──────────────────────────────────────────────────────────── */
const RK_COLS = 'id,nickname,monster,star,variant,weapon,style,time_sec,video_url,build,created_at';

/* 리더보드와 랭킹이 같은 목록을 씁니다. 먼저 연 쪽이 받아오고 다른 쪽은 그 약속을 기다립니다 —
   탭마다 부르면 같은 500 행을 두 번 받습니다. */
let rkReq = null;
const rkReady = () => (rkReq || (rkReq = rkLoad()));

async function rkLoad() {
  try {
    // 같은 시간이면 먼저 올린 쪽이 위입니다(rkOrder 와 같은 규칙). limit 이 걸려 있으므로
    // 자르는 기준도 서버가 같이 알아야 합니다.
    const r = await rest(`records?select=${RK_COLS}&order=time_sec.asc,created_at.asc&limit=${RK_LIMIT}`);
    if (!r.ok) throw new Error(await r.text());
    rkRows = await r.json();
    rkRefresh();
    rkOpenFromUrl();
  } catch (err) {
    console.error(err);
    rkFailed = true;
    $('#rk-state').hidden = false;
    $('#rk-state').textContent = '기록을 불러오지 못했습니다. 새로고침해 주세요.';
    if (rnDrawn) rnRender();
  }
}

/* 목록이 바뀌었을 때. 순위(왕관)는 데이터가 바뀔 때만 다시 세면 됩니다 —
   필터는 무엇을 보여줄지만 정할 뿐 누가 1위인지를 바꾸지 않습니다. */
function rkRefresh() {
  rkTop = rkTopMap(rkRows);
  rkRender();
  if (rnDrawn) rnRender();
}

/* 지금 화면에 깔린 목록. 크게 보기 모달의 이전/다음이 이 순서로 넘어갑니다. */
let rkShown = [];
const rkList = () => rkRows.filter(rkPass);   // 서버가 이미 시간 오름차순으로 줍니다

function rkRender() {
  rkShown = rkList();
  /* 순위는 '지금 보고 있는 판'의 순위입니다. 몬스터를 안 고르면 여러 몬스터가
     섞여 있어 숫자가 뜻을 잃으므로, 그때는 번호를 아예 안 붙입니다. */
  const ranked = !!rkF.monster;

  $('#rk-list').innerHTML = rkShown.map((r, i) => rkItem(r, i, ranked ? i + 1 : 0)).join('');
  $('#rk-count').textContent = rkShown.length === rkRows.length
    ? `${rkRows.length}건`
    : `${rkShown.length}건 / 전체 ${rkRows.length}건`;
  $('#rk-reset').hidden = !rkF.star && !rkF.variant && !rkF.monster && !rkF.weapon && !rkF.style;

  const state = $('#rk-state');
  state.hidden = rkShown.length > 0;
  state.textContent = rkRows.length
    ? '조건에 맞는 기록이 없습니다. 필터를 바꿔보세요.'
    : '아직 등록된 기록이 없습니다. 첫 기록을 올려보세요!';
}

/* 숏츠가 기준이라 카드는 세로(9:16)입니다. 유튜브 썸네일(4:3)에 세로 영상이
   좌우 검은 띠와 함께 들어 있는데, 9:16 칸에 cover 로 넣으면 그 띠가 정확히 잘려
   원본 화면만 남습니다. */
function rkItem(r, i, rank) {
  const v = rkVid(r.video_url);
  const mon = rkMon(r.monster);
  /* 왼쪽 위: 그 판(몬스터·난이도·종류)에서 3위 안이면 왕관, 아니면 지금 보고 있는 판의 번호.
     왕관은 필터와 무관한 «진짜» 순위라 무엇을 걸러 보든 같은 카드에 같은 왕관이 붙습니다. */
  const badges = `
    ${rkCrown(rkTop.get(r.id)) || (rank ? `<span class="rk-no${rank <= 3 ? ' top' : ''}">${rank}</span>` : '')}
    <span class="rk-src">${v ? (v.kind === 'yt' ? 'YouTube' : 'X') : '영상'}</span>
    ${r.build ? '<span class="rk-bdg" title="빌드가 함께 등록된 기록입니다">빌드 있음</span>' : ''}
    <span class="rk-t">${rkTime(r.time_sec)}</span>`;
  return `
  <li class="rk-item" data-id="${r.id}">
    ${v ? `<button class="rk-play" type="button" data-i="${i}" aria-label="${esc(r.nickname)} 영상 크게 보기">
      ${v.kind === 'yt' ? `<img src="${esc(rkThumb(v))}" alt="" loading="lazy" onerror="this.hidden=true">` : ''}
      <span class="rk-pi" aria-hidden="true">▶</span>${badges}
    </button>` : `<div class="rk-play none">${badges}<p class="rk-noembed">영상을 표시할 수 없습니다</p></div>`}
    <div class="rk-info">
      <p class="rk-nick"><span>${esc(r.nickname)}</span>
        <button class="icon rk-kakao" data-act="kakao" aria-label="카카오톡으로 공유" title="카카오톡으로 공유">${BD_I.kakao}</button>
        <button class="icon" data-act="copy" aria-label="링크 복사" title="링크 복사">${BD_I.link}</button>
        <button class="icon danger rk-del" data-act="del" aria-label="기록 삭제" title="삭제 (비밀번호 필요)">${TRASH_ICON}</button>
      </p>
      <div class="rk-tags">
        <span class="chip">${mon ? `<img class="rk-mi" src="assets/monster/${esc(mon.icon)}.png" width="16" height="16" alt="" loading="lazy">` : ''}${esc(mon ? mon.name : r.monster)}</span>
        <span class="chip star">★${r.star}</span>
        ${r.variant === 'dim' ? '<span class="chip dim">차원변이</span>' : ''}
        <span class="chip">${esc(rkWeaponName(r.weapon))}${r.style ? ` <b>${esc(r.style)}</b>` : ''}</span>
      </div>
    </div>
  </li>`;
}

/* ── 필터 ──────────────────────────────────────────────────────────── */
/* 난이도·종류·무기 칩. 리더보드와 랭킹이 같은 칩을 씁니다. cur 와 같은 값이 켜진 채로 나옵니다.
   항목은 [값, 이름], 아이콘이 있으면 [값, 이름, 그림]입니다. 좁은 화면에서는 그림만 남으므로
   이름을 title 로도 답니다 — display:none 인 글자는 읽어주는 기기도 건너뜁니다.
   «전체»가 필요한 쪽은 부르면서 목록 앞에 넣습니다(랭킹의 난이도는 판을 정해야 해서 없습니다). */
const rkChips = (name, items, cur = '') => `<div class="mt-chips">${
  items.map(([v, label, img]) => `
    <button class="mt-chip${String(v) === String(cur) ? ' on' : ''}" data-f="${name}" data-v="${esc(String(v))}"${
      img ? ` title="${esc(label)}"` : ''}>${
      img ? `<img src="${esc(img)}" width="18" height="18" alt="" loading="lazy">` : ''}<span>${esc(label)}</span></button>`).join('')
}</div>`;

const RK_ALL = ['', '전체'];

function rkFilterUI() {
  $('#rk-filter').innerHTML = `
    <p class="stone-label">난이도</p>
    ${rkChips('star', [RK_ALL, ...RK_STARS.map(s => [s, '★' + s])])}
    <p class="stone-label">종류</p>
    ${rkChips('variant', [RK_ALL, ...Object.entries(RK_VARIANT)])}
    <p class="stone-label">몬스터 · 무기</p>
    <div class="rk-selects">
      <div class="field"><span>몬스터</span>
        <button type="button" class="rk-pick" id="rk-fmon" data-pick="monster"></button>
      </div>
      <div class="field"><span>무기</span>
        <button type="button" class="rk-pick" id="rk-fwp" data-pick="weapon"></button>
      </div>
      <label class="field" id="rk-fstyle-f" hidden><span>스타일</span>
        <select id="rk-fstyle"><option value="">전체</option></select>
      </label>
    </div>`;
  rkFilterLabels();

  $('#rk-filter').addEventListener('click', e => {
    const pick = e.target.closest('.rk-pick');
    if (pick) return rkPickOpen(pick.dataset.pick, 'f');

    const chip = e.target.closest('.mt-chip');
    if (!chip) return;
    rkF[chip.dataset.f] = chip.dataset.f === 'star' ? Number(chip.dataset.v || 0) : chip.dataset.v;
    for (const b of $('#rk-filter').querySelectorAll(`.mt-chip[data-f="${chip.dataset.f}"]`)) {
      b.classList.toggle('on', b === chip);
    }
    rkRender();
  });

  $('#rk-fstyle').addEventListener('change', e => { rkF.style = e.target.value; rkRender(); });
  $('#rk-reset').addEventListener('click', () => {
    rkF.star = 0;
    rkF.variant = rkF.monster = rkF.weapon = rkF.style = '';
    // '전체' 칩(data-v="")만 켜진 상태로 되돌립니다.
    for (const b of $('#rk-filter').querySelectorAll('.mt-chip')) b.classList.toggle('on', !b.dataset.v);
    rkFilterLabels();
    rkRender();
  });
}

function rkFilterLabels() {
  $('#rk-fmon').innerHTML = rkPickHtml('monster', rkF.monster, '전체');
  $('#rk-fwp').innerHTML = rkPickHtml('weapon', rkF.weapon, '전체');
  /* 스타일은 무기에 딸린 목록이라 무기를 고른 뒤에만 뜹니다. */
  const styles = rkStyles(rkF.weapon);
  $('#rk-fstyle-f').hidden = !styles.length;
  $('#rk-fstyle').innerHTML = '<option value="">전체</option>'
    + styles.map(s => `<option value="${esc(s)}"${s === rkF.style ? ' selected' : ''}>${esc(s)}</option>`).join('');
}

/* ── 몬스터 · 무기 고르기 (빌드 탭 모달을 같이 씁니다) ──────────────
   #bd-modal 과 .bd-grid 는 build.js 것을 그대로 빌려 씁니다. 같은 격자를 한 벌 더
   만들 이유가 없습니다. 누가 연 모달인지는 dataset.owner 로 갈립니다. */
let rkPick = null;      // { kind: 'monster'|'weapon', where: 'f'(필터) | 'form'(등록창) }

function rkPickOpen(kind, where) {
  rkPick = { kind, where };
  const mon = kind === 'monster';
  bdOpen(mon ? '몬스터 선택' : '무기 선택', '', mon, { placeholder: '몬스터 이름' });
  $('#bd-modal').dataset.owner = 'record';
  rkPickFill('');
}

function rkPickFill(q) {
  const { kind, where } = rkPick;
  const norm = s => String(s).toLowerCase().replace(/\s+/g, '');
  const needle = norm(q);
  const cur = where === 'f' ? rkF[kind] : rkForm[kind];
  const items = rkPickItems(kind).filter(it => !needle || norm(it.n).includes(needle));

  $('#bd-modal-count').textContent = `${items.length}종`;
  $('#bd-modal-body').innerHTML = items.length ? `<div class="bd-grid">
    ${where === 'f' ? `<button class="bd-gi rk-any${cur ? '' : ' on'}" data-v="">전체 보기</button>` : ''}
    ${items.map(it => `
      <button class="bd-gi${it.v === cur ? ' on' : ''}" data-v="${esc(it.v)}">
        <img src="${esc(it.img)}" width="40" height="40" alt="" loading="lazy">
        <span>${esc(it.n)}</span>
      </button>`).join('')}
  </div>` : `<p class="bd-empty">일치하는 ${kind === 'monster' ? '몬스터' : '무기'}가 없습니다.</p>`;
}

/* 모달의 클릭·검색은 build.js 도 듣고 있습니다. 서로 owner 를 보고 남의 차례에는 빠집니다. */
function rkModalUI() {
  $('#bd-modal-body').addEventListener('click', e => {
    if ($('#bd-modal').dataset.owner !== 'record') return;
    const gi = e.target.closest('.bd-gi');
    if (!gi) return;
    const { kind, where } = rkPick;
    if (where === 'f') {
      rkF[kind] = gi.dataset.v;
      if (kind === 'weapon') rkF.style = '';     // 무기가 바뀌면 스타일은 뜻을 잃습니다
      rkFilterLabels();
      rkRender();
    } else {
      rkForm[kind] = gi.dataset.v;
      rkFormLabels();
    }
    $('#bd-modal').close();
  });

  $('#bd-q').addEventListener('input', e => {
    if ($('#bd-modal').dataset.owner === 'record') rkPickFill(e.target.value);
  });
}

/* ── 크게 보기 · 삭제 ──────────────────────────────────────────────── */
function rkListUI() {
  $('#rk-list').addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    if (act) {
      const id = act.closest('.rk-item').dataset.id;
      if (act.dataset.act === 'del') return rkAskDelete(id);
      const row = rkRows.find(x => String(x.id) === String(id));
      if (!row) return;
      return act.dataset.act === 'kakao' ? rkShare(row) : bdCopyLink(rkShareUrl(row));
    }
    /* 랭킹 탭이 크게 보기 목록을 바꿔 놓았을 수 있으므로, 열 때 지금 깔린 목록을 같이 넘깁니다. */
    const play = e.target.closest('.rk-play');
    if (play) rkOpenView(Number(play.dataset.i), rkList());
  });

  $('#rk-v-prev').addEventListener('click', () => rkOpenView(rkAt - 1));
  $('#rk-v-next').addEventListener('click', () => rkOpenView(rkAt + 1));
  $('#rk-v-close').addEventListener('click', () => $('#rk-view').close());
  closeOnBackdrop($('#rk-view'));
  /* 화살표로도 넘깁니다. dialog 가 열려 있는 동안 키보드 초점이 안에 있습니다. */
  $('#rk-view').addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') rkOpenView(rkAt - 1);
    else if (e.key === 'ArrowRight') rkOpenView(rkAt + 1);
  });
  // 닫을 때 iframe 을 걷어냅니다. 남겨두면 뒤에서 소리가 계속 납니다.
  $('#rk-view').addEventListener('close', () => { $('#rk-v-body').innerHTML = ''; rkAt = -1; });

  $('#rk-v-kakao').addEventListener('click', () => rkShare(rkShown[rkAt]));
  $('#rk-v-copy').addEventListener('click', () => {
    const r = rkShown[rkAt];
    if (r) bdCopyLink(rkShareUrl(r));
  });
}

let rkAt = -1;      // rkShown 안에서 지금 보고 있는 자리

/* ── 공유 ──────────────────────────────────────────────────────────
   카카오 SDK 준비·링크 복사는 빌드 탭 것을 그대로 씁니다(bdKakaoReady/bdCopyLink).
   같은 일을 두 벌 두면 키를 바꿀 때 한쪽만 낡습니다. */
const rkShareUrl = r => `${location.origin}${location.pathname}?rec=${r.id}#record`;
/* 카카오로 나가는 링크는 받는 사람이 열 수 있어야 하므로 배포 절대 주소를 씁니다
   (BD_BASE 는 og:url). 배포 환경에서는 위와 같은 값입니다. */
const rkShareAbs = r => (typeof BD_BASE === 'string' ? BD_BASE : location.origin + location.pathname)
  + `?rec=${r.id}#record`;

function rkShareText(r) {
  const mon = rkMon(r.monster);
  return {
    title: `${rkTime(r.time_sec)} · ${mon ? mon.name : r.monster} ★${r.star}`
      + (r.variant === 'dim' ? ' 차원변이' : ''),
    desc: `${r.nickname} · ${rkWeaponName(r.weapon)}${r.style ? ' ' + r.style : ''}`,
  };
}

async function rkShare(r) {
  if (!r) return;
  const url = rkShareAbs(r);
  const { title, desc } = rkShareText(r);
  const v = rkVid(r.video_url);
  const link = { mobileWebUrl: url, webUrl: url };

  if (typeof bdKakaoReady === 'function' && await bdKakaoReady()) {
    try {
      /* 빌드용 리스트 템플릿(KAKAO_TEMPLATE_ID)은 방어구 5줄짜리라 영상에는 안 맞습니다.
         썸네일 한 장이 그림이 되는 feed 를 씁니다. */
      window.Kakao.Share.sendDefault({
        objectType: 'feed',
        content: {
          title, description: desc,
          imageUrl: (v && rkThumb(v)) || (typeof BD_OG === 'string' ? BD_OG : ''),
          link,
        },
        buttons: [{ title: '영상 보기', link }],
      });
      return;
    } catch (e) { toast('카카오톡 공유에 실패했습니다'); }
  }
  if (navigator.share) {
    try { await navigator.share({ title, text: desc, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }   // 사용자가 취소한 건 실패가 아닙니다
  }
  /* 카카오 키도 공유 시트도 없는 환경(대개 PC). 링크를 붙여넣으면 카톡이 og 태그로
     카드를 만들어 주므로 그 방법을 알려 줍니다. */
  bdCopyLink(rkShareUrl(r), '링크 복사됨 · 카카오톡에 붙여넣으세요');
}

/* ?rec=<id> 로 들어오면 그 기록을 바로 크게 띄웁니다(공유 링크로 들어온 사람). */
let rkFromUrlDone = false;
function rkOpenFromUrl() {
  if (rkFromUrlDone) return;
  rkFromUrlDone = true;
  const id = new URLSearchParams(location.search).get('rec');
  if (!id) return;
  const at = rkShown.findIndex(r => String(r.id) === String(id));
  if (at >= 0) rkOpenView(at);
  else toast('그 기록을 찾지 못했습니다');
}

/* list 를 주면 그 목록을 크게 보기의 «이전/다음» 범위로 삼습니다(랭킹 탭은 그 판 전체를 넘깁니다).
   안 주면 지금 걸린 범위 그대로 — 창 안의 이전/다음이 그렇게 부릅니다. */
function rkOpenView(i, list) {
  if (list) rkShown = list;
  const r = rkShown[i];
  if (!r) return;                       // 처음/끝에서 더 넘기려 한 경우
  rkAt = i;
  const v = rkVid(r.video_url);
  const mon = rkMon(r.monster);

  $('#rk-v-title').innerHTML = `<b>${rkTime(r.time_sec)}</b><span>${esc(r.nickname)}</span>`;
  $('#rk-v-tags').innerHTML = `
    <span class="chip">${mon ? `<img class="rk-mi" src="assets/monster/${esc(mon.icon)}.png" width="16" height="16" alt="">` : ''}${esc(mon ? mon.name : r.monster)}</span>
    <span class="chip star">★${r.star}</span>
    ${r.variant === 'dim' ? '<span class="chip dim">차원변이</span>' : ''}
    <span class="chip">${esc(rkWeaponName(r.weapon))}${r.style ? ` <b>${esc(r.style)}</b>` : ''}</span>`;

  /* X 임베드는 제 높이를 알려주지 않아 CSS 로 고정합니다. 유튜브만 세로 비율입니다. */
  const body = $('#rk-v-body');
  body.className = 'rk-v-body' + (v ? ' ' + v.kind : '');
  body.innerHTML = v
    ? `<iframe src="${esc(rkEmbed(v))}" allow="autoplay; encrypted-media; picture-in-picture; clipboard-write" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="토벌 영상"></iframe>`
    : '<p class="rk-noembed">영상을 표시할 수 없습니다</p>';

  $('#rk-v-src').href = r.video_url;
  $('#rk-v-build').hidden = !r.build;
  if (r.build) $('#rk-v-build').href = `?build=${r.build}#build`;
  $('#rk-v-prev').disabled = i === 0;
  $('#rk-v-next').disabled = i === rkShown.length - 1;
  $('#rk-v-pos').textContent = `${i + 1} / ${rkShown.length}`;
  if (!$('#rk-view').open) $('#rk-view').showModal();
}

let rkPending = null;

function rkAskDelete(id) {
  rkPending = id;
  $('#rk-d-pw').value = '';
  $('#rk-d-err').hidden = true;
  $('#rk-del').showModal();
  $('#rk-d-pw').focus();
}

/* ── 등록 ──────────────────────────────────────────────────────────── */
const rkOpt = (list, val, label) => list.map(x => `<option value="${esc(String(val(x)))}">${esc(String(label(x)))}</option>`).join('');


/* 고른 몬스터·무기를 버튼에 반영합니다. 스타일·종류 목록도 고른 값에 맞춰 다시 채웁니다. */
function rkFormLabels() {
  $('#rk-mon').innerHTML = rkPickHtml('monster', rkForm.monster, '몬스터 선택');
  $('#rk-wp').innerHTML = rkPickHtml('weapon', rkForm.weapon, '무기 선택');
  const styles = rkStyles(rkForm.weapon);
  $('#rk-style-f').hidden = !styles.length;
  $('#rk-style').innerHTML = '<option value="">선택 안 함</option>' + rkOpt(styles, s => s, s => s);

  /* 고룡은 ★8 이 가장 높은 등급이고(그 아래는 ★6 이라 이 표에 없습니다) 차원변이도 없습니다.
     목록에서 아예 빼서 올릴 수 없게 합니다 — 화면에서 감추기만 하면 잘못 고른 기록이 그대로 남습니다. */
  const elder = (rkMon(rkForm.monster) || {}).group === 'elder';
  rkPickOne('#rk-star', elder ? [RK_ELDER_STAR] : RK_STARS, s => s, s => '★' + s);
  rkPickOne('#rk-var', Object.entries(RK_VARIANT).filter(([v]) => !elder || v === 'normal'),
    v => v[0], v => v[1]);
}

/* 선택칸을 다시 채우되 고르고 있던 값이 아직 있으면 그대로 둡니다.
   그냥 다시 그리면 몬스터를 바꿀 때마다 난이도가 첫 항목으로 되돌아갑니다. */
function rkPickOne(sel, list, val, label) {
  const keep = $(sel).value;
  $(sel).innerHTML = rkOpt(list, val, label);
  if (list.some(x => String(val(x)) === keep)) $(sel).value = keep;
}

function rkFormUI() {
  rkFormLabels();                 // 난이도·종류 선택칸을 채웁니다
  // 대부분의 기록이 10성이라 기본값으로 둡니다. 잘못 올려도 지우려면 비밀번호가 필요합니다.
  $('#rk-star').value = '10';

  $('#rk-reg-form').addEventListener('click', e => {
    const pick = e.target.closest('.rk-pick');
    if (pick) rkPickOpen(pick.dataset.pick, 'form');
  });

  /* 초 단위 정수만 받습니다. inputmode 는 모바일 자판만 바꿀 뿐이고 form 이 novalidate 라
     pattern 도 안 걸립니다 — 친구 코드 칸처럼 입력하는 족족 숫자만 남깁니다. */
  $('#rk-time').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
  });

  /* URL 을 붙여넣는 즉시 무엇으로 인식했는지 보여줍니다. 등록 후에야 틀린 걸
     알게 되면 다시 채워야 하니, 여기서 미리 알려줍니다. */
  $('#rk-url').addEventListener('input', () => {
    const v = rkVid($('#rk-url').value);
    const box = $('#rk-preview');
    box.className = 'preview' + (v ? ' ok' : '');
    box.innerHTML = v
      ? `${v.kind === 'yt' ? `<img src="${esc(rkThumb(v))}" alt="" onerror="this.hidden=true">` : ''}
         <p><b>${v.kind === 'yt' ? '유튜브' : 'X'}</b> 영상으로 인식했습니다. 목록에서 눌러 재생할 수 있습니다.</p>`
      : '<p>유튜브(숏츠 포함) 또는 X 영상 주소를 붙여넣어 주세요. 주소만 넣으면 영상이 붙습니다.</p>';
  });

  /* 닉네임 자동완성. 추천빌드 등록창과 같은 것을 씁니다 — app.js 의 nickAuto(). */
  nickAuto('#rk-nick', '#rk-nick-list', '#rk-nick-hint');

  $('#rk-open').addEventListener('click', () => {
    $('#rk-err').hidden = true;
    $('#rk-nick-hint').hidden = true;
    if (!$('#rk-nick').value) $('#rk-nick').value = lastNick();
    $('#rk-reg').showModal();
    $('#rk-nick').focus();
  });
  $('#rk-cancel').addEventListener('click', () => $('#rk-reg').close());
  closeOnBackdrop($('#rk-reg'));
  $('#rk-reg-form').addEventListener('submit', rkSubmit);

  $('#rk-del-cancel').addEventListener('click', () => $('#rk-del').close());
  closeOnBackdrop($('#rk-del'));
  $('#rk-del-form').addEventListener('submit', rkDelete);
}

async function rkSubmit(e) {
  e.preventDefault();
  const err = $('#rk-err');
  const nickname = $('#rk-nick').value.trim().replace(/\s+/g, ' ');
  const time_sec = rkParse($('#rk-time').value);
  const vid = rkVid($('#rk-url').value);
  const buildRaw = $('#rk-build').value.trim();
  const build = rkBuildParam(buildRaw);
  const password = $('#rk-pw').value;

  const bad = !nickname ? '닉네임을 입력해 주세요.'
    : nickname.length > 20 ? '닉네임은 20자 이내로 입력해 주세요.'
    : !rkForm.monster ? '몬스터를 골라주세요.'
    : !rkForm.weapon ? '무기를 골라주세요.'
    : time_sec == null ? '토벌 시간은 초 단위 정수로 적어주세요. 예) 45'
    : !vid ? '유튜브 또는 X 영상 주소만 등록할 수 있습니다.'
    : buildRaw && !build ? '빌드 링크는 빌드 탭의 공유 링크(?build=…)를 붙여넣어 주세요.'
    : password.length < 4 ? '삭제용 비밀번호는 4자 이상 입력해 주세요.'
    : null;
  if (bad) { err.textContent = bad; err.hidden = false; return; }

  const submit = $('#rk-submit');
  submit.disabled = true;
  err.hidden = true;
  const row = {
    nickname,
    monster: rkForm.monster,
    star: Number($('#rk-star').value),
    variant: $('#rk-var').value,
    weapon: rkForm.weapon,
    style: $('#rk-style').value || null,
    time_sec,
    video_url: rkCanon(vid),
    build,
  };
  try {
    const r = await rest('rpc/add_record', {
      method: 'POST',
      body: JSON.stringify({
        p_nickname: row.nickname, p_monster: row.monster, p_star: row.star,
        p_variant: row.variant, p_weapon: row.weapon, p_style: row.style,
        p_time_sec: row.time_sec, p_video_url: row.video_url, p_build: row.build,
        p_password: password,
      }),
    });
    if (!r.ok) {
      // SQLSTATE 로 정확히 봅니다. 본문 전체를 훑으면 입력값 때문에 오판합니다.
      const e2 = await r.json().catch(() => ({}));
      throw new Error(e2.code === '23505' ? 'DUP' : (e2.message || `HTTP ${r.status}`));
    }
    row.id = await r.json();
    row.created_at = new Date().toISOString();
    saveNick(nickname);          // 다음 등록창에 미리 채워 둡니다
    // 제자리에 끼워 넣습니다. 다시 받아올 이유가 없습니다. 정렬 규칙은 rkOrder 한 곳뿐이라
    // 같은 시간일 때 «먼저 올린 쪽이 위»가 여기서도 저절로 지켜집니다.
    rkRows.push(row);
    rkRows.sort(rkOrder);
    rkRefresh();
    $('#rk-reg').close();
    $('#rk-reg-form').reset();
    /* reset() 은 선택칸만 되돌립니다. 기본값과 모달로 고른 몬스터·무기는 직접 비웁니다.
       (연달아 올릴 때 앞 기록의 몬스터가 남아 있으면 그대로 또 올라갑니다)
       고룡을 올린 직후에는 난이도 목록이 ★8 뿐이므로, 목록을 되살린 «뒤에» 10성으로 돌립니다. */
    rkForm.monster = rkForm.weapon = null;
    rkFormLabels();
    $('#rk-star').value = '10';
    $('#rk-nick').value = lastNick();               // reset() 이 지운 닉네임은 되살립니다
    $('#rk-nick-hint').hidden = true;
    $('#rk-preview').className = 'preview';
    $('#rk-preview').innerHTML = '<p>유튜브 숏츠 또는 X 영상 주소를 붙여넣어 주세요. 주소만 넣으면 영상이 붙습니다.</p>';
    toast('기록이 등록되었습니다!');
  } catch (e3) {
    err.textContent = e3.message === 'DUP'
      ? '이미 등록된 영상입니다.'
      : '등록에 실패했습니다. 잠시 후 다시 시도해 주세요.';
    err.hidden = false;
    if (e3.message !== 'DUP') console.error(e3);
  } finally {
    submit.disabled = false;
  }
}

async function rkDelete(e) {
  e.preventDefault();
  const err = $('#rk-d-err');
  const password = $('#rk-d-pw').value;
  if (!password) { err.textContent = '비밀번호를 입력해 주세요.'; err.hidden = false; return; }

  const btn = $('#rk-del-submit');
  btn.disabled = true;
  err.hidden = true;
  try {
    const r = await rest('rpc/delete_record', {
      method: 'POST',
      body: JSON.stringify({ p_id: Number(rkPending), p_password: password }),
    });
    if (!r.ok) throw new Error(await r.text());
    if (await r.json() !== true) {
      err.textContent = '비밀번호가 일치하지 않습니다.';
      err.hidden = false;
      return;
    }
    rkRows = rkRows.filter(x => String(x.id) !== String(rkPending));
    rkRefresh();       // 1위가 지워지면 2위가 금관을 물려받습니다
    $('#rk-del').close();
    toast('삭제되었습니다');
  } catch (e2) {
    console.error(e2);
    err.textContent = '삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.';
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

/* ── 랭킹 탭 ────────────────────────────────────────────────────────
   리더보드와 같은 목록(rkRows)을 몬스터별로 접어 1·2·3위만 보여줍니다.

   한 줄 = 몬스터 하나, 그 안에 일반 · 차원변이가 나란히 섭니다. 둘은 각각 다른 판
   (rkKey = 몬스터 · 난이도 · 종류)이라 왕관도 따로 셉니다 — 나란히 두는 건 보기 편해서일 뿐
   섞는 게 아닙니다. 난이도만 고르고 나면 남는 축이 몬스터뿐이라 모든 몬스터를
   한 줄씩 세울 수 있습니다(기록이 없는 몬스터도 자리를 지킵니다). */
let rnDrawn = false;
const rnF = { star: 10, weapon: '' };          // 대부분이 찾는 난이도를 기본값으로, 무기는 전체

/* 무기는 판을 가르는 값이 아니라 «그 무기만 남긴 판»입니다. 고르면 그 안에서 1·2·3위를
   다시 셉니다 — 전체일 때가 리더보드 카드의 왕관과 같은 순위입니다. */
const rnRows = () => (rnF.weapon ? rkRows.filter(r => r.weapon === rnF.weapon) : rkRows);

/* 고룡은 ★8 이 가장 높은 등급이라 난이도 칩을 타지 않습니다. ★10 을 골랐다고 고룡 줄이
   통째로 비면 «아직 기록이 없다»로 잘못 읽힙니다. 등록도 ★8 만 받습니다(rkFormLabels). */
const rnStar = m => (m.group === 'elder' ? RK_ELDER_STAR : rnF.star);
const rnKey = (m, variant) => `${m.id}|${rnStar(m)}|${variant}`;

function rnUI() {
  $('#rn-filter').innerHTML = `
    <p class="stone-label">난이도</p>
    ${rkChips('star', RK_STARS.map(s => [s, '★' + s]), rnF.star)}
    <p class="stone-label">무기</p>
    ${rkChips('weapon', [RK_ALL, ...rkWeapons().map(w => [w.k, w.n, `assets/part/${w.k}.png`])], rnF.weapon)}`;

  $('#rn-filter').addEventListener('click', e => {
    const chip = e.target.closest('.mt-chip');
    if (!chip) return;
    rnF[chip.dataset.f] = chip.dataset.f === 'star' ? Number(chip.dataset.v || 0) : chip.dataset.v;
    for (const b of $('#rn-filter').querySelectorAll(`.mt-chip[data-f="${chip.dataset.f}"]`)) {
      b.classList.toggle('on', b === chip);
    }
    rnRender();
  });

  /* 크게 보기는 그 판 전체를 목록으로 받습니다 — 창 안의 이전/다음이 4위, 5위로 이어집니다. */
  $('#rn-list').addEventListener('click', e => {
    const b = e.target.closest('.rn-e');
    // 화면과 같은 목록을 넘겨야 합니다 — 무기를 걸어 둔 채 열면 그 무기의 순위대로 넘어갑니다.
    if (b) rkOpenView(Number(b.dataset.i), rkGroup(rnRows()).get(b.dataset.k) || []);
  });
}

function rnRender() {
  /* 줄마다 보는 난이도가 다를 수 있으므로(고룡은 늘 ★8) 통째로 묶어 두고 줄마다 꺼내 씁니다. */
  const g = rkGroup(rnRows());
  const mons = rkFailed ? [] : rkMons();         // 못 불러왔으면 빈 순위표를 그리지 않습니다
  /* 고룡에는 차원변이가 없습니다. 빈 칸을 세워 두면 «없는 것»과 «아직 없는 것»이 같아 보이므로
     아예 칸을 안 만듭니다 — 옛 기록이 남아 있을 때만 그 칸이 다시 나옵니다. */
  const cols = m => Object.keys(RK_VARIANT)
    .map(v => [v, g.get(rnKey(m, v)) || []])
    .filter(([v, l]) => v === 'normal' || m.group !== 'elder' || l.length);

  /* 기록이 있는 몬스터를 위로 올리고, 그 안에서는 게임(재료 탭) 순서 그대로 둡니다.
     sort 는 안정 정렬이라 같은 편끼리는 원래 순서가 유지됩니다. */
  const pick = list => list.map(m => [m, cols(m)]).sort(([, a], [, b]) => rnCount(b) - rnCount(a));
  const normal = pick(mons.filter(m => m.group !== 'elder'));
  const elders = pick(mons.filter(m => m.group === 'elder'));

  $('#rn-list').innerHTML = normal.map(([m, c]) => rnRow(m, c)).join('');
  $('#rn-elders').innerHTML = elders.map(([m, c]) => rnRow(m, c)).join('');
  $('#rn-elders-h').hidden = !mons.length;
  // 화면에 깔린 것만 셉니다 — 고룡이 다른 난이도를 보고 있어 rkRows 전체와는 다릅니다.
  const all = [...normal, ...elders];
  const n = all.reduce((s, [, c]) => s + c.reduce((t, [, l]) => t + l.length, 0), 0);
  $('#rn-count').textContent = `${all.filter(([, c]) => rnCount(c)).length}종 기록 · 총 ${n}건`;

  const state = $('#rn-state');
  state.hidden = !rkFailed;
  state.textContent = '기록을 불러오지 못했습니다. 새로고침해 주세요.';
}

/* 기록이 하나라도 있으면 1, 없으면 0. 정렬은 «있다/없다»로만 가릅니다 —
   건수로 줄을 세우면 3건짜리가 1위 기록이 더 빠른 줄보다 위로 올라옵니다. */
const rnCount = c => (c.some(([, l]) => l.length) ? 1 : 0);

function rnRow(mon, cols) {
  return `
  <li class="rn-row${rnCount(cols) ? '' : ' empty'}">
    <div class="rn-mon">
      <img src="assets/monster/${esc(mon.icon)}.png" width="42" height="42" alt="" loading="lazy">
      <b>${esc(mon.name)}</b>
    </div>
    ${cols.map(([v, list]) => rnCol(mon, v, list)).join('')}
  </li>`;
}

/* 일반 · 차원변이 한 칸씩. 둘은 다른 판이라 왕관도 각자 1 · 2 · 3위입니다. */
function rnCol(mon, variant, list) {
  return `
    <div class="rn-col">
      <p class="rn-h">
        <span class="chip${variant === 'dim' ? ' dim' : ''}">${RK_VARIANT[variant]}</span>
        ${list.length ? `<span class="rn-n">${list.length}건</span>` : ''}
      </p>
      ${list.length ? `<ol class="rn-top">
        ${list.slice(0, 3).map((x, i) => `
          <li><button class="rn-e" type="button" data-k="${esc(rnKey(mon, variant))}" data-i="${i}"
                      aria-label="${esc(mon.name)} ${RK_VARIANT[variant]} ${i + 1}위 ${esc(x.nickname)} ${rkTime(x.time_sec)} 영상 크게 보기">
            ${rkCrown(i + 1)}
            <span class="rn-nick">${esc(x.nickname)}</span>
            <b class="rn-t">${rkTime(x.time_sec)}</b>
            <span class="rn-wp">${esc(rkWeaponName(x.weapon))}${x.style ? ` ${esc(x.style)}` : ''}</span>
          </button></li>`).join('')}
      </ol>` : '<p class="rn-none">아직 기록이 없습니다</p>'}
    </div>`;
}

/* ── 시작 ──────────────────────────────────────────────────────────── */
/* app.js 의 showTab() 이 부릅니다. 첫 호출에서만 화면을 짓고 목록을 받아옵니다. */
function drawRecord() {
  if (rkDrawn) return;
  rkDrawn = true;
  rkFilterUI();
  rkListUI();
  rkModalUI();
  rkFormUI();
  rkReady();
}

function drawRank() {
  if (rnDrawn) return;
  rnDrawn = true;
  rnUI();
  // 리더보드를 먼저 열었으면 이미 받아온 목록으로 즉시, 아니면 다 받은 뒤에 그립니다.
  rkReady().then(rnRender);
}
