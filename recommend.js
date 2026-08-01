/* 추천 빌드 탭 — 남들이 쓰라고 올려 둔 빌드 목록.
 *
 * 데이터: Supabase 의 public.recommended_ranked (supabase/schema.sql).
 * 추천도(score)는 DB 가 계산합니다 — 오래될수록 낮아지고, 좋아요는 올리고
 * 싫어요는 더 크게 내리고, 초보자 + 파밍 쉬움이면 크게 올립니다.
 * 브라우저에서 계산하면 사람마다 기준이 달라질 수 있어 서버에 둡니다.
 *
 * 읽기는 한 번에 다 받아 브라우저에서 거릅니다. 필터가 여섯 종류라 조합마다
 * 서버를 다시 부르면 요청이 폭발합니다.
 *
 * app.js 의 $ / esc / toast / rest / when / TRASH_ICON 을 함수 안에서만 씁니다.
 * 무기 목록은 build-data.js 의 BUILD 를 그대로 씁니다.
 */

const RC_LIMIT = 300;
const RC_TIER = { beginner: '초보자', expert: '숙련자' };
const RC_SCENE = { field: '필드사냥', intercept: '요격전', swarm: '대량출현', chain: '대연속', elder: '고룡토벌' };
const RC_PARTY = { solo: '개인전', party: '파티사냥' };
const RC_COLS = 'id,nickname,title,build,weapon,tier,scenes,party,easy_farm,up,down,created_at,score,comments';

const RC_CM_ICON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/></svg>';

/* 좁은 화면에서는 글자를 감추고 이 그림만 남깁니다(.rc-act .lbl).
   별은 빌드 탭의 «추천 빌드로 등록» 과 같은 것을 씁니다 — BD_I.star. */
const RC_I = {
  eye: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  use: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11m0 0 4.5-4.5M12 14l-4.5-4.5M4 20h16"/></svg>',
};

let rcRows = [];
let rcMine = {};                 // { 빌드id: 1 | -1 }  내가 누른 것
let rcFilter = { weapon: '', tier: '', scene: '', party: '', easy: false };
let rcLoaded = false;

/* 기기 식별자. 표를 기기당 한 번으로 묶는 데만 씁니다(서버는 여기에 IP 를 더해 해싱).
   지우면 다시 누를 수 있지만, IP 가 같으면 서버가 같은 사람으로 봅니다. */
function rcDevice() {
  let d = localStorage.getItem('mhnkr.device');
  if (!d) {
    d = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2) + Date.now();
    localStorage.setItem('mhnkr.device', d);
  }
  return d;
}

const rcWeapons = () => (typeof BUILD !== 'undefined' ? BUILD.weaponTypes : []);
const rcWeaponName = (k) => (rcWeapons().find(w => w.k === k) || {}).n || k;

