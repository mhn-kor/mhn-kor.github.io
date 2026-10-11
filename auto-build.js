/* docs/WEAPON_SETTING_GUIDE.md의 사용자 규칙을 조건별 추천과 탐색에 적용한다.
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
  .filter(s => s !== '상태 이상 축적 시 위력 UP' || bdBuildupApplies(bdWeaponOf(abState.b)))
  .sort((a, b) => a.localeCompare(b, 'ko'));
/* 같은 단위의 단일 효과만 증가 곡선으로 비교한다. 복합/확률 효과는 임의 환산하지 않는다. */
function abCurve(s, b) {
  const rows = Array.from({ length: abMax(s) }, (_, i) => bdEffects(bdSkillDesc(s, i + 1) || '', s, bdWeaponOf(b)));
  if (rows.some(r => r.length !== 1 || r[0].need || r[0].perBaseCrit || !(r[0].v > 0))) return null;
  const key = e => [e.k, e.pct, e.el, e.onCrit].join(':');
  if (rows.some(r => key(r[0]) !== key(rows[0][0]))) return null;
  const initial = rows[0][0].k === 'critx' ? 125 : 0;
  const values = rows.map(r => r[0].v - initial);
  return { values, increments: values.map((v, i) => v - (values[i - 1] || 0)) };
}
const abTargets = names => names.map(s => ({ s, min: 1, max: abMax(s) }));
const abMelee = wt => !['light-gun', 'heavy-gun', 'bow'].includes(wt);
const abMonsters = wt => bdOrderedSets().filter(s => s.weapons.some(w => w.t === wt));
const abElementSkill = b => {
  const element = bdWeaponOf(b)?.e;
  return ['불', '물', '번개', '얼음', '용'].includes(element) ? `${element}속성 공격 강화` : null;
};
const abGun = b => ['light-gun', 'heavy-gun'].includes(b.wt);
const AB_RECOIL = ['소', '중', '대', '특대', '용격 전용'];
const AB_RELOAD = ['빠름', '보통', '조금 느림', '느림'];
function abGunInfo(b, setting = b._abGun || {}) {
  if (!abGun(b)) return null;
  const w = bdWeaponOf(b), saved = BD_BOWGUN_DATA.weapons[b.w + '/' + b.wt];
  const data = saved && JSON.stringify(saved.x) === JSON.stringify(w?.x) ? saved : null;
  const style = bdStylesOf(b.wt)[b.st - 1];
  const repeatable = (b.wt === 'light-gun' && style === '스텝 샷') || (b.wt === 'heavy-gun' && style === '앉아쏘기');
  const slots = (w?.x || []).map((x, i) => ({ i, name:x, ...(data?.ammo[i] || {}) }));
  const wyvern = slots.filter(a => /용격탄/.test(a.name));
  const modes = [['cycle','전체 탄 순환'], ...(repeatable && slots.length ? [['repeat','특정 탄 · 회피 장전']] : []),
    ...(repeatable && b.wt === 'heavy-gun' && wyvern.length ? [['sp','용격탄 · 회피/SP 연계']] : [])];
  const mode = modes.some(([id]) => id === setting.mode) ? setting.mode : 'cycle';
  const choices = mode === 'sp' ? wyvern : slots;
  const slot = choices.find(a => a.i === +setting.slot) || choices[0];
  const ammo = mode === 'cycle' ? slots : slot ? [slot] : [];
  const best = field => Math.max(0, ...ammo.map(a => a[field].indexOf(Math.min(...a[field]))));
  const required = [], recommended = [], avoid = [];
  const add = (s, min, max = min) => { if (min) required.push({s,min,max}); };
  if (repeatable) avoid.push('반동 경감');
  if (['슬라이딩 리로드','가드리로드'].includes(style) || mode !== 'cycle') avoid.push('장전 속도');
  if (data) {
    if (!avoid.includes('반동 경감')) add('반동 경감', best('recoil'));
    if (!avoid.includes('장전 속도')) add('장전 속도', best('reload'));
  }
  if (mode !== 'cycle') add('회피 장전', 4, setting.reload5 ? 5 : 4);
  if (mode === 'sp') {
    add('특수 게이지 가속',3); add('특수 게이지 가속【저스트 회피】',3);
    add('절대 회피【SP】',1,3); // 연계를 성립시키는 최소1, 사용자 권장 목표3.
  }
  if (style === '가드리로드') recommended.push({s:'가드 성능',min:0,max:3});
  const name = modes.find(([id]) => id === mode)[1];
  return { data, style, mode, slot:slot?.i || 0, slots, choices, ammo, modes, name, required, recommended, avoid,
    settings:{mode,slot:slot?.i || 0,reload5:!!setting.reload5}, unknown:!data };
}
function abOperationRule(b, setting) {
  const gun = abGunInfo(b, setting);
  return gun ? { name:gun.name, required:gun.required, recommended:gun.recommended, avoid:gun.avoid,
    desc:'선택한 탄 운용의 필수 조건을 확보하고 몬스터·파라미터별 투자 방향을 결합합니다.' } : abStyleRule(b);
}
function abGunWeapon(b, setting) {
  const w = bdWeaponOf(b), g = abGunInfo(b, setting);
  return g && g.mode !== 'cycle' ? { ...w, x:g.ammo.map(a => a.name) } : w;
}
function abSearchTargets(config) {
  const rows = [...config.targets, ...(config.styleGuide !== false ? abOperationRule(config.b,config.gun)?.required || [] : [])];
  if (config.lockon && abMelee(config.b.wt)) rows.unshift({ s: '록온', min: 1, max: 1 });
  // 경지 등 선택한 핵심 효과의 발동 선행 레벨도 확보한다.
  for (const t of config.targets) for (const e of bdEffects(bdSkillDesc(t.s, t.min) || '', t.s, bdWeaponOf(config.b)))
    if (t.min > 0 && e.need) rows.push({ s: e.need.s, min: e.need.lv, max: abMax(e.need.s) });
  const merged = new Map();
  for (const t of rows) {
    const old = merged.get(t.s);
    merged.set(t.s, { ...t, min: Math.max(t.min, old?.min || 0), max: Math.max(t.max, old?.max || 0) });
  }
  return [...merged.values()];
}
let abState = { b: { ...bdNewBuild(), w: 'mizu', wt: 'long-sword' }, direction: '', edited: false,
  targets: abTargets(['물속성 공격 강화', '회심격【속성】', '슈퍼회심']), drift: true, lockon: true,
  gun:{mode:'cycle',slot:0}, styleGuide: true, order: 'priority', pool: [], stats: null, busy: false, run: 0, notice: '', scroll: 0, active: false };

