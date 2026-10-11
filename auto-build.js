/* 전체 등록 무기를 지원. 무기별 운용 지침은 별도 구현 단계에서 적용한다.
   bounded beam search: 전역 최적 보장이 아닌 제한 탐색, 점수는 기존 bdStats를 공유. */
const AB_LIMIT = { beam: 160, armor: 24, evaluated: 6000, ms: 8000 };
const AB_SOURCES = [
  ['물속성 공격 강화', 'https://monsterhunternow.com/ko/skills/water_attack'],
  ['회심격【속성】', 'https://monsterhunternow.com/ko/skills/critical_element'],
  ['슈퍼회심', 'https://monsterhunternow.com/ko/skills/critical_boost'],
];
const abMax = s => BUILD.maxLv[s] || bdSkillLevels(s)?.at(-1)?.[0] || 1;
const abSP = s => /특수.*위력|위력.*특수|속성 공격 증강.*SP/.test(s);
const abStonePool = () => {
  const pool = new Map();
  for (const g of bdStones()) for (const s of g.skills) if (!pool.has(s.name)) pool.set(s.name, g.group);
  return pool;
};
const abSkills = () => [...new Set([...Object.keys(BUILD.maxLv), ...abStonePool().keys()])]
  .filter(s => !BD_STATUS_BOOST[s] || bdStatusBoostApplies(s, bdWeaponOf(abState.b)))
  .sort((a, b) => a.localeCompare(b, 'ko'));
const abTargets = names => names.map(s => ({ s, min: Math.max(1, abMax(s) - 2), max: abMax(s) }));
const abMelee = wt => !['light-gun', 'heavy-gun', 'bow'].includes(wt);
const abMonsters = wt => bdOrderedSets().filter(s => s.weapons.some(w => w.t === wt));
const abElementSkill = b => {
  const element = bdWeaponOf(b)?.e;
  return ['불', '물', '번개', '얼음', '용'].includes(element) ? `${element}속성 공격 강화` : null;
};
const abSearchTargets = config => config.lockon && abMelee(config.b.wt)
  ? [{ s: '록온', min: 1, max: 1 }, ...config.targets.filter(t => t.s !== '록온')] : config.targets;
let abState = { b: { ...bdNewBuild(), w: 'mizu', wt: 'long-sword' }, direction: '', edited: false,
  targets: abTargets(['물속성 공격 강화', '회심격【속성】', '슈퍼회심']), drift: true, lockon: true,
  order: 'priority', pool: [], stats: null, busy: false, run: 0, notice: '', scroll: 0, active: false };

function abDirections(b) {
  const skill = abElementSkill(b);
  if (!skill) return [];
  const base = bdWeaponBase(b), elemental = { id: 'water', name: `${bdWeaponOf(b).e}속성 중심`,
    desc: '해당 속성 강화와 회심격을 중심으로 구성합니다.',
    skills: [skill, '회심격【속성】', '슈퍼회심'] };
  const critical = { id: 'critical', name: '회심 활용',
    desc: `강화 적용 후 기본 회심 ${base.crit}%를 활용합니다.`,
    skills: ['회심격【속성】', '슈퍼회심', skill] };
  return base.crit >= 40 ? [critical, elemental] : [elemental, critical];
}

function abChangeWeapon(field, value) {
  const s = abState;
  if (field === 'wt') {
    s.b.wt = value; s.lockon = abMelee(value);
    if (!bdWeaponOf(s.b)) s.b.w = abMonsters(value)[0]?.key || null;
  } else s.b.w = value;
  s.b.st = 0; s.b.style20 = false; s.b.params = [null, null, null];
  if (!s.edited) abApplyDirection(abDirections(s.b)[0]?.id || 'manual');
}

function abApplyDirection(id) {
  abState.direction = id; abState.edited = false;
  abState.targets = id === 'manual' ? [{ s: '', min: 1, max: 1 }, { s: '', min: 1, max: 1 }, { s: '', min: 1, max: 1 }]
    : abTargets(abDirections(abState.b).find(d => d.id === id).skills);
}

function abScoreBuild(b) {
  const conds = bdStats(b).conds;
  b.cond = Object.fromEntries(conds.map(c => [c.sk, !abSP(c.sk)]));
  b.bowEfficiency = false; // 집중 주기 보정은 추천 시 사용자가 지정하지 않은 가정이다.
  return bdStats(b).score;
}