/* ── 목록 ─────────────────────────────────────────────────────────── */
async function rcLoad() {
  const box = $('#rc-list');
  box.innerHTML = '<p class="bd-empty">불러오는 중…</p>';
  try {
    const r = await rest(`recommended_ranked?select=${RC_COLS}&order=score.desc,created_at.desc&limit=${RC_LIMIT}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    rcRows = await r.json();
  } catch (e) {
    /* 실패는 «받아왔음» 이 아닙니다. 되돌려 놓지 않으면 탭을 다시 열었을 때
       다시 받아오지도 않고 «아직 등록된 추천 빌드가 없습니다» 로 굳습니다. */
    rcLoaded = false;
    box.innerHTML = '<p class="bd-empty">목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.</p>';
    return;
  }
  /* 내가 무엇을 눌렀는지는 따로 물어봅니다. 표 자체는 남에게 보이면 안 되므로
     목록에 섞어 내려주지 않습니다. */
  try {
    const r = await rest('rpc/my_recommended_votes', {
      method: 'POST',
      body: JSON.stringify({ p_ids: rcRows.map(x => x.id), p_device: rcDevice() }),
    });
    rcMine = r.ok ? await r.json() : {};
  } catch (e) { rcMine = {}; }
  rcRender();
}

function rcMatch(r) {
  const f = rcFilter;
  if (f.weapon && r.weapon !== f.weapon) return false;
  if (f.tier && r.tier !== f.tier) return false;
  if (f.scene && !(r.scenes || []).includes(f.scene)) return false;
  if (f.party && !(r.party || []).includes(f.party)) return false;
  if (f.easy && !r.easy_farm) return false;
  return true;
}

function rcRender() {
  rcChips();
  const rows = rcRows.filter(rcMatch);
  $('#rc-count').textContent = `${rows.length}개`;
  $('#rc-list').innerHTML = rows.length
    ? rows.map((r, i) => rcCard(r, i + 1)).join('')
    : `<p class="bd-empty">${rcRows.length ? '조건에 맞는 빌드가 없습니다.' : '아직 등록된 추천 빌드가 없습니다. 빌드 탭에서 올려 보세요.'}</p>`;
}

function rcCard(r, rank) {
  const mine = rcMine[r.id];
  const tags = [
    `<span class="rc-t tier ${r.tier}">${RC_TIER[r.tier] || r.tier}</span>`,
    ...(r.scenes || []).map(s => `<span class="rc-t">${esc(RC_SCENE[s] || s)}</span>`),
    ...(r.party || []).map(s => `<span class="rc-t">${esc(RC_PARTY[s] || s)}</span>`),
    r.easy_farm ? '<span class="rc-t easy">파밍 쉬움</span>' : '',
  ].filter(Boolean).join('');

  return `<article class="rc-card" data-rc="${r.id}">
    <header>
      <span class="rc-rank">${rank}</span>
      <b class="rc-title">${esc(r.title || rcWeaponName(r.weapon) + ' 빌드')}</b>
      <span class="rc-wp">${esc(rcWeaponName(r.weapon))}</span>
    </header>
    <p class="rc-by">${esc(r.nickname)} · ${when(r.created_at)}
      <button class="icon danger rc-del" data-act="del" aria-label="추천 빌드 삭제" title="삭제 (비밀번호 필요)">${TRASH_ICON}</button>
    </p>
    ${rcBrief(r)}
    <div class="rc-tags">${tags}</div>
    <div class="rc-act">
      <button class="rc-v up${mine === 1 ? ' on' : ''}" data-vote="${r.id}:1" title="좋아요">▲ <b>${r.up}</b></button>
      <button class="rc-v down${mine === -1 ? ' on' : ''}" data-vote="${r.id}:-1" title="싫어요">▼ <b>${r.down}</b></button>
      <button class="rc-v cm" data-rc-cm="${r.id}" title="댓글 보기">${RC_CM_ICON} <b>${r.comments || 0}</b></button>
      <span class="rc-do">
        <span class="rc-t score" title="추천도 ${r.score} — 오래될수록 낮아지고 좋아요·싫어요가 반영됩니다"
              aria-label="추천도 ${r.score}">${BD_I.star}<b>${r.score}</b></span>
        <button class="btn ghost" data-rc-view="${r.id}" title="미리보기" aria-label="미리보기">${RC_I.eye}<span class="lbl">미리보기</span></button>
        <button class="btn ghost" data-rc-use="${r.id}" title="내 빌드로 가져오기" aria-label="내 빌드로 가져오기">${RC_I.use}<span class="lbl">가져오기</span></button>
      </span>
    </div>
  </article>`;
}

/* 카드에 얹는 간략 정보 — 장비 여섯 칸과 합산 스킬. 그리는 일은 build.js 가 합니다.
   빌드 문자열을 푸는 규칙이 한 군데만 있어야 옛 등록이 안 깨집니다. */
function rcBrief(r) {
  if (typeof bdParse !== 'function') return '';
  const b = bdParse(r.build, r.title);
  if (!b) return '';
  return `<div class="rc-brief" data-rc-open="${r.id}" title="눌러서 자세히 보기">
    ${bdIconRow(b)}${bdChipRow(b)}${bdStoneChips(b)}
  </div>`;
}

/* 미리보기 모달. 모바일에서는 장비 검색 모달과 같이 화면을 꽉 채웁니다. */
function rcView(id, toComments) {
  const r = rcRows.find(x => x.id === id);
  if (!r || typeof bdPreviewHtml !== 'function') return;
  const b = bdParse(r.build, r.title);
  if (!b) return toast('빌드를 읽지 못했습니다');
  $('#rc-view-title').textContent = r.title || rcWeaponName(r.weapon) + ' 빌드';
  $('#rc-view-sub').textContent =
    `${rcWeaponName(r.weapon)} · ${r.nickname} · 추천도 ${r.score}`;
  $('#rc-view-gear').innerHTML = bdPreviewHtml(b);
  $('#rc-view-use').dataset.rcUse = id;
  /* 창을 먼저 띄워야 스크롤 위치를 잴 수 있고, 목록을 다 받은 뒤라야 «댓글» 머리가
     제자리에 있습니다(불러오는 동안은 한 줄이라 자리가 어긋납니다). */
  $('#rc-view-body').scrollTop = 0;
  const drawn = rcCmOpen(id);
  $('#rc-view').showModal();
  if (toComments) drawn.then(() => $('#rc-cm').scrollIntoView({ block: 'start' }));
}

/* ── 댓글 ─────────────────────────────────────────────────────────── */
/* 지금 열려 있는 빌드. 창이 하나뿐이라 하나만 들고 있으면 됩니다. */
let rcCmId = null;

/* 창을 열 때마다 새로 받습니다. 한 빌드에 몇 줄뿐이라 캐시할 가치가 없고,
   남이 방금 단 댓글이 안 보이는 편이 훨씬 나쁩니다. */
async function rcCmOpen(id) {
  rcCmId = id;
  const row = rcRows.find(x => x.id === id);
  $('#rc-cm-n').textContent = (row && row.comments) || 0;
  $('#rc-cm-err').hidden = true;
  $('#rc-cm-body').value = '';
  if (!$('#rc-cm-nick').value) $('#rc-cm-nick').value = lastNick();
  $('#rc-cm-nick-hint').hidden = true;
  $('#rc-cm-list').innerHTML = '<li class="rc-cm-empty">불러오는 중…</li>';
  try {
    const r = await rest(`recommended_comments_public?select=id,nickname,body,created_at`
      + `&build_id=eq.${id}&order=created_at.asc`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    /* 창이 이미 닫혔거나 다른 빌드로 넘어갔으면 늦게 온 응답은 버립니다. */
    if (rcCmId !== id) return;
    rcCmDraw(id, await r.json());
  } catch (e) {
    if (rcCmId === id) $('#rc-cm-list').innerHTML = '<li class="rc-cm-empty">댓글을 불러오지 못했습니다.</li>';
  }
}

/* 목록과 개수를 한 번에 맞춥니다. 카드의 «댓글 N» 도 같이 고쳐야 창을 닫았을 때
   숫자가 어긋나지 않습니다. */
function rcCmDraw(id, list) {
  $('#rc-cm-n').textContent = list.length;
  $('#rc-cm-list').innerHTML = list.length
    ? list.map(c => `<li class="rc-cm-i" data-cm="${c.id}">
        <p class="rc-cm-by">${esc(c.nickname)} · ${when(c.created_at)}
          <button class="icon danger rc-cm-del" data-act="cmdel" aria-label="댓글 삭제" title="삭제 (비밀번호 필요)">${TRASH_ICON}</button>
        </p>
        <p class="rc-cm-b">${esc(c.body)}</p>
      </li>`).join('')
    : '<li class="rc-cm-empty">아직 댓글이 없습니다. 먼저 한마디 남겨 보세요.</li>';
  const row = rcRows.find(x => x.id === id);
  if (row) { row.comments = list.length; rcRender(); }
}

$('#rc-cm-list').addEventListener('click', e => {
  const d = e.target.closest('[data-act="cmdel"]');
  if (d) rcAskDelete(+d.closest('[data-cm]').dataset.cm, 'comment');
});

$('#rc-cm-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#rc-cm-err');
  err.hidden = true;
  const nick = $('#rc-cm-nick').value.trim().replace(/\s+/g, ' ');
  const pw = $('#rc-cm-pw').value;
  const body = $('#rc-cm-body').value.trim();
  const bad = !nick ? '닉네임을 입력해 주세요.'
    : !body ? '내용을 입력해 주세요.'
    : pw.length < PW_MIN ? `비밀번호는 ${PW_MIN}자 이상이어야 합니다.` : null;
  if (bad) { err.textContent = bad; err.hidden = false; return; }

  const btn = $('#rc-cm-submit');
  btn.disabled = true;
  try {
    const r = await rest('rpc/add_recommended_comment', {
      method: 'POST',
      body: JSON.stringify({ p_build_id: rcCmId, p_nickname: nick, p_body: body, p_password: pw }),
    });
    /* 서버가 왜 거절했는지 그대로 보여 줍니다 — 길이 제한처럼 다시 눌러도
       소용없는 실패를 «잠시 뒤 다시» 로 뭉뚱그리면 알아볼 길이 없습니다. */
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || `HTTP ${r.status}`);
    saveNick(nick);
    $('#rc-cm-body').value = '';
    await rcCmOpen(rcCmId);
  } catch (e2) {
    err.textContent = '댓글을 남기지 못했습니다 — ' + e2.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

/* 닉네임 자동완성. 등록창·리더보드와 같은 것을 씁니다 — app.js 의 nickAuto(). */
nickAuto('#rc-cm-nick', '#rc-cm-nick-list', '#rc-cm-nick-hint');

/* 필터 칩. 무기는 전체 + 14종, 나머지는 전체 + 항목입니다. */
function rcChips() {
  const chip = (kind, val, label, on) =>
    `<button class="rc-c${on ? ' on' : ''}" data-f="${kind}:${esc(val)}">${esc(label)}</button>`;
  $('#rc-f-weapon').innerHTML = chip('weapon', '', '전체', !rcFilter.weapon)
    + rcWeapons().map(w => chip('weapon', w.k, w.n, rcFilter.weapon === w.k)).join('');
  $('#rc-f-rest').innerHTML =
    Object.entries(RC_TIER).map(([k, v]) => chip('tier', k, v, rcFilter.tier === k)).join('')
    + '<i class="rc-sep"></i>'
    + Object.entries(RC_SCENE).map(([k, v]) => chip('scene', k, v, rcFilter.scene === k)).join('')
    + '<i class="rc-sep"></i>'
    + Object.entries(RC_PARTY).map(([k, v]) => chip('party', k, v, rcFilter.party === k)).join('')
    + '<i class="rc-sep"></i>'
    + chip('easy', '1', '파밍 쉬움', rcFilter.easy);
}

/* ── 좋아요 / 싫어요 ─────────────────────────────────────────────── */
async function rcVote(id, v) {
  try {
    const r = await rest('rpc/vote_recommended_build', {
      method: 'POST',
      body: JSON.stringify({ p_id: id, p_vote: v, p_device: rcDevice() }),
    });
    if (!r.ok) {
      /* 한 IP 가 한 빌드에 넣을 수 있는 표에 상한이 있습니다(schema.sql 의 VOTE_PER_IP).
         왜 안 되는지 알려주지 않으면 눌러도 아무 일이 없는 것처럼 보입니다. */
      const msg = (await r.json().catch(() => ({}))).message || '';
      throw new Error(msg.includes('VOTE_LIMIT') ? '같은 곳에서 이미 여러 번 투표했습니다' : 'HTTP ' + r.status);
    }
    const out = await r.json();
    const row = rcRows.find(x => x.id === id);
    /* score 도 서버가 up/down 으로 다시 계산한 값이라 같이 받아 갱신해야 합니다.
       안 그러면 ▲를 눌러 숫자는 오르는데 옆의 추천도 배지가 옛 값으로 남습니다. */
    if (row) { row.up = out.up; row.down = out.down; if (out.score != null) row.score = out.score; }
    if (out.mine == null) delete rcMine[id]; else rcMine[id] = out.mine;
    rcRender();
  } catch (e) {
    toast(/VOTE_LIMIT|이미 여러 번/.test(e.message) ? e.message : '표를 반영하지 못했습니다');
  }
}

/* ── 가져오기 ─────────────────────────────────────────────────────── */
/* 빌드 탭에 새 카드로 얹고 그 탭으로 넘깁니다. 남의 빌드가 내 것을 덮으면 안 되므로
   덮어쓰지 않고 항상 새 카드로 만듭니다. */
function rcUse(id) {
  const row = rcRows.find(x => x.id === id);
  if (!row) return;
  if (typeof bdAdopt !== 'function') { location.href = `?build=${row.build}#build`; return; }
  const ok = bdAdopt(row.build, row.title || `${rcWeaponName(row.weapon)} 빌드`);
  if (!ok) return;                    // 이유는 bdAdopt 가 이미 알렸습니다
  location.hash = '#build';
  toast('내 빌드에 담았습니다');
}

/* ── 삭제 ─────────────────────────────────────────────────────────── */
/* 빌드와 댓글이 창 하나를 같이 씁니다. 묻는 것도(비밀번호) 규칙도 같아서
   창을 하나 더 두면 마크업만 두 벌이 됩니다. kind 로 부를 함수만 갈립니다. */
let rcDelId = null;
let rcDelKind = 'build';
function rcAskDelete(id, kind = 'build') {
  let what;
  if (kind === 'comment') {
    const li = $('#rc-cm-list').querySelector(`[data-cm="${id}"]`);
    if (!li) return;
    what = `<b>댓글</b> · ${esc(li.querySelector('.rc-cm-b').textContent.slice(0, 40))}`;
  } else {
    const row = rcRows.find(x => x.id === id);
    if (!row) return;
    what = `<b>${esc(row.title || rcWeaponName(row.weapon) + ' 빌드')}</b> · ${esc(row.nickname)}`;
  }
  rcDelId = id;
  rcDelKind = kind;
  $('#rc-del h2').textContent = kind === 'comment' ? '댓글 삭제' : '추천 빌드 삭제';
  $('#rc-del-what').innerHTML = what;
  $('#rc-del-pw').value = '';
  $('#rc-del-err').hidden = true;
  $('#rc-del').showModal();
}

/* ── 붙이기 ───────────────────────────────────────────────────────── */
function drawRecommend() {
  if (!rcLoaded) { rcLoaded = true; rcLoad(); }
  else rcRender();
}

$('#rc-f-weapon').addEventListener('click', e => {
  const c = e.target.closest('[data-f]');
  if (!c) return;
  const [kind, val] = c.dataset.f.split(/:(.*)/);
  rcFilter[kind] = val;
  rcRender();
});
$('#rc-f-rest').addEventListener('click', e => {
  const c = e.target.closest('[data-f]');
  if (!c) return;
  const [kind, val] = c.dataset.f.split(/:(.*)/);
  /* 같은 칩을 다시 누르면 해제됩니다. 칩마다 «전체» 를 두면 줄이 두 배가 됩니다. */
  if (kind === 'easy') rcFilter.easy = !rcFilter.easy;
  else rcFilter[kind] = rcFilter[kind] === val ? '' : val;
  rcRender();
});
$('#rc-list').addEventListener('click', e => {
  const d = e.target.closest('[data-act="del"]');
  if (d) return rcAskDelete(+d.closest('[data-rc]').dataset.rc);
  const v = e.target.closest('[data-vote]');
  if (v) { const [id, val] = v.dataset.vote.split(':'); return rcVote(+id, +val); }
  const u = e.target.closest('[data-rc-use]');
  if (u) return rcUse(+u.dataset.rcUse);
  /* 댓글 아이콘으로 열면 댓글이 보이는 자리에서 시작합니다. 장비부터 열리면
     «댓글» 을 눌렀는데 또 내려야 합니다. */
  const c = e.target.closest('[data-rc-cm]');
  if (c) return rcView(+c.dataset.rcCm, true);
  const v2 = e.target.closest('[data-rc-view]');
  if (v2) return rcView(+v2.dataset.rcView);
  /* 장비 줄을 눌러도 열립니다 — 버튼을 못 찾는 사람이 없도록. */
  const o = e.target.closest('[data-rc-open]');
  if (o) return rcView(+o.dataset.rcOpen);
});

$('#rc-view-close').addEventListener('click', () => $('#rc-view').close());
$('#rc-view-use').addEventListener('click', e => {
  $('#rc-view').close();
  rcUse(+e.currentTarget.dataset.rcUse);
});

$('#rc-del-cancel').addEventListener('click', () => $('#rc-del').close());
$('#rc-del-form').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = $('#rc-del-pw').value;
  const err = $('#rc-del-err');
  err.hidden = true;
  try {
    const isCm = rcDelKind === 'comment';
    const r = await rest(`rpc/delete_recommended_${isCm ? 'comment' : 'build'}`, {
      method: 'POST', body: JSON.stringify({ p_id: rcDelId, p_password: pw }),
    });
    const ok = r.ok && (await r.json()) === true;
    if (!ok) { err.textContent = '비밀번호가 다릅니다.'; err.hidden = false; return; }
    $('#rc-del').close();
    if (isCm) {
      /* 지운 뒤 목록을 다시 받습니다 — 개수와 카드의 «댓글 N» 이 한 번에 맞습니다. */
      await rcCmOpen(rcCmId);
    } else {
      rcRows = rcRows.filter(x => x.id !== rcDelId);
      rcRender();
    }
    toast('삭제했습니다');
  } catch (e2) {
    err.textContent = '삭제하지 못했습니다.'; err.hidden = false;
  }
});

