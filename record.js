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

/* ── 시간 (1/100초) ───────────────────────────────────────────────── */
const rkTime = cs => {
  const s = Math.floor(cs / 100), m = Math.floor(s / 60);
  return (m ? `${m}:${String(s % 60).padStart(2, '0')}` : String(s % 60))
    + '.' + String(cs % 100).padStart(2, '0');
};

/* '1:23.45' · '83.45' · '83' 을 모두 받습니다. 범위 밖이면 null → 등록에서 막힙니다. */
const rkParse = txt => {
  const m = String(txt == null ? '' : txt).trim().match(/^(?:(\d{1,2}):)?(\d{1,3})(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  const cs = (Number(m[1] || 0) * 60 + Number(m[2])) * 100 + Number(String(m[3] || '0').padEnd(2, '0'));
  return cs >= 100 && cs <= 360000 ? cs : null;
};

/* 빌드 탭에서 복사한 링크(?build=… #build)에서 파라미터만 떼어냅니다.
   나중에 만들 '추천 빌드'가 이 값으로 기록과 빌드를 잇습니다. */
const rkBuildParam = raw => {
  const m = String(raw || '').trim().match(/[?&]build=([^&#\s]+)/);
  return m && m[1].length <= 600 ? m[1] : null;
};

if (typeof module !== 'undefined') module.exports = { rkVid, rkCanon, rkEmbed, rkTime, rkParse, rkBuildParam };

/* ── 상태 ──────────────────────────────────────────────────────────── */
let rkRows = [];
let rkDrawn = false;
const rkF = { star: 0, variant: '', monster: '', weapon: '', style: '' };

const rkMons = () => (typeof MATERIAL === 'undefined' ? [] : MATERIAL.monsters);
const rkMon = id => rkMons().find(m => m.id === id) || null;
const rkWeapons = () => (typeof BUILD === 'undefined' ? [] : BUILD.weaponTypes);
const rkWeaponName = k => (rkWeapons().find(w => w.k === k) || {}).n || k;
const rkStyles = wt => (typeof BD_STYLES !== 'undefined' && BD_STYLES[wt]) || [];

const rkPass = r => (!rkF.star || r.star === rkF.star)
  && (!rkF.variant || r.variant === rkF.variant)
  && (!rkF.monster || r.monster === rkF.monster)
  && (!rkF.weapon || r.weapon === rkF.weapon)
  && (!rkF.style || r.style === rkF.style);

/* ── 목록 ──────────────────────────────────────────────────────────── */
const RK_COLS = 'id,nickname,monster,star,variant,weapon,style,time_cs,video_url,build,created_at';

async function rkLoad() {
  try {
    const r = await rest(`records?select=${RK_COLS}&order=time_cs.asc&limit=${RK_LIMIT}`);
    if (!r.ok) throw new Error(await r.text());
    rkRows = await r.json();
    rkRender();
  } catch (err) {
    console.error(err);
    $('#rk-state').hidden = false;
    $('#rk-state').textContent = '기록을 불러오지 못했습니다. 새로고침해 주세요.';
  }
}

function rkRender() {
  const list = rkRows.filter(rkPass);          // 서버가 이미 time_cs 오름차순으로 줍니다
  /* 순위는 '지금 보고 있는 판'의 순위입니다. 몬스터를 안 고르면 여러 몬스터가
     섞여 있어 숫자가 뜻을 잃으므로, 그때는 번호 대신 몬스터 아이콘만 보여줍니다. */
  const ranked = !!rkF.monster;

  $('#rk-list').innerHTML = list.map((r, i) => rkItem(r, ranked ? i + 1 : 0)).join('');
  $('#rk-count').textContent = list.length === rkRows.length
    ? `${rkRows.length}건`
    : `${list.length}건 / 전체 ${rkRows.length}건`;

  const state = $('#rk-state');
  state.hidden = list.length > 0;
  state.textContent = rkRows.length
    ? '조건에 맞는 기록이 없습니다. 필터를 바꿔보세요.'
    : '아직 등록된 기록이 없습니다. 첫 기록을 올려보세요!';
}

function rkItem(r, rank) {
  const v = rkVid(r.video_url);
  const mon = rkMon(r.monster);
  const icon = mon ? `assets/monster/${esc(mon.icon)}.png` : '';
  return `
  <li class="rk-item" data-id="${r.id}">
    <div class="rk-vid">
      ${v ? `<button class="rk-play" type="button" data-embed="${esc(rkEmbed(v))}" aria-label="영상 재생">
        ${v.kind === 'yt'
          ? `<img src="${esc(rkThumb(v))}" alt="" loading="lazy" onerror="this.hidden=true">`
          : ''}
        <span class="rk-pi" aria-hidden="true">▶</span>
        <span class="rk-src">${v.kind === 'yt' ? 'YouTube' : 'X'}</span>
      </button>` : '<p class="rk-noembed">영상을 표시할 수 없습니다</p>'}
    </div>
    <div class="rk-info">
      <div class="rk-top">
        ${rank ? `<span class="rk-no${rank <= 3 ? ' top' : ''}">${rank}</span>` : ''}
        ${icon ? `<img class="rk-mi" src="${icon}" width="30" height="30" alt="" loading="lazy">` : ''}
        <b class="rk-t">${rkTime(r.time_cs)}</b>
        <button class="icon danger rk-del" data-act="del" aria-label="기록 삭제" title="삭제 (비밀번호 필요)">${TRASH_ICON}</button>
      </div>
      <p class="rk-nick">${esc(r.nickname)}</p>
      <div class="rk-tags">
        <span class="chip">${esc(mon ? mon.name : r.monster)}</span>
        <span class="chip star">★${r.star}</span>
        ${r.variant === 'dim' ? '<span class="chip dim">차원변이</span>' : ''}
        <span class="chip">${esc(rkWeaponName(r.weapon))}${r.style ? ` <b>${esc(r.style)}</b>` : ''}</span>
      </div>
      <div class="rk-links">
        ${r.build ? `<a class="btn ghost" href="?build=${esc(r.build)}#build">빌드 보기</a>` : ''}
        <a class="btn ghost" href="${esc(r.video_url)}" target="_blank" rel="noopener noreferrer">원본 열기</a>
      </div>
    </div>
  </li>`;
}

/* ── 필터 ──────────────────────────────────────────────────────────── */
function rkFilterUI() {
  const chips = (name, items) => `<div class="mt-chips">${
    [['', '전체'], ...items].map(([v, label]) => `
      <button class="mt-chip${v === '' ? ' on' : ''}" data-f="${name}" data-v="${esc(String(v))}">${esc(label)}</button>`).join('')
  }</div>`;

  $('#rk-filter').innerHTML = `
    <p class="stone-label">난이도</p>
    ${chips('star', RK_STARS.map(s => [s, '★' + s]))}
    <p class="stone-label">종류</p>
    ${chips('variant', Object.entries(RK_VARIANT))}
    <p class="stone-label">몬스터 · 무기</p>
    <div class="rk-selects">
      <label class="field"><span>몬스터</span>
        <select id="rk-fmon">
          <option value="">전체</option>
          ${rkMons().map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>무기</span>
        <select id="rk-fwp">
          <option value="">전체</option>
          ${rkWeapons().map(w => `<option value="${esc(w.k)}">${esc(w.n)}</option>`).join('')}
        </select>
      </label>
      <label class="field" id="rk-fstyle-f" hidden><span>스타일</span>
        <select id="rk-fstyle"><option value="">전체</option></select>
      </label>
    </div>`;

  $('#rk-filter').addEventListener('click', e => {
    const chip = e.target.closest('.mt-chip');
    if (!chip) return;
    rkF[chip.dataset.f] = chip.dataset.f === 'star' ? Number(chip.dataset.v || 0) : chip.dataset.v;
    for (const b of $('#rk-filter').querySelectorAll(`.mt-chip[data-f="${chip.dataset.f}"]`)) {
      b.classList.toggle('on', b === chip);
    }
    rkRender();
  });

  $('#rk-fmon').addEventListener('change', e => { rkF.monster = e.target.value; rkRender(); });
  /* 스타일은 무기에 딸린 목록이라 무기를 고른 뒤에만 뜹니다. */
  $('#rk-fwp').addEventListener('change', e => {
    rkF.weapon = e.target.value;
    rkF.style = '';
    const styles = rkStyles(rkF.weapon);
    $('#rk-fstyle-f').hidden = !styles.length;
    $('#rk-fstyle').innerHTML = '<option value="">전체</option>'
      + styles.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    rkRender();
  });
  $('#rk-fstyle').addEventListener('change', e => { rkF.style = e.target.value; rkRender(); });
}

/* ── 재생 · 삭제 ───────────────────────────────────────────────────── */
function rkListUI() {
  $('#rk-list').addEventListener('click', e => {
    const play = e.target.closest('.rk-play');
    if (play) {
      /* 썸네일 자리를 iframe 으로 바꿉니다. X 임베드는 제 높이를 알려주지 않아
         style.css 에서 고정해 두었습니다 — 글이 길면 트윗 안에서 스크롤됩니다. */
      const box = play.parentElement;
      box.classList.add(play.dataset.embed.includes('platform.twitter.com') ? 'x' : 'yt');
      box.innerHTML = `<iframe src="${esc(play.dataset.embed)}" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; clipboard-write" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="토벌 영상"></iframe>`;
      return;
    }
    const del = e.target.closest('[data-act="del"]');
    if (del) rkAskDelete(del.closest('.rk-item').dataset.id);
  });
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
function rkFormUI() {
  const opt = (list, val, label) => list.map(x => `<option value="${esc(String(val(x)))}">${esc(String(label(x)))}</option>`).join('');
  $('#rk-mon').innerHTML = opt(rkMons(), m => m.id, m => m.name);
  $('#rk-wp').innerHTML = opt(rkWeapons(), w => w.k, w => w.n);
  $('#rk-star').innerHTML = opt(RK_STARS, s => s, s => '★' + s);
  $('#rk-var').innerHTML = opt(Object.entries(RK_VARIANT), v => v[0], v => v[1]);

  // 대부분의 기록이 10성이라 기본값으로 둡니다. 잘못 올려도 지우려면 비밀번호가 필요합니다.
  $('#rk-star').value = '10';

  /* 스타일은 무기에 딸린 목록입니다. 무기가 바뀌면(등록 후 form.reset() 포함) 다시 채웁니다. */
  $('#rk-wp').addEventListener('change', () => {
    const styles = rkStyles($('#rk-wp').value);
    $('#rk-style-f').hidden = !styles.length;
    $('#rk-style').innerHTML = '<option value="">선택 안 함</option>' + opt(styles, s => s, s => s);
  });
  $('#rk-wp').dispatchEvent(new Event('change'));

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

  $('#rk-open').addEventListener('click', () => { $('#rk-err').hidden = true; $('#rk-reg').showModal(); $('#rk-nick').focus(); });
  $('#rk-cancel').addEventListener('click', () => $('#rk-reg').close());
  $('#rk-reg').addEventListener('click', e => { if (e.target === $('#rk-reg')) $('#rk-reg').close(); });
  $('#rk-reg-form').addEventListener('submit', rkSubmit);

  $('#rk-del-cancel').addEventListener('click', () => $('#rk-del').close());
  $('#rk-del').addEventListener('click', e => { if (e.target === $('#rk-del')) $('#rk-del').close(); });
  $('#rk-del-form').addEventListener('submit', rkDelete);
}

async function rkSubmit(e) {
  e.preventDefault();
  const err = $('#rk-err');
  const nickname = $('#rk-nick').value.trim().replace(/\s+/g, ' ');
  const time_cs = rkParse($('#rk-time').value);
  const vid = rkVid($('#rk-url').value);
  const buildRaw = $('#rk-build').value.trim();
  const build = rkBuildParam(buildRaw);
  const password = $('#rk-pw').value;

  const bad = !nickname ? '닉네임을 입력해 주세요.'
    : nickname.length > 20 ? '닉네임은 20자 이내로 입력해 주세요.'
    : time_cs == null ? '시간은 1:23.45 또는 83.45 형식으로 입력해 주세요.'
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
    monster: $('#rk-mon').value,
    star: Number($('#rk-star').value),
    variant: $('#rk-var').value,
    weapon: $('#rk-wp').value,
    style: $('#rk-style').value || null,
    time_cs,
    video_url: rkCanon(vid),
    build,
  };
  try {
    const r = await rest('rpc/add_record', {
      method: 'POST',
      body: JSON.stringify({
        p_nickname: row.nickname, p_monster: row.monster, p_star: row.star,
        p_variant: row.variant, p_weapon: row.weapon, p_style: row.style,
        p_time_cs: row.time_cs, p_video_url: row.video_url, p_build: row.build,
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
    // 시간순 자리에 그대로 끼웁니다. 다시 받아올 이유가 없습니다.
    const at = rkRows.findIndex(x => x.time_cs > row.time_cs);
    rkRows.splice(at < 0 ? rkRows.length : at, 0, row);
    rkRender();
    $('#rk-reg').close();
    $('#rk-reg-form').reset();
    // reset() 은 선택칸을 첫 항목으로 되돌립니다. 기본값과 스타일 목록을 다시 맞춰줍니다.
    $('#rk-star').value = '10';
    $('#rk-wp').dispatchEvent(new Event('change'));
    $('#rk-preview').className = 'preview';
    $('#rk-preview').innerHTML = '<p>유튜브(숏츠 포함) 또는 X 영상 주소를 붙여넣어 주세요. 주소만 넣으면 영상이 붙습니다.</p>';
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
    rkRender();
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

/* ── 시작 ──────────────────────────────────────────────────────────── */
/* app.js 의 showTab() 이 부릅니다. 첫 호출에서만 화면을 짓고 목록을 받아옵니다. */
function drawRecord() {
  if (rkDrawn) return;
  rkDrawn = true;
  rkFilterUI();
  rkListUI();
  rkFormUI();
  rkLoad();
}