function abValidate(targets) {
  if (targets.some(t => !t.s)) return '핵심 스킬 3개를 선택해 주세요.';
  if (new Set(targets.map(t => t.s)).size !== targets.length) return '핵심 스킬은 중복 없이 선택해 주세요.';
  if (targets.some(t => !abSkills().includes(t.s) || t.min < 1 || t.max > abMax(t.s) || t.min > t.max)) return '허용 레벨 범위를 확인해 주세요.';
  return '';
}

const abSignature = b => BD_PARTS().map(p => b[p.k]).join('|');
function abCompare(a, b, order) {
  if (order === 'score' && a.score !== b.score) return b.score - a.score;
  for (let i = 0; i < a.levels.length; i++) if (a.levels[i] !== b.levels[i]) return b.levels[i] - a.levels[i];
  return b.score - a.score || a.drifts - b.drifts || abSignature(a.b).localeCompare(abSignature(b.b));
}

function abBest(pool, order, count = 5) {
  const chosen = [], signatures = new Set();
  for (const r of [...pool].sort((a, b) => abCompare(a, b, order))) {
    const signature = abSignature(r.b);
    if (signatures.has(signature)) continue;
    signatures.add(signature); chosen.push(r);
    if (chosen.length === count) break;
  }
  return chosen;
}

/* 부족한 핵심 레벨은 연성으로 먼저 확보. 이후 핵심 레벨 또는 실제 점수 증가를 비교한다.
   전용 스킬도 SMELT에 있는 것만 슬롯당 Lv1로 넣는다. */
function abFillDrift(original, targets, fillers, use, preferPriority) {
  const b = structuredClone(original), stonePool = abStonePool();
  if (!use) return b;
  const slots = BD_PARTS().flatMap(({ k }) => Array.from({ length: bdSlotCount(b, k) }, (_, i) => ({ k, i })))
    .filter(({ k, i }) => !b.ds[k][i]);
  // 동일 스킬이 기본으로 붙은 부위부터 배치. 없거나 가득 찼으면 다른 빈 슬롯을 사용한다.
  const take = s => slots.splice(Math.max(0, slots.findIndex(({ k }) =>
    bdSet(b[k]).pieces[k].skills.some(x => x.s === s))), 1)[0];
  const put = (slot, s) => { b.ds[slot.k][slot.i] = { s, c: stonePool.get(s) }; };
  const total = () => new Map(bdTotals(b));
  for (const t of targets) {
    const need = Math.max(0, t.min - (total().get(t.s) || 0));
    if (need && (!stonePool.has(t.s) || slots.length < need)) return null;
    for (let i = 0; i < need; i++) put(take(t.s), t.s);
  }
  while (slots.length) {
    const slot = slots[0];
    const levels = total();
    const priority = preferPriority && targets.find(t => stonePool.has(t.s) && (levels.get(t.s) || 0) < t.max);
    if (priority) { put(take(priority.s), priority.s); continue; }
    let best = abScoreBuild(b), skill = null;
    for (const s of fillers) {
      const cap = targets.find(t => t.s === s)?.max ?? abMax(s);
      if (!stonePool.has(s) || (levels.get(s) || 0) >= cap || abSP(s)) continue;
      put(slot, s); const score = abScoreBuild(b);
      if (score > best) { best = score; skill = s; }
    }
    b.ds[slot.k][slot.i] = null;
    if (skill) put(take(skill), skill); else slots.shift();
  }
  abScoreBuild(b);
  return b;
}