/* app.js 가 showTab() 을 이미 부른 뒤에 이 파일이 읽히므로, 첫 화면이
   추천빌드 탭이면 여기서 한 번 그려 줍니다. */
if (!$('#panel-recommend').hidden) drawRecommend();

/* ── 리더보드에서 쓰기 ────────────────────────────────────────────
   기록 등록 폼의 «빌드 링크» 칸을 채웁니다. 링크를 직접 복사해 오는 대신
   «내 빌드»(빌드 탭에 저장해 둔 것)나 «추천 빌드» 중에서 고르면 됩니다.
   record.js 는 건드리지 않고 그 칸의 값만 넣어 주므로 저쪽 검증(rkBuildParam)이
   그대로 통합니다. */
let rcPickWt = '';       // 기록 등록 폼에서 고른 무기. 같은 무기를 위로 올립니다.

/* 내 빌드. 상태(bdState)도 직렬화(bdShareParam)도 build.js 가 갖고 있어 그대로 빌려 씁니다.
   빌드를 푸는 규칙이 한 군데만 있어야 옛 등록이 안 깨집니다. */
function rcMyBuilds() {
  if (typeof bdState === 'undefined' || typeof bdShareParam !== 'function') return [];
  return (bdState.builds || [])
    .map((b, i) => ({ b, i }))
    // 무기도 방어구도 없는 빈 카드는 가져와 봐야 아무것도 안 남습니다.
    .filter(({ b }) => b.w || BUILD.parts.some(p => b[p.k]))
    .map(({ b, i }) => {
      const w = typeof bdWeaponOf === 'function' ? bdWeaponOf(b) : null;
      const worn = BUILD.parts.filter(p => b[p.k]).length;
      return {
        i,
        weapon: b.wt,
        title: (b.n || '').trim() || rcWeaponName(b.wt) + ' 빌드',
        sub: [w ? w.name : '무기 없음', `방어구 ${worn}부위`,
          typeof bdStats === 'function' ? `점수 ${bdStats(b).score}` : ''].filter(Boolean).join(' · '),
      };
    });
}

