/* 빌드 탭 — 여러 빌드를 카드로 만들고 스킬 합계를 비교합니다.
 *
 * 데이터: build-data.js(BUILD, 장비·무기), build-styles.js(BD_SP/BD_STYLES),
 *         smelt-data.js(SMELT, 표류석 색상별 스킬 풀).
 * 장비 등급은 항상 최대(10 Lv5) 기준입니다.
 *
 * app.js 와 파일을 나눈 이유: 빌드 화면이 크고 독립적이라 서로의 편집이 얽히지 않게
 * 하려는 것입니다. app.js 의 showTab() 이 drawBuild() 를 부릅니다.
 */

const BD_KEY = 'mhnkr.builds';
const BD_MAX = 8;                 // 카드 상한. 이 이상은 비교가 아니라 목록이 됩니다.
const BD_PARTS = () => BUILD.parts;

/* 표류석: 색상별 스킬 풀을 표류연성 데이터에서 그대로 가져옵니다.
   같은 정보를 두 곳에 두면 게임 업데이트 때 한쪽만 낡습니다. */
const bdStones = () => (typeof SMELT === 'undefined' ? [] : SMELT.groups);

const bdNewBuild = () => ({
  n: '', w: null, wt: 'shield-sword', st: 0,
  helm: null, mail: null, gloves: null, belt: null, greaves: null,
  ds: { helm: [], mail: [], gloves: [], belt: [], greaves: [] },
});

let bdState = { builds: [bdNewBuild()], detail: false };

const bdSet = key => BUILD.sets.find(s => s.key === key);
const bdWeaponOf = b => {
  const s = bdSet(b.w);
  return s ? s.weapons.find(w => w.t === b.wt) || null : null;
};
const bdStylesOf = wt => (typeof BD_STYLES !== 'undefined' && BD_STYLES[wt]) || [];
const bdSpOf = wt => (typeof BD_SP !== 'undefined' && BD_SP[wt]) || null;

function bdSave() {
  localStorage.setItem(BD_KEY, JSON.stringify(bdState));
}

/* 부위가 가진 표류 슬롯 수. 슬롯보다 많이 끼워진 표류석은 무시합니다. */
function bdSlotCount(b, part) {
  const s = bdSet(b[part]);
  return s && s.pieces[part] ? s.pieces[part].slot : 0;
}

/* 한 빌드의 스킬 합계 — 장비 + 무기 + 표류석 */
function bdTotals(b) {
  const total = new Map();
  const add = (name, lv) => total.set(name, (total.get(name) || 0) + lv);
  const ws = bdSet(b.w);
  if (ws) ws.weaponSkills.forEach(x => add(x.s, x.lv));
  for (const { k } of BD_PARTS()) {
    const s = bdSet(b[k]);
    if (s && s.pieces[k]) s.pieces[k].skills.forEach(x => add(x.s, x.lv));
    /* 표류석은 스킬 레벨 1을 줍니다. 예전 저장값에 lv 2·3 이 남아 있어도 1로 셉니다. */
    (b.ds[k] || []).slice(0, bdSlotCount(b, k)).forEach(d => { if (d && d.s) add(d.s, 1); });
  }
  return [...total.entries()].sort((a, b2) => b2[1] - a[1] || a[0].localeCompare(b2[0], 'ko'));
}

/* ── 공유 ──────────────────────────────────────────────────────── */
/* 링크 복사와 카카오톡 공유가 같은 URL 을 씁니다.
   표류석은 `ds=부위|칸|색상|스킬;…` 로 담습니다. 구분자는 기존 형식이 쓰는
   ',' 와 '=' 를 피해 ';' 와 '|' 를 골랐습니다. 색상·스킬을 이름으로 적는 건
   smelt-data.js 를 다시 만들어 순서가 바뀌어도 옛 링크가 살아 있어야 하기 때문입니다. */
function bdShareParam(bi) {
  const b = bdState.builds[bi];
  const ds = [];
  for (const { k } of BD_PARTS()) {
    (b.ds[k] || []).slice(0, bdSlotCount(b, k)).forEach((d, i) => {
      if (d && d.s) ds.push(`${k}|${i}|${d.c}|${d.s}`);
    });
  }
  const p = [`w=${b.w || ''}`, `wt=${b.wt}`, b.st ? `st=${b.st}` : '', ds.length ? `ds=${ds.join(';')}` : '']
    .concat(BD_PARTS().map(({ k }) => `${k}=${b[k] || ''}`)).filter(Boolean).join(',');
  return encodeURIComponent(p);
}
/* 링크 복사는 지금 보고 있는 주소를 씁니다(로컬에서 붙여넣어 확인할 수 있게).
   카카오·공유 시트로 나가는 링크는 받는 사람이 열 수 있어야 하므로 배포 절대 주소를 씁니다.
   배포 환경에서는 둘이 같은 값입니다. */