async function abSearch(config, progress = () => {}, cancelled = () => false) {
  const started = performance.now(), parts = BD_PARTS(), { b: seed, targets: userTargets, drift } = config;
  const targets = abSearchTargets(config), requireLock = !!config.lockon && abMelee(seed.wt);
  const stones = abStonePool(), fillers = [...new Set([...targets.map(t => t.s),
    ...[abElementSkill(seed)].filter(Boolean), '회심격【속성】', '슈퍼회심', '간파', '약점 특효', '연격'])];
  let all = parts.map(({ k }) => bdOrderedSets().filter(s => s.pieces[k]).map(s => ({ key: s.key, piece: s.pieces[k] })));
  const totalsFor = b => new Map(bdTotals(b));
  const optimistic = (b, stage) => {
    const levels = totalsFor(b);
    const slots = drift ? parts.slice(0, stage).reduce((n, p) => n + bdSlotCount(b, p.k), 0)
      + all.slice(stage).reduce((n, rows) => n + Math.max(0, ...rows.map(r => r.piece.slot)), 0) : 0;
    return targets.every(t => (levels.get(t.s) || 0) + all.slice(stage).reduce((n, rows) =>
      n + Math.max(0, ...rows.map(r => r.piece.skills.find(x => x.s === t.s)?.lv || 0)), 0)
      + (stones.has(t.s) ? slots : 0) >= t.min);
  };
  const rank = b => {
    const lv = totalsFor(b), priority = targets.reduce((n, t) => n + Math.min(t.max, lv.get(t.s) || 0)
      * (requireLock && t.s === '록온' ? 500 : [100, 20, 4][userTargets.findIndex(x => x.s === t.s)]), 0);
    const slots = drift ? parts.reduce((n, p) => n + bdSlotCount(b, p.k), 0) * 35 : 0;
    return { priority: priority + slots, score: abScoreBuild(b) + slots };
  };
  // 모든 방어구를 단품 평가한 뒤 핵심 스킬 / 점수 / 슬롯 경로를 묶어 부위 후보를 제한한다.
  all = all.map((rows, i) => {
    const rated = rows.map(r => ({ ...r, ...rank({ ...seed, [parts[i].k]: r.key }) })), keep = new Map();
    for (const t of targets) for (const r of [...rated].sort((a, b) =>
      (b.piece.skills.find(x => x.s === t.s)?.lv || 0) - (a.piece.skills.find(x => x.s === t.s)?.lv || 0)).slice(0, 3)) keep.set(r.key, r);
    for (const key of ['priority', 'score']) for (const r of [...rated].sort((a, b) => b[key] - a[key]).slice(0, 8)) keep.set(r.key, r);
    return [...keep.values()].slice(0, AB_LIMIT.armor);
  });
  let beam = [{ b: structuredClone(seed), ...rank(seed) }], expanded = 0, evaluated = 0;
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));
  for (let pi = 0; pi < parts.length; pi++) {
    const next = [], k = parts[pi].k;
    for (const node of beam) for (const row of all[pi]) {
      const b = { ...node.b, [k]: row.key };
      expanded++;
      if (optimistic(b, pi + 1)) next.push({ b, ...rank(b) });
      if (expanded % 180 === 0) {
        progress({ stage: pi + 1, expanded, evaluated }); await pause();
        if (cancelled()) return null;
        if (performance.now() - started > AB_LIMIT.ms) return { pool: [], expanded, evaluated, limited: true, ms: performance.now() - started };
      }
    }
    // 두 평가 경로를 함께 보존해 우선순위와 점수 정렬 모두 후보를 갖게 한다.
    const keep = new Map();
    for (const key of ['priority', 'score']) for (const n of [...next].sort((a, b) => b[key] - a[key]).slice(0, AB_LIMIT.beam / 2)) keep.set(abSignature(n.b), n);
    beam = [...keep.values()];
    if (!beam.length) break;
  }
  const pool = [];
  finish: for (const node of beam) for (const preferPriority of [true, false]) {
    const b = abFillDrift(node.b, targets, fillers, drift, preferPriority);
    evaluated++;
    if (b) {
      const lv = totalsFor(b), levels = userTargets.map(t => Math.min(t.max, lv.get(t.s) || 0));
      if (targets.every(t => (lv.get(t.s) || 0) >= t.min)) pool.push({ b, levels, score: abScoreBuild(b), drifts: bdStoneList(b).length });
    }
    if (evaluated % 8 === 0) {
      progress({ stage: 5, expanded, evaluated }); await pause();
      if (cancelled()) return null;
      if (evaluated >= AB_LIMIT.evaluated || performance.now() - started > AB_LIMIT.ms) break finish;
    }
    if (evaluated >= AB_LIMIT.evaluated || performance.now() - started > AB_LIMIT.ms) break finish;
  }
  return { pool, expanded, evaluated, limited: performance.now() - started > AB_LIMIT.ms || evaluated >= AB_LIMIT.evaluated,
    ms: Math.round(performance.now() - started) };
}

function abOptions(rows, selected) {
  return rows.map(([value, label]) => `<option value="${esc(String(value))}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`).join('');
}