const AB_STYLE_RULES = {
  '저스트 가드': { id: 'lance-just', name: '저스트가드 · 공격 특화',
    required: [{ s: '불퇴전', min: 4, max: 5 }, { s: '반사', min: 1, max: 5 }],
    recommended: [{ s: '매진', min: 0, max: 3 }],
    avoid: ['가드 성능'], desc: '불퇴전 4~5 · 반사 1 이상 · 매진 2~3. 가드 성능은 우대하지 않습니다.' },
  '실드 태클': { id: 'lance-shield', name: '실드태클 · 돌진 유지',
    required: [{ s: '가드 성능', min: 5, max: 5 }, { s: '반사', min: 1, max: 5 }, { s: '불퇴전', min: 4, max: 5 }],
    recommended: [],
    avoid: [], desc: '가드 성능 5 · 반사 1 이상 · 불퇴전 4~5. 돌진 중 가드를 활용합니다.' },
  '스텝 샷': { id: 'light-step', name: '스텝샷 · 반동 대체', required: [], recommended: [],
    avoid: ['반동 경감'], desc: '스텝샷 중심 사격은 반동 경감을 자동 보충하지 않습니다. 탄 순환 시 장전 속도는 별도로 필요합니다. 일반 탭 사격의 반동까지 대체하지 않습니다.' },
  '슬라이딩 리로드': { id: 'light-slide', name: '슬라이딩 리로드 · 장전 대체', required: [], recommended: [],
    avoid: ['장전 속도'], desc: '한 발 이상 사용 후 슬라이딩 리로드로 장전을 대체합니다. 반동 경감은 사용하는 탄에 맞춰 별도로 확보해야 합니다.' },
  '가드리로드': { id: 'heavy-guard', name: '가드리로드 · 장전 대체', required: [],
    recommended: [{ s: '가드 성능', min: 0, max: 3 }], avoid: ['장전 속도'],
    desc: '가드리로드로 장전을 대체하고 가드 성능 2~3을 권장 후보로 검토합니다. 필수 최소로 강제하지 않으며, 반동 경감은 사용하는 탄에 맞춰 별도로 필요합니다.' },
  '앉아쏘기': { id: 'heavy-crouch', name: '앉아쏘기 · 반동 대체', required: [], recommended: [],
    avoid: ['반동 경감'], desc: '앉아쏘기 중심 사격은 반동 경감을 자동 보충하지 않습니다. 탄 순환 시 장전 속도는 별도로 필요합니다. 일반 사격까지 같은 조건으로 취급하지 않습니다.' },
};
const abStyleRule = b => ['lance', 'light-gun', 'heavy-gun'].includes(b.wt) ? AB_STYLE_RULES[bdStylesOf(b.wt)[b.st - 1]] : null;
const abEquipmentSkills = () => [...new Set(bdOrderedSets().flatMap(s => Object.values(s.pieces).flatMap(p => p.skills.map(x => x.s))))];
function abSupportSkills(b, setting) {
  const c = abContext(b);
  // 수치는 후보 선별용 상대 효율일 뿐 최종 피해 점수에 가산하지 않는다.
  return abEquipmentSkills().filter(s => !abSP(s)
    && (s !== '상태 이상 축적 시 위력 UP' || bdBuildupApplies(c.w))).map(s => {
    const effects = bdEffects(bdSkillDesc(s, abMax(s)) || '', s, abGunWeapon(b,setting));
    const value = effects.reduce((n, e) => {
      if (/공중/.test(e.scope || '')) return n; // 공중 운용 지침 없이 범용 피해로 추천하지 않는다.
      if (/탄·화살/.test(e.scope || '') && !['light-gun', 'heavy-gun', 'bow'].includes(b.wt)) return n;
      if (/모으기/.test(e.scope || '') && !['great-sword', 'hammer', 'bow'].includes(b.wt)) return n;
      if (e.el && e.el !== c.w?.e) return n;
      if (e.k === 'ele' && !c.element) return n;
      if (e.k === 'critx') return n + Math.max(0, c.base.crit) / 100 * Math.max(0, e.v - 125) / 100;
      if (e.k === 'crit') return n + Math.max(0, e.v) / 100 * .25;
      if (e.k === 'atk' || e.k === 'ele') return n + (e.perBaseCrit ? e.v * Math.max(0, c.base.crit)
        : e.pct ? (e.k === 'atk' ? c.base.atk : c.base.ele) * e.v / 100 : e.v || 0) / Math.max(1, c.base.atk + (c.element ? c.base.ele : 0));
      return n + (e.k === 'dmg' ? e.v / 100 : 0);
    }, 0);
    return { s, value };
  }).filter(x => x.value > 0).sort((a, b) => b.value - a.value).map(x => x.s);
}
function abContext(b) {
  const w = bdWeaponOf(b), base = bdWeaponBase(b), info = bdStyleInfo(b);
  const tripleCrit = info.active && info.params.every(p => p?.stat === 'crit');
  return { w, base, element: abElementSkill(b), tripleCrit,
    nativeNegative: (w?.crit || 0) < 0,
    style: bdStylesOf(b.wt)[b.st - 1],
    status: Object.keys(BD_STATUS_BOOST).find(s => bdStatusBoostApplies(s, w)) };
}
function abDirections(b, setting) {
  const c = abContext(b), directions = [];
  const make = (id, name, skills, desc, extra = {}) => ({ id, name,
    targets: abTargets(skills).map((t, i) => ({ ...t, min: abOperationRule(b,setting)?.required.length && i > 0 ? 0 : t.min })), desc, ...extra });
  if (c.nativeNegative && c.base.crit < 0 && !c.tripleCrit) {
    const low = make('brutal-low', '흉회심 · 저투자', ['흉회심', c.status || c.element || '연격', '돌파구'],
      '흉회심 1로 손실을 보완하고 다른 피해 스킬에 투자합니다. 전심전력은 필수로 묶지 않습니다.');
    low.targets[0] = { s: '흉회심', min: 1, max: 1 };
    const high = [3, 5].map(lv => {
      const d = make('brutal-' + lv, `흉회심 · Lv${lv}${lv === 5 ? ' 고점' : ' 균형'}`,
        ['흉회심', c.status || c.element || '연격', '돌파구'],
        `흉회심 ${lv}를 확보합니다. ${b.wt === 'great-sword' ? '대검의 한방 고점 선호를 반영하되 평균 점수에 보너스를 더하지 않습니다.' : '다른 피해 스킬과 평균 기대값을 비교합니다.'}`);
      d.targets[0] = { s: '흉회심', min: lv, max: lv }; return d;
    });
    return b.wt === 'great-sword' ? [high[1], high[0], low] : [low, ...high];
  }
  if (c.status) {
    const status = BD_STATUS_BOOST[c.status], elder = { 독: '하룡의 독 안개', 폭파: '염왕룡의 폭발가루' }[status];
    const skills = [c.status, elder || '상태 이상 축적 시 위력 UP', elder ? '상태 이상 축적 시 위력 UP' : '연격'];
    const main = make('status', `${status} · 추가 공격 중심`, skills,
      '추가 공격 Lv5를 목표로 축적 확률·피해 스킬을 조합합니다. 내성·발동 횟수·유지율은 아직 점수에 모델링하지 않습니다.');
    directions.push(main);
    if (b.wt === 'gunlance' && c.style === '블래스트 대시') directions.push(make('status-rear', `${status} · 후방 축적`,
      [c.status, '기습 상태 이상', '상태 이상 축적 시 위력 UP'], '블래스트 대시로 후방을 잡는 운용을 가정합니다. 후방 유지율은 미확정입니다.'));
    return directions;
  }
  const offense = c.element || '연격';
  const mastery = c.element && abEquipmentSkills().find(s => s === c.element + '·경지');
  const elder = c.element && [...BD_ELE_MUL].find(s => bdEffects(bdSkillDesc(s, 1) || '', s, c.w).some(e => e.el === c.w.e && e.k === 'ele'));
  const plain = make('water', c.element ? `${c.w.e}속성${mastery ? ' · 경지' : ''} 중심` : '물리 · 피해 효율',
    [offense, mastery || (c.element ? elder || '연격' : '돌파구'), mastery ? elder || '연격' : '용맹'],
    c.nativeNegative && c.tripleCrit ? '회심 파라미터 3개의 역회심 보정 의도를 반영해 흉회심 방향을 제외합니다.' : '회심 확보 비용을 강제하지 않고 속성·피해 스킬의 투자 효율을 비교합니다.');
  if (c.base.crit > 0) {
    directions.push(make('critical', c.element ? '회심격 · 회심 80~100%' : '회심 확보 · 80~100%',
      [c.element ? '회심격【속성】' : offense, '간파', offense === '연격' ? '돌파구' : offense],
      '파라미터 포함 무기 회심을 활용하고, 발동 가정 회심 80% 이상인 후보만 추천합니다. 슈퍼회심은 필수가 아닙니다.', { critMin: 80 }));
    if (c.tripleCrit) directions.push(make('crit-attack', '무기 회심 · 공격 증강',
      ['공격 증강【회심】', offense, '연격'].filter((s, i, a) => a.indexOf(s) === i).concat(c.element ? [] : ['용맹']),
      `무기 자체 회심 ${c.base.crit}%에 대한 공격 증가를 비교합니다. 장비 강제 착용이나 추가 점수 보너스는 없습니다.`, { prefer: ['공격 증강【회심】'] }));
    if (b.wt === 'switch-axe') directions.push(make('morph-critical', '변형 공격 · 회심 활용',
      ['변형 공격 강화', c.element ? '회심격【속성】' : '슈퍼회심', c.element ? '슈퍼회심' : offense],
      '변형 공격의 회심 증가를 활용합니다. 해당 공격의 발동 가정이며 전체 공격의 상시 효과는 아닙니다.', { critMin: 80 }));
  }
  if (c.tripleCrit && !c.nativeNegative) directions.push(plain); else directions.unshift(plain);
  // 3회심에서도 속성 대안을 유지한다. 슬래시액스의 변형 방향은 일반 회심 방향을 대체한다.
  const morph = directions.find(d => d.id === 'morph-critical');
  const selected = morph ? directions.filter(d => d.id !== 'critical') : directions;
  return selected.slice(0, 3);
}

