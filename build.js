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
/* 스킬 설명에 «공격력이 50 상승한다» 처럼 수치가 그대로 적혀 있어 그 문장을 읽습니다.
   조건이 붙은 스킬(«약점을 공격하면 …», «체력이 최대일 때 …»)은 상시 수치가 아니라
   빼고, 조건어가 효과 앞에 오는지로 가릅니다. */
const BD_COND = /때|하면|되면|중에는|동안|이하|뒤|그룹 사냥|사용 시|공격 시|명중|가드|부활|포효|모으기|상태 중/;

function bdEffects(desc) {
  /* «Lv5 이상의 '공격' 스킬이 발동 중일 때» 는 전투 조건이 아니라 빌드 조건이라,
     그 스킬이 실제로 그 레벨이면 켭니다(공격·경지 등). */
  const gate = /Lv(\d+) 이상의 '(.+?)' 스킬이 발동 중일 때/.exec(desc);
  const need = gate ? { s: gate[2], lv: +gate[1] } : null;
  /* 체력 게이지는 만피(BD_BASE_HP) 기준으로 봅니다. 하이 차지가 «남은 체력 게이지» 를
     쓰는 것과 같은 전제라, «체력이 최대일 때» 조건은 늘 만족합니다(완전 충전).
     반대로 «29% 이하» 나 «부활하면» 같은 조건은 만피에서 성립하지 않아 그대로 둡니다. */
  const body = (gate ? desc.slice(gate.index + gate[0].length) : desc)
    .replace(/체력이 최대일 때\s*/g, '');
  const out = [];
  const scan = (src, fn) => {
    const r = new RegExp(src, 'g'); let m;
    while ((m = r.exec(body))) fn(m, BD_COND.test(body.slice(0, m.index)));
  };
  /* «얼음속성 공격력이 15% 증가» 가 공격력으로도 세지지 않도록 앞의 «속성 » 을 뺍니다.
     «수치가» 와 «공격력이» 는 조사가 달라 둘 다 받습니다. */
  scan('(?<!속성 )공격력이 (\\d+)% (?:상승|증가)', (m, c) => out.push({ k: 'atk', pct: 1, v: +m[1], need, cond: c }));
  scan('(?<!속성 )공격력이 (\\d+) (?:상승|증가)', (m, c) => out.push({ k: 'atk', v: +m[1], need, cond: c }));
  scan('회심률이 (\\d+)% (?:상승|증가)', (m, c) => out.push({ k: 'crit', v: +m[1], need, cond: c }));
  scan('회심률이 (\\d+)% 감소', (m, c) => out.push({ k: 'crit', v: -m[1], need, cond: c }));
  scan('(\\S+?)속성 (?:수치|공격력)[이가] (\\d+)% 증가', (m, c) => out.push({ k: 'ele', pct: 1, v: +m[2], el: m[1], need, cond: c }));
  scan('(\\S+?)속성 (?:수치|공격력)[이가] (\\d+) (?:증가|상승)', (m, c) => out.push({ k: 'ele', v: +m[2], el: m[1], need, cond: c }));
  scan('무기의 속성 공격력이 (\\d+)% 증가', (m, c) => out.push({ k: 'ele', pct: 1, v: +m[1], need, cond: c }));
  /* F = 대미지 % 증가(가산). G 쪽의 회심 배율은 «대미지 배율이 130%로 강화» 로 적힙니다. */
  scan('(?:주는 )?대미지가 (\\d+)% 증가', (m, c) => out.push({ k: 'dmg', pct: 1, v: +m[1], need, cond: c }));
  scan('대미지 배율이 (\\d+)%로 강화', (m, c) => out.push({ k: 'critx', v: +m[1], need, cond: c }));
  /* 체력 증강 등. 체력 자체는 대미지가 아니지만 하이 차지가 이 값을 씁니다. */
  scan('체력이 (\\d+) 증가', (m, c) => out.push({ k: 'hp', v: +m[1], need, cond: c }));
  /* 하이 차지 — «남은 체력 게이지의 2배만큼 얼음속성 공격력이 증가한다».
     속성 정액(D)이지만 값이 체력에 달려 있어 배수만 담아 둡니다. */
  scan('남은 체력 게이지의 (\\d+)배만큼 (\\S+?)속성 공격력이 증가',
    (m, c) => out.push({ k: 'ele', hpx: +m[1], el: m[2], need, cond: c }));
  return out;
}