function abRender() {
  const s = abState, b = s.b, base = bdWeaponBase(b), info = bdStyleInfo(b), dirs = abDirections(b);
  const skills = abSkills(), w = bdWeaponOf(b);
  $('#ab-screen').innerHTML = `<div class="ab-heading"><button class="btn ghost" data-ab-back>← 내 빌드</button><h2>자동빌드 (테스트중)</h2></div>
    <div class="ab-box ab-form-settings ab-weapon-settings"><h3>무기 설정</h3><div class="ab-config">
      <label>무기군<select data-ab="wt">${abOptions(BUILD.weaponTypes.filter(t => abMonsters(t.k).length).map(t => [t.k, t.n]), b.wt)}</select></label>
      <label>몬스터·소재<select data-ab="monster">${abOptions(abMonsters(b.wt).map(s => [s.key, s.name]), b.w)}</select></label>
      <label>스타일<select data-ab="st"${info.selectable ? '' : ' disabled'}>${abOptions([[0, '스타일 없음'], ...bdStylesOf(b.wt).map((n, i) => [i + 1, n])], b.st)}</select></label>
      <label class="ab-check"><input type="checkbox" data-ab="style20"${info.active ? ' checked' : ''}${info.available ? '' : ' disabled'}>스타일강화 Lv20 적용</label>
    </div><div class="ab-parameter">${BD_PARAM_LEVELS.map((lv, i) => `<label>Lv${lv} 파라미터<select data-ab-param="${i}"${info.active ? '' : ' disabled'}>${abOptions([['', '미선택'], ...(info.profile?.parameters[lv] || []).map(p => [p.stat, `${{ atk: '공', crit: '회', ele: '속' }[p.stat]} +${p.value}${p.stat === 'crit' ? '%' : ''}`])], b.params[i] || '')}</select></label>`).join('')}</div>
    <p class="ab-base">${esc(w.name)} · 공격력 <b>${base.atk}</b>${w.e ? ` · ${esc(w.e)} <b>${base.ele}</b>` : ''} · 회심 <b>${base.crit}%</b></p></div>
    <div class="ab-box"><h3>세팅 방향 <small>공식 효과 기반 샘플 프리셋</small></h3><div class="ab-directions" role="group" aria-label="세팅 방향">
      ${[...dirs, { id: 'manual', name: '직접 설정', desc: '핵심 스킬과 순위를 직접 정합니다.' }].map((d, i) => `<button data-ab-dir="${d.id}" aria-pressed="${s.direction === d.id}"><b>${esc(d.name)}${i === 0 && dirs.length ? ' · 추천' : ''}</b><span>${esc(d.desc)}</span></button>`).join('')}</div>
      <p class="ab-muted">${s.edited ? '선택한 방향 · 사용자 수정. 새 방향을 선택하면 핵심 스킬이 교체됩니다.' : '방향을 선택하면 핵심 스킬을 채워줍니다. 무기별 운용 가이드는 아직 적용하지 않았습니다.'}</p></div>
    <div class="ab-box ab-form-settings ab-core-settings"><h3>핵심 스킬</h3><div class="ab-targets">${s.targets.map((t, i) => `<div><label>${i + 1}순위<select data-ab-skill="${i}">${abOptions([['', '스킬 선택'], ...skills.map(n => [n, n])], t.s)}</select></label>
      <label>최소 Lv<select data-ab-min="${i}">${abOptions(Array.from({ length: abMax(t.s) }, (_, n) => [n + 1, String(n + 1)]), t.min)}</select></label>
      <label>목표 Lv<select data-ab-max="${i}">${abOptions(Array.from({ length: abMax(t.s) }, (_, n) => [n + 1, String(n + 1)]), t.max)}</select></label></div>`).join('')}</div>
      <p class="ab-muted">기본 범위는 최대 레벨 −2 ~ 최대 레벨입니다. 최소 레벨은 반드시 충족하고, 우선순위순은 1 → 2 → 3순위 목표 충족도를 먼저 비교합니다.</p>
      <div class="ab-actions"><label class="ab-check"><input type="checkbox" data-ab="drift"${s.drift ? ' checked' : ''}>표류연성 사용</label>
      <label class="ab-check" title="체크하면 핵심 스킬과 별도로 록온 Lv1을 반드시 확보합니다"><input type="checkbox" data-ab="lockon"${s.lockon && abMelee(b.wt) ? ' checked' : ''}${abMelee(b.wt) ? '' : ' disabled'}>록온 필수</label>
      <button class="btn primary" data-ab-search${s.busy ? ' disabled' : ''}>${s.busy ? '후보 탐색 중…' : '추천 빌드 찾기'}</button>${s.busy ? '<button class="btn ghost" data-ab-cancel>중지</button>' : ''}</div>
      <p id="ab-status" role="status" aria-live="polite">${esc(s.notice)}</p>
      <details class="ab-basis"><summary>추천 기준과 출처</summary><p>기존 빌드 점수로 평가합니다. 조건부 효과는 발동한 상태로 가정하며 특수 위력·SP 전용 효과는 제외합니다. 동시 발동 가능성·유지율은 보정하지 않아 실제 DPS가 아닙니다. 특수 게이지 가속은 선택 가능한 핵심 스킬로 유지하며 임의 대미지 점수는 부여하지 않습니다.</p>
      <p>방향은 무기 종류·스타일을 유지한 최종 스펙 기준의 임시 프리셋입니다. 회심 40% 이상이면 회심 활용을 먼저 권합니다. 사용자 스킬은 무기 설정 변경으로 덮어쓰지 않습니다.</p>
      <p>록온 필수는 근접무기에서 기본 적용하며 Lv1을 내부 0순위로 확보합니다. 핵심 스킬 3개는 그대로 유지하며 록온이 없는 후보는 점수와 관계없이 제외합니다. 원거리 3종은 이 옵션을 사용하지 않습니다.</p>
      <p>방어구 전 부위를 제한 폭으로 탐색하고 연성은 핵심 스킬 보충 후 소수의 공격 관련 후보로 채웁니다. 최대 ${AB_LIMIT.ms / 1000}초, 탐색 폭 ${AB_LIMIT.beam}. 최적해 보장은 아니며 같은 방어구 조합의 중복 추천은 제외합니다. 장비·연성의 보유 여부와 획득 난도는 고려하지 않습니다.</p>
      ${AB_SOURCES.map(([n, url]) => `<a href="${url}" target="_blank" rel="noopener noreferrer">공식 ${esc(n)}</a>`).join(' · ')}</details></div>
    <div id="ab-results"></div>`;
  abRenderResults();
}