function abSyncDirection() {
  if (abState.edited || abState.direction === 'manual') return;
  abApplyDirection(abDirections(abState.b,abState.gun)[0]?.id || 'manual');
}

function abChangeWeapon(field, value) {
  const s = abState;
  if (field === 'wt') {
    s.b.wt = value; s.lockon = abMelee(value);
    if (!bdWeaponOf(s.b)) s.b.w = abMonsters(value)[0]?.key || null;
  } else s.b.w = value;
  s.b.st = 0; s.b.style20 = false; s.b.params = [null, null, null];
  s.gun = {mode:'cycle',slot:0};
  if (!s.edited) abApplyDirection(abDirections(s.b)[0]?.id || 'manual');
}

function abApplyDirection(id) {
  abState.direction = id; abState.edited = false;
  abState.targets = id === 'manual' ? [{ s: '', min: 1, max: 1 }, { s: '', min: 1, max: 1 }, { s: '', min: 1, max: 1 }]
    : structuredClone(abDirections(abState.b,abState.gun).find(d => d.id === id).targets);
}

function abScoreBuild(b) {
  const conds = bdStats(b).conds;
  b.cond = Object.fromEntries(conds.map(c => [c.sk, !abSP(c.sk)]));
  for (const s of Object.keys(BD_AMMO_BOOST)) if (s in b.cond && !bdAmmoBoostApplies(s,abGunWeapon(b))) b.cond[s] = false;
  if (b.wt === 'lance' && AB_STYLE_RULES[bdStylesOf(b.wt)[b.st - 1]] && b.cond['불퇴전']) b.cond['매진'] = false;
  b.bowEfficiency = false; // 집중 주기 보정은 추천 시 사용자가 지정하지 않은 가정이다.
  return bdStats(b).score;
}