const bdShareURL = bi => `${location.origin}${location.pathname}?build=${bdShareParam(bi)}#build`;

const bdCopyLink = (url, msg = '링크를 복사했습니다') => navigator.clipboard.writeText(url)
  .then(() => toast(msg)).catch(() => toast('복사 실패'));

/* 카카오톡 카드에 넣을 제목·설명. 정적 사이트라 og 태그는 빌드마다 바꿀 수 없어서
   카드 내용을 공유할 때 넘겨줍니다. */
function bdShareText(b) {
  const w = bdWeaponOf(b);
  const wt = BUILD.weaponTypes.find(t => t.k === b.wt);
  const top = bdTotals(b).slice(0, 5).map(([n, lv]) => `${n} ${lv}`).join(' · ');
  return {
    title: (b.n || '').trim() || `${wt ? wt.n : '무기'} 빌드`,
    desc: [w ? w.name : '', top].filter(Boolean).join('\n') || '장비를 골라 빌드를 만들어 보세요',
  };
}

/* 카카오 JS SDK 는 JavaScript 키가 있어야 씁니다. 키는 index.html 의
   KAKAO_JS_KEY 에 넣습니다. 키가 없거나 SDK 를 못 받아오면
   기기 공유 시트(카카오톡 포함) → 링크 복사 순으로 내려갑니다. */
function bdKakaoReady() {
  const key = window.KAKAO_JS_KEY;
  if (!key) return Promise.resolve(false);
  if (window.Kakao && window.Kakao.isInitialized && window.Kakao.isInitialized()) return Promise.resolve(true);
  const init = () => { try { window.Kakao.init(key); return true; } catch (e) { return false; } };
  if (window.Kakao) return Promise.resolve(init());
  return new Promise(res => {
    const el = document.createElement('script');
    el.src = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.5/kakao.min.js';
    el.crossOrigin = 'anonymous';
    el.onload = () => res(init());
    el.onerror = () => res(false);
    document.head.appendChild(el);
  });
}

const BD_OG = (document.querySelector('meta[property="og:image"]') || {}).content || '';
/* 카카오 서버가 이미지를 직접 받아 가므로 localhost 가 아닌 배포 주소여야 합니다.
   og:url 을 기준으로 잡으면 로컬에서 눌러도 카드 이미지가 제대로 나옵니다. */
const BD_BASE = (((document.querySelector('meta[property="og:url"]') || {}).content) || '/').replace(/\/?$/, '/');
const bdMonURL = key => BD_BASE + bdIcon(key);
const bdShareAbs = bi => `${BD_BASE}?build=${bdShareParam(bi)}#build`;

/* 콘솔에 등록한 리스트형 사용자 템플릿에 넘길 인자. 방어구 5부위를 한 줄씩 씁니다.
   줄마다 그 부위의 스킬과 표류석 스킬만 적고, 이미지는 그 방어구의 재료 몬스터입니다.
   SDK 기본 템플릿은 아이템이 3개까지라 5줄이 안 되므로 이 경로만 5줄을 낼 수 있습니다. */
function bdKakaoArgs(bi) {
  const b = bdState.builds[bi];
  const w = bdWeaponOf(b);
  const args = {
    HEADER: [bdShareText(b).title, w ? w.name : ''].filter(Boolean).join(' · '),
    /* 링크 칸에 쓰는 두 형태를 모두 보냅니다. 어느 쪽을 템플릿에 넣었든 맞습니다.
         ${URL}                                    → 전체 주소 (단독으로 넣을 때)
         https://mhn-kor.github.io/qr/?build=${BUILD}#build  → 쿼리 값 자리에 넣을 때
       location 이 아니라 배포 절대 주소로 만듭니다. 로컬에서 눌러도 남이 열 수 있어야 합니다. */
    URL: bdShareAbs(bi),
    BUILD: bdShareParam(bi),
  };
  BD_PARTS().forEach(({ k, n }, i) => {
    const set = bdSet(b[k]);
    const piece = set && set.pieces[k];
    const stones = (b.ds[k] || []).slice(0, bdSlotCount(b, k)).filter(d => d && d.s);
    const j = i + 1;
    args['P' + j] = `${n} · ${piece ? set.name : '없음'}`;
    args['D' + j] = piece
      ? [piece.skills.map(x => `${x.s} ${x.lv}`).join(' · '),
         stones.length ? `표류석 ${stones.map(d => d.s).join(' · ')}` : '',
        ].filter(Boolean).join('  |  ')
      : '비어 있음';
    /* 재료 몬스터 아이콘. 빈 칸은 부위 실루엣, 아이콘 없는 이벤트 장비는 bdIcon 이 대신 고릅니다.
       콘솔 이미지 칸은 값이 ${...} 로 시작해야 하므로 인자가 URL 전체를 담습니다. */
    args['I' + j] = BD_BASE + (piece ? bdIcon(set.key) : `assets/part/${k}.png`);
  });
  return args;
}