/* 빌드의 장비 행/스킬 칩을 공유하되 편집용 인덱스와 버튼은 생성하지 않는다. */
function abEquipmentUI(b) {
  const core = new Set(abState.targets.map(t => t.s));
  if (abState.lockon && abMelee(b.wt)) core.add('록온');
  const chips = (skills, drift = false) => skills.map(x => `<span class="chip${core.has(x.s) ? ' ab-core' : ''}${drift ? ' ab-drift-skill' : ''}"${drift ? ' title="표류연성 스킬"' : ''}>${esc(x.s)}<b>${x.lv}</b></span>`).join('');
  const dots = part => `<span class="bd-ds">${Array.from({ length: bdSlotCount(b, part) }, (_, i) => {
    const d = b.ds[part]?.[i], g = d && bdStones().find(x => x.group === d.c);
    return `<span class="bd-dot${d ? ' on' : ''}"${g ? ` style="--c:${g.color}"` : ''} role="img" aria-label="${d ? esc(d.s + ' Lv1 · 표류석【' + d.c + '】') : '빈 연성 슬롯'}" title="${d ? esc(d.s + ' Lv1') : '빈 연성 슬롯'}"></span>`;
  }).join('')}</span>`;
  const row = (part, name, set, skills, stones = []) => `<div class="bd-row" data-ab-part="${part}">
    <span class="bd-ti static"><img src="assets/part/${esc(part)}.png" width="24" height="24" alt="${esc(BD_PARTS().find(p => p.k === part)?.n || '무기')}"></span>
    <div class="bd-body"><div class="bd-line">${bdMon(set.key)}<span class="ab-name"><span class="bd-nm">${esc(name)}</span> <small>${esc(set.name)}</small></span>${dots(part)}</div>
    <div class="bd-inline">${chips(skills)}${chips(stones.map(d => ({ s: d.s, lv: 1 })), true)}</div></div></div>`;
  const w = bdWeaponOf(b), ws = bdSet(b.w), base = bdWeaponBase(b), stats = bdStats(b);
  const style = bdStylesOf(b.wt)[b.st - 1] || '스타일 없음';
  return `<div class="bd-rows ab-equipment">${row(b.wt, w.name, ws, bdBuildWSkills(b))}
    <p class="ab-weapon-info">${esc(style)}${bdStyleInfo(b).active ? ' · 스타일강화 Lv20' : ''} · ${b.params.map(p => p ? BD_PARAM_NAMES[p] : '미선택').join(' / ')}</p>
    ${BD_PARTS().map(({ k }) => { const s = bdSet(b[k]); return row(k, s.pieces[k].name, s, s.pieces[k].skills, bdStoneList(b, k)); }).join('')}</div>
    <div class="ab-totals"><h4>스킬 합계 <small>강조: 핵심 스킬 · 필수 록온</small></h4><div class="bd-inline">${chips(bdTotals(b).map(([s, lv]) => ({ s, lv })))}</div>
    <div class="bd-stats"><span>${BD_SI.atk}${base.atk} ▸ <b>${stats.now.atk}</b></span>${w.e && BD_EI[w.e] ? `<span>${bdIco(`assets/element/${BD_EI[w.e]}.png`)}${base.ele} ▸ <b>${stats.now.ele}</b></span>` : ''}<span>${BD_SI.crit}${base.crit}% ▸ <b>${stats.now.crit}%</b></span></div></div>`;
}

