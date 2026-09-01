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
const BD_MAX = 100;               // 카드 상한. 실수로 무한 복제되는 것만 막는 안전핀입니다.
const BD_PARTS = () => BUILD.parts;

/* 표류석: 색상별 스킬 풀을 표류연성 데이터에서 그대로 가져옵니다.
   같은 정보를 두 곳에 두면 게임 업데이트 때 한쪽만 낡습니다. */
const bdStones = () => (typeof SMELT === 'undefined' ? [] : SMELT.groups);

/* 표류석으로만 붙는 스킬은 build-data.js 의 maxLv 와 skill-desc.js 양쪽에서 빠져 있습니다 —
   생성기가 «빌드에 실제로 쓰이는 스킬» 을 장비와 무기에서만 추리기 때문입니다(12종).
   그런 스킬도 레벨별 설명은 표류연성 데이터에 이미 있으므로 여기서 빌려 씁니다.
   레벨 칸은 표류연성 쪽이 문자열이라 숫자로 맞춥니다 — SKILLDESC 와 같은 모양이어야
   찾는 쪽(bdSkillDesc)이 한 벌로 돕니다. */
const bdStoneLevels = name => {
  for (const g of bdStones()) for (const s of g.skills) {
    if (s.name === name && s.levels) return s.levels.map(([lv, d]) => [Number(lv), d]);
  }
  return null;
};

const bdNewBuild = () => ({
  n: '', w: null, wt: 'shield-sword', st: 0,
  helm: null, mail: null, gloves: null, belt: null, greaves: null,
  ds: { helm: [], mail: [], gloves: [], belt: [], greaves: [] },
  /* 켜 둔 조건부 스킬 이름. 기본은 전부 꺼짐입니다. */
  cond: {},
});

let bdState = { builds: [bdNewBuild()], detail: false };

const bdSet = key => BUILD.sets.find(s => s.key === key);
const bdWeaponOf = b => {
  const s = bdSet(b.w);
  return s ? s.weapons.find(w => w.t === b.wt) || null : null;
};
/* 무기 스킬은 소재 공통이지만 종류마다 다른 소재가 있습니다(바젤기우스·이블조 등).
   그런 무기는 자기 스킬을 sk 로 들고 오므로 그것을 먼저 봅니다. */
const bdWSkills = (s, w) => (w && w.sk) || (s ? s.weaponSkills : []);
const bdStylesOf = wt => (typeof BD_STYLES !== 'undefined' && BD_STYLES[wt]) || [];
const bdSpOf = wt => (typeof BD_SP !== 'undefined' && BD_SP[wt]) || null;