function abPolicy(b, direction, targets, styleGuide = true, setting) {
  const c = abContext(b), meta = abDirections(b,setting).find(d => d.id === direction) || {};
  const style = styleGuide ? abOperationRule(b,setting) : null;
  const explicit = new Set(targets.map(t => t.s));
  const skip = new Set(style?.avoid || []);
  if (c.nativeNegative && c.tripleCrit) skip.add('흉회심');
  if (c.base.crit < 0 && !c.tripleCrit) ['간파', '약점 특효', '슈퍼회심', '회심격【속성】'].forEach(s => skip.add(s));
  if (c.style !== '블래스트 대시') skip.add('기습 상태 이상');
  // 사용자가 직접 선택한 스킬은 우선한다. 비권장은 장비 자체의 금지가 아니다.
  explicit.forEach(s => skip.delete(s));
  const contextSkills = [c.status, c.element, ...(c.base.crit > 0 ? ['공격 증강【회심】'] : [])].filter(Boolean);
  const support = abSupportSkills(b,setting).filter(s => !skip.has(s));
  const styleTargets = [...(style?.required || []), ...(style?.recommended || [])];
  const fillers = [...new Set([...explicit, ...styleTargets.map(t => t.s), ...contextSkills, ...support.slice(0, 12), '전심전력'])]
    .filter(s => !skip.has(s) && !abSP(s)
      && (!BD_STATUS_BOOST[s] || bdStatusBoostApplies(s, c.w))
      && (!BD_SKILL_WEAPONS[s] || BD_SKILL_WEAPONS[s].includes(b.wt))
      && (!BD_AMMO_BOOST[s] || bdAmmoBoostApplies(s, abGunWeapon(b,setting))));
  return { ...meta, style, styleTargets, avoid: [...skip], lowPriority: c.base.crit < 0 ? ['전심전력'] : [], fillers,
    prefer: [...new Set([...(meta.prefer || []), ...styleTargets.map(t => t.s), ...contextSkills,
      ...support.filter(s => BD_ELE_MUL.has(s) || /경지/.test(s)).slice(0, 4)])] };
}

function abValidate(targets) {
  if (targets.some(t => !t.s)) return '핵심 스킬 3개를 선택해 주세요.';
  if (new Set(targets.map(t => t.s)).size !== targets.length) return '핵심 스킬은 중복 없이 선택해 주세요.';
  if (targets.some(t => !abSkills().includes(t.s) || t.min < 0 || t.max < 1 || t.max > abMax(t.s) || t.min > t.max)) return '허용 레벨 범위를 확인해 주세요.';
  return '';
}

const abSignature = b => BD_PARTS().map(p => b[p.k]).join('|');
function abCompare(a, b, order) {
  if (order === 'score' && a.score !== b.score) return b.score - a.score;
  for (let i = 0; i < a.levels.length; i++) if (a.levels[i] !== b.levels[i]) return b.levels[i] - a.levels[i];
  for (let i = 0; i < (a.styleLevels?.length || 0); i++) if (a.styleLevels[i] !== b.styleLevels[i]) return b.styleLevels[i] - a.styleLevels[i];
  if ((a.discouraged || 0) !== (b.discouraged || 0)) return (a.discouraged || 0) - (b.discouraged || 0);
  return b.score - a.score || a.drifts - b.drifts || abSignature(a.b).localeCompare(abSignature(b.b));
}

function abBest(pool, order, count = 5) {
  const chosen = [], signatures = new Set(), profiles = new Set();
  const sorted = [...pool].sort((a, b) => abCompare(a, b, order === 'alternatives' ? 'score' : order));
  const add = r => { signatures.add(abSignature(r.b)); profiles.add(r.profile); chosen.push(r); };
  if (order === 'alternatives') for (const r of sorted) {
    if (!signatures.has(abSignature(r.b)) && !profiles.has(r.profile)) add(r);
    if (chosen.length === count) return chosen;
  }
  for (const r of sorted) {
    const signature = abSignature(r.b);
    if (signatures.has(signature)) continue;
    add(r);
    if (chosen.length === count) break;
  }
  return chosen;
}

/* 부족한 핵심 레벨은 연성으로 먼저 확보. 이후 핵심 레벨 또는 실제 점수 증가를 비교한다.
   전용 스킬도 SMELT에 있는 것만 슬롯당 Lv1로 넣는다. */