function abCalculationUI(b) {
  const stats = bdStats(b), x = stats.branches, f = bdCalcNumber;
  return `${stats.co.R && x.p > 0 ? `<p>일반 공격 ${f(x.normal)}점 · 회심 공격 ${f(x.critical)}점<br>회심 확률 ${f(x.p * 100)}%</p>`
    : `<p>공격력 + 속성 평균에 대미지·회심 배율을 적용합니다.</p>`}<p class="ab-formula">${bdScoreFormula(stats)}점</p>`;
}

function abRenderResults() {
  const s = abState, results = abBest(s.pool, s.order);
  s.results = results;
  $('#ab-results').innerHTML = !s.stats ? '' : `<div class="ab-heading"><h3>추천 결과 ${results.length}개</h3><label>정렬 <select data-ab="order">${abOptions([['priority', '스킬 우선순위순'], ['score', '빌드 점수순']], s.order)}</select></label></div>
    <p class="ab-muted">${s.stats.expanded.toLocaleString()}개 조합 탐색 · ${s.stats.evaluated}개 연성 구성 검토 · ${s.pool.length}개 유효 후보 · ${(s.stats.ms / 1000).toFixed(1)}초${s.stats.limited ? ' · 탐색 제한 도달' : ''}</p>
    ${results.length ? `<div class="bd-cards ab-result-grid">` + results.map((r, i) => `<article class="bd-card ab-result"><div class="ab-heading"><h3>추천 ${i + 1}</h3><b class="ab-score">${r.score.toLocaleString()}점</b></div>
      <div class="ab-levels">${s.targets.map((t, j) => `<span>${j + 1}순위 ${esc(t.s)} <b>Lv${r.levels[j]}</b> / 목표 ${t.max}</span>`).join('')}</div>
      ${abEquipmentUI(r.b)}
      <details><summary>추천 · 계산 근거</summary>
      <div class="ab-reason"><h4>요구 스킬 충족</h4><ul>
      ${s.lockon && abMelee(s.b.wt) ? '<li>필수 록온: Lv1 확보</li>' : ''}
      ${s.targets.map((t, j) => `<li>${j + 1}순위 ${esc(t.s)}: <b>Lv${r.levels[j]}</b> 확보 <small>(최소 ${t.min} · 목표 ${t.max})</small></li>`).join('')}</ul>
      <h4>연성 배치</h4><p>${r.drifts}개 사용 · 같은 스킬이 기본으로 붙은 부위의 빈 슬롯부터 배치합니다.</p>
      <h4>점수 계산 가정</h4><p>발동 가정: ${Object.entries(r.b.cond).filter(([, on]) => on).map(([n]) => esc(n)).join(' · ') || '없음'}</p>
      <p>특수 위력·SP 전용 효과와 집중 보정은 제외합니다. 실제 전투 DPS가 아닌 비교 점수입니다.</p>
      <h4>기대 점수</h4>${abCalculationUI(r.b)}<p class="ab-muted">일반·회심 공격을 회심률로 평균합니다. 표시와 최종 점수만 반올림합니다.</p></div></details>
      <footer><button class="btn primary" data-ab-import="${i}">내 빌드로 가져오기</button></footer></article>`).join('') + '</div>' : '<p class="ab-box">설정한 최소 레벨을 만족하는 후보를 찾지 못했습니다. 연성을 켜거나 최소 레벨을 낮춰 보세요. 제한 탐색이므로 불가능한 조합이라는 뜻은 아닙니다.</p>'}`;
}