/* 목록이 길어지면 훑기 어려워 검색을 답니다. 화면에 보이는 것(제목·무기·닉네임·상황)을
   그대로 훑습니다 — 보이지 않는 값으로 걸리면 왜 나왔는지 알 수 없습니다. */
function rcPickFill(q) {
  const norm = s => String(s).toLowerCase().replace(/\s+/g, '');
  const needle = norm(q || '');
  const hit = txt => !needle || norm(txt).includes(needle);
  const same = wt => (wt === rcPickWt ? ' <i class="rc-same">무기 일치</i>' : '');

  const mine = rcMyBuilds().filter(m => hit(m.title + m.sub + rcWeaponName(m.weapon)));
  const rows = [...rcRows]
    /* 기록의 무기와 빌드의 무기가 다르면 보는 사람이 헷갈리므로 같은 것을 먼저 보여 줍니다. */
    .sort((a, b) => (b.weapon === rcPickWt) - (a.weapon === rcPickWt) || b.score - a.score)
    .filter(r => hit([r.title || '', rcWeaponName(r.weapon), r.nickname,
      ...(r.scenes || []).map(s => RC_SCENE[s] || s)].join('')));

  const total = rcMyBuilds().length + rcRows.length;
  const shown = mine.length + rows.length;
  $('#rc-pick-count').textContent = total
    ? (shown === total ? `${total}개` : `${shown}개 / 전체 ${total}개`)
    : '';

  const html = [];
  if (mine.length) {
    html.push('<p class="bd-gh">내 빌드</p>');
    html.push(...mine.map(m => `
      <button type="button" class="bd-lr gear" data-my-pick="${m.i}">
        <span class="bd-lt">
          <b>${esc(m.title)}${same(m.weapon)}</b>
          <i>${esc(m.sub)}</i>
        </span>
      </button>`));
  }
  if (rows.length) {
    html.push('<p class="bd-gh">추천 빌드</p>');
    html.push(...rows.map(r => `
      <button type="button" class="bd-lr gear" data-rc-pick="${r.id}">
        <span class="bd-lt">
          <b>${esc(r.title || rcWeaponName(r.weapon) + ' 빌드')}${same(r.weapon)}</b>
          <i>${esc(rcWeaponName(r.weapon))} · ${esc(r.nickname)} · 추천도 ${r.score}</i>
          <span class="bd-ls">${(r.scenes || []).map(s => `<em>${esc(RC_SCENE[s] || s)}</em>`).join('')}</span>
        </span>
      </button>`));
  }
  $('#rc-pick-list').innerHTML = html.length ? html.join('')
    : `<p class="bd-empty">${total ? '검색 결과가 없습니다.'
        : '빌드 탭에서 빌드를 만들거나, 추천빌드 탭에 올라온 것을 기다려 주세요.'}</p>`;
}