/* 템플릿 ID 를 아직 안 넣었을 때만 쓰는 예비 카드. 코드에서 만들 수 있는 리스트형은
   아이템이 2~3개까지라 무기 / 방어구 / 표류석 세 줄로 묶습니다. 2줄도 안 되면 null → 피드형. 공식 SDK 가 아이템을
   2~3개로 제한하므로 방어구를 한 부위씩 넣을 수 없어, 무기 / 방어구 / 표류석
   세 줄로 묶고 방어구 줄에 5부위를 모두 적습니다. 2줄도 안 되면 null → 피드형. */
function bdKakaoList(bi) {
  const b = bdState.builds[bi];
  const url = bdShareAbs(bi);
  const link = { mobileWebUrl: url, webUrl: url };
  const wt = BUILD.weaponTypes.find(t => t.k === b.wt);
  const rows = [];

  const w = bdWeaponOf(b);
  if (w) {
    const style = bdStylesOf(b.wt)[b.st - 1];
    rows.push({
      title: w.name,
      description: [wt && wt.n, w.atk ? `공격 ${w.atk}` : '', w.e ? `${w.e} ${w.ele}` : '무속성',
        style ? `스타일 ${style}` : ''].filter(Boolean).join(' · '),
      imageUrl: bdMonURL(bdSet(b.w).key), link,
    });
  }

  const worn = BD_PARTS().map(p => ({ p, s: bdSet(b[p.k]) })).filter(x => x.s && x.s.pieces[x.p.k]);
  if (worn.length) {
    rows.push({
      title: `방어구 ${worn.length}부위`,
      description: worn.map(x => `${x.p.n} ${x.s.name}`).join(' · '),
      imageUrl: bdMonURL(worn[0].s.key), link,
    });
  }

  const stones = [];
  for (const { k } of BD_PARTS()) {
    (b.ds[k] || []).slice(0, bdSlotCount(b, k)).forEach(d => { if (d && d.s) stones.push(d); });
  }
  if (stones.length) {
    const g = bdStones().find(x => x.group === stones[0].c);
    rows.push({
      title: `표류석 ${stones.length}개`,
      description: stones.map(d => `${d.c} ${d.s}`).join(' · '),
      imageUrl: g ? `${BD_BASE}assets/stone/${g.icon}.png` : BD_OG, link,
    });
  } else {
    const top = bdTotals(b).slice(0, 5).map(([n, lv]) => `${n} ${lv}`).join(' · ');
    if (top) rows.push({ title: '스킬', description: top, imageUrl: BD_OG, link });
  }

  if (rows.length < 2) return null;
  return {
    objectType: 'list',
    headerTitle: bdShareText(b).title,
    headerLink: link,
    contents: rows.slice(0, 3),
    buttons: [{ title: '빌드 보기', link }],
  };
}