function abInvalidate() {
  abState.run++; abState.busy = false; abState.pool = []; abState.stats = null; abState.notice = '';
}

function abRoute() {
  const active = location.hash === '#auto-build';
  if (active && !abState.active) abRender();
  for (const selector of ['#panel-build .hero', '#panel-build .bd-tools', '#bd-weapon-filter', '#bd-cards']) $(selector).hidden = active;
  $('#ab-screen').hidden = !active;
  if (!active && abState.active) {
    abState.run++; abState.busy = false;
    if (location.hash === '#build') requestAnimationFrame(() => window.scrollTo(0, abState.scroll));
  }
  abState.active = active;
}

$('#bd-auto').addEventListener('click', () => { abState.scroll = window.scrollY; location.hash = 'auto-build'; });
$('#ab-screen').addEventListener('change', e => {
  const el = e.target, s = abState;
  if (el.dataset.ab === 'order') { s.order = el.value; return abRenderResults(); }
  abInvalidate();
  if (['wt', 'monster'].includes(el.dataset.ab)) abChangeWeapon(el.dataset.ab, el.value);
  if (el.dataset.ab === 'st') { s.b.st = +el.value; if (!s.b.st) s.b.style20 = false; }
  if (el.dataset.ab === 'style20') s.b.style20 = el.checked;
  if (el.dataset.ab === 'drift') s.drift = el.checked;
  if (el.dataset.ab === 'lockon') s.lockon = abMelee(s.b.wt) && el.checked;
  if (el.hasAttribute('data-ab-param')) s.b.params[+el.dataset.abParam] = el.value || null;
  for (const field of ['skill', 'min', 'max']) if (el.hasAttribute('data-ab-' + field)) {
    const i = +el.dataset['ab' + field[0].toUpperCase() + field.slice(1)], t = s.targets[i];
    if (field === 'skill') s.targets[i] = abTargets([el.value])[0]; else t[field] = +el.value;
    s.edited = true;
  }
  bdNormalizeParams(s.b); abRender();
});
$('#ab-screen').addEventListener('click', async e => {
  const el = e.target.closest('button');
  if (!el) return;
  if (el.hasAttribute('data-ab-back')) { location.hash = 'build'; return; }
  if (el.hasAttribute('data-ab-dir')) { abInvalidate(); abApplyDirection(el.dataset.abDir); abRender(); return; }
  if (el.hasAttribute('data-ab-cancel')) { abInvalidate(); abState.notice = '탐색을 중지했습니다.'; abRender(); return; }
  if (el.hasAttribute('data-ab-import')) {
    const r = abState.results[+el.dataset.abImport];
    if (!r) return;
    const b = structuredClone(r.b), direction = abDirections(b).find(d => d.id === abState.direction)?.name || '직접 설정';
    b.n = `${bdSet(b.w).name} · ${direction}`;
    if (bdAdopt(bdShareParam(b), b.n)) {
      abState.scroll = 0; location.hash = 'build';
      requestAnimationFrame(() => bdFocusBuild(0)); toast('최신 내 빌드로 가져왔습니다');
    }
    return;
  }
  if (!el.hasAttribute('data-ab-search') || abState.busy) return;
  const error = abValidate(abState.targets);
  if (error) { abState.notice = error; abRender(); return; }
  abInvalidate(); const run = abState.run;
  abState.busy = true; abState.notice = '후보를 탐색하고 있습니다…'; abRender();
  try {
    const result = await abSearch(structuredClone({ b: abState.b, targets: abState.targets, drift: abState.drift, lockon: abState.lockon }),
      p => { $('#ab-status').textContent = `${p.stage}/5부위 · ${p.expanded.toLocaleString()}개 조합 탐색 · ${p.evaluated}개 연성 구성 검토`; },
      () => run !== abState.run);
    if (!result || run !== abState.run) return;
    abState.pool = result.pool; abState.stats = result; abState.notice = '후보 탐색이 완료되었습니다.';
  } catch (err) { if (run === abState.run) abState.notice = '추천 중 오류가 발생했습니다. 다시 시도해 주세요.'; console.error(err); }
  if (run === abState.run) { abState.busy = false; abRender(); }
});
abApplyDirection('water');
abRoute();