$('#rk-from-rc').addEventListener('click', async () => {
  $('#rc-pick-list').innerHTML = '<p class="bd-empty">불러오는 중…</p>';
  $('#rc-pick-count').textContent = '';
  $('#rc-pick-q').value = '';
  $('#rc-pickdlg').showModal();
  /* 저장해 둔 내 빌드는 빌드 탭을 한 번 열어야 localStorage 에서 올라옵니다.
     리더보드부터 연 사람도 내 빌드를 볼 수 있도록 여기서 부릅니다(안이 멱등입니다). */
  if (typeof drawBuild === 'function') drawBuild();
  if (!rcRows.length) await rcLoad();
  /* 무기는 record.js 의 rkForm 에서 읽습니다. 그 칸은 선택칸이 아니라 모달 버튼이라
     value 가 비어 있습니다. */
  rcPickWt = (typeof rkForm !== 'undefined' && rkForm.weapon) || '';
  rcPickFill('');
});

$('#rc-pick-q').addEventListener('input', e => rcPickFill(e.target.value));

$('#rc-pick-cancel').addEventListener('click', () => $('#rc-pickdlg').close());
$('#rc-pick-list').addEventListener('click', e => {
  const my = e.target.closest('[data-my-pick]');
  if (my) return rcPickApply(bdShareParam(+my.dataset.myPick));
  const b = e.target.closest('[data-rc-pick]');
  if (!b) return;
  const row = rcRows.find(x => x.id === +b.dataset.rcPick);
  if (row) rcPickApply(row.build);
});

/* record.js 가 ?build= 를 찾아 파라미터만 떼어 가므로 전체 주소 형태로 넣습니다. */
function rcPickApply(param) {
  $('#rk-build').value = `${location.origin}${location.pathname}?build=${param}#build`;
  $('#rc-pickdlg').close();
  toast('빌드를 넣었습니다');
}