function bdSave() {
  /* 저장이 막힌 브라우저(사파리 «모든 쿠키 차단», 쿼터 초과)에서도 화면까지 죽이지
     않습니다 — 이번 방문 동안은 메모리로 동작하고 저장만 안 됩니다. */
  try { localStorage.setItem(BD_KEY, JSON.stringify(bdState)); } catch (e) { /* 무시 */ }
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
  /* «회심 공격 시» 는 조건이 아니라 회심 그 자체입니다. 점수는 이미 회심 확률로
     기대값을 내므로 전부 켜거나 끄는 게 아니라 확률만큼 섞여야 합니다.
     문구를 떼어내고 onCrit 로 표시해 뒤에서 확률을 곱합니다. */
  const onCrit = /회심 공격 시/.test(desc);
  const body = (gate ? desc.slice(gate.index + gate[0].length) : desc)
    .replace(/체력이 최대일 때\s*/g, '')
    .replace(/회심 공격 시\s*/g, '');
  const out = [];
  const scan = (src, fn) => {
    const r = new RegExp(src, 'g'); let m;
    while ((m = r.exec(body))) fn(m, BD_COND.test(body.slice(0, m.index)));
  };
  /* «얼음속성 공격력이 15% 증가» 가 공격력으로도 세지지 않도록 앞의 «속성 » 을 뺍니다.
     «수치가» 와 «공격력이» 는 조사가 달라 둘 다 받습니다. */
  scan('(?<!속성 )공격력이 (\\d+)% (?:상승|증가)', (m, c) => out.push({ onCrit, k: 'atk', pct: 1, v: +m[1], need, cond: c }));
  scan('(?<!속성 )공격력이 (\\d+) (?:상승|증가)', (m, c) => out.push({ onCrit, k: 'atk', v: +m[1], need, cond: c }));
  scan('회심률이 (\\d+)% (?:상승|증가)', (m, c) => out.push({ onCrit, k: 'crit', v: +m[1], need, cond: c }));
  scan('회심률이 (\\d+)% 감소', (m, c) => out.push({ onCrit, k: 'crit', v: -m[1], need, cond: c }));
  scan('(\\S+?)속성 (?:수치|공격력)[이가] (\\d+)% 증가', (m, c) => out.push({ onCrit, k: 'ele', pct: 1, v: +m[2], el: m[1], need, cond: c }));
  scan('(\\S+?)속성 (?:수치|공격력)[이가] (\\d+) (?:증가|상승)', (m, c) => out.push({ onCrit, k: 'ele', v: +m[2], el: m[1], need, cond: c }));
  scan('무기의 속성 공격력이 (\\d+)% 증가', (m, c) => out.push({ onCrit, k: 'ele', pct: 1, v: +m[1], need, cond: c }));
  /* F = 대미지 % 증가(가산). G 쪽의 회심 배율은 «대미지 배율이 130%로 강화» 로 적힙니다. */
  scan('(?:주는 )?대미지가 (\\d+)% 증가', (m, c) => out.push({ onCrit, k: 'dmg', pct: 1, v: +m[1], need, cond: c }));
  scan('대미지 배율이 (\\d+)%로 강화', (m, c) => out.push({ onCrit, k: 'critx', v: +m[1], need, cond: c }));
  /* 체력 증강 등. 체력 자체는 대미지가 아니지만 하이 차지가 이 값을 씁니다. */
  scan('체력이 (\\d+) 증가', (m, c) => out.push({ onCrit, k: 'hp', v: +m[1], need, cond: c }));
  /* 하이 차지 — «남은 체력 게이지의 2배만큼 얼음속성 공격력이 증가한다».
     속성 정액(D)이지만 값이 체력에 달려 있어 배수만 담아 둡니다. */
  scan('남은 체력 게이지의 (\\d+)배만큼 (\\S+?)속성 공격력이 증가',
    (m, c) => out.push({ onCrit, k: 'ele', hpx: +m[1], el: m[2], need, cond: c }));
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
/* 한 스킬의 레벨별 설명 전부. 공식 스킬 페이지(SKILLDESC)가 원본이고, 거기 없으면
   표류연성 데이터에서 빌려 옵니다(위 bdStoneLevels 주석). 한 줄만 필요한 곳과
   표로 다 보여 주는 곳이 같은 것을 봐야 해서 여기 한 벌만 둡니다. */
function bdSkillLevels(name) {
  const rows = (typeof SKILLDESC !== 'undefined' && SKILLDESC[name]) || bdStoneLevels(name);
  return rows && rows.length ? rows : null;
}

function bdSkillDesc(name, lv) {
  const rows = bdSkillLevels(name);
  if (!rows) return null;
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
  const on = b.cond || {};

  /* 효과를 먼저 다 모읍니다. 조건부는 켜 둔 것만 씁니다.
     조건부 목록은 화면에서 켜고 끌 수 있도록 그대로 돌려줍니다. */
  const eff = [];
  const conds = [];
  for (const [name, lv] of lvOf) {
    const list = bdEffects(bdSkillDesc(name, lv) || '');
    if (!list.length) continue;
    if (list.some(e => e.cond)) conds.push({ sk: name, lv, list: list.filter(e => e.cond) });
    for (const e of list) {
      if (e.need && (lvOf.get(e.need.s) || 0) < e.need.lv) continue;
      if (e.cond && !on[name]) continue;
      eff.push({ ...e, sk: name });
    }
  }

  /* 순서가 있습니다. 하이 차지가 체력을 쓰고, «회심 공격 시» 효과가 회심률을 씁니다. */
  const hp = BD_BASE_HP + eff.reduce((n, e) => n + (e.k === 'hp' ? e.v : 0), 0);
  for (const e of eff) if (e.k === 'crit') crit += e.v;
  const p = Math.max(0, Math.min(100, crit)) / 100;   // 마이너스 회심은 회심이 안 터집니다

  for (const e of eff) {
    if (e.k === 'atk') { if (e.pct) B += e.v / 100; else A += e.v; continue; }
    /* 회심 공격 시 터지는 배율만 받습니다. 흉회심의 «마이너스 회심 발동 시» 배율도
       같은 k 로 오는데, critX 는 아래에서 양수 회심에만 곱해지므로 그대로 받으면
       회심이 내려갔는데 점수가 오르는 정반대 결과가 됩니다. */
    if (e.k === 'critx') { if (e.onCrit) critX = Math.max(critX, e.v / 100); continue; }
    if (e.k === 'dmg') { F += e.v / 100; continue; }
    if (e.k === 'ele') {
      /* 속성 강화는 무기 속성이 같을 때만 붙습니다. 속성 표기가 없으면 어떤 속성이든 붙습니다. */
      if (!w || !w.e) continue;
      if (e.el && w.e !== e.el) continue;
      if (e.hpx) { D += hp * e.hpx; continue; }                       // 하이 차지
      if (!e.pct) { D += e.v; continue; }
      /* 회심 시에만 붙는 속성 증가는 회심 확률만큼만 섞습니다(회심격【속성】). */
      const v = e.onCrit ? (e.v / 100) * p : e.v / 100;
      if (BD_ELE_MUL.has(e.sk) || e.onCrit) E *= 1 + v; else C += v;
    }
  }
  const now = {
    atk: Math.round(base.atk * B + A),
    ele: base.ele ? Math.round((base.ele * C + D) * E) : 0,
    crit: Math.round(crit),
  };
  /* 회심 기대 배율. 양수면 회심이, 음수면 역회심이 그 확률만큼 섞입니다. */
  const q = Math.max(-100, Math.min(100, now.crit)) / 100;
  const G = 1 + (q >= 0 ? q * (critX - 1) : -q * (BD_CRIT_DOWN - 1));
  const score = Math.round((now.atk + now.ele) * F * G);
  /* 계수를 그대로 넘겨 상세 보기에서 계산 과정을 그릴 수 있게 합니다. */
  return { base, now, score, hp, conds, el: w ? w.e : null, co: { A, B, C, D, E, F, G, critX } };
}

function bdTotals(b) {
  const total = new Map();
  const add = (name, lv) => total.set(name, (total.get(name) || 0) + lv);
  bdWSkills(bdSet(b.w), bdWeaponOf(b)).forEach(x => add(x.s, x.lv));
  for (const { k } of BD_PARTS()) {
    const s = bdSet(b[k]);
    if (s && s.pieces[k]) s.pieces[k].skills.forEach(x => add(x.s, x.lv));
    /* 표류석은 스킬 레벨 1을 줍니다. 예전 저장값에 lv 2·3 이 남아 있어도 1로 셉니다. */
    (b.ds[k] || []).slice(0, bdSlotCount(b, k)).forEach(d => { if (d && d.s) add(d.s, 1); });
  }
  return [...total.entries()].sort((a, b2) => b2[1] - a[1] || a[0].localeCompare(b2[0], 'ko'));
}

/* 조건부 스킬. 조건의 성격이 제각각이라(약점 공격은 사실상 상시, 부활은 사고)
   하나의 기본값이 없어 켜고 끄게 둡니다. 기본은 전부 꺼짐입니다. */
const BD_KIND = { atk: '공격력', crit: '회심률', ele: '속성', dmg: '대미지', critx: '회심 배율', hp: '체력' };
function bdCondList(b) {
  const bi = bdState.builds.indexOf(b);
  /* 미리보기처럼 내 빌드 목록에 없는 것은 켜고 끌 수 없습니다(저장할 곳이 없습니다). */
  if (bi < 0) return '';
  const { conds } = bdStats(b);
  if (!conds.length) return '';
  const on = b.cond || {};
  const n = conds.filter(c => on[c.sk]).length;
  return `<div class="bd-cond">
    <p class="bd-cdh">조건부 스킬 <b>${n}/${conds.length}</b> <i>켠 것만 점수에 들어갑니다</i></p>
    ${conds.map(c => {
      const what = c.list.map(e => `${BD_KIND[e.k] || e.k} ${e.v > 0 ? '+' : ''}${e.v}${e.pct || e.k === 'crit' || e.k === 'critx' ? '%' : ''}`).join(' · ');
      return `<label class="bd-cl${on[c.sk] ? ' on' : ''}">
        <input type="checkbox" data-cond="${bi}:${esc(c.sk)}"${on[c.sk] ? ' checked' : ''}>
        <span>${esc(c.sk)} <b>${c.lv}</b></span>
        <i>${esc(what)}</i>
      </label>`;
    }).join('')}
  </div>`;
}

/* ── 방어구 일괄선택 ───────────────────────────────────────────── */
/* 부위마다 따로 모달을 여닫으면 다섯 번을 반복해야 합니다. 한 화면에서 부위를 찍고
   합산 스킬을 보며 고른 뒤 한 번에 적용합니다. bdBulk 에 고르는 중인 값을 담습니다. */
let bdBulk = null;
let bdBulkFold = false;   // 합산 스킬 접힘 여부

/* 걸어 둔 스킬 뱃지 [{ s: 이름, c: 색 }]. 색은 뱃지 · 부위 칸 숫자 · 합산 칩이
   같은 것을 씁니다 — 어느 스킬 때문에 걸린 칸인지 색만 보고 알게 하려는 것입니다.
   빼도 남은 뱃지의 색이 흔들리지 않도록 «안 쓰는 색» 중에서 고릅니다. */
const BD_SKC = ['#E9A13B', '#4BC49A', '#5FA8E6', '#E4705E', '#B98BE0', '#C9D24B'];
let bdBulkSk = [];

function bdBulkAddSk(name) {
  if (!bdBulkSk.some(x => x.s === name)) {
    const c = BD_SKC.find(v => !bdBulkSk.some(x => x.c === v)) || BD_SKC[bdBulkSk.length % BD_SKC.length];
    bdBulkSk.push({ s: name, c });
  }
  /* 자동완성이 넣어 준 이름은 지웁니다 — 뱃지가 대신 걸렸고, 검색칸은 다음 스킬
     (또는 몬스터 이름)을 받을 자리로 비어 있어야 합니다. */
  $('#bd-q').value = '';
  $('#bd-q').focus();
  bdFillBulk('');
}

function bdOpenBulk(bi) {
  const b = bdState.builds[bi];
  bdPick = { kind: 'bulk', bi };
  bdBulk = {};
  bdBulkSk = [];
  for (const { k } of BD_PARTS()) bdBulk[k] = b[k] || null;
  bdOpen('방어구 일괄선택', '', true, { placeholder: '몬스터 · 방어구 · 스킬 검색' });
  bdFillBulk('');
}

/* 공식 방어구 페이지 순서(o)대로 세우고, 이벤트 장비는 뒤로 갑니다. */
function bdBulkSets() {
  return BUILD.sets.filter(s => Object.keys(s.pieces).length)
    .sort((a, b) => a.o - b.o || a.g - b.g || a.u - b.u || a.id - b.id);
}

/* 검색은 세트가 아니라 부위 단위로 겁니다. 세트만 걸러 다섯 칸을 다 보여 주면
   어느 부위가 걸린 건지 눌러 봐야 압니다. 몬스터·방어구 이름은 부분 일치지만
   스킬명은 전체가 같아야 합니다(«공격» 에 «불속성 공격 강화» 가 끼지 않도록).
   대신 스킬 전체 이름은 검색칸 자동완성으로 채웁니다. */
/* 뱃지가 여러 개면 «전부 가진 부위» 로 좁히지 않습니다 — 스킬은 부위마다 나뉘어
   붙어서 그렇게 하면 거의 항상 빈 목록이 됩니다. 하나라도 가지면 남기되(OR),
   겹친 개수를 세어 많이 겹친 세트를 위로 올리고 칸에는 색깔 숫자를 답니다.
   그래서 «둘 다 가진 부위» 는 좁히지 않아도 맨 위에서 두 색으로 눈에 띕니다. */
function bdBulkRows(q) {
  const norm = t => String(t).toLowerCase().replace(/[\s　]+/g, '');
  const needle = norm(q);
  const sk = bdBulkSk || [];
  return bdBulkSets().map(s => {
    const m = {};                       // 부위 → [{ c: 색, lv: 그 부위가 주는 레벨 }]
    const hit = BD_PARTS().filter(p => {
      const pc = s.pieces[p.k];
      if (!pc) return false;
      if (needle && !(norm(s.name + pc.name).includes(needle)
        || pc.skills.some(x => norm(x.s) === needle))) return false;
      if (!sk.length) return true;
      m[p.k] = sk.map(x => ({ c: x.c, lv: (pc.skills.find(y => y.s === x.s) || {}).lv }))
        .filter(x => x.lv != null);
      return m[p.k].length > 0;
    }).map(p => p.k);
    /* 세트가 덮는 스킬 가짓수. 부위가 나뉘어 있어도 «이 세트로 둘 다 된다» 가 보입니다. */
    const n = new Set(hit.flatMap(k => (m[k] || []).map(x => x.c))).size;
    return { s, hit, m, n };
  }).filter(r => r.hit.length).sort((a, b) => b.n - a.n);
}

/* 자동완성에 띄울 방어구 스킬 이름. 목록은 바뀌지 않으니 한 번만 모읍니다. */
let bdSkNames = null;
function bdArmorSkills() {
  if (!bdSkNames) {
    const all = new Set();
    for (const s of BUILD.sets) for (const k in s.pieces) s.pieces[k].skills.forEach(x => all.add(x.s));
    bdSkNames = [...all].sort((a, b) => a.localeCompare(b, 'ko'));
  }
  return bdSkNames;
}

function bdFillBulk(q) {
  const parts = BD_PARTS();
  const rows = bdBulkRows(q);
  const nsk = bdBulkSk.length;

  /* 뱃지 줄은 목록과 같이 흐르되 위에 붙어 있습니다 — 스크롤을 내려도 지금 무슨
     색이 무슨 스킬인지 보여야 아래 칸의 숫자를 읽을 수 있습니다. */
  const badges = nsk ? `<div class="bd-bsk">${bdBulkSk.map((x, i) =>
    `<button class="bd-skb" style="--c:${x.c}" data-bulk-sk="${i}" title="빼기">${esc(x.s)}<i aria-hidden="true">×</i></button>`).join('')
    }${nsk > 1 ? '<button class="bd-skb clr" data-bulk-sk="all">스킬 전부 빼기</button>' : ''}</div>` : '';

  $('#bd-modal-body').innerHTML = badges + (rows.length ? `<ul class="bd-blist">${rows.map(({ s, hit, m, n }) => `
    <li class="bd-brow">
      ${bdMon(s.key)}
      <span class="bd-bn">${esc(s.name)}</span>
      ${nsk > 1 ? `<span class="bd-bc${n === nsk ? ' full' : ''}" title="이 세트가 덮는 스킬 ${n}종">${n}/${nsk}</span>` : ''}
      <span class="bd-bp bd-p5">${parts.map(p => {
        const pc = s.pieces[p.k];
        if (!pc || !hit.includes(p.k)) return '<i class="bd-bx"></i>';
        const on = bdBulk[p.k] === s.key;
        const lv = m[p.k] || [];
        return `<button class="bd-bb${on ? ' on' : ''}${lv.length ? ' lv' : ''}${lv.length > 1 ? ' multi' : ''}" data-bulk-pick="${esc(s.key)}:${p.k}"
          title="${esc(pc.name)} · ${pc.skills.map(x => x.s + ' ' + x.lv).join(', ')}${pc.slot ? ' · 표류석 ' + pc.slot + '칸' : ''}">
          <img src="assets/part/${p.k}.png" width="18" height="18" alt="${esc(p.n)}">
          ${lv.length ? `<i class="bd-bl">${lv.map(x => `<em style="--c:${x.c}">${x.lv}</em>`).join('')}</i>` : ''}
        </button>`;
      }).join('')}</span>
    </li>`).join('')}</ul>` : `<p class="bd-empty">${nsk ? '고른 스킬이 붙은 방어구가 없습니다.' : '일치하는 방어구가 없습니다.'}</p>`);
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
      ? list.map(([nm, lv]) => {
        /* 걸어 둔 스킬은 합산에서도 뱃지와 같은 색으로 찍습니다 — 지금 고른 부위가
           찾던 스킬을 몇 레벨까지 채웠는지 한눈에 보라고 둔 것입니다. */
        const c = bdBulkSk.find(x => x.s === nm);
        return `<span class="chip${c ? ' sel' : ''}"${c ? ` style="--c:${c.c}"` : ''}>${esc(nm)}<b>${lv}</b></span>`;
      }).join('')
      : '<span class="bd-empty">부위를 고르면 스킬이 합산됩니다.</span>'}</div>
    <div class="bd-bact">
      <button class="btn ghost" data-bulk-clear="1">전부 비우기</button>
      <button class="btn primary" data-bulk-apply="1">${n}부위 적용</button>
    </div>`;
  $('#bd-bulk-foot').hidden = false;
}

/* ── 공유 ──────────────────────────────────────────────────────── */
/* 링크 복사와 카카오톡 공유가 같은 URL 을 씁니다. 내 빌드도 추천빌드도 넘기므로
   목록의 번호가 아니라 빌드 객체를 받습니다.
   표류석은 `ds=부위|칸|색상|스킬;…` 로 담습니다. 구분자는 기존 형식이 쓰는
   ',' 와 '=' 를 피해 ';' 와 '|' 를 골랐습니다. 색상·스킬을 이름으로 적는 건
   smelt-data.js 를 다시 만들어 순서가 바뀌어도 옛 링크가 살아 있어야 하기 때문입니다.

   한글은 %EC%88%98 처럼 세 배로 불어나므로 encodeURIComponent 로 통째로 감싸지 않고
   쿼리에서 실제로 뜻이 달라지는 글자만 뺍니다(공백·% # & + ?). 장비 키·스킬명에는
   이 글자들이 없어서(구분자도 마찬가지) 날것으로 두어도 되돌릴 수 있습니다.
   길이가 1/3 로 줄어드는 게 중요한 이유는 bdKakao 주석에 적어 두었습니다.
   옛 링크는 전부 인코딩되어 있어도 bdParse 의 decodeURIComponent 가 그대로 풉니다. */
const bdEscape = p => p.replace(/[%#&+?\s]/g, encodeURIComponent);

function bdShareParam(b) {
  const ds = [];
  for (const { k } of BD_PARTS()) {
    (b.ds[k] || []).slice(0, bdSlotCount(b, k)).forEach((d, i) => {
      if (d && d.s) ds.push(`${k}|${i}|${d.c}|${d.s}`);
    });
  }
  const cond = Object.keys(b.cond || {}).filter(k => b.cond[k]);
  const p = [`w=${b.w || ''}`, `wt=${b.wt}`, b.st ? `st=${b.st}` : '', ds.length ? `ds=${ds.join(';')}` : '',
    cond.length ? `c=${cond.join(';')}` : '']
    .concat(BD_PARTS().map(({ k }) => `${k}=${b[k] || ''}`)).filter(Boolean).join(',');
  return bdEscape(p);
}
/* 링크 복사는 지금 보고 있는 주소를 씁니다(로컬에서 붙여넣어 확인할 수 있게).
   카카오·공유 시트로 나가는 링크는 받는 사람이 열 수 있어야 하므로 배포 절대 주소를 씁니다.
   배포 환경에서는 둘이 같은 값입니다. */
const bdShareURL = b => `${location.origin}${location.pathname}?build=${bdShareParam(b)}#build`;

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
const bdShareAbs = b => `${BD_BASE}?build=${bdShareParam(b)}#build`;
/* 카카오 카드는 한 줄에 들어가는 글자 수가 빡빡해서 공백을 전부 뺍니다.
   스킬명 안의 공백과 레벨 앞 공백까지 포함합니다(마비 내성 3 → 마비내성3).
   URL·이미지 인자에는 쓰지 않습니다. */
const bdTight = v => String(v).replace(/[\s\u3000]+/g, '');

/* 콘솔에 등록한 리스트형 사용자 템플릿에 넘길 인자. 방어구 5부위를 한 줄씩 씁니다.
   줄마다 그 부위의 스킬과 표류석 스킬만 적고, 이미지는 그 방어구의 재료 몬스터입니다.
   SDK 기본 템플릿은 아이템이 3개까지라 5줄이 안 되므로 이 경로만 5줄을 낼 수 있습니다. */
function bdKakaoArgs(b) {
  const w = bdWeaponOf(b);
  const args = {
    /* 빌드명을 직접 지었으면 그 이름만 씁니다. 이름이 없어 «대검 빌드» 같은
       기본 제목이 될 때만 무기명을 덧붙입니다. */
    HEADER: bdTight((b.n || '').trim() || [bdShareText(b).title, w ? w.name : ''].filter(Boolean).join('·')),
    /* 링크 칸에 쓰는 두 형태를 모두 보냅니다. 어느 쪽을 템플릿에 넣었든 맞습니다.
         ${URL}                                    → 전체 주소 (단독으로 넣을 때)
         https://mhn-kor.github.io/?build=${BUILD}#build  → 쿼리 값 자리에 넣을 때
       location 이 아니라 배포 절대 주소로 만듭니다. 로컬에서 눌러도 남이 열 수 있어야 합니다. */
    URL: bdShareAbs(b),
    BUILD: bdShareParam(b),
  };
  BD_PARTS().forEach(({ k, n }, i) => {
    const set = bdSet(b[k]);
    const piece = set && set.pieces[k];
    const stones = bdStoneList(b, k);
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
function bdKakaoList(b) {
  const url = bdShareAbs(b);
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

  const stones = bdStoneList(b);
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

/* 카카오 SDK 는 카톡 앱으로 바로 보낼 때(모바일·카톡 인앱 브라우저) 완성된 메시지가
   1만 자를 넘으면 던지는데, 그 오류는 우리 try 밖에서 페이지를 통째로 카카오 오류
   화면으로 옮겨 버립니다. 카드가 링크를 열아홉 번 되풀이해 담으므로 최종 크기는
   링크 길이의 스무 배쯤이고, 그래서 «링크가 얼마나 짧은가» 가 곧 성패입니다.
   여섯 부위를 다 갖춘 빌드(추천빌드에서 가져온 것이 늘 그렇습니다)는 옛 인코딩으로
   700~850자였고 그대로 한도를 넘었습니다. bdEscape 로 200~300자가 되어 들어오지만,
   표류석을 끝까지 채운 빌드는 아직 넘길 수 있어 여기서 한 번 더 막습니다.
   ponytail: 스무 배는 콘솔 템플릿(KAKAO_TEMPLATE_ID)이 링크를 몇 줄에 다는지에 달렸습니다.
   템플릿을 바꿔 줄이 늘면 이 값을 같이 내려야 합니다. */
const BD_KAKAO_URL_MAX = 340;

async function bdKakao(b) {
  const url = bdShareAbs(b);
  const { title, desc } = bdShareText(b);
  const link = { mobileWebUrl: url, webUrl: url };
  if (url.length <= BD_KAKAO_URL_MAX && await bdKakaoReady()) {
    try {
      const tid = parseInt(window.KAKAO_TEMPLATE_ID, 10);
      if (tid) window.Kakao.Share.sendCustom({ templateId: tid, templateArgs: bdKakaoArgs(b) });
      else window.Kakao.Share.sendDefault(bdKakaoList(b) || {
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
  bdCopyLink(bdShareURL(b), '링크 복사됨 · 카카오톡에 붙여넣으세요');
}

/* ── 렌더 ──────────────────────────────────────────────────────── */
/* ⧉ 🔗 같은 문자는 기기 글꼴에 없으면 빈칸으로 나옵니다. SVG 로 그립니다. */
const BD_I = {
  copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  del: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 14.5 7-7 7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 9.5 7 7 7-7"/></svg>',
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
  const wsk = ws ? bdWSkills(ws, w) : [];
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
        ${wsk.length ? `<span class="bd-inline">${bdChips(wsk)}</span>` : ''}
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
    /* 방어구 스킬 뒤에 그 부위에 낀 표류석을 같이 답니다. 육각형만으로는 무엇이
       끼워졌는지 눌러 보기 전에는 알 수 없습니다(모바일에는 title 도 안 뜹니다). */
    const chips = (piece ? bdChips(piece.skills) : '') + bdStoneList(b, k).map(bdStoneChip).join('');
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
          ${chips ? `<span class="bd-inline">${chips}</span>` : ''}
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
        <button class="bd-ic" data-rec="${bi}" title="추천 빌드로 등록" aria-label="추천 빌드로 등록">${BD_I.star}</button>
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
    <p class="bd-score"><span>점수</span><b>${score}</b>${(() => {
      const n = Object.values(b.cond || {}).filter(Boolean).length;
      return n ? `<em class="bd-cb" title="조건부 스킬 ${n}개 반영">조건 ${n}</em>` : '';
    })()}</p>
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
    ${bdCondList(b)}
    <p class="bd-note">체력은 만피(${BD_BASE_HP} + 체력 스킬) 기준입니다. 모션치·육질은 공격 동작과 부위마다 달라 1로 둡니다 — 빌드끼리 비교하는 상대값입니다.</p>
  </div>`;
}

/* 스킬마다 상한이 달라(대개 3 또는 5) 막대를 그 수만큼 칸으로 나눕니다.
   상한을 넘으면 초과분은 낭비이므로 빨갛게 표시합니다. 상한을 모르는 스킬
   (이벤트 스킬 등)은 칸을 나누지 않고 현재 값만 채웁니다. */
function bdTotalRow(name, lv) {
  const rows = bdSkillLevels(name);
  const max = (BUILD.maxLv || {})[name] || (rows || []).length;
  const over = max > 0 && lv > max;
  const cells = max > 0 ? max : lv;
  const seg = Array.from({ length: cells }, (_, i) =>
    `<i class="${i < Math.min(lv, cells) ? 'on' : ''}"></i>`).join('');
  /* 상세 수치를 켜면 그 레벨에서 실제로 무슨 일이 일어나는지 한 줄 붙입니다. */
  const desc = bdState.detail ? bdSkillDesc(name, lv) : null;
  /* 설명이 있는 스킬만 누를 수 있습니다 — 없는 것을 눌러 봐야 빈 창입니다.
     이름을 진짜 button 으로 두면 키보드 이동과 포커스 표시가 저절로 따라옵니다. */
  return `<div class="bd-tr${over ? ' over' : ''}">
    ${rows
      ? `<button type="button" class="bd-skn" data-sk="${esc(name)}" data-sklv="${lv}"
                 title="레벨별 설명 보기">${esc(name)}</button>`
      : `<span>${esc(name)}</span>`}
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

/* 이 모달은 리더보드 탭(record.js)도 같이 씁니다. 연 쪽을 dataset.owner 에 적어 두고
   각자의 클릭·검색 처리기가 남의 차례에는 손을 떼게 합니다. record.js 는 bdOpen() 을
   부른 뒤 owner 를 'record' 로 덮어씁니다. */
function bdOpen(title, bodyHtml, withSearch, opt = {}) {
  bdDlg().dataset.owner = 'build';
  /* 창의 «성격». 목록을 고르는 창과 읽기만 하는 창은 크기가 달라야 합니다(style.css). */
  bdDlg().dataset.view = opt.view || '';
  $('#bd-modal-title').innerHTML = title;
  $('#bd-modal-body').innerHTML = bodyHtml;
  $('#bd-srow').hidden = !withSearch;
  $('#bd-clear').hidden = !opt.clear;
  $('#bd-gsk').hidden = !opt.sk;      // 스킬 표시는 장비 선택에서만 씁니다
  $('#bd-wf').hidden = true;          // 상세 필터 칩은 무기 선택(bdOpenGear)이 다시 켭니다
  $('#bd-bulk-foot').hidden = true;
  $('#bd-bulk-foot').innerHTML = '';
  if (withSearch) {
    $('#bd-q').value = '';
    $('#bd-q').placeholder = opt.placeholder || '몬스터 · 장비 · 스킬 검색';
  }
  bdDlg().showModal();
  if (withSearch) focusIn($('#bd-q'));
}

/* 합계에서 스킬 이름을 누르면 레벨별 설명을 통째로 보여 줍니다.
   표류연성 탭의 표와 같은 것이되(.lv 를 그대로 씁니다), 굵게 서는 줄이 «MAX» 가 아니라
   «지금 이 빌드의 레벨» 입니다 — 다음 한 칸이 얼마나 오르는지 보러 탭을 건너가지 않아도 됩니다.
   상한을 넘겨 낀 경우(over)에는 표에 없는 레벨이라 마지막 줄을 짚습니다. */
function bdOpenSkill(name, lv) {
  const rows = bdSkillLevels(name);
  if (!rows) return;
  bdPick = { kind: 'skill' };          // 모달 본문 핸들러가 옛 선택을 붙들지 않게 비웁니다
  const max = rows[rows.length - 1][0];
  const cur = Math.min(lv, max);
  const body = rows.length === 1
    ? `<p class="one">${esc(rows[0][1])}</p>`
    : `<table><thead><tr><th>Lv</th><th>효과</th></tr></thead><tbody>${rows.map(([n, d]) =>
        /* 레벨은 bdSkillLevels 가 숫자로 맞춰 줍니다 — esc 는 문자열만 받습니다. */
        `<tr${n === cur ? ' class="on"' : ''}><td>${n}</td><td>${esc(d)}</td></tr>`).join('')}</tbody></table>`;
  bdOpen(`${esc(name)}<i class="bd-lvnow">Lv${lv}${lv > max ? ` <em>/${max}</em>` : ''}</i>`,
    `<div class="lv bd-lvcur">${body}</div>`, false, { view: 'skill' });
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

/* 빌드 목록 — 이름 줄 아래 장비 여섯 칸(bdIconRow)을 깔고, ▲▼로 순서를 바꿉니다.
   카드가 길어 화면에 하나씩만 보이므로, 순서는 여기서 한눈에 만집니다.
   여섯 칸에 부위 제목은 달지 않습니다 — 칸 순서가 카드와 같고 title 로 충분합니다. */
function bdFillList() {
  $('#bd-modal-body').innerHTML = `<ul class="bd-blist">${bdState.builds.map((b, i) => {
    const styleName = b.st ? bdStylesOf(b.wt)[b.st - 1] : null;
    return `
    <li class="bd-brow">
      <span class="bd-lb">
        <span class="bd-bn"><img src="assets/part/${esc(b.wt)}.png" width="18" height="18" alt="">
          ${esc((b.n || '').trim() || `빌드 ${i + 1}`)}
          ${styleName ? `<i class="bd-lst">${esc(styleName)}</i>` : ''}</span>
        ${bdIconRow(b)}
      </span>
      <span class="bd-bp">
        <button class="bd-ic" data-move="${i}:-1" title="위로" aria-label="위로"${i === 0 ? ' disabled' : ''}>${BD_I.up}</button>
        <button class="bd-ic" data-move="${i}:1" title="아래로" aria-label="아래로"${i === bdState.builds.length - 1 ? ' disabled' : ''}>${BD_I.down}</button>
      </span>
    </li>`;
  }).join('')}</ul>`;
}

function bdOpenList() {
  bdPick = { kind: 'list' };
  bdOpen('빌드 목록', '', false, { view: 'skill' });   // 읽기 창과 같은 «내용만큼» 높이
  bdFillList();
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
/* 스킬을 켜면 지금까지처럼 한 줄에 한 세트씩, 끄면 몬스터 아이콘만 격자로 깝니다.
   85줄을 손가락으로 넘기는 것보다 아이콘을 훑는 편이 빨라 모바일은 끈 채로 시작합니다.
   자리가 넉넉한 PC 는 켠 채로 시작하고, 버튼은 양쪽 모두에 있습니다. */
let bdGearSk = !globalThis.matchMedia?.('(max-width: 640px)').matches;
function bdSkBtn() {
  const el = $('#bd-gsk');
  el.classList.toggle('on', bdGearSk);
  el.setAttribute('aria-pressed', String(bdGearSk));
}

/* 무기 종류별 상세 필터 — 검색창 위에 칩으로 깝니다. 칩은 하나만 걸리고 다시 누르면
   풀립니다. 항목은 [이름, 대조 정규식?] 이고, 정규식이 없으면 부가정보(x) 항목과
   «같거나 그 낱말로 시작» 하면 맞은 것으로 봅니다(«일반형» ↔ «일반형 포격»).
   수렵피리는 연주가 36곡이라 곡명 대신 계열(공격력UP 대·소 묶음 등)로 깝니다.
   정령왕의 가호·회피거리UP 처럼 계열이 없는 한두 곡은 검색창이 맡습니다. */
const BD_WF_AMMO = [
  ['통상탄', /^통상탄/], ['관통탄', /^관통/],
  /* «산탄» 은 화염산탄처럼 앞에 속성이 붙지만, 확산탄과 수냉확산탄의 «…산탄» 과는
     갈라야 합니다 — 앞 글자가 '확' 이면 확산탄 계열입니다. */
  ['산탄', /(^|[^확])산탄/], ['철갑유탄', /철갑유탄/], ['확산탄', /확산탄/],
  ['참렬탄', /^참렬/], ['속성탄', /^(화염|수냉|전격|빙결|멸룡)탄/], ['상태이상탄', /^(독|마비|수면)탄/],
];
const BD_WFILTER = {
  'insect-glaive': [['비상형'], ['공투형'], ['가루형'], ['절단'], ['타격']],
  'light-gun': BD_WF_AMMO,
  'heavy-gun': [...BD_WF_AMMO, ['용격탄', /용격탄/]],
  bow: [['Lv4 연사'], ['Lv4 관통'], ['Lv4 확산'], ['독병'], ['마비병'], ['수면병'], ['폭파병']],
  gunlance: [['일반형'], ['방사형'], ['확산형']],
  'switch-axe': [['강격병'], ['멸기병'], ['강속성병'], ['독병'], ['마비병'], ['멸룡병']],
  'charge-blade': [['유탄병'], ['강속성병']],
  'hunting-horn': [
    /* ^ 앵커가 없으면 «불속성 공격력UP» 이 공격력UP 으로도 걸립니다. */
    ['공격력UP', /^공격력UP/], ['회심률UP', /^회심률UP/], ['속성치UP', /^속성치UP/],
    ['속성 공격력UP', /^(불|물|번개|얼음|용)속성 공격력UP/], ['SP게이지 가속', /^SP게이지 가속/],
    ['고주파 충격파', /^고주파 충격파/], ['방어력UP'], ['청각 보호', /^청각 보호/],
    ['무효·내성', /무효|내성/],
  ],
};
let bdGearWf = null;   // 걸려 있는 칩([이름, 정규식?] 그대로). 창을 열 때마다 풉니다.
const bdWfTest = ([n, re], e) => (re ? re.test(e) : e === n || e.startsWith(n + ' '));

function bdWfChips() {
  const el = $('#bd-wf');
  const list = (bdPick && bdPick.kind === 'gear' && bdPick.target === 'weapon'
    && BD_WFILTER[bdState.builds[bdPick.bi].wt]) || [];
  el.hidden = !list.length;
  el.innerHTML = list.map(([n]) => {
    const on = bdGearWf && bdGearWf[0] === n;
    return `<button type="button" class="bd-wfc${on ? ' on' : ''}" data-wf="${esc(n)}" aria-pressed="${on}">${esc(n)}</button>`;
  }).join('');
}

function bdOpenGear(bi, target) {
  bdPick = { kind: 'gear', bi, target };
  const b = bdState.builds[bi];
  const isW = target === 'weapon';
  const type = BUILD.weaponTypes.find(t => t.k === b.wt);
  const head = isW
    ? `<img src="assets/part/${esc(b.wt)}.png" width="24" height="24" alt="">무기 · ${esc(type.n)}`
    : `<img src="assets/part/${esc(target)}.png" width="24" height="24" alt="">${esc(BD_PARTS().find(p => p.k === target).n)}`;
  bdOpen(head, '', true, { sk: true });
  bdGearWf = null;
  bdWfChips();
  bdSkBtn();
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
    const item = isW ? s.weapons.find(w => w.t === b.wt) : s.pieces[target];
    /* 상세 필터 칩(벌레 타입·탄 종류 등)이 걸려 있으면 부가정보가 맞는 무기만 남깁니다. */
    if (isW && bdGearWf && !(item.x || []).some(e => bdWfTest(bdGearWf, e))) return false;
    if (!needle) return true;
    const sk = (isW ? bdWSkills(s, item) : item.skills).map(x => x.s).join('');
    /* 무기는 부가정보(벌레·탄·화살·병·포격·연주)로도 좁힐 수 있습니다 —
       «절단» «관통» 처럼 종류로 찾는 일이 잦습니다. */
    const extra = isW && item.x ? item.x.join('') : '';
    return norm(s.name + item.name + sk + extra).includes(needle);
  });

  /* 그룹이 바뀌는 자리에 머리글을 끼웁니다. 목록이 85줄이라 어디서 이벤트·기타
     소재가 시작되는지 보이지 않으면 찾기 어렵습니다.
     아이콘 격자에는 넣지 않습니다 — 머리글이 줄을 끊으면 한 화면에 들어가는 수가
     줄어, 아이콘만 훑겠다는 목적과 어긋납니다. */
  const GNAME = ['몬스터 소재', '이벤트 소재', '기본 소재'];
  let lastG = -1;

  $('#bd-modal-body').innerHTML =
    `<div class="bd-list${bdGearSk ? '' : ' grid'}">
      <button class="bd-lr clear" data-v="">선택 해제</button>
      ${rows.map(s => {
        const head = bdGearSk && s.g !== lastG ? `<p class="bd-gh">${esc(GNAME[s.g] || '기타')}</p>` : '';
        lastG = s.g;
        return head + (bdGearSk ? bdGearRow : bdGearCell)(s, b, target, isW, chosen);
      }).join('')}
    </div>`;
  $('#bd-modal-count').textContent = `${rows.length}종`;
}

/* 스킬 끔 — 몬스터 아이콘만 깔고 나머지는 title 로 미룹니다. 한 줄에 몇 개가
   들어갈지는 CSS 가 화면 너비를 보고 정합니다(auto-fill). */
function bdGearCell(s, b, target, isW, chosen) {
  const item = isW ? s.weapons.find(w => w.t === b.wt) : s.pieces[target];
  const sk = (isW ? bdWSkills(s, item) : item.skills).map(x => `${x.s} ${x.lv}`).join(', ');
  const tip = [s.name, item.name, sk, isW && item.x ? item.x.join(' · ') : '',
    !isW && item.slot ? `표류석 ${item.slot}칸` : ''].filter(Boolean).join(' · ');
  return `<button class="bd-lr cell${s.key === chosen ? ' on' : ''}" data-v="${esc(s.key)}"
    title="${esc(tip)}" aria-label="${esc(s.name)}">${bdMon(s.key)}</button>`;
}

function bdGearRow(s, b, target, isW, chosen) {
  return ((() => {
        const item = isW ? s.weapons.find(w => w.t === b.wt) : s.pieces[target];
        const sk = isW ? bdWSkills(s, item) : item.skills;
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
        return `<button class="bd-lr gear${s.key === chosen ? ' on' : ''}" data-v="${esc(s.key)}">
          ${bdMon(s.key)}
          <span class="bd-lt">
            <b>${esc(s.name)}</b>
            <i>${esc(item.name)}${meta ? ' <span class="bd-lm">' + meta + '</span>' : ''}</i>
            <span class="bd-ls">${sk.map(x => `<em>${esc(x.s)}<b>${x.lv}</b></em>`).join('')}</span>
            ${isW && item.x ? `<span class="bd-lx">${item.x.map(t => `<i>${esc(t)}</i>`).join('')}</span>` : ''}
          </span>
          ${slots}
        </button>`;
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
  const rec = t.closest('[data-rec]');
  if (rec) return bdOpenRecommend(+rec.dataset.rec);
  const bulk = t.closest('[data-bulk]');
  if (bulk) return bdOpenBulk(+bulk.dataset.bulk);
  const lk = t.closest('[data-link]');
  if (lk) return bdCopyLink(bdShareURL(bdState.builds[+lk.dataset.link]));
  const kk = t.closest('[data-kakao]');
  if (kk) return bdKakao(bdState.builds[+kk.dataset.kakao]);
  const sk = t.closest('[data-sk]');
  if (sk) return bdOpenSkill(sk.dataset.sk, +sk.dataset.sklv);
});

/* 추천빌드 미리보기도 같은 합계 줄(bdTotalRow)을 씁니다 — 그 안에서도 눌리게 합니다.
   미리보기는 제 dialog 안에 있어 스킬 창이 그 위에 겹쳐 열립니다. */
$('#rc-view-gear')?.addEventListener('click', e => {
  const sk = e.target.closest('[data-sk]');
  if (sk) bdOpenSkill(sk.dataset.sk, +sk.dataset.sklv);
});

$('#bd-cards').addEventListener('change', e => {
  const c = e.target.closest('[data-cond]');
  if (!c) return;
  const [bi, sk] = c.dataset.cond.split(/:(.+)/);
  const b = bdState.builds[+bi];
  b.cond = b.cond || {};
  if (c.checked) b.cond[sk] = true; else delete b.cond[sk];
  bdSave(); bdRender();
});

$('#bd-cards').addEventListener('input', e => {
  const el = e.target.closest('[data-name]');
  if (!el) return;
  bdState.builds[+el.dataset.name].n = el.value;
  bdSave();
});

/* 모달 내부 선택 */
$('#bd-modal-body').addEventListener('click', e => {
  if (bdDlg().dataset.owner !== 'build') return;      // 리더보드가 연 모달이면 record.js 담당
  const b = bdState.builds[bdPick.bi];

  /* 빌드 목록: ▲▼로 이웃과 자리를 바꿉니다. 창은 열어 둔 채 뒤의 카드도 같이 다시 그립니다. */
  const mv = e.target.closest('[data-move]');
  if (mv) {
    const [i, d] = mv.dataset.move.split(':').map(Number);
    const a = bdState.builds;
    [a[i], a[i + d]] = [a[i + d], a[i]];
    bdSave(); bdRender(); return bdFillList();
  }

  const gi = e.target.closest('.bd-gi');
  if (gi) {
    b.wt = gi.dataset.v; b.st = 0;
    if (!(bdSet(b.w) || {}).weapons?.some(w => w.t === b.wt)) b.w = null;
    bdSave(); bdRender(); return bdDlg().close();
  }
  /* 일괄선택: 스킬 뱃지 빼기. */
  const rm = e.target.closest('[data-bulk-sk]');
  if (rm) {
    const v = rm.dataset.bulkSk;
    bdBulkSk = v === 'all' ? [] : bdBulkSk.filter((_, i) => i !== +v);
    return bdFillBulk($('#bd-q').value.trim());
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
  if (bdDlg().dataset.owner !== 'build') return;
  const v = e.target.value.trim();
  if (bdPick?.kind === 'gear') bdFillGear(v);
  else if (bdPick?.kind === 'ds') bdFillStone(v);
  else if (bdPick?.kind === 'bulk') bdFillBulk(v);
});

/* 스킬 이름 자동완성. 검색은 전체 일치라 이름을 다 쳐야 하므로, 치는 동안 후보를 띄웁니다.
   후보는 부분 일치로 찾습니다(«공격» → 불속성 공격 강화…). 고르면 뱃지로 걸립니다.
   이미 건 스킬은 후보에서 빼서, 같은 걸 두 번 고르는 헛손질을 없앱니다.
   목록은 app.js 의 nickAuto 를 그대로 씁니다 — datalist 는 너비도 위치도 브라우저가
   정해 버려 입력칸과 어긋나고, 바로 뜨지도 않습니다(app.js 주석 참고).
   #bd-q 는 다른 모달과 리더보드도 같이 쓰므로 일괄선택일 때만 후보를 냅니다. */
nickAuto('#bd-q', '#bd-q-list', null, {
  list: q => {
    if (bdDlg().dataset.owner !== 'build' || bdPick?.kind !== 'bulk') return [];
    const norm = t => String(t).toLowerCase().replace(/[\s　]+/g, '');
    const needle = norm(q);
    return bdArmorSkills()
      .filter(s => norm(s).includes(needle) && !bdBulkSk.some(x => x.s === s))
      .slice(0, 12);
  },
  pick: v => bdBulkAddSk(v),
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

$('#bd-gsk').addEventListener('click', () => {
  bdGearSk = !bdGearSk;
  bdSkBtn();
  bdFillGear($('#bd-q').value.trim());
});

/* 무기 상세 필터 칩. 하나만 걸리고, 걸린 칩을 다시 누르면 풀립니다. */
$('#bd-wf').addEventListener('click', e => {
  const c = e.target.closest('[data-wf]');
  if (!c || !bdPick || bdPick.kind !== 'gear') return;
  const hit = (BD_WFILTER[bdState.builds[bdPick.bi].wt] || []).find(([n]) => n === c.dataset.wf);
  bdGearWf = bdGearWf === hit ? null : hit;
  bdWfChips();
  bdFillGear($('#bd-q').value.trim());
});

$('#bd-clear').addEventListener('click', () => {
  const b = bdState.builds[bdPick.bi];
  (b.ds[bdPick.part] = b.ds[bdPick.part] || [])[bdPick.slot] = null;
  bdSave(); bdRender(); bdDlg().close();
});
$('#bd-modal-close').addEventListener('click', () => bdDlg().close());

$('#bd-add').addEventListener('click', () => {
  if (bdState.builds.length >= BD_MAX) return toast(`빌드는 ${BD_MAX}개까지입니다`);
  /* 새 빌드는 맨 앞에 — 만들자마자 만지는 것이 새 빌드라, 스크롤 없이 바로 보이게. */
  bdState.builds.unshift(bdNewBuild());
  bdSave(); bdRender();
});
$('#bd-detail').addEventListener('click', () => {
  bdState.detail = !bdState.detail;
  bdSave(); bdRender();
});
$('#bd-list').addEventListener('click', bdOpenList);

/* ── 추천 빌드 ─────────────────────────────────────────────────── */
/* 등록은 recommend.js 가 아니라 여기 있습니다. 올릴 대상이 «지금 보고 있는 빌드»라
   빌드 상태를 아는 쪽에서 여는 편이 단순합니다. */
/* 어휘는 recommend.js 의 RC_TIER / RC_SCENE / RC_PARTY 하나만 씁니다. 여기 사본을
   두면 상황을 하나 추가할 때 한쪽만 고쳐, 등록은 되는데 카드에 영문 키가 찍히고
   필터 칩은 안 생기는 상태가 됩니다. 읽는 시점이 창을 여는 때라 로드 순서와 무관합니다. */
let bdRecBi = null;

function bdOpenRecommend(bi) {
  const b = bdState.builds[bi];
  if (!bdWeaponOf(b)) return toast('무기를 고른 뒤에 등록할 수 있습니다');
  bdRecBi = bi;
  const wt = BUILD.weaponTypes.find(t => t.k === b.wt);
  const worn = BD_PARTS().filter(p => bdSet(b[p.k]) && bdSet(b[p.k]).pieces[p.k]).length;
  $('#rc-add-what').innerHTML =
    `<b>${esc((b.n || '').trim() || (wt ? wt.n : '') + ' 빌드')}</b> · ${esc(bdWeaponOf(b).name)}`
    + ` · 방어구 ${worn}부위 · 점수 ${bdStats(b).score}`;
  const pick = (id, opts, multi) => {
    $(id).innerHTML = opts.map(([k, n]) =>
      `<button type="button" class="rc-p" data-pick-val="${k}">${esc(n)}</button>`).join('');
    $(id).dataset.multi = multi ? '1' : '';
  };
  pick('#rc-tier', Object.entries(RC_TIER), false);
  pick('#rc-scene', Object.entries(RC_SCENE), true);
  pick('#rc-party', Object.entries(RC_PARTY), true);
  $('#rc-tier').querySelector('.rc-p').classList.add('on');   // 초보자를 기본으로
  $('#rc-easy').checked = false;
  $('#rc-nick').value = lastNick();
  $('#rc-pw').value = '';
  $('#rc-add-err').hidden = true;
  $('#rc-add').showModal();
}

/* 고른 항목 모으기. 하나만 고르는 칸은 눌린 걸 하나만 남깁니다. */
for (const id of ['#rc-tier', '#rc-scene', '#rc-party']) {
  $(id).addEventListener('click', e => {
    const p = e.target.closest('.rc-p');
    if (!p) return;
    if ($(id).dataset.multi) p.classList.toggle('on');
    else { for (const x of $(id).children) x.classList.toggle('on', x === p); }
  });
}
const bdRecPicked = (id) => [...$(id).querySelectorAll('.rc-p.on')].map(x => x.dataset.pickVal);

/* 닉네임 자동완성. 리더보드 등록창과 같은 것을 씁니다 — app.js 의 nickAuto(). */
nickAuto('#rc-nick', '#rc-nick-list', '#rc-nick-hint');

$('#rc-add-cancel').addEventListener('click', () => $('#rc-add').close());
$('#rc-add-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#rc-add-err');
  err.hidden = true;
  const b = bdState.builds[bdRecBi];
  const tier = bdRecPicked('#rc-tier')[0];
  const scenes = bdRecPicked('#rc-scene');
  const party = bdRecPicked('#rc-party');
  /* 다른 등록 폼 셋과 같은 규칙으로 접습니다 — 한 사람이 탭마다 다른 이름으로
     보이지 않도록. */
  const nick = $('#rc-nick').value.trim().replace(/\s+/g, ' ');
  const pw = $('#rc-pw').value;
  const fail = !nick ? '닉네임을 입력해 주세요.'
    : !tier ? '초보자인지 숙련자인지 골라 주세요.'
    : !scenes.length ? '어디에서 쓰는 빌드인지 하나 이상 골라 주세요.'
    : !party.length ? '개인전인지 파티사냥인지 골라 주세요.'
    : pw.length < PW_MIN ? `비밀번호는 ${PW_MIN}자 이상이어야 합니다.` : null;
  if (fail) { err.textContent = fail; err.hidden = false; return; }

  const wt = BUILD.weaponTypes.find(t => t.k === b.wt);
  /* 나머지 등록·삭제 폼과 같이 잠급니다. 없으면 모바일에서 두 번 눌렸을 때
     똑같은 추천빌드가 두 개 생깁니다(서버에 unique 제약이 없습니다). */
  const submit = $('#rc-add-submit');
  submit.disabled = true;
  try {
    const r = await rest('rpc/add_recommended_build', {
      method: 'POST',
      body: JSON.stringify({
        p_nickname: nick, p_title: (b.n || '').trim() || null,
        p_build: bdShareParam(b), p_weapon: b.wt,
        p_tier: tier, p_scenes: scenes, p_party: party,
        p_easy_farm: $('#rc-easy').checked, p_password: pw,
      }),
    });
    /* 서버가 왜 거절했는지를 그대로 들고 옵니다. «잠시 뒤 다시» 로 뭉뚱그리면
       길이 제한처럼 다시 시도해도 소용없는 실패를 알아볼 길이 없습니다. */
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || `HTTP ${r.status}`);
    saveNick(nick);
    $('#rc-add').close();
    toast('추천 빌드로 등록했습니다');
    /* 다음에 추천빌드 탭을 열 때 새로 받도록 표시만 해 둡니다. */
    if (typeof rcLoaded !== 'undefined') rcLoaded = false;
  } catch (e2) {
    err.textContent = '등록하지 못했습니다 — ' + e2.message;
    err.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

/* 추천빌드 탭에서 «가져오기» 를 누르면 부릅니다. 남의 빌드가 내 것을 덮으면 안 되므로
   덮어쓰지 않고 새 카드로 얹습니다. */
/* 공유 문자열을 빌드 객체로 풉니다. 상태를 건드리지 않아 추천빌드 카드의
   미리보기처럼 «읽기만» 하는 곳에서도 쓸 수 있습니다. 못 읽으면 null. */
function bdParse(param, title) {
  const kv = {};
  /* 퍼센트 인코딩이 깨진 문자열이면 decodeURIComponent 가 던집니다. DB 는 길이만 보고
     받아 주므로 그런 행이 하나만 있어도 추천빌드 목록이 통째로 안 그려지고, 카드가
     없으니 삭제 버튼에도 닿지 못합니다. «못 읽으면 null» 이 이 함수의 계약입니다. */
  let raw;
  try { raw = decodeURIComponent(param || ''); } catch { return null; }
  for (const part of raw.split(',')) {
    const i = part.indexOf('=');
    if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1);
  }
  if (!kv.wt || !BUILD.weaponTypes.some(t => t.k === kv.wt)) return null;

  const b = bdNewBuild();
  b.n = String(title || '').slice(0, 24);
  b.wt = kv.wt;
  if (bdSet(kv.w)) b.w = kv.w;
  b.st = Math.max(0, Math.min(bdStylesOf(b.wt).length, parseInt(kv.st, 10) || 0));
  for (const { k } of BUILD.parts) if (bdSet(kv[k]) && bdSet(kv[k]).pieces[k]) b[k] = kv[k];
  /* 방어구를 먼저 채운 뒤에 표류석을 끼웁니다. 칸 수가 방어구에 달려 있습니다. */
  for (const e of String(kv.ds || '').split(';')) {
    const [part, i, color, skill] = e.split('|');
    if (!Array.isArray(b.ds[part]) || !(+i >= 0)) continue;
    const g = bdStones().find(x => x.group === color);
    if (g && g.skills.some(x => x.name === skill)) b.ds[part][+i] = { c: color, s: skill };
  }
  for (const nm of String(kv.c || '').split(';')) if (nm) b.cond[nm] = true;
  return b;
}

/* 추천빌드 탭에서 «가져오기» 를 누르면 부릅니다. 남의 빌드가 내 것을 덮으면 안 되므로
   덮어쓰지 않고 새 카드로 얹습니다. */
function bdAdopt(param, title) {
  /* 빌드 탭을 이번에 한 번도 안 열었으면 bdState 는 아직 저장값을 읽지 않은
     «빈 빌드 하나» 입니다. 그 위에 얹고 저장하면 저장해 둔 내 빌드가 전부 지워집니다.
     drawBuild() 가 첫 호출에서 저장값을 읽으므로 먼저 부릅니다(두 번째부터는 그리기만). */
  drawBuild();
  const b = bdParse(param, title);
  /* 실패 이유는 여기서 다 알립니다. 호출부가 false 하나만 보고 «읽지 못했습니다» 로
     뭉뚱그리면, 개수가 꽉 찬 것뿐인데 빌드가 깨진 줄로 읽습니다. */
  if (!b) return toast('빌드를 읽지 못했습니다'), false;
  if (bdState.builds.length >= BD_MAX) return toast(`빌드는 ${BD_MAX}개까지입니다`), false;
  bdState.builds.push(b);
  bdSave(); bdRender();
  return true;
}

/* ── 미리보기 ───────────────────────────────────────────────────── */
/* 추천빌드 카드에 얹는 «장비 여섯 칸». 무기 + 방어구 5부위를 아이콘으로만 보여 줍니다.
   빈 칸도 자리를 남겨야 몇 부위를 갖췄는지 한눈에 보입니다. */
function bdIconRow(b) {
  const cells = [];
  const ws = bdSet(b.w);
  cells.push(ws
    ? `<span class="bd-ic6" title="${esc(bdWeaponOf(b) ? bdWeaponOf(b).name : ws.name)}">${bdMon(ws.key)}</span>`
    : '<span class="bd-ic6 empty"></span>');
  for (const { k, n } of BD_PARTS()) {
    const s = bdSet(b[k]);
    const piece = s && s.pieces[k];
    cells.push(piece
      ? `<span class="bd-ic6" title="${esc(n + ' · ' + piece.name)}">${bdMon(s.key)}</span>`
      : `<span class="bd-ic6 empty" title="${esc(n)} 없음"></span>`);
  }
  return `<div class="bd-row6">${cells.join('')}</div>`;
}

/* 합산 스킬 칩. 카드에서는 몇 개만 보여 주고 나머지는 «+N» 으로 접습니다. */
function bdChipRow(b, max = 8) {
  const all = bdTotals(b);
  if (!all.length) return '';
  const head = all.slice(0, max);
  const rest = all.length - head.length;
  return `<div class="bd-chips6">`
    + head.map(([n, lv]) => `<span class="chip">${esc(n)}<b>${lv}</b></span>`).join('')
    + (rest > 0 ? `<span class="chip rest" title="스킬 ${rest}종 더">+${rest}</span>` : '')
    + '</div>';
}

/* 빌드에 낀 표류석을 부위 순서대로 모읍니다. part 를 주면 그 부위만 봅니다.
   여러 곳에서 같은 규칙으로 훑어야 해서(카톡 카드·카드 줄·뱃지·미리보기) 한 곳에
   둡니다. 슬롯 수를 넘겨 남아 있는 옛 값은 버립니다. */
function bdStoneList(b, part) {
  const out = [];
  for (const { k, n } of BD_PARTS()) {
    if (part && k !== part) continue;
    (b.ds[k] || []).slice(0, bdSlotCount(b, k)).forEach(d => { if (d && d.s) out.push({ ...d, part: n }); });
  }
  return out;
}

/* 표류석 알약 하나. 육각형은 카드의 슬롯(.bd-dot)과 같은 모양이라 스킬 칩과
   섞여 있어도 «이건 표류석» 이 바로 읽힙니다. 색은 표류연성 탭과 같은 색을 씁니다
   — 같은 돌이 두 탭에서 다른 색이면 안 됩니다. */
function bdStoneChip(d) {
  const g = bdStones().find(x => x.group === d.c);
  const t = esc(`${d.part ? d.part + ' · ' : ''}표류석【${d.c}】`);
  return `<span class="chip stone"${g ? ` style="--c:${g.color}"` : ''} title="${t}">${esc(d.s)}</span>`;
}

/* 빌드 하나의 표류석을 모아 한 줄로. 합산 스킬 칩만 보면 그 레벨이 방어구에서
   왔는지 표류석에서 왔는지 알 수 없습니다. */
function bdStoneChips(b) {
  const list = bdStoneList(b);
  return list.length ? `<div class="bd-chips6 bd-stones">${list.map(bdStoneChip).join('')}</div>` : '';
}

/* 미리보기 모달 본문. 편집할 수 없는 읽기 전용이라 카드 렌더러를 재사용하지 않고
   따로 그립니다 — 카드 쪽은 인덱스와 이벤트가 얽혀 있습니다. */
function bdPreviewHtml(b) {
  const w = bdWeaponOf(b);
  const wt = BUILD.weaponTypes.find(t => t.k === b.wt);
  const style = bdStylesOf(b.wt)[b.st - 1];
  const line = (icon, name, sub, skills, dots) => `<li class="bd-pv">
      ${icon}
      <span class="bd-lt">
        <b>${esc(name)}</b>
        <i>${esc(sub)}</i>
        <span class="bd-ls">${(skills || []).map(x => `<em>${esc(x.s)}<b>${x.lv}</b></em>`).join('')}</span>
      </span>
      ${dots || ''}
    </li>`;

  const ws = bdSet(b.w);
  const rows = [ws
    ? line(bdMon(ws.key), w ? w.name : ws.name,
        [wt && wt.n, style ? `스타일 ${style}` : ''].filter(Boolean).join(' · '), bdWSkills(ws, w))
    : `<li class="bd-pv empty">무기 없음</li>`];

  for (const { k, n } of BD_PARTS()) {
    const s = bdSet(b[k]);
    const piece = s && s.pieces[k];
    if (!piece) { rows.push(`<li class="bd-pv empty">${esc(n)} 없음</li>`); continue; }
    const stones = bdStoneList(b, k);
    rows.push(line(bdMon(s.key), s.name, `${n} · ${piece.name}`, piece.skills,
      stones.length ? `<span class="bd-pvs">${stones.map(bdStoneChip).join('')}</span>` : ''));
  }
  return `<ul class="bd-pvl">${rows.join('')}</ul>
    <div class="bd-sum bd-pvsum">
      ${bdTotals(b).map(([n, lv]) => bdTotalRow(n, lv)).join('')}
      ${bdStatBar(b)}
    </div>`;
}

/* ── 시작 ──────────────────────────────────────────────────────── */
let bdDrawn = false;
function drawBuild() {
  if (typeof BUILD === 'undefined') return;
  if (!bdDrawn) {
    bdDrawn = true;
    let hasSaved = false;
    try {
      const saved = JSON.parse(localStorage.getItem(BD_KEY) || 'null');
      if (saved && Array.isArray(saved.builds) && saved.builds.length) {
        bdState = { detail: !!saved.detail, builds: saved.builds.map(x => ({ ...bdNewBuild(), ...x, ds: { ...bdNewBuild().ds, ...(x.ds || {}) }, cond: { ...(x.cond || {}) } })) };
        hasSaved = true;
      }
    } catch (e) { /* 저장값이 깨졌으면 기본값으로 */ }

    /* 공유 링크는 저장해 둔 내 빌드 «맨 앞에» 새 카드로 얹습니다 — 링크를 연 목적이
       그 빌드를 보는 것이라, 저장 빌드가 많을 때 뒤에 얹으면 스크롤 밖이라 안 보입니다.
       예전에는 링크의 빌드 하나로 상태를 갈아끼웠는데, 그 뒤 아무 편집이든 저장되는
       순간 원래 빌드가 전부 지워졌습니다. 링크 카드는 여기서 저장하지 않습니다 — 리더보드의
       «빌드 보기» 처럼 구경만 하는 링크가 저장 목록에 쌓이면 안 되고, 편집을
       시작하면 그 편집의 bdSave 가 이 카드도 함께 저장합니다.
       링크 값은 한 번 쓰고 주소에서 지워, 그 자리에서 새로고침해도 같은 카드가
       거듭 늘지 않게 합니다.
       URLSearchParams 를 안 쓰는 이유: 그쪽 디코딩과 bdParse 의 디코딩이 겹치면
       두 번 풀립니다. 날 문자열을 그대로 넘겨 bdParse 한 곳에서만 풉니다.
       '+' 만 %20 으로 돌려놓습니다 — app.js 의 showTab() 이 searchParams 를 만지며
       쿼리를 폼 인코딩으로 다시 쓰기 때문에, 여기 도달한 '+' 는 언제나 공백입니다
       (진짜 '+' 는 bdEscape 가 %2B 로 내보내고 폼 인코딩도 그대로 둡니다). */
    const q = (/[?&]build=([^&]*)/.exec(location.search) || [])[1];
    if (q) {
      const b = bdParse(q.replace(/\+/g, '%20'));
      if (!b) toast('빌드를 읽지 못했습니다');
      else if (hasSaved && bdState.builds.length >= BD_MAX) toast(`빌드는 ${BD_MAX}개까지입니다`);
      else if (hasSaved) bdState.builds.unshift(b);
      /* 저장된 게 없으면 기본으로 깔린 빈 카드를 링크 카드로 갈음합니다. */
      else bdState = { builds: [b], detail: false };
      const url = new URL(location);
      url.searchParams.delete('build');
      history.replaceState(null, '', url);
    }
  }
  bdRender();
}

/* app.js 가 showTab() 을 이미 호출한 뒤에 이 파일이 로드되므로,
   첫 화면이 빌드 탭이면 여기서 한 번 그려줍니다. */
if (!$('#panel-build').hidden) drawBuild();