/* 속성 % 중 이 셋만 승산(E)이고 나머지는 가산(C)입니다. 참조 글의 분류를 따릅니다. */
const BD_ELE_MUL = new Set(['강룡의 얼음바람', '명룡의 파뢰', '환수의 벼락', '은작룡의 홍혈', '빙룡의 얼음 갑옷']);
/* 회심은 1.25배, 마이너스 회심은 0.75배. 슈퍼회심이 있으면 1.25 자리가 올라갑니다. */
const BD_CRIT_UP = 1.25, BD_CRIT_DOWN = 0.75;
/* 기본 체력. 하이 차지가 «남은 체력 게이지» 를 쓰므로 만피 기준으로 잡습니다. */
const BD_BASE_HP = 100;

/* 스킬 설명은 레벨별로 값이 달라, 합산된 레벨의 문장을 씁니다.
   상한을 넘겨 찍혔으면 표에 있는 마지막 레벨로 자릅니다. */
function bdSkillDesc(name, lv) {
  const rows = (typeof SKILLDESC !== 'undefined' && SKILLDESC[name]) || null;
  if (!rows || !rows.length) return null;
  const cap = Math.min(lv, rows[rows.length - 1][0]);
  const hit = rows.find(r => r[0] === cap);
  return hit ? hit[1] : null;
}

/* 참조 글(디시 몬헌나우 갤러리)의 대미지 공식을 모션치·육질 없이 계산합니다.
     무속성  = 무기공격력×B + A
     속성    = 위 + (무기속성치×C + D)×E
     점수    = (공격력 + 속성공격력) × F × G
   B·C·F 는 가산(1+합), E·G 는 승산(곱). 회심은 기대값으로 G 에 넣습니다.
   모션치·육질은 공격 동작과 부위마다 달라 빌드만으로는 정할 수 없어 1 로 둡니다. */
function bdStats(b) {
  const w = bdWeaponOf(b);
  const base = { atk: (w && w.atk) || 0, ele: (w && w.ele) || 0, crit: (w && w.crit) || 0 };
  let A = 0, B = 1, C = 1, D = 0, E = 1, F = 1, critX = BD_CRIT_UP, crit = base.crit;
  const lvOf = new Map(bdTotals(b));

  /* 조건·게이트를 통과한 효과만 모읍니다. 하이 차지가 체력을 쓰기 때문에
     체력을 먼저 다 더한 뒤에 나머지를 계산합니다. */
  const eff = [];
  for (const [name, lv] of lvOf) {
    for (const e of bdEffects(bdSkillDesc(name, lv) || '')) {
      if (e.cond) continue;
      if (e.need && (lvOf.get(e.need.s) || 0) < e.need.lv) continue;
      eff.push({ ...e, sk: name });   // 승산 판별(BD_ELE_MUL)에 이름이 필요합니다
    }
  }
  const hp = BD_BASE_HP + eff.reduce((n, e) => n + (e.k === 'hp' ? e.v : 0), 0);

  for (const e of eff) {
    if (e.k === 'atk') { if (e.pct) B += e.v / 100; else A += e.v; continue; }
    if (e.k === 'crit') { crit += e.v; continue; }
    if (e.k === 'critx') { critX = Math.max(critX, e.v / 100); continue; }
    if (e.k === 'dmg') { F += e.v / 100; continue; }
    if (e.k === 'ele') {
      /* 속성 강화는 무기 속성이 같을 때만 붙습니다. 속성 표기가 없으면 어떤 속성이든 붙습니다. */
      if (!w || !w.e) continue;
      if (e.el && w.e !== e.el) continue;
      if (e.hpx) { D += hp * e.hpx; continue; }   // 하이 차지
      if (!e.pct) { D += e.v; continue; }
      if (BD_ELE_MUL.has(e.sk)) E *= 1 + e.v / 100; else C += e.v / 100;
    }
  }
  const now = {
    atk: Math.round(base.atk * B + A),
    ele: base.ele ? Math.round((base.ele * C + D) * E) : 0,
    crit: Math.round(crit),
  };
  /* 회심 기대 배율. 양수면 회심이, 음수면 역회심이 그 확률만큼 섞입니다. */
  const p = Math.max(-100, Math.min(100, now.crit)) / 100;
  const G = 1 + (p >= 0 ? p * (critX - 1) : -p * (BD_CRIT_DOWN - 1));
  const score = Math.round((now.atk + now.ele) * F * G);
  /* 계수를 그대로 넘겨 상세 보기에서 계산 과정을 그릴 수 있게 합니다. */
  return { base, now, score, hp, el: w ? w.e : null, co: { A, B, C, D, E, F, G, critX } };
}

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