async function bdKakao(bi) {
  const url = bdShareAbs(bi);
  const { title, desc } = bdShareText(bdState.builds[bi]);
  const link = { mobileWebUrl: url, webUrl: url };
  if (await bdKakaoReady()) {
    try {
      const tid = parseInt(window.KAKAO_TEMPLATE_ID, 10);
      if (tid) window.Kakao.Share.sendCustom({ templateId: tid, templateArgs: bdKakaoArgs(bi) });
      else window.Kakao.Share.sendDefault(bdKakaoList(bi) || {
        objectType: 'feed',
        content: { title, description: desc, imageUrl: BD_OG, link },
        buttons: [{ title: '빌드 보기', link }],
      });
      return;
    } catch (e) { toast('카카오톡 공유에 실패했습니다'); }
  }
  if (navigator.share) {
    try { await navigator.share({ title, text: desc, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }   // 사용자가 취소한 건 실패가 아닙니다
  }
  /* 카카오 키도 공유 시트도 없는 환경(대개 PC). 링크를 붙여넣으면 카톡이
     og 태그로 카드를 만들어 주므로 그 방법을 알려 줍니다. */
  bdCopyLink(bdShareURL(bi), '링크 복사됨 · 카카오톡에 붙여넣으세요');
}

/* ── 렌더 ──────────────────────────────────────────────────────── */
/* ⧉ 🔗 같은 문자는 기기 글꼴에 없으면 빈칸으로 나옵니다. SVG 로 그립니다. */
const BD_I = {
  copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  del: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  kakao: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 3C6.9 3 2.8 6.2 2.8 10.2c0 2.5 1.6 4.8 4.2 6.1l-.9 3.3c-.1.3.2.5.5.4l3.9-2.4q.7.1 1.5.1c5.1 0 9.2-3.2 9.2-7.5S17.1 3 12 3z"/></svg>',
};
/* 이 이벤트 장비 5종은 몬스터 소재가 아니라서 참조 사이트에도 아이콘이 없습니다(404).
   404 를 띄우지 않고 이벤트 표류석 아이콘으로 대신합니다. */
const BD_NOICON = new Set(['mr-beast', 'halloween-25', 'winter-25', 'lunar-25', 'spring-26']);
const bdIcon = key => (BD_NOICON.has(key) ? 'assets/stone/event.png' : `assets/monster/${key}.png`);
const bdMon = key => `<img class="bd-mi" src="${esc(bdIcon(key))}" width="26" height="26" alt="" loading="lazy">`;
const bdChips = list => list.map(x => `<span class="chip">${esc(x.s)}<b>${x.lv}</b></span>`).join('');

/* 표류석 육각형. 비어 있으면 점선으로 두어 끼울 자리임을 보여줍니다. */
function bdStoneDots(b, part, bi) {
  const n = bdSlotCount(b, part);
  if (!n) return '';
  const list = b.ds[part] || [];
  return `<span class="bd-ds">${Array.from({ length: n }, (_, i) => {
    const d = list[i];
    const g = d && bdStones().find(x => x.group === d.c);
    return `<button class="bd-dot${d ? ' on' : ''}" data-ds="${bi}:${part}:${i}"
      style="${g ? `--c:${g.color}` : ''}"
      title="${d ? esc('표류석【' + d.c + '】 · ' + d.s) : '표류석 선택'}"></button>`;
  }).join('')}</span>`;
}

function bdCard(b, bi) {
  const w = bdWeaponOf(b);
  const ws = bdSet(b.w);
  const styles = bdStylesOf(b.wt);
  const sp = bdSpOf(b.wt);
  const styleName = b.st && styles[b.st - 1] ? styles[b.st - 1] : null;
  const type = BUILD.weaponTypes.find(t => t.k === b.wt);
  const D = bdState.detail;

  /* 무기 줄 — 이름 줄과 스킬 줄을 나눕니다. 스킬을 오른쪽에 붙이면 칩이 많을 때
     좁은 칼럼으로 접혀 읽기 어렵습니다. */
  const wx = w && w.x ? w.x : null;
  let rows = `
    <div class="bd-row">
      <button class="bd-ti" data-wt="${bi}" title="무기 종류 변경 (${esc(type.n)})">
        <img src="assets/part/${esc(b.wt)}.png" width="24" height="24" alt="${esc(type.n)}">
      </button>
      <span class="bd-body">
        <span class="bd-line">
          <button class="bd-pick" data-pick="${bi}:weapon">
            ${ws ? bdMon(ws.key) + `<span class="bd-nm">${esc(ws.name)}</span>`
                 : '<span class="bd-nm empty">무기 선택</span>'}
          </button>
          ${styles.length ? `<button class="bd-style${b.st ? ' on' : ''}" data-style="${bi}">${esc(styleName || '스타일 없음')}</button>` : ''}
        </span>
        ${ws && ws.weaponSkills.length ? `<span class="bd-inline">${bdChips(ws.weaponSkills)}</span>` : ''}
      </span>
    </div>
    ${D && w ? `<div class="bd-stat">
        <b class="wn">${esc(w.name)}</b>
        ${w.atk ? `<span>공격 <b>${w.atk}</b></span>` : ''}
        ${w.e ? `<span class="el">${esc(w.e)} <b>${w.ele}</b></span>` : '<span class="el">무속성</span>'}
        ${sp ? `<span class="sp">SP ${esc(styleName || sp)}</span>` : ''}
        ${wx ? wx.map(t => `<span class="wx">${esc(t)}</span>`).join('') : ''}
      </div>` : ''}`;

  /* 방어구 5줄 */
  for (const { k, n } of BD_PARTS()) {
    const s = bdSet(b[k]);
    const piece = s && s.pieces[k];
    rows += `
      <div class="bd-row">
        <span class="bd-ti static"><img src="assets/part/${esc(k)}.png" width="24" height="24" alt="${esc(n)}"></span>
        <span class="bd-body">
          <span class="bd-line">
            <button class="bd-pick" data-pick="${bi}:${k}">
              ${s ? bdMon(s.key) + `<span class="bd-nm">${esc(s.name)}</span>`
                  : `<span class="bd-nm empty">${esc(n)} 선택</span>`}
              ${D && piece ? `<span class="bd-sub">${esc(piece.name)}</span>` : ''}
            </button>
            ${bdStoneDots(b, k, bi)}
          </span>
          ${piece && piece.skills.length ? `<span class="bd-inline">${bdChips(piece.skills)}</span>` : ''}
        </span>
      </div>`;
  }

  /* 합계 */
  const rowsT = bdTotals(b);
  const picked = (b.w ? 1 : 0) + BD_PARTS().filter(({ k }) => b[k]).length;

  return `
    <article class="bd-card">
      <header class="bd-ch">
        <input class="bd-title" data-name="${bi}" value="${esc(b.n)}" placeholder="빌드 ${bi + 1}" maxlength="24" aria-label="빌드 이름">
        <span class="bd-cnt">${picked}/6</span>
        <button class="bd-ic" data-copy="${bi}" title="복제" aria-label="복제">${BD_I.copy}</button>
        <button class="bd-ic" data-link="${bi}" title="링크 복사" aria-label="링크 복사">${BD_I.link}</button>
        <button class="bd-ic kakao" data-kakao="${bi}" title="카카오톡 공유" aria-label="카카오톡 공유">${BD_I.kakao}</button>
        <button class="bd-ic danger" data-del="${bi}" title="빌드 삭제" aria-label="빌드 삭제">${BD_I.del}</button>
      </header>
      <div class="bd-rows">${rows}</div>
      <div class="bd-sum">
        ${rowsT.length ? rowsT.map(([n, lv]) => bdTotalRow(n, lv)).join('')
          : '<p class="bd-empty">장비를 고르면 스킬이 합산됩니다.</p>'}
      </div>
    </article>`;
}

/* 스킬마다 상한이 달라(대개 3 또는 5) 막대를 그 수만큼 칸으로 나눕니다.
   상한을 넘으면 초과분은 낭비이므로 빨갛게 표시합니다. 상한을 모르는 스킬
   (이벤트 스킬 등)은 칸을 나누지 않고 현재 값만 채웁니다. */
function bdTotalRow(name, lv) {
  const max = (BUILD.maxLv || {})[name] || 0;
  const over = max > 0 && lv > max;
  const cells = max > 0 ? max : lv;
  const seg = Array.from({ length: cells }, (_, i) =>
    `<i class="${i < Math.min(lv, cells) ? 'on' : ''}"></i>`).join('');
  return `<div class="bd-tr${over ? ' over' : ''}">
    <span>${esc(name)}</span>
    <b>${lv}${over ? `<em>/${max}</em>` : ''}</b>
    <span class="bd-bar" style="--n:${cells}">${seg}</span>
  </div>`;
}

function bdRender() {
  $('#bd-cards').innerHTML = bdState.builds.map(bdCard).join('');
  $('#bd-detail').setAttribute('aria-pressed', String(bdState.detail));
  $('#bd-add').disabled = bdState.builds.length >= BD_MAX;
  $('#bd-count').textContent = `빌드 ${bdState.builds.length}개`;
}

/* ── 선택 모달 ─────────────────────────────────────────────────── */
let bdPick = null;             // { bi, target } 또는 { bi, part, slot } 등

const bdDlg = () => $('#bd-modal');

function bdOpen(title, bodyHtml, withSearch, opt = {}) {
  $('#bd-modal-title').innerHTML = title;
  $('#bd-modal-body').innerHTML = bodyHtml;
  $('#bd-srow').hidden = !withSearch;
  $('#bd-clear').hidden = !opt.clear;
  if (withSearch) {
    $('#bd-q').value = '';
    $('#bd-q').placeholder = opt.placeholder || '몬스터 · 장비 · 스킬 검색';
  }
  bdDlg().showModal();
  if (withSearch) $('#bd-q').focus();
}

/* 무기 종류 — 아이콘 격자 */
function bdOpenType(bi) {
  bdPick = { kind: 'wt', bi };
  const cur = bdState.builds[bi].wt;
  bdOpen('무기 종류 변경',
    `<div class="bd-grid">${BUILD.weaponTypes.map(t => `
      <button class="bd-gi${t.k === cur ? ' on' : ''}" data-v="${t.k}">
        <img src="assets/part/${esc(t.k)}.png" width="40" height="40" alt="">
        <span>${esc(t.n)}</span>
      </button>`).join('')}</div>`, false);
}

/* 스타일 강화 */
function bdOpenStyle(bi) {
  bdPick = { kind: 'st', bi };
  const b = bdState.builds[bi];
  const styles = bdStylesOf(b.wt);
  bdOpen('스타일 강화',
    `<ul class="bd-list">
      <li><button class="bd-lr${b.st === 0 ? ' on' : ''}" data-v="0">스타일 강화 없음</button></li>
      ${styles.map((s, i) => `<li><button class="bd-lr${b.st === i + 1 ? ' on' : ''}" data-v="${i + 1}">${esc(s)}</button></li>`).join('')}
    </ul>`, false);
}

/* 장비 (무기 소재 / 방어구 세트) */
function bdOpenGear(bi, target) {
  bdPick = { kind: 'gear', bi, target };
  const b = bdState.builds[bi];
  const isW = target === 'weapon';
  const type = BUILD.weaponTypes.find(t => t.k === b.wt);
  const head = isW
    ? `<img src="assets/part/${esc(b.wt)}.png" width="24" height="24" alt="">무기 · ${esc(type.n)}`
    : `<img src="assets/part/${esc(target)}.png" width="24" height="24" alt="">${esc(BD_PARTS().find(p => p.k === target).n)}`;
  bdOpen(head, '', true);
  bdFillGear('');
}

function bdFillGear(q) {
  const { bi, target } = bdPick;
  const b = bdState.builds[bi];
  const isW = target === 'weapon';
  const norm = s => String(s).toLowerCase().replace(/\s+/g, '');
  const needle = norm(q);
  const chosen = isW ? b.w : b[target];

  const list = BUILD.sets.filter(s => (isW ? s.weapons.some(w => w.t === b.wt) : s.pieces[target]));
  const rows = list.filter(s => {
    if (!needle) return true;
    const item = isW ? s.weapons.find(w => w.t === b.wt) : s.pieces[target];
    const sk = (isW ? s.weaponSkills : item.skills).map(x => x.s).join('');
    return norm(s.name + item.name + sk).includes(needle);
  });

  /* 그룹이 바뀌는 자리에 머리글을 끼웁니다. 목록이 85줄이라 어디서 이벤트·기타
     소재가 시작되는지 보이지 않으면 찾기 어렵습니다. */
  const GNAME = ['몬스터 소재', '이벤트 소재', '기본 소재'];
  let lastG = -1;

  $('#bd-modal-body').innerHTML =
    `<ul class="bd-list">
      <li><button class="bd-lr clear" data-v="">선택 해제</button></li>
      ${rows.map(s => {
        const head = s.g !== lastG ? `<li class="bd-gh">${esc(GNAME[s.g] || '기타')}</li>` : '';
        lastG = s.g;
        return head + bdGearRow(s, b, target, isW, chosen);
      }).join('')}
    </ul>`;
  $('#bd-modal-count').textContent = `${rows.length}종`;
}

function bdGearRow(s, b, target, isW, chosen) {
  return ((() => {
        const item = isW ? s.weapons.find(w => w.t === b.wt) : s.pieces[target];
        const sk = isW ? s.weaponSkills : item.skills;
        const meta = isW
          ? `${item.atk ? `공격 ${item.atk}` : ''}${item.e ? ` · ${esc(item.e)} ${item.ele}` : ''}`
          : (item.slot ? `◇ ${item.slot}` : '');
        return `<li><button class="bd-lr gear${s.key === chosen ? ' on' : ''}" data-v="${esc(s.key)}">
          ${bdMon(s.key)}
          <span class="bd-lt">
            <b>${esc(s.name)}</b>
            <i>${esc(item.name)}${meta ? ' · ' + meta : ''}</i>
            <span class="bd-ls">${sk.map(x => `<em>${esc(x.s)}<b>${x.lv}</b></em>`).join('')}</span>
          </span>
        </button></li>`;
  })());
}

/* 표류석 — 색상이 아니라 스킬을 직접 고릅니다. 표류석 하나가 주는 스킬 레벨은
   항상 1이라 레벨 선택이 없습니다. 색상은 고른 스킬이 속한 그룹으로 정해집니다. */
function bdOpenStone(bi, part, slot) {
  const cur = (bdState.builds[bi].ds[part] || [])[slot] || null;
  bdPick = { kind: 'ds', bi, part, slot };
  const partName = BD_PARTS().find(p => p.k === part).n;
  bdOpen(`<img src="assets/part/${esc(part)}.png" width="24" height="24" alt="">${esc(partName)} 표류석 ${slot + 1}번`,
    '', true, { clear: !!cur, placeholder: '스킬 검색' });
  bdFillStone('');
}

function bdFillStone(q) {
  const { bi, part, slot } = bdPick;
  const cur = (bdState.builds[bi].ds[part] || [])[slot] || null;
  const norm = s => String(s).toLowerCase().replace(/[\s　]+/g, '');
  const needle = norm(q);

  let n = 0;
  const html = bdStones().map(g => {
    const hits = g.skills.filter(sk => !needle || norm(sk.name).includes(needle));
    if (!hits.length) return '';
    n += hits.length;
    return `<p class="bd-sgl" style="--c:${g.color}">표류석【${esc(g.group)}】</p>
      <div class="bd-skgrid">${hits.map(sk => {
        const on = cur && cur.s === sk.name && cur.c === g.group;
        return `<button class="bd-sk${on ? ' on' : ''}" data-color="${esc(g.group)}" data-skill="${esc(sk.name)}"
          title="${esc(g.group)} · ${esc(sk.rate)}">${esc(sk.name)}</button>`;
      }).join('')}</div>`;
  }).join('');

  $('#bd-modal-body').innerHTML = html || '<p class="bd-empty">일치하는 스킬이 없습니다.</p>';
  $('#bd-modal-count').textContent = `${n}종`;
}

/* ── 이벤트 ────────────────────────────────────────────────────── */
$('#bd-cards').addEventListener('click', e => {
  const t = e.target;
  const pick = t.closest('[data-pick]');
  if (pick) { const [bi, target] = pick.dataset.pick.split(':'); return bdOpenGear(+bi, target); }
  const wt = t.closest('[data-wt]');
  if (wt) return bdOpenType(+wt.dataset.wt);
  const st = t.closest('[data-style]');
  if (st) return bdOpenStyle(+st.dataset.style);
  const ds = t.closest('[data-ds]');
  if (ds) { const [bi, part, slot] = ds.dataset.ds.split(':'); return bdOpenStone(+bi, part, +slot); }

  const del = t.closest('[data-del]');
  if (del) {
    if (bdState.builds.length === 1) bdState.builds = [bdNewBuild()];
    else bdState.builds.splice(+del.dataset.del, 1);
    bdSave(); bdRender(); return toast('빌드를 지웠습니다');
  }
  const cp = t.closest('[data-copy]');
  if (cp) {
    if (bdState.builds.length >= BD_MAX) return toast(`빌드는 ${BD_MAX}개까지입니다`);
    const src = bdState.builds[+cp.dataset.copy];
    bdState.builds.splice(+cp.dataset.copy + 1, 0, JSON.parse(JSON.stringify({ ...src, n: '' })));
    bdSave(); bdRender(); return toast('복제했습니다');
  }
  const lk = t.closest('[data-link]');
  if (lk) return bdCopyLink(bdShareURL(+lk.dataset.link));
  const kk = t.closest('[data-kakao]');
  if (kk) return bdKakao(+kk.dataset.kakao);
});

$('#bd-cards').addEventListener('input', e => {
  const el = e.target.closest('[data-name]');
  if (!el) return;
  bdState.builds[+el.dataset.name].n = el.value;
  bdSave();
});

/* 모달 내부 선택 */
$('#bd-modal-body').addEventListener('click', e => {
  const b = bdState.builds[bdPick.bi];

  const gi = e.target.closest('.bd-gi');
  if (gi) {
    b.wt = gi.dataset.v; b.st = 0;
    if (!(bdSet(b.w) || {}).weapons?.some(w => w.t === b.wt)) b.w = null;
    bdSave(); bdRender(); return bdDlg().close();
  }
  const skBtn = e.target.closest('.bd-sk');
  if (skBtn) {
    b.ds[bdPick.part] = b.ds[bdPick.part] || [];
    // 표류석이 주는 스킬 레벨은 항상 1입니다.
    b.ds[bdPick.part][bdPick.slot] = { c: skBtn.dataset.color, s: skBtn.dataset.skill };
    bdSave(); bdRender(); return bdDlg().close();
  }
  const lr = e.target.closest('.bd-lr');
  if (!lr) return;
  if (bdPick.kind === 'st') { b.st = +lr.dataset.v; bdSave(); bdRender(); return bdDlg().close(); }
  if (bdPick.kind === 'gear') {
    const v = lr.dataset.v || null;
    if (bdPick.target === 'weapon') b.w = v;
    else { b[bdPick.target] = v; b.ds[bdPick.target] = []; }   // 세트가 바뀌면 슬롯 수도 바뀝니다
    bdSave(); bdRender(); return bdDlg().close();
  }
});

$('#bd-q').addEventListener('input', e => {
  const v = e.target.value.trim();
  if (bdPick?.kind === 'gear') bdFillGear(v);
  else if (bdPick?.kind === 'ds') bdFillStone(v);
});
$('#bd-clear').addEventListener('click', () => {
  const b = bdState.builds[bdPick.bi];
  (b.ds[bdPick.part] = b.ds[bdPick.part] || [])[bdPick.slot] = null;
  bdSave(); bdRender(); bdDlg().close();
});
$('#bd-modal-close').addEventListener('click', () => bdDlg().close());
bdDlg().addEventListener('click', e => { if (e.target === bdDlg()) bdDlg().close(); });

$('#bd-add').addEventListener('click', () => {
  if (bdState.builds.length >= BD_MAX) return toast(`빌드는 ${BD_MAX}개까지입니다`);
  bdState.builds.push(bdNewBuild());
  bdSave(); bdRender();
});
$('#bd-detail').addEventListener('click', () => {
  bdState.detail = !bdState.detail;
  bdSave(); bdRender();
});

/* ── 시작 ──────────────────────────────────────────────────────── */
let bdDrawn = false;
function drawBuild() {
  if (typeof BUILD === 'undefined') return;
  if (!bdDrawn) {
    bdDrawn = true;
    const q = new URLSearchParams(location.search).get('build');
    if (q) {
      /* 공유 링크는 링크에 담긴 구성만 새 카드로 엽니다. 저장값과 섞으면
         남의 링크를 열었을 때 내 장비가 남아 다른 빌드가 됩니다. */
      const kv = {};
      for (const part of String(q).split(',')) {
        const i = part.indexOf('=');
        if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1);
      }
      const b = bdNewBuild();
      if (kv.wt && BUILD.weaponTypes.some(t => t.k === kv.wt)) b.wt = kv.wt;
      if (bdSet(kv.w)) b.w = kv.w;
      b.st = Math.max(0, Math.min(bdStylesOf(b.wt).length, parseInt(kv.st, 10) || 0));
      for (const { k } of BUILD.parts) {
        if (bdSet(kv[k]) && bdSet(kv[k]).pieces[k]) b[k] = kv[k];
      }
      /* 방어구를 먼저 채운 뒤에 표류석을 끼웁니다. 칸 수가 방어구에 달려 있습니다. */
      for (const e of String(kv.ds || '').split(';')) {
        const [part, i, color, skill] = e.split('|');
        if (!Array.isArray(b.ds[part]) || !(+i >= 0)) continue;
        const g = bdStones().find(x => x.group === color);
        if (g && g.skills.some(x => x.name === skill)) b.ds[part][+i] = { c: color, s: skill };
      }
      bdState = { builds: [b], detail: false };
    } else {
      try {
        const saved = JSON.parse(localStorage.getItem(BD_KEY) || 'null');
        if (saved && Array.isArray(saved.builds) && saved.builds.length) {
          bdState = { detail: !!saved.detail, builds: saved.builds.map(x => ({ ...bdNewBuild(), ...x, ds: { ...bdNewBuild().ds, ...(x.ds || {}) } })) };
        }
      } catch (e) { /* 저장값이 깨졌으면 기본값으로 */ }
    }
  }
  bdRender();
}

/* app.js 가 showTab() 을 이미 호출한 뒤에 이 파일이 로드되므로,
   첫 화면이 빌드 탭이면 여기서 한 번 그려줍니다. */
if (!$('#panel-build').hidden) drawBuild();