function abFillDrift(original, targets, fillers, use, preferPriority, lowInvestment = false) {
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
      if (!stonePool.has(s) || (levels.get(s) || 0) >= (lowInvestment ? Math.min(1, cap) : cap) || abSP(s)) continue;
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
  const started = performance.now(), parts = BD_PARTS(), { targets: userTargets, drift } = config;
  const seed = structuredClone(config.b);
  if (abGun(seed)) seed._abGun = abGunInfo(seed,config.gun).settings;
  const targets = abSearchTargets(config), requireLock = !!config.lockon && abMelee(seed.wt);
  const policy = abPolicy(seed, config.direction, userTargets, config.styleGuide !== false), stones = abStonePool(), fillers = policy.fillers;
  const optional = policy.styleTargets.filter(t => !targets.some(x => x.s === t.s));
  const curves = new Map(targets.map(t => [t.s, abCurve(t.s, seed)]));
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
    const lv = totalsFor(b), priority = targets.reduce((n, t) => {
      const level = Math.min(t.max, lv.get(t.s) || 0), values = curves.get(t.s)?.values;
      const contribution = values ? (values[level - 1] || 0) / (values[t.max - 1] || 1) : level / t.max;
      const index = userTargets.findIndex(x => x.s === t.s);
      return n + contribution * (requireLock && t.s === '록온' ? 500 : index >= 0 ? [100, 20, 4][index] : 80);
    }, 0);
    const slots = drift ? parts.reduce((n, p) => n + bdSlotCount(b, p.k), 0) * 35 : 0;
    const score = abScoreBuild(b), crit = policy.critMin ? Math.min(policy.critMin, bdStats(b).now.crit) : 0;
    return { priority: priority + slots + crit, score: score + slots };
  };
  // 모든 방어구를 단품 평가한 뒤 핵심 스킬 / 점수 / 슬롯 경로를 묶어 부위 후보를 제한한다.
  all = all.map((rows, i) => {
    const rated = rows.map(r => ({ ...r, ...rank({ ...seed, [parts[i].k]: r.key }) })), keep = new Map();
    for (const t of targets) for (const r of [...rated].filter(r => r.piece.skills.some(x => x.s === t.s)).sort((a, b) =>
      (b.piece.skills.find(x => x.s === t.s)?.lv || 0) - (a.piece.skills.find(x => x.s === t.s)?.lv || 0) || b.score - a.score).slice(0, 2)) keep.set(r.key, r);
    for (const s of policy.prefer) for (const r of [...rated].filter(r => r.piece.skills.some(x => x.s === s))
      .sort((a, b) => b.score - a.score).slice(0, 1)) keep.set(r.key, r);
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
  finish: for (const node of beam) for (const mode of ['priority', 'score', 'low']) {
    const b = abFillDrift(node.b, [...targets, ...optional], fillers, drift, mode === 'priority', mode === 'low');
    evaluated++;
    if (b) {
      const lv = totalsFor(b), levels = userTargets.map(t => Math.min(t.max, lv.get(t.s) || 0));
      if (targets.every(t => (lv.get(t.s) || 0) >= t.min)
        && (!policy.critMin || bdStats(b).now.crit >= policy.critMin)) {
        const support = [...lv].filter(([s]) => !userTargets.some(t => t.s === s)
          && (fillers.includes(s) || policy.styleTargets.some(t => t.s === s))).map(([s, level]) => [s, Math.min(abMax(s), level)]);
        const profile = [...support].sort(([a], [b]) => a.localeCompare(b)).map(([s, lv]) => s + ':' + lv).join('|');
        pool.push({ b, levels, styleLevels: policy.styleTargets.map(t => Math.min(t.max, lv.get(t.s) || 0)),
          support, profile, score: abScoreBuild(b), drifts: bdStoneList(b).length,
          discouraged: [...policy.avoid, ...policy.lowPriority].reduce((n, s) => n + (lv.get(s) || 0), 0), driftMode: mode });
      }
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

function abGuideUI(b, direction, targets) {
  const setting = b._abGun || abState.gun;
  const policy = abPolicy(b, direction, targets, abState.styleGuide,setting), c = abContext(b);
  const extra = abSearchTargets({ b, targets, gun:setting, styleGuide: abState.styleGuide })
    .filter(t => !targets.some(x => x.s === t.s && x.min >= t.min));
  return `<p>${esc(policy.desc || '직접 설정: 사용자 스킬과 레벨을 우선하며 적용 가능한 효과만 평가합니다.')}</p>
    ${policy.style ? `<p>스타일 골격: ${esc(policy.style.name)}. ${esc(policy.style.desc)} ${policy.style.required.length ? '필수 조건과 선택한 투자 방향을 결합하며 보조 핵심의 최소 레벨은 직접 높일 수 있습니다.' : ''} 권장 스킬은 최소 레벨로 강제하지 않습니다.</p>` : ''}
    ${abGun(b) ? abGunGuideUI(b,setting) : ''}
    ${c.nativeNegative && c.tripleCrit ? '<p>회심 파라미터 3개: 흉회심 중심 방향과 자동 추가 연성은 제외합니다. 무기 기본 스킬·장비에 함께 붙은 효과는 실제 계산을 유지합니다.</p>' : ''}
    ${policy.avoid.length ? `<p>자동 보충 비권장: ${policy.avoid.map(esc).join(' · ')}. 다른 유용한 스킬이 붙은 장비까지 금지하지 않습니다.</p>` : ''}
    ${policy.lowPriority.length ? `<p>낮은 우선순위: ${policy.lowPriority.map(esc).join(' · ')}. 후보에서 제외하지 않고 실제 점수로 비교합니다.</p>` : ''}
    ${extra.length ? `<p>추가 확보 조건: ${extra.filter(t=>t.min>0).map(t => `${esc(t.s)} ${t.min}${t.max>t.min ? ` (목표 ${t.max})` : ''}`).join(' · ')}. 운용 최소와 선택한 경지의 선행 레벨입니다.</p>` : ''}
    ${targets.map(t => { const curve = abCurve(t.s, b); return t.s ? `<p>${esc(t.s)}: ${curve ? `레벨별 효과 ${curve.values.join(' / ')} · 추가 증가량 ${curve.increments.join(' / ')} (동일 단위)` : '복합·확률 또는 비수치 효과: 임의 대미지 환산 없이 레벨 우선순위로 평가'}</p>` : ''; }).join('')}
    <p>확정 최소 레벨을 우선하고, 나머지는 Lv1부터 목표까지 비교합니다. 점수 우선 연성과 Lv1 중심 다이소 연성 경로도 함께 탐색합니다.</p>
    ${b.wt === 'lance' && AB_STYLE_RULES[c.style] ? '<p>반사 효과는 임의 피해 점수로 더하지 않습니다. 불퇴전이 발동한 점수에서는 매진을 끄고, 이동 후 보완 효과는 별도로 남깁니다.</p>' : ''}
    ${c.status ? '<p>상태이상 축적 확률·임계치·발동 횟수·지속 시간은 미모델링입니다. 기존 점수는 상시 DPS나 실제 상태이상 피해를 뜻하지 않습니다.</p>' : ''}`;
}

function abGunGuideUI(b, setting) {
  const g = abGunInfo(b,setting), levels = new Map(bdTotals(b));
  return `<p>탄 운용: ${esc(g.name)}${g.mode !== 'cycle' ? ' · '+esc(g.ammo[0]?.name || '') : ''}.</p>
    ${g.unknown ? '<p>현재 탄 구성과 일치하는 반동·장전 자료가 없습니다. 요구 레벨은 자동 확정하지 않습니다.</p>' : `<p>나우칼 참고값에서 선택 탄의 최선 표시 단계에 도달하는 최소 레벨을 확보합니다. 모든 탄 순환은 탄별 요구 중 최대값을 사용합니다.</p>
    <ul>${g.ammo.map(a => `<li>${esc(a.name)}: 반동 ${AB_RECOIL[a.recoil[0]]} → ${AB_RECOIL[Math.min(...a.recoil)]} (Lv${a.recoil.indexOf(Math.min(...a.recoil))}) · 장전 ${AB_RELOAD[a.reload[0]]} → ${AB_RELOAD[Math.min(...a.reload)]} (Lv${a.reload.indexOf(Math.min(...a.reload))})</li>`).join('')}</ul>`}
    ${g.avoid.length ? `<p>운용으로 대체: ${g.avoid.map(esc).join(' · ')}. 직접 지정·겸용 장비는 유지합니다.</p>` : ''}
    ${g.mode !== 'cycle' ? `<p>회피 장전: 최소4 · 기본 목표4. Lv5는 추가 투자 대안이며 강제하지 않습니다. 현재 Lv${levels.get('회피 장전') || 0}. 확률 보충 실패 시 대응과 유지율은 미계산입니다.</p>` : ''}
    ${g.mode === 'sp' ? '<p>SP 연계: 두 가속은 각각3 확보. 절대 회피는 연계 성립 최소1·권장 목표3으로 비교합니다. SP 회복·소비나 회피 장전은 대미지 배율로 환산하지 않습니다.</p>' : ''}
    <p>비교 점수는 사격 DPS가 아닙니다. 탄별 피해·회심 판정, 사격 비중 및 가드 후 탄 강화는 미계산입니다.</p>
    <p><a href="'+esc(BD_BOWGUN_DATA.sources[b.wt])+'" target="_blank" rel="noopener noreferrer">탄별 반동·장전 자료: 나우칼</a></p>`;
}
function abGunUI(b) {
  const g = abGunInfo(b,abState.gun);
  if (!g) return '';
  return `<div class="ab-box ab-form-settings"><h3>보우건 운용 <small>딜링 방향과 별도로 결합</small></h3>
    <div class="ab-config"><label>탄 운용<select data-ab="gunMode">${abOptions(g.modes,g.mode)}</select></label>
    ${g.mode !== 'cycle' ? `<label>반복할 탄<select data-ab="gunSlot">${abOptions(g.choices.map(a=>[a.i,`${a.i+1}번 · ${a.name}`]),g.slot)}</select></label>` : ''}</div>
    <label class="ab-check"><input type="checkbox" data-ab="styleGuide"${abState.styleGuide ? ' checked' : ''}>탄·스타일 운용 기준 적용</label>
    <p class="ab-muted">${!abState.styleGuide ? '자동 운용 기준 해제. 직접 선택한 핵심 스킬만 요구합니다.' : (g.unknown ? '반동·장전 자료 미확인. 해당 스킬은 직접 지정해 주세요. ' : '')+'필수: '+(g.required.map(t=>`${esc(t.s)} ${t.min}${t.max>t.min ? ` → 목표${t.max}` : ''}`).join(' · ') || '추가 반동·장전 불필요')}
    ${g.recommended.length ? ' · 가드 성능 2~3 권장(필수 아님)' : ''}</p>
    ${g.mode !== 'cycle' ? `<label class="ab-check"><input type="checkbox" data-ab="reload5"${abState.gun.reload5 ? ' checked' : ''}>회피 장전 Lv5까지 투자 비교</label>` : ''}
    <details><summary>탄 운용 근거·한계</summary>${abGunGuideUI(b,abState.gun)}</details></div>`;
}

function abRender() {
  const s = abState, b = s.b, base = bdWeaponBase(b), info = bdStyleInfo(b), dirs = abDirections(b,s.gun);
  const skills = abSkills(), w = bdWeaponOf(b);
  $('#ab-screen').innerHTML = `<div class="ab-heading"><button class="btn ghost" data-ab-back>← 내 빌드</button><h2>자동빌드 (테스트중)</h2></div>
    <div class="ab-box ab-form-settings ab-weapon-settings"><h3>무기 설정</h3><div class="ab-config">
      <label>무기군<select data-ab="wt">${abOptions(BUILD.weaponTypes.filter(t => abMonsters(t.k).length).map(t => [t.k, t.n]), b.wt)}</select></label>
      <label>몬스터·소재<select data-ab="monster">${abOptions(abMonsters(b.wt).map(s => [s.key, s.name]), b.w)}</select></label>
      <label>스타일<select data-ab="st"${info.selectable ? '' : ' disabled'}>${abOptions([[0, '스타일 없음'], ...bdStylesOf(b.wt).map((n, i) => [i + 1, n])], b.st)}</select></label>
      <label class="ab-check"><input type="checkbox" data-ab="style20"${info.active ? ' checked' : ''}${info.available ? '' : ' disabled'}>스타일강화 Lv20 적용</label>
    </div><div class="ab-parameter">${BD_PARAM_LEVELS.map((lv, i) => `<label>Lv${lv} 파라미터<select data-ab-param="${i}"${info.active ? '' : ' disabled'}>${abOptions([['', '미선택'], ...(info.profile?.parameters[lv] || []).map(p => [p.stat, `${{ atk: '공', crit: '회', ele: '속' }[p.stat]} +${p.value}${p.stat === 'crit' ? '%' : ''}`])], b.params[i] || '')}</select></label>`).join('')}</div>
    <p class="ab-base">${esc(w.name)} · 공격력 <b>${base.atk}</b>${w.e ? ` · ${esc(w.e)} <b>${base.ele}</b>` : ''} · 회심 <b>${base.crit}%</b></p></div>
    ${abGunUI(b)}
    ${!abGun(b) && abStyleRule(b) ? `<div class="ab-box ab-form-settings"><h3>스타일 운용 기준 <small>투자 방향과 별도로 결합</small></h3>
      <label class="ab-check"><input type="checkbox" data-ab="styleGuide"${s.styleGuide ? ' checked' : ''}>${esc(abStyleRule(b).name)} 기준 적용</label>
      <p class="ab-muted">${esc(abStyleRule(b).desc)}</p>
      <p class="ab-muted">${s.styleGuide ? '아래 핵심 3개와 함께 적용합니다. 같은 스타일에서도 몬스터·파라미터에 따라 투자 방향이 달라집니다.' : '스타일의 자동 기준을 해제했습니다. 직접 선택한 핵심 스킬은 유지합니다.'}</p></div>` : ''}
    <div class="ab-box"><h3>세팅 방향 <small>무기 특성 × 파라미터 × 운용 지침</small></h3><div class="ab-directions" role="group" aria-label="세팅 방향">
      ${[...dirs, { id: 'manual', name: '직접 설정', desc: '핵심 스킬과 순위를 직접 정합니다.' }].map((d, i) => `<button data-ab-dir="${d.id}" aria-pressed="${s.direction === d.id}"><b>${esc(d.name)}${i === 0 && dirs.length ? ' · 추천' : ''}</b><span>${esc(d.desc)}</span></button>`).join('')}</div>
      <p class="ab-muted">${s.edited ? '사용자 수정 유지 중. 새 방향을 선택하면 핵심 스킬이 교체됩니다.' : '무기·스타일·회심·파라미터에 맞는 지침으로 핵심 스킬과 레벨을 설정합니다.'}</p>
      <details><summary>적용 지침과 레벨 근거</summary>${abGuideUI(b, s.direction, s.targets)}</details></div>
    <div class="ab-box ab-form-settings ab-core-settings"><h3>핵심 스킬</h3><div class="ab-targets">${s.targets.map((t, i) => `<div><label>${i + 1}순위<select data-ab-skill="${i}">${abOptions([['', '스킬 선택'], ...skills.map(n => [n, n])], t.s)}</select></label>
      <label>최소 Lv<select data-ab-min="${i}">${abOptions(Array.from({ length: abMax(t.s) + 1 }, (_, n) => [n, n ? String(n) : '권장(0)']), t.min)}</select></label>
      <label>목표 Lv<select data-ab-max="${i}">${abOptions(Array.from({ length: abMax(t.s) }, (_, n) => [n + 1, String(n + 1)]), t.max)}</select></label></div>`).join('')}</div>
      <p class="ab-muted">최소 레벨은 반드시 충족합니다. 권장(0)은 확보를 강제하지 않고 목표까지 비교합니다. 스타일 조건이 있으면 방향의 보조 스킬은 권장으로 시작합니다. 우선순위순은 1 → 2 → 3순위 목표 충족도를 먼저 비교합니다.</p>
      <div class="ab-actions"><label class="ab-check"><input type="checkbox" data-ab="drift"${s.drift ? ' checked' : ''}>표류연성 사용</label>
      <label class="ab-check" title="체크하면 핵심 스킬과 별도로 록온 Lv1을 반드시 확보합니다"><input type="checkbox" data-ab="lockon"${s.lockon && abMelee(b.wt) ? ' checked' : ''}${abMelee(b.wt) ? '' : ' disabled'}>록온 필수</label>
      <button class="btn primary" data-ab-search${s.busy ? ' disabled' : ''}>${s.busy ? '후보 탐색 중…' : '추천 빌드 찾기'}</button>${s.busy ? '<button class="btn ghost" data-ab-cancel>중지</button>' : ''}</div>
      <p id="ab-status" role="status" aria-live="polite">${esc(s.notice)}</p>
      <details class="ab-basis"><summary>추천 기준과 출처</summary><p>기존 빌드 점수로 평가합니다. 조건부 효과는 발동한 상태로 가정하며 특수 위력·SP 전용 효과는 제외합니다. 동시 발동 가능성·유지율은 보정하지 않아 실제 DPS가 아닙니다. 특수 게이지 가속은 선택 가능한 핵심 스킬로 유지하며 임의 대미지 점수는 부여하지 않습니다.</p>
      <p>스타일 골격과 무기의 투자 방향을 함께 적용합니다. 핵심 3개가 같아도 몬스터·스타일·파라미터에 따라 보조 스킬과 연성이 달라질 수 있습니다. 실제 등록 장비의 스킬 효과로 보조 후보를 재평가하며 회심 중심 방향은 발동 가정 회심 80% 이상을 요구합니다. 사용자 수정 스킬과 레벨은 설정 변경으로 덮어쓰지 않습니다.</p>
      <p>록온 필수는 근접무기에서 기본 적용하며 Lv1을 내부 0순위로 확보합니다. 핵심 스킬 3개는 그대로 유지하며 록온이 없는 후보는 점수와 관계없이 제외합니다. 원거리 3종은 이 옵션을 사용하지 않습니다.</p>
      <p>방어구 전 부위를 제한 폭으로 탐색하고 연성은 핵심 스킬 보충 후 소수의 공격 관련 후보로 채웁니다. 최대 ${AB_LIMIT.ms / 1000}초, 탐색 폭 ${AB_LIMIT.beam}. 최적해 보장은 아니며 같은 방어구 조합의 중복 추천은 제외합니다. 장비·연성의 보유 여부와 획득 난도는 고려하지 않습니다.</p>
      ${AB_SOURCES.map(([n, url]) => `<a href="${url}" target="_blank" rel="noopener noreferrer">공식 ${esc(n)}</a>`).join(' · ')}</details></div>
    <div id="ab-results"></div>`;
  abRenderResults();
}

/* 빌드의 장비 행/스킬 칩을 공유하되 편집용 인덱스와 버튼은 생성하지 않는다. */
function abEquipmentUI(b) {
  const core = new Set(abState.targets.map(t => t.s));
  if (abState.styleGuide) abOperationRule(b)?.required.forEach(t => core.add(t.s));
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
  $('#ab-results').innerHTML = !s.stats ? '' : `<div class="ab-heading"><h3>추천 결과 ${results.length}개</h3><label>정렬 <select data-ab="order">${abOptions([['priority', '스킬 우선순위순'], ['score', '빌드 점수순'], ['alternatives', '투자 대안 비교']], s.order)}</select></label></div>
    ${s.order === 'alternatives' ? '<p class="ab-muted">최고 점수 후보를 먼저 보여주고, 보조 스킬·투자 레벨이 다른 대안을 이어서 보여줍니다. 점수순은 아니며 차이를 함께 표시합니다.</p>' : ''}
    <p class="ab-muted">${s.stats.expanded.toLocaleString()}개 조합 탐색 · ${s.stats.evaluated}개 연성 구성 검토 · ${s.pool.length}개 유효 후보 · ${(s.stats.ms / 1000).toFixed(1)}초${s.stats.limited ? ' · 탐색 제한 도달' : ''}</p>
    ${results.length ? `<div class="bd-cards ab-result-grid">` + results.map((r, i) => `<article class="bd-card ab-result"><div class="ab-heading"><h3>추천 ${i + 1}</h3><b class="ab-score">${r.score.toLocaleString()}점</b></div>
      <div class="ab-levels">${s.targets.map((t, j) => `<span>${j + 1}순위 ${esc(t.s)} <b>Lv${r.levels[j]}</b> / 목표 ${t.max}</span>`).join('')}</div>
      <p class="ab-muted" style="padding:0 12px">보조 투자: ${(r.support || []).slice(0, 3).map(([n, lv]) => `${esc(n)} ${lv}`).join(' · ') || '핵심 스킬 중심'}${r.support?.length > 3 ? ` 외 ${r.support.length - 3}개` : ''}${s.order === 'alternatives' ? ` · 최고 후보 대비 ${Math.max(...s.pool.map(x => x.score)) - r.score}점 차이` : ''}</p>
      ${abEquipmentUI(r.b)}
      <details><summary>추천 · 계산 근거</summary>
      <div class="ab-reason"><h4>요구 스킬 충족</h4><ul>
      ${s.lockon && abMelee(s.b.wt) ? '<li>필수 록온: Lv1 확보</li>' : ''}
      ${s.targets.map((t, j) => `<li>${j + 1}순위 ${esc(t.s)}: <b>Lv${r.levels[j]}</b> 확보 <small>(최소 ${t.min} · 목표 ${t.max})</small></li>`).join('')}</ul>
      ${s.styleGuide && abOperationRule(r.b)?.required.length ? `<h4>운용 조건 확보</h4><p>${abOperationRule(r.b).required.map(t => `${esc(t.s)} ${Math.min(abMax(t.s), new Map(bdTotals(r.b)).get(t.s) || 0)} / 최소 ${t.min}${t.max>t.min ? ` · 목표 ${t.max}` : ''}`).join(' · ')}</p>` : ''}
      <h4>적용한 운용 지침</h4>${abGuideUI(r.b, s.direction, s.targets)}
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
  if (el.dataset.ab === 'styleGuide') s.styleGuide = el.checked;
  if (el.dataset.ab === 'gunMode') s.gun = { ...s.gun, mode:el.value, slot:0 };
  if (el.dataset.ab === 'gunSlot') s.gun.slot = +el.value;
  if (el.dataset.ab === 'reload5') s.gun.reload5 = el.checked;
  if (['st','gunMode','gunSlot','reload5'].includes(el.dataset.ab) && abGun(s.b)) s.gun = abGunInfo(s.b,s.gun).settings;
  if (el.hasAttribute('data-ab-param')) s.b.params[+el.dataset.abParam] = el.value || null;
  for (const field of ['skill', 'min', 'max']) if (el.hasAttribute('data-ab-' + field)) {
    const i = +el.dataset['ab' + field[0].toUpperCase() + field.slice(1)], t = s.targets[i];
    if (field === 'skill') s.targets[i] = abTargets([el.value])[0]; else t[field] = +el.value;
    s.edited = true;
  }
  bdNormalizeParams(s.b);
  if (['st', 'style20','gunMode','gunSlot','reload5'].includes(el.dataset.ab) || el.hasAttribute('data-ab-param')) abSyncDirection();
  abRender();
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
    const b = structuredClone(r.b), direction = abDirections(b).find(d => d.id === abState.direction)?.name || '직접 설정', gun = abGunInfo(b);
    delete b._abGun; // 자동추천 운용 메타데이터는 저장 빌드 형식에 추가하지 않는다.
    b.n = `${bdSet(b.w).name} · ${direction}${gun ? ' · '+gun.name+(gun.mode !== 'cycle' ? ' · '+gun.ammo[0]?.name : '') : ''}`;
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
    const result = await abSearch(structuredClone({ b: abState.b, gun:abState.gun, direction: abState.direction, targets: abState.targets, drift: abState.drift, lockon: abState.lockon, styleGuide: abState.styleGuide }),
      p => { $('#ab-status').textContent = `${p.stage}/5부위 · ${p.expanded.toLocaleString()}개 조합 탐색 · ${p.evaluated}개 연성 구성 검토`; },
      () => run !== abState.run);
    if (!result || run !== abState.run) return;
    abState.pool = result.pool; abState.stats = result; abState.notice = '후보 탐색이 완료되었습니다.';
  } catch (err) { if (run === abState.run) abState.notice = '추천 중 오류가 발생했습니다. 다시 시도해 주세요.'; console.error(err); }
  if (run === abState.run) { abState.busy = false; abRender(); }
});
abApplyDirection('water');
abRoute();