/* ── 방어구 일괄선택 ───────────────────────────────────────────── */
/* 부위마다 따로 모달을 여닫으면 다섯 번을 반복해야 합니다. 한 화면에서 부위를 찍고
   합산 스킬을 보며 고른 뒤 한 번에 적용합니다. bdBulk 에 고르는 중인 값을 담습니다. */
let bdBulk = null;
let bdBulkFold = false;   // 합산 스킬 접힘 여부

function bdOpenBulk(bi) {
  const b = bdState.builds[bi];
  bdPick = { kind: 'bulk', bi };
  bdBulk = {};
  for (const { k } of BD_PARTS()) bdBulk[k] = b[k] || null;
  bdOpen('방어구 일괄선택', '', true, { placeholder: '몬스터 · 방어구 · 스킬 검색' });
  bdFillBulk('');
}

/* 공식 방어구 페이지 순서(o)대로 세우고, 이벤트 장비는 뒤로 갑니다. */
function bdBulkSets() {
  return BUILD.sets.filter(s => Object.keys(s.pieces).length)
    .sort((a, b) => a.o - b.o || a.g - b.g || a.u - b.u || a.id - b.id);
}

function bdFillBulk(q) {
  const norm = t => String(t).toLowerCase().replace(/\s+/g, '');
  const needle = norm(q);
  const parts = BD_PARTS();

  const rows = bdBulkSets().filter(s => {
    if (!needle) return true;
    const txt = s.name + parts.map(p => {
      const pc = s.pieces[p.k];
      return pc ? pc.name + pc.skills.map(x => x.s).join('') : '';
    }).join('');
    return norm(txt).includes(needle);
  });

  $('#bd-modal-body').innerHTML = rows.length ? `<ul class="bd-blist">${rows.map(s => `
    <li class="bd-brow">
      ${bdMon(s.key)}
      <span class="bd-bn">${esc(s.name)}</span>
      <span class="bd-bp">${parts.map(p => {
        const pc = s.pieces[p.k];
        if (!pc) return '<i class="bd-bx"></i>';
        const on = bdBulk[p.k] === s.key;
        return `<button class="bd-bb${on ? ' on' : ''}" data-bulk-pick="${esc(s.key)}:${p.k}"
          title="${esc(pc.name)} · ${pc.skills.map(x => x.s + ' ' + x.lv).join(', ')}${pc.slot ? ' · 표류석 ' + pc.slot + '칸' : ''}">
          <img src="assets/part/${p.k}.png" width="18" height="18" alt="${esc(p.n)}">
        </button>`;
      }).join('')}</span>
    </li>`).join('')}</ul>` : '<p class="bd-empty">일치하는 방어구가 없습니다.</p>';
  $('#bd-modal-count').textContent = `${rows.length}세트`;
  bdBulkFoot();
}

/* 고른 부위의 스킬 합계와 적용 버튼. 고르는 도중에도 결과가 보여야 합니다. */
function bdBulkFoot() {
  const total = new Map();
  let n = 0;
  for (const { k, n: kn } of BD_PARTS()) {
    const s = bdSet(bdBulk[k]);
    const pc = s && s.pieces[k];
    if (!pc) continue;
    n++;
    pc.skills.forEach(x => total.set(x.s, (total.get(x.s) || 0) + x.lv));
  }
  const list = [...total.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  /* 스킬이 많으면 목록을 다 가려서, 접을 수 있게 합니다. 버튼 줄은 항상 보입니다. */
  $('#bd-bulk-foot').innerHTML = `
    <button class="bd-bt${bdBulkFold ? ' fold' : ''}" data-bulk-toggle="1" aria-expanded="${bdBulkFold ? 'false' : 'true'}">
      <span>합산 스킬 <b>${list.length}</b></span>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <div class="bd-bsum"${bdBulkFold ? ' hidden' : ''}>${list.length
      ? list.map(([nm, lv]) => `<span class="chip">${esc(nm)}<b>${lv}</b></span>`).join('')
      : '<span class="bd-empty">부위를 고르면 스킬이 합산됩니다.</span>'}</div>
    <div class="bd-bact">
      <button class="btn ghost" data-bulk-clear="1">전부 비우기</button>
      <button class="btn primary" data-bulk-apply="1">${n}부위 적용</button>
    </div>`;
  $('#bd-bulk-foot').hidden = false;
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
/* 카카오 카드는 한 줄에 들어가는 글자 수가 빡빡해서 공백을 전부 뺍니다.
   스킬명 안의 공백과 레벨 앞 공백까지 포함합니다(마비 내성 3 → 마비내성3).
   URL·이미지 인자에는 쓰지 않습니다. */
const bdTight = v => String(v).replace(/[\s\u3000]+/g, '');

/* 콘솔에 등록한 리스트형 사용자 템플릿에 넘길 인자. 방어구 5부위를 한 줄씩 씁니다.
   줄마다 그 부위의 스킬과 표류석 스킬만 적고, 이미지는 그 방어구의 재료 몬스터입니다.
   SDK 기본 템플릿은 아이템이 3개까지라 5줄이 안 되므로 이 경로만 5줄을 낼 수 있습니다. */
function bdKakaoArgs(bi) {
  const b = bdState.builds[bi];
  const w = bdWeaponOf(b);
  const args = {
    HEADER: bdTight([bdShareText(b).title, w ? w.name : ''].filter(Boolean).join('·')),
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
    args['P' + j] = bdTight(`${n}·${piece ? set.name : '없음'}`);
    /* 방어구 스킬과 표류석 스킬은 | 로 가릅니다('표류석'이라 적을 자리가 없습니다). */
    args['D' + j] = bdTight(piece
      ? [piece.skills.map(x => `${x.s}${x.lv}`).join('·'), stones.map(d => d.s).join('·')]
          .filter(Boolean).join('|')
      : '비어 있음');
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
      title: bdTight(w.name),
      description: bdTight([wt && wt.n, w.atk ? `공격${w.atk}` : '', w.e ? `${w.e}${w.ele}` : '무속성',
        w.crit != null ? `회심${w.crit > 0 ? '+' : ''}${w.crit}%` : '',
        style ? `스타일${style}` : ''].filter(Boolean).join('·')),
      imageUrl: bdMonURL(bdSet(b.w).key), link,
    });
  }

  const worn = BD_PARTS().map(p => ({ p, s: bdSet(b[p.k]) })).filter(x => x.s && x.s.pieces[x.p.k]);
  if (worn.length) {
    rows.push({
      title: bdTight(`방어구${worn.length}부위`),
      description: bdTight(worn.map(x => `${x.p.n}·${x.s.name}`).join('/')),
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
      title: bdTight(`표류석${stones.length}개`),
      description: bdTight(stones.map(d => `${d.c}·${d.s}`).join('/')),
      imageUrl: g ? `${BD_BASE}assets/stone/${g.icon}.png` : BD_OG, link,
    });
  } else {
    const top = bdTotals(b).slice(0, 5).map(([n, lv]) => `${n} ${lv}`).join(' · ');
    if (top) rows.push({ title: '스킬', description: bdTight(top), imageUrl: BD_OG, link });
  }

  if (rows.length < 2) return null;
  return {
    objectType: 'list',
    headerTitle: bdTight(bdShareText(b).title),
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
        ${w.atk ? `<span>${BD_SI.atk}<b>${w.atk}</b></span>` : ''}
        ${w.e && BD_EI[w.e]
          ? `<span class="el" title="${esc(w.e)}속성">${bdIco(`assets/element/${BD_EI[w.e]}.png`)}<b>${w.ele}</b></span>`
          : '<span class="el">무속성</span>'}
        ${w.crit != null ? `<span class="cr${w.crit < 0 ? ' minus' : ''}">${BD_SI.crit}<b>${w.crit > 0 ? '+' : ''}${w.crit}%</b></span>` : ''}
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
      <button class="bd-bulk" data-bulk="${bi}">방어구 일괄선택</button>
      <div class="bd-sum">
        ${rowsT.length ? rowsT.map(([n, lv]) => bdTotalRow(n, lv)).join('')
          : '<p class="bd-empty">장비를 고르면 스킬이 합산됩니다.</p>'}
        ${bdStatBar(b)}
      </div>
    </article>`;
}

/* 무기 기본값 ▸ 스킬 합산값. 한 줄에 붙입니다.
   속성 아이콘은 속성마다 다르고, 무속성 무기는 속성 칸 자체를 만들지 않습니다. */
/* 공격력·회심률 아이콘도 공식 것을 씁니다(assets/icons/stat_*.png).
   속성은 종류마다 그림이 달라 아래 BD_EI 로 고릅니다. */
const bdIco = (src, cls = '') => `<img class="bd-ii${cls ? ' ' + cls : ''}" src="${src}" width="13" height="13" alt="" loading="lazy">`;
const BD_SI = {
  atk: bdIco('assets/stat/attack.png'),
  crit: bdIco('assets/stat/affinity.png'),
};

/* 속성 아이콘은 공식 사이트의 것을 씁니다(monsterhunternow.com/assets/icons/element_*.png).
   색까지 들어 있는 그림이라 따로 칠하지 않습니다. */
const BD_EI = {
  '불': 'fire', '물': 'water', '번개': 'thunder', '얼음': 'ice', '용': 'dragon',
  '독': 'poison', '마비': 'paralysis', '수면': 'sleep', '폭파': 'blast',
};

function bdStatBar(b) {
  const w = bdWeaponOf(b);
  if (!w) return '';
  const { base, now, score } = bdStats(b);
  const cell = (icon, a, c, sx = '', style = '') =>
    `<span class="bd-sc${c > a ? ' up' : c < a ? ' down' : ''}"${style}>${icon}${a}${sx}<em>▸</em><b>${c}${sx}</b></span>`;

  const ei = BD_EI[w.e];
  const out = [cell(BD_SI.atk, base.atk, now.atk)];
  /* 무속성 무기는 속성 칸을 만들지 않습니다(0 ▸ 0 은 읽을 값이 없습니다). */
  if (ei) out.push(cell(bdIco(`assets/element/${ei}.png`), base.ele, now.ele, '', ` title="${esc(w.e)}속성"`));
  out.push(cell(BD_SI.crit, base.crit, now.crit, '%'));

  return `<div class="bd-stats">${out.join('')}</div>
    <p class="bd-score"><span>점수</span><b>${score}</b></p>
    ${bdState.detail ? bdCalc(b) : ''}`;
}

/* 점수가 어떻게 나왔는지 한 줄씩 보여 줍니다(상세 수치 ON).
   B·C·F 는 가산(1+합), E·G 는 승산(곱)이라 곱해지는 자리가 다릅니다. */
function bdCalc(b) {
  const w = bdWeaponOf(b);
  if (!w) return '';
  const { base, now, score, hp, co } = bdStats(b);
  const f = n => (Math.round(n * 1000) / 1000).toString();
  const rows = [];

  /* 하이 차지가 체력을 쓰므로, 체력이 기본값과 다르면 어디서 왔는지 보여 줍니다. */
  if (hp !== BD_BASE_HP) rows.push(`<span>체력</span><i>${BD_BASE_HP} + ${hp - BD_BASE_HP} = <b>${hp}</b></i>`);
  rows.push(`<span>공격력</span><i>${base.atk} × ${f(co.B)}${co.A ? ` + ${co.A}` : ''} = <b>${now.atk}</b></i>`);
  if (base.ele) {
    rows.push(`<span>속성</span><i>(${base.ele} × ${f(co.C)}${co.D ? ` + ${co.D}` : ''})${co.E !== 1 ? ` × ${f(co.E)}` : ''} = <b>${now.ele}</b></i>`);
  }
  /* 회심은 확률이라 기대 배율로 넣습니다. 양수는 ×${critX}, 음수는 ×0.75 가 그 확률만큼 섞입니다. */
  rows.push(`<span>회심</span><i>${now.crit}% → 기대배율 <b>${f(co.G)}</b>${now.crit >= 0 ? ` (회심 ×${f(co.critX)})` : ' (역회심 ×0.75)'}</i>`);
  if (co.F !== 1) rows.push(`<span>대미지</span><i>× <b>${f(co.F)}</b></i>`);
  rows.push(`<span>점수</span><i>(${now.atk}${base.ele ? ` + ${now.ele}` : ''})${co.F !== 1 ? ` × ${f(co.F)}` : ''} × ${f(co.G)} = <b>${score}</b></i>`);

  return `<div class="bd-calc">
    ${rows.map(r => `<p>${r}</p>`).join('')}
    <p class="bd-note">체력은 만피(${BD_BASE_HP} + 체력 스킬) 기준입니다. 모션치·육질은 공격 동작과 부위마다 달라 1로 둡니다 — 빌드끼리 비교하는 상대값입니다.</p>
  </div>`;
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
  /* 상세 수치를 켜면 그 레벨에서 실제로 무슨 일이 일어나는지 한 줄 붙입니다. */
  const desc = bdState.detail ? bdSkillDesc(name, lv) : null;
  return `<div class="bd-tr${over ? ' over' : ''}">
    <span>${esc(name)}</span>
    <b>${lv}${over ? `<em>/${max}</em>` : ''}</b>
    <span class="bd-bar" style="--n:${cells}">${seg}</span>
    ${desc ? `<p class="bd-td">${esc(desc)}</p>` : ''}
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
  $('#bd-bulk-foot').hidden = true;
  $('#bd-bulk-foot').innerHTML = '';
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
        /* 목록 요약줄도 카드와 같은 공식 아이콘을 씁니다. «공격 1463 · 불 1420» 처럼
           글자로 적으면 줄이 길어져 무기 이름이 잘립니다. */
        const meta = isW
          ? [item.atk ? BD_SI.atk + item.atk : '',
             item.e && BD_EI[item.e] ? bdIco(`assets/element/${BD_EI[item.e]}.png`) + item.ele : '',
             item.crit != null ? BD_SI.crit + (item.crit > 0 ? '+' : '') + item.crit + '%' : '',
            ].filter(Boolean).join(' ')
          : '';
        /* 방어구는 표류석 슬롯을 줄 오른쪽 끝에 육각형으로 보여 줍니다.
           «◇ 2» 를 설명줄에 섞어 두면 슬롯 수가 몇 갠지 훑어보기 어렵습니다. */
        const slots = !isW && item.slot
          ? `<span class="bd-rs" title="표류석 슬롯 ${item.slot}칸">${'<i></i>'.repeat(item.slot)}</span>`
          : '';
        return `<li><button class="bd-lr gear${s.key === chosen ? ' on' : ''}" data-v="${esc(s.key)}">
          ${bdMon(s.key)}
          <span class="bd-lt">
            <b>${esc(s.name)}</b>
            <i>${esc(item.name)}${meta ? ' <span class="bd-lm">' + meta + '</span>' : ''}</i>
            <span class="bd-ls">${sk.map(x => `<em>${esc(x.s)}<b>${x.lv}</b></em>`).join('')}</span>
          </span>
          ${slots}
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
  const bulk = t.closest('[data-bulk]');
  if (bulk) return bdOpenBulk(+bulk.dataset.bulk);
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
  /* 일괄선택: 부위 칸을 누르면 그 세트로 바뀝니다(같은 걸 다시 누르면 해제). */
  const bp = e.target.closest('[data-bulk-pick]');
  if (bp) {
    const [key, part] = bp.dataset.bulkPick.split(':');
    bdBulk[part] = bdBulk[part] === key ? null : key;
    return bdFillBulk($('#bd-q').value.trim());
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
  else if (bdPick?.kind === 'bulk') bdFillBulk(v);
});
/* 합산·적용 줄은 #bd-modal-body 바깥의 footer 라 따로 받습니다. */
$('#bd-bulk-foot').addEventListener('click', e => {
  if (!bdBulk) return;
  if (e.target.closest('[data-bulk-toggle]')) {
    bdBulkFold = !bdBulkFold;
    return bdBulkFoot();
  }
  if (e.target.closest('[data-bulk-clear]')) {
    for (const { k } of BD_PARTS()) bdBulk[k] = null;
    return bdFillBulk($('#bd-q').value.trim());
  }
  if (e.target.closest('[data-bulk-apply]')) {
    const bb = bdState.builds[bdPick.bi];
    for (const { k } of BD_PARTS()) {
      if (bb[k] === bdBulk[k]) continue;
      bb[k] = bdBulk[k];
      /* 방어구가 바뀌면 표류석 칸 수도 바뀌므로 그 부위 표류석은 비웁니다. */
      bb.ds[k] = [];
    }
    bdSave(); bdRender(); bdDlg().close();
    toast('방어구를 적용했습니다');
  }
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
