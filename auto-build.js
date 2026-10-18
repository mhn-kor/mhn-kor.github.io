/* docs/WEAPONS.md·CONCEPTS.md의 사용자 규칙을 조건별 추천과 탐색에 적용한다.
   bounded beam search: 전역 최적 보장이 아닌 제한 탐색, 점수는 기존 bdStats를 공유. */
const AB_LIMIT = { beam: 160, armor: 24, evaluated: 6000, ms: 8000 };
const AB_SOURCES = [
  ['물속성 공격 강화', 'https://monsterhunternow.com/ko/skills/water_attack'],
  ['회심격【속성】', 'https://monsterhunternow.com/ko/skills/critical_element'],
  ['슈퍼회심', 'https://monsterhunternow.com/ko/skills/critical_boost'],
];
const abMax = s => BUILD.maxLv[s] || bdSkillLevels(s)?.at(-1)?.[0] || 1;
// SP 전용 공격(특수 스킬 위력). SP 연계 버프(속성 공격 증강【SP】·투기 활성)는 AB_ASSUME.sp 조건부 후보로 따로 다룬다.
const abSP = s => /특수.*위력|위력.*특수/.test(s);
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
const abTargets = names => names.map(s => ({ s, min: 0, max: abMax(s) }));
const abMelee = wt => !['light-gun', 'heavy-gun', 'bow'].includes(wt);
const abMonsters = wt => bdOrderedSets().filter(s => s.weapons.some(w => w.t === wt));
const abElementSkill = b => {
  const element = bdWeaponOf(b)?.e;
  return ['불', '물', '번개', '얼음', '용'].includes(element) ? `${element}속성 공격 강화` : null;
};
const abGun = b => ['light-gun', 'heavy-gun'].includes(b.wt);
const AB_RECOIL = ['소', '중', '대', '특대', '용격 전용'];
const AB_RELOAD = ['빠름', '보통', '조금 느림', '느림'];
const AB_AMMO_PREFERENCE = {통상:1,산탄:2,관통:3,참렬:3,용격:4,확산:4};
const abAmmoPreference = x => AB_AMMO_PREFERENCE[bdAmmoFamily(x)] || 0;
function abGunInfo(b, setting = b._abGun || {}) {
  if (!abGun(b)) return null;
  const w = bdWeaponOf(b), saved = BD_BOWGUN_DATA.weapons[b.w + '/' + b.wt];
  const data = saved && JSON.stringify(saved.x) === JSON.stringify(w?.x) ? saved : null;
  const style = bdStylesOf(b.wt)[b.st - 1], rule = abStyleRow(b), allowed = rule?.modes || [];
  const slots = (w?.x || []).map((x, i) => ({ i, name:x, ...(data?.ammo[i] || {}) }));
  const wyvern = slots.filter(a => /용격탄/.test(a.name));
  const modes = Object.entries(AB_RULES.gunModes).filter(([id]) => id === 'cycle'
    || allowed.includes(id) && (id === 'sp' ? wyvern : slots).length).map(([id, m]) => [id, m.name]);
  const mode = modes.some(([id]) => id === setting.mode) ? setting.mode : 'cycle', spec = AB_RULES.gunModes[mode];
  const choices = mode === 'sp' ? wyvern : slots;
  const slot = choices.find(a => a.i === +setting.slot) || [...choices].sort((a,b) => abAmmoPreference(b.name)-abAmmoPreference(a.name))[0];
  const ammo = mode === 'cycle' ? slots : slot ? [slot] : [];
  const best = field => Math.max(0, ...ammo.map(a => a[field].indexOf(Math.min(...a[field]))));
  const required = [], recommended = (rule?.recommended || []).map(t => ({...t})), avoid = [...(rule?.avoid || [])];
  const add = (s, min, max = min) => { if (min) required.push({s,min,max}); };
  for (const s of spec.avoid || []) if (!avoid.includes(s)) avoid.push(s);
  if (data) {
    if (!avoid.includes('반동 경감')) add('반동 경감', best('recoil'));
    if (!avoid.includes('장전 속도')) add('장전 속도', best('reload'));
  }
  for (const t of spec.required) add(t.s, t.min, t.s === '회피 장전' && setting.reload5 ? 5 : t.max);
  const name = spec.name;
  return { data, style, mode, slot:slot?.i || 0, slots, choices, ammo, modes, name, required, recommended, avoid,
    compare: mode === 'cycle' ? [...slots].sort((a,b) => abAmmoPreference(b.name)-abAmmoPreference(a.name))[0] : slot,
    settings:{mode,slot:slot?.i || 0,reload5:!!setting.reload5}, unknown:!data };
}
function abOperationRule(b, setting, styleGuide = true) {
  if (styleGuide === false) return null;
  const gun = abGunInfo(b, setting), rule = gun ? { name:gun.name, required:gun.required, recommended:gun.recommended, avoid:gun.avoid,
    desc:'선택한 탄 운용의 필수 조건을 확보하고 몬스터·파라미터별 투자 방향을 결합합니다.' } : abStyleRule(b);
  // 배열이면 사용자가 끈 규칙 스킬. 끈 스킬만 빼고 나머지 운용 조건은 유지한다.
  const off = Array.isArray(styleGuide) ? styleGuide : [];
  return rule && off.length ? { ...rule, required:rule.required.filter(t => !off.includes(t.s)),
    recommended:rule.recommended.filter(t => !off.includes(t.s)) } : rule;
}
function abGunWeapon(b, setting) {
  const w = bdWeaponOf(b), g = abGunInfo(b, setting);
  return g?.compare ? {...w,x:[g.compare.name]} : bdScoreWeapon(b);
}
function abSearchTargets(config) {
  const rows = [...config.targets, ...(abOperationRule(config.b,config.gun,config.styleGuide ?? true)?.required || [])];
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
let abState = { b: { ...bdNewBuild(), w: 'mizu', wt: 'shield-sword' }, direction: '', edited: false,
  targets: abTargets(['물속성 공격 강화', '회심격【속성】', '슈퍼회심']), drift: true, lockon: true,
  gun:{mode:'cycle'}, styleOff: [], exclude: [], assumeOn: [], assumeOff: [], chip: null, adding: null, stale: false, variant: {},
  pool: [], stats: null, busy: false, run: 0, notice: '', scroll: 0, active: false };

/* 자동세팅 규칙 데이터. docs/weapons/*.md 운용 규칙 표와 1:1 (tools/auto-build-rules-test.js가 대조).
   지침 변경은 해당 행을 고친다. 함수에 무기·스타일 조건을 따로 하드코딩하지 않는다.
   styles: style ''=기본(스타일 없음). mode=같은 스타일 안의 운용 성향. when=무기 조건. max 'MAX'=스킬 최대.
   label=방향 이름 접두. coreSlot=권장 첫 스킬이 방향 핵심에 없으면 넣을 칸. modes=허용 보우건 탄 운용. note=근거 추가 설명. */
const abT = (s, min, max = min) => ({ s, min, max });
const AB_RULES = {
  styles: [
    { id:'lance-base', wt:'lance', style:'', name:'기본 · 카운터 운용', required:[abT('가드 성능',2,3)],
      recommended:[abT('불퇴전',0,5),abT('공격적인 방어',0,5)], avoid:['매진'],
      desc:'가드 성능 최소2·목표3. 불퇴전·공격적인 방어는 권장 후보이며 가드 동작의 보정을 상시 스킬 레벨로 더하지 않습니다.' },
    { id:'lance-just', wt:'lance', style:'저스트 가드', name:'저스트가드 · 공격 특화', required:[abT('불퇴전',4,5),abT('반사',1,5)],
      recommended:[], avoid:['가드 성능','매진'], desc:'불퇴전 4~5 · 반사 1 이상. 가드 성능은 우대하지 않습니다. 매진은 앞회피로 불퇴전을 꺼서 쓰지 않습니다.',
      note:'반사 효과는 임의 피해 점수로 더하지 않습니다.' },
    { id:'lance-shield', wt:'lance', style:'실드 태클', name:'실드태클 · 돌진 유지',
      required:[abT('가드 성능',5),abT('반사',1,5),abT('불퇴전',4,5)], recommended:[], avoid:['매진'],
      desc:'가드 성능 5 · 반사 1 이상 · 불퇴전 4~5. 돌진 중 가드를 활용합니다.',
      note:'반사 효과는 임의 피해 점수로 더하지 않습니다.' },
    { id:'sns-base', wt:'shield-sword', style:'', name:'기본 · 가드/방패 연계', required:[abT('가드 성능',5)], recommended:[], avoid:['비연'],
      desc:'가드 성능5 확보 후 밀림 없는 가드에서 방패 공격으로 연결합니다.' },
    { id:'sns-fallbash', wt:'shield-sword', style:'', mode:'fallbash', label:'폴배시', coreSlot:2, name:'기본 · 폴배시',
      required:[], recommended:[abT('저스트 교격',0,5)], avoid:['가드 성능','과감'],
      desc:'가드 성능보다 공격 투자. 저스트 회피 후 폴배시 공격을 가정할 때만 저스트 교격을 조건부 점수에 반영합니다.' },
    { id:'sns-dive', wt:'shield-sword', style:'파고들어베기', name:'파고들어베기 · 절단/다타수', required:[], recommended:[], avoid:[],
      desc:'방패 대신 칼 공격의 다타수로 절단·상태이상 활용을 비교합니다. 임의 타수 배율은 더하지 않습니다.' },
    { id:'sns-rush', wt:'shield-sword', style:'저스트러시', name:'저스트러시 · 가드베기', required:[abT('가드 성능',5)], recommended:[], avoid:[],
      desc:'가드 성능5 확보 후 가드베기 연계와 대미지 투자로 구성합니다.' },
    { id:'gs-element', wt:'great-sword', style:['','격앙참'], when:'element', coreSlot:1, name:'{style} · 대검 운용', required:[],
      recommended:[abT('차지 마스터',0,'MAX'),abT('차지 스톡',0,3)], avoid:[],
      desc:'모으기 연계에 차지 마스터·차지 스톡을 우선 검토하고 남은 장비는 공격에 투자합니다. 태클을 무피해로 가정하지 않습니다.' },
    { id:'gs-raw', wt:'great-sword', style:['','격앙참'], when:'raw', coreSlot:1, name:'{style} · 대검 운용', required:[],
      recommended:[abT('저스트 모으기 해방',0,'MAX'),abT('차지 스톡',0,3)], avoid:[],
      desc:'모으기 연계에 저스트 모으기 해방·차지 스톡을 우선 검토하고 남은 장비는 공격에 투자합니다. 태클을 무피해로 가정하지 않습니다.' },
    { id:'gs-stream', wt:'great-sword', style:'수류베기', name:'수류베기 · 대검 운용', required:[], recommended:[], avoid:[],
      desc:'차지 없는 연속 공격 후 강/참모아베기. 상태이상 방향도 검토하며 별도 필수 스킬은 강제하지 않습니다.' },
    { id:'bow-base', wt:'bow', style:'', coreSlot:1, name:'기본 · 집중', required:[abT('집중',5)], recommended:[abT('저스트 모으기 해방',0,5)], avoid:[],
      desc:'집중5와 저스트 모으기 해방을 함께 추천합니다. 집중을 4로 낮추는 운용은 직접 조정합니다. 점수에 임의 딜사이클 배율을 더하지 않습니다.' },
    { id:'bow-evade', wt:'bow', style:'회피 근접공격', name:'회피 근접공격', required:[], recommended:[], avoid:['집중'],
      desc:'모으는 차지 단계가 없어 집중과 모으기 계열 효과를 쓰지 않습니다.' },
    { id:'bow-rapid', wt:'bow', style:'강연사', name:'강연사 · 집중', required:[abT('집중',5)], recommended:[], avoid:[],
      desc:'단계당 모으기 시간이 길어 집중5를 확보합니다. 점수에 임의 딜사이클 배율을 더하지 않습니다.' },
    { id:'light-step', wt:'light-gun', style:'스텝 샷', modes:['repeat'], name:'스텝샷 · 반동 대체', required:[], recommended:[], avoid:['반동 경감'],
      desc:'스텝샷 중심 사격은 반동 경감을 자동 보충하지 않습니다. 탄 순환 시 장전 속도는 별도로 필요합니다. 일반 탭 사격의 반동까지 대체하지 않습니다.' },
    { id:'light-slide', wt:'light-gun', style:'슬라이딩 리로드', name:'슬라이딩 리로드 · 장전 대체', required:[], recommended:[], avoid:['장전 속도'],
      desc:'한 발 이상 사용 후 슬라이딩 리로드로 장전을 대체합니다. 반동 경감은 사용하는 탄에 맞춰 별도로 확보해야 합니다.' },
    { id:'heavy-guard', wt:'heavy-gun', style:'가드리로드', name:'가드리로드 · 장전 대체', required:[], recommended:[abT('가드 성능',0,3)], avoid:['장전 속도'],
      desc:'가드리로드로 장전을 대체하고 가드 성능 2~3을 권장 후보로 검토합니다. 필수 최소로 강제하지 않으며, 반동 경감은 사용하는 탄에 맞춰 별도로 필요합니다.' },
    { id:'heavy-crouch', wt:'heavy-gun', style:'앉아쏘기', modes:['repeat','sp'], name:'앉아쏘기 · 반동 대체', required:[], recommended:[], avoid:['반동 경감'],
      desc:'앉아쏘기 중심 사격은 반동 경감을 자동 보충하지 않습니다. 탄 순환 시 장전 속도는 별도로 필요합니다. 일반 사격까지 같은 조건으로 취급하지 않습니다.' },
  ],
  // 보우건 탄 운용(B2·B3). 반동·장전 요구는 탄 자료로 계산한다. 회피 장전 Lv5는 사용자 옵션.
  gunModes: {
    cycle: { name:'전체 탄 순환', required:[] },
    repeat: { name:'특정 탄 · 회피 장전', required:[abT('회피 장전',4)], avoid:['장전 속도'] },
    sp: { name:'용격탄 · 회피/SP 연계', avoid:['장전 속도'], // 절대 회피는 연계 성립 최소1, 권장 목표3.
      required:[abT('회피 장전',4),abT('특수 게이지 가속',3),abT('특수 게이지 가속【저스트 회피】',3),abT('절대 회피【SP】',1,3)] },
  },
  // 무기 공통: 지침 출처, 동시 발동하지 않는 조건 (앞 조건 ON이면 뒤 조건 OFF).
  weapons: { lance:{ source:'W5' }, 'shield-sword':{ source:'W9' }, 'great-sword':{ source:'W10' },
    bow:{ source:'기존 집중 기준' }, 'light-gun':{ source:'B1–B3' }, 'heavy-gun':{ source:'B1–B3' } },
  // 문맥별 자동 보충 제외 (W2·W4·B5). 사용자가 직접 지정한 스킬은 제외하지 않는다.
  avoid: [
    { when:c => c.nativeNegative && c.tripleCrit, skills:['흉회심'] },
    { when:c => c.base.crit < 0 && !c.tripleCrit, skills:['간파','약점 특효','슈퍼회심','회심격【속성】'] },
    { when:c => c.style !== '블래스트 대시', skills:['기습 상태 이상'] },
    { when:c => !c.critAllowed, skills:['간파','약점 특효','슈퍼회심','회심격【속성】','흉회심'] },
  ],
  // 점수 밖 운용 스킬 (A0 운용 수준). 강화 지속은 스킬 설명의 무기군으로 판정한다.
  operation: ['반사','가드 성능','집중','회피 장전','절대 회피【SP】','특수 게이지 가속','특수 게이지 가속【저스트 회피】'],
};
/* 무기 특성: docs/WEAPONS.md 표와 1:1 (tools/auto-build-rules-test.js가 대조). [기본, 스타일1, 스타일2]마다 [있음, 없음]. */
const AB_TRAITS = {
  'shield-sword': [['가드 · 공중 · 저스트 회피 · 연속 타격 · 가드·카운터 보유','—'],['연속 타격 · 가드·카운터 보유','—'],['가드 · 가드·카운터 보유','연속 타격']],
  'great-sword': [['모으기 · 태클','연속 타격 · 가드·카운터 보유'],['모으기 · 가드·카운터 보유','가드 · 태클 · 연속 타격'],['모으기 · 가드 · 가드·카운터 보유','연속 타격']],
  'long-sword': [['강화 상태 · 연속 타격 · 후방 · 가드·카운터 보유','—'],['강화 상태 · 후방 · 가드·카운터 보유','연속 타격'],['강화 상태 · 연속 타격 · 후방 · 가드·카운터 보유','—']],
  'dual-blades': [['강화 상태 · 연속 타격 · 후방','—'],['강화 상태 · 연속 타격 · 후방','—'],['강화 상태 · 연속 타격 · 후방','—']],
  hammer: [['모으기','연속 타격'],['모으기 · 카운터 · 가드·카운터 보유','—'],['모으기','연속 타격']],
  'hunting-horn': [['강화 상태 · 연속 타격','—'],['강화 상태','연속 타격'],['강화 상태 · 연속 타격','—']],
  lance: [['가드 · 카운터 · 강화 상태 · 가드·카운터 보유','연속 타격'],['가드 · 강화 상태 · 가드·카운터 보유','연속 타격'],['가드 · 강화 상태 · 가드·카운터 보유','연속 타격']],
  gunlance: [['포격·병 · 강화 상태 · 가드·카운터 보유','연속 타격'],['포격·병 · 강화 상태 · 후방 · 가드·카운터 보유','연속 타격'],['포격·병 · 강화 상태 · 가드·카운터 보유','연속 타격']],
  'switch-axe': [['변형 · 강화 상태','—'],['변형 · 강화 상태','—'],['카운터 · 강화 상태 · 가드·카운터 보유','변형 · 연속 타격']],
  'charge-blade': [['포격·병 · 강화 상태 · 가드·카운터 보유','변형 · 연속 타격'],['변형 · 공중 · 포격·병 · 강화 상태 · 가드·카운터 보유','연속 타격'],['포격·병 · 강화 상태 · 가드·카운터 보유','변형']],
  'insect-glaive': [['강화 상태 · 연속 타격','—'],['강화 상태 · 연속 타격','—'],['강화 상태','—']],
  'light-gun': [['탄·화살','연속 타격'],['탄·화살','연속 타격'],['탄·화살','연속 타격']],
  'heavy-gun': [['탄·화살','연속 타격'],['탄·화살 · 가드 · 가드·카운터 보유','연속 타격'],['탄·화살','연속 타격']],
  bow: [['모으기 · 탄·화살','연속 타격'],['탄·화살 · 회피 · 연속 타격','모으기'],['모으기 · 탄·화살','연속 타격']],
};
/* 조건부 스킬의 기본 가정: docs/SKILLS.md 기본 가정 칸과 1:1 (테스트 대조).
   monster=ON(사용자가 칩으로 끔) · off=OFF · candidate·sp=직접 넣거나 칩으로 켤 때만 (sp는 SP 게이지·특수 스킬이 트리거인 버프) ·
   actions=무기 특성에 그 동작(' · '로 여러 개면 하나라도)이 있을 때만 ON (미확인·없음은 OFF, 운용 규칙에 적힌 스킬은 ON) · linked=연계 스킬이 빌드에 있을 때만 ON ·
   exclusive=앞 스킬이 발동하면 뒤 스킬 OFF. */
const AB_ASSUME = {
  monster: ['완전 충전','용맹','무심','추격','약점 특효'],
  off: ['그룹 사냥 강화【공격】','불굴','재난대처능력'],
  candidate: ['앙심','힘의 해방'],
  sp: ['속성 공격 증강【SP】','투기 활성'],
  actions: { '공격적인 방어':'가드', '저스트 모으기 해방':'모으기', '차지 마스터':'모으기', '변형 공격 강화':'변형', '비연':'공중',
    '저스트 교격【지속】':'저스트 회피', '적정 거리 위력 UP':'탄·화살', '차지 스톡':'모으기', '연격':'연속 타격', '기습':'후방', '불퇴전':'가드·카운터 보유' },
  // 무기 특성에 이 동작이 있으면 OFF (매진의 앞회피는 불퇴전을 끈다).
  blockedBy: { '매진':'가드·카운터 보유' },
  // 컨트롤에 따라 유지가 갈리는 무기 동작 스킬: 켜지는 무기에서는 고수 기준으로 켠 채 시작하고, 발동 가정 칩으로 끌 수 있다.
  control: ['연격','기습','불퇴전'],
  linked: { skills:['돌파구','전화위복'], by:['거품의 춤','견인불발','겁혈 망토','귀화 망토'] },
  exclusive: [['과감','저스트 교격'],['과감','저스트 교격【지속】'],['멸진룡의 갈망','투기 활성'],['멸진룡의 갈망','속성 공격 증강【SP】'],
    ['매진','불퇴전']], // 매진은 앞회피로 발동해 불퇴전(회피하면 꺼짐)을 끈다
};
// 회심 관련 무기 스킬 (CONCEPTS W1, 2026-10-18 사용자).
const AB_CRIT_WEAPON_SKILLS = ['간파','약점 특효','슈퍼회심','회심격【속성】','힘의 해방'];
const abTraitList = cell => cell === '—' ? [] : cell.split(' · ');
function abTrait(b, code) {
  const [has, no] = AB_TRAITS[b.wt]?.[b.st || 0] || ['—','—'];
  return abTraitList(has).includes(code) ? 'yes' : abTraitList(no).includes(code) ? 'no' : null;
}
/* 방향 핵심의 공격력 버프 순서. 연격은 무기 특성 '연속 타격'이 있을 때만 쓰고, 없으면 가드 무기는 공격적인 방어,
   그 외는 공격 활성·용맹을 쓴다 (SKILLS.md 연격·공격 활성·용맹, 2026-10-18 사용자). */
const abAttackBuffs = b => abTrait(b, '연속 타격') === 'yes' ? ['연격','용맹','공격 활성']
  : [...(abAssumed('공격적인 방어', b) ? ['공격적인 방어'] : []), '공격 활성', '용맹'];
// 앙심 자동 후보: 대검 기본·격앙참의 태클·가드태클 칩 대미지, 무속성 무기 (SKILLS.md 앙심 메모).
const abAutoCandidate = (s, b) => s === '앙심' && b.wt === 'great-sword' && b.st !== 1 && !abElementSkill(b);
/* 이 빌드에서 조건부 스킬을 켠 것으로 볼지. fill=자동 보충 후보 판정(연계 스킬은 빌드가 정해지기 전이라 허용). */
function abAssumed(s, b, { fill = false, lv = null, row = abStyleRow(b) } = {}) {
  const a = b._abAssume || {}, ruled = [...(row?.required || []), ...(row?.recommended || [])].some(t => t.s === s);
  if (abSP(s) || a.off?.includes(s)) return false;
  if (a.on?.includes(s)) return true;
  if (AB_ASSUME.off.includes(s) || row?.avoid.includes(s)) return false;
  if (AB_ASSUME.blockedBy[s] && abTrait(b, AB_ASSUME.blockedBy[s]) === 'yes') return false;
  if (AB_ASSUME.sp.includes(s)) return false;
  if (AB_ASSUME.candidate.includes(s)) return abAutoCandidate(s, b);
  if (AB_ASSUME.linked.skills.includes(s)) {
    if (fill) return true;
    const levels = lv || new Map(bdTotals(b));
    return AB_ASSUME.linked.by.some(x => levels.get(x) > 0);
  }
  const code = AB_ASSUME.actions[s];
  return !code || ruled || abTraitList(code).some(x => abTrait(b, x) === 'yes');
}
function abStyleRow(b) {
  const style = bdStylesOf(b.wt)[b.st - 1] || '', elemental = () => !!(abElementSkill(b) || bdBuildupApplies(bdWeaponOf(b)));
  const rows = AB_RULES.styles.filter(r => r.wt === b.wt && [].concat(r.style).includes(style)
    && (!r.when || (r.when === 'element') === elemental()));
  return rows.find(r => r.mode && r.mode === b.snsMode) || rows.find(r => !r.mode) || null;
}
function abStyleRule(b) {
  const r = abStyleRow(b), style = bdStylesOf(b.wt)[b.st - 1];
  if (!r) return null;
  const targets = list => list.map(t => abT(t.s, t.min, t.max === 'MAX' ? abMax(t.s) : t.max));
  return { id:r.id, name:r.name.replace('{style}', style || '기본'),
    required:targets(r.required), recommended:targets(r.recommended), avoid:[...r.avoid], desc:r.desc };
}
const abSustains = b => { const type = BUILD.weaponTypes.find(t => t.k === b.wt)?.n; return !!(type && bdSkillDesc('강화 지속',1)?.includes(type)); };
/* W7: 단일 버프 분류는 선별 순위만 결정한다. 복합/회심 효과는 별도 실효 비교. */
function abBuffTier(effects) {
  const types = effects.map(e => ['dmg','atk','ele'].includes(e.k) && !e.onCrit && !e.perBaseCrit && !e.hpx
    ? (e.pct ? 0 : 4) + (e.k === 'dmg' ? 1 : 3) + (e.cond ? 1 : 0) : 9);
  return types.length && types.every(t=>t===types[0]) ? types[0] : 9;
}
const abEquipmentSkills = () => [...new Set(bdOrderedSets().flatMap(s => Object.values(s.pieces).flatMap(p => p.skills.map(x => x.s))))];
function abSupportSkills(b, setting) {
  const c = abContext(b,setting), row = abStyleRow(b);
  // 수치는 후보 선별용 상대 효율일 뿐 최종 피해 점수에 가산하지 않는다.
  // 방어구 스킬과 연성 전용 스킬(불퇴전 등)을 같은 기준으로 비교한다. 레벨은 강제하지 않고 칸마다 점수로 채운다.
  return [...new Set([...abEquipmentSkills(), ...abStonePool().keys()])].filter(s => abAssumed(s, b, { fill:true, row })
    && (s !== '상태 이상 축적 시 위력 UP' || bdBuildupApplies(c.w))).map(s => {
    const weapon = abGunWeapon(b,setting), effects = bdEffects(bdSkillDesc(s, abMax(s)) || '', s, weapon);
    const value = effects.reduce((n, e) => {
      if (e.el && e.el !== c.w?.e) return n;
      if (e.k === 'ele' && !c.element) return n;
      if (abGun(b) && !['통상','산탄','관통','참렬'].includes(bdAmmoFamily(weapon.x?.[0]))
        && (['crit','critx','negcritx'].includes(e.k) || e.onCrit)) return n;
      if (e.k === 'critx') return n + Math.max(0, c.base.crit) / 100 * Math.max(0, e.v - 125) / 100;
      if (e.k === 'crit') return n + Math.max(0, e.v) / 100 * .25;
      if (e.k === 'atk' || e.k === 'ele') return n + (e.perBaseCrit ? e.v * Math.max(0, c.base.crit)
        : e.pct ? (e.k === 'atk' ? c.base.atk : c.base.ele) * e.v / 100 : e.v || 0) / Math.max(1, c.base.atk + (c.element ? c.base.ele : 0));
      return n + (e.k === 'dmg' ? e.v / 100 : 0);
    }, 0);
    return { s, value, tier:abBuffTier(effects) };
  }).filter(x => x.value > 0).sort((a, b) => a.tier-b.tier || b.value-a.value).map(x => x.s);
}
function abContext(b, setting) {
  const w = bdWeaponOf(b), base = bdWeaponBase(b), info = bdStyleInfo(b);
  const tripleCrit = info.active && info.params.every(p => p?.stat === 'crit');
  // 회심 세팅 의지 (CONCEPTS W1): 스타일강화 무기는 회심 파라미터 3개, 미적용 무기는 기본 회심 30% 이상 또는 20% 이상 + 회심 관련 무기 스킬.
  const critIntent = info.active ? tripleCrit
    : base.crit >= 30 || base.crit >= 20 && bdBuildWSkills(b).some(x => AB_CRIT_WEAPON_SKILLS.includes(x.s));
  return { w, base, element: abElementSkill(b), tripleCrit, critIntent, morph: abTrait(b, '변형') === 'yes',
    nativeNegative: (w?.crit || 0) < 0,
    critAllowed: !abGun(b) || ['통상','산탄','관통','참렬'].includes(bdAmmoFamily(abGunWeapon(b,setting).x?.[0])),
    style: bdStylesOf(b.wt)[b.st - 1],
    status: Object.keys(BD_STATUS_BOOST).find(s => bdStatusBoostApplies(s, w)) };
}
function abInvestmentDirections(b, setting) {
  const c = abContext(b,setting), directions = [], atk = abAttackBuffs(b);
  const pick = (...used) => atk.find(s => !used.includes(s));
  const make = (id, name, skills, desc, extra = {}) => ({ id, name,
    targets: abTargets(skills).map((t, i) => ({ ...t, min: abOperationRule(b,setting)?.required.length && i > 0 ? 0 : t.min })), desc, ...extra });
  if (c.critAllowed && c.nativeNegative && c.base.crit < 0 && !c.tripleCrit) {
    // 돌파구는 자체 상태이상 스킬이 있을 때만 쓰므로 방향 핵심에 두지 않는다 (SKILLS.md 돌파구).
    const second = c.status || c.element || atk[0], third = pick(second);
    const low = make('brutal-low', '흉회심 · 저투자', ['흉회심', second, third],
      '흉회심 1의 손실 보완과 미채용 대안을 비교하고 다른 피해 스킬에 투자합니다. 전심전력은 필수로 묶지 않습니다.');
    low.targets[0] = { s: '흉회심', min: 0, max: 1 };
    const high = [3, 5].map(lv => {
      const d = make('brutal-' + lv, `흉회심 · Lv${lv}${lv === 5 ? ' 고점' : ' 균형'}`,
        ['흉회심', second, third],
        `흉회심을 미채용부터 ${lv}까지 비교합니다. ${b.wt === 'great-sword' ? '대검의 한방 고점 선호를 반영하되 평균 점수에 보너스를 더하지 않습니다.' : '다른 피해 스킬과 평균 기대값을 비교합니다.'}`);
      d.targets[0] = { s: '흉회심', min: 0, max: lv }; return d;
    });
    return b.wt === 'great-sword' && c.style !== '수류베기' ? [high[1], high[0], low] : [low, ...high];
  }
  if (c.status) {
    const status = BD_STATUS_BOOST[c.status], elder = { 독: '하룡의 독 안개', 폭파: '염왕룡의 폭발가루' }[status];
    const skills = [c.status, elder || '상태 이상 축적 시 위력 UP', elder ? '상태 이상 축적 시 위력 UP' : atk[0]];
    const main = make('status', `${status} · 추가 공격 중심`, skills,
      '추가 공격 Lv5를 목표로 축적 확률·피해 스킬을 조합합니다. 내성·발동 횟수·유지율은 아직 점수에 모델링하지 않습니다.');
    directions.push(main);
    if (b.wt === 'gunlance' && c.style === '블래스트 대시') directions.push(make('status-rear', `${status} · 후방 축적`,
      [c.status, '기습 상태 이상', '상태 이상 축적 시 위력 UP'], '블래스트 대시로 후방을 잡는 운용을 가정합니다. 후방 유지율은 미확정입니다.'));
    return directions;
  }
  const offense = c.element || atk[0];
  const mastery = c.element && abEquipmentSkills().find(s => s === c.element + '·경지');
  const elder = c.element && [...BD_ELE_MUL].find(s => bdEffects(bdSkillDesc(s, 1) || '', s, c.w).some(e => e.el === c.w.e && e.k === 'ele'));
  const plain = make('water', c.element ? `${c.w.e}속성${mastery ? ' · 경지' : ''} 중심` : '물리 · 피해 효율',
    [offense, mastery || (c.element ? elder || atk[0] : pick(offense)), mastery ? elder || atk[0] : c.element ? pick(atk[0]) : null].filter(Boolean),
    c.nativeNegative && c.tripleCrit ? '회심 파라미터 3개의 역회심 보정 의도를 반영해 흉회심 방향을 제외합니다.' : '회심 확보 비용을 강제하지 않고 속성·피해 스킬의 투자 효율을 비교합니다.');
  if (c.critAllowed && c.critIntent) {
    directions.push(make('critical', c.element ? '회심격 · 자체 회심 활용' : '자체 회심 · 투자 비교',
      [c.element ? '회심격【속성】' : offense, '간파', c.element ? offense : pick(offense)],
      '파라미터 포함 무기 자체 회심을 활용할 투자안을 비교합니다. 특정 회심률을 강제하지 않으며 슈퍼회심도 필수가 아닙니다.'));
    if (c.tripleCrit) directions.push(make('crit-attack', '무기 회심 · 공격 증강',
      ['공격 증강【회심】', offense, atk[0]].filter((s, i, a) => a.indexOf(s) === i).concat(c.element ? [] : [pick(offense)]),
      `무기 자체 회심 ${c.base.crit}%에 대한 공격 증가를 비교합니다. 장비 강제 착용이나 추가 점수 보너스는 없습니다.`, { prefer: ['공격 증강【회심】'] }));
  }
  if (c.tripleCrit && !c.nativeNegative) directions.push(plain); else directions.unshift(plain);
  // 변형 공격 강화 중심 무기는 파라미터와 상관없이 변형 회심 방향을 첫 추천으로 두고, 일반 회심 방향을 대체한다.
  // 변형 회심 80%와 무기 회심으로 100%에 모자란 만큼 약점 특효 레벨을 핵심에 넣는다 (CONCEPTS W1).
  if (c.morph && c.critAllowed) {
    const need = 100 - c.base.crit - (bdEffects(bdSkillDesc('변형 공격 강화', abMax('변형 공격 강화')) || '', '변형 공격 강화', c.w).find(e => e.k === 'crit')?.v || 0);
    const rows = bdSkillLevels('약점 특효') || [], value = r => +(/(\d+)%/.exec(r[1])?.[1] || 0);
    const weak = need > 0 ? (rows.find(r => value(r) >= need) || rows.at(-1))?.[0] : 0;
    const d = make('morph-critical', '변형 공격 · 회심 활용',
      ['변형 공격 강화', ...(weak ? ['약점 특효'] : []), c.element ? '회심격【속성】' : '슈퍼회심', c.element ? '슈퍼회심' : offense],
      `변형 공격의 회심 80%를 활용합니다.${weak ? ` 회심 100%까지 모자란 ${need}%는 약점 특효 Lv${weak}로 보충합니다.` : ''} 해당 공격의 발동 가정이며 전체 공격의 상시 효과는 아닙니다.`);
    if (weak) d.targets[1].max = weak;
    directions.splice(0, directions.length, d, ...directions.filter(x => x.id !== 'critical'));
  }
  return directions.slice(0, 3);
}

function abDirections(b, setting) {
  const c = abContext(b,setting), dirs = abInvestmentDirections(b,setting), rule = abOperationRule(b,setting);
  const fixed = dirs.find(d=>d.id==='water');
  if (c.element && fixed) {
    // 경지는 기본5가 필요하므로 선택 투자로 시작. 실제 확보와 비용은 후보 점수/연성에서 비교한다.
    fixed.targets.filter(t=>/경지/.test(t.s)).forEach(t=>t.min=0);
    const elder = [...BD_ELE_MUL].find(s=>bdEffects(bdSkillDesc(s,abMax(s)) || '',s,c.w).some(e=>e.el===c.w.e));
    if (elder) {
      const flat = bdEffects(bdSkillDesc(c.element,abMax(c.element)) || '',c.element,c.w).find(e=>e.k==='ele'&&!e.pct)?.v || 0;
      const pct = bdEffects(bdSkillDesc(elder,abMax(elder)) || '',elder,c.w).find(e=>e.k==='ele'&&e.pct&&e.el===c.w.e)?.v || 0;
      const high = c.base.ele*pct/100/abMax(elder) > flat/abMax(c.element);
      const d = {id:'elder',name:c.w.e+'속성 · 고룡/혼합 투자',targets:abTargets([elder,c.element,abAttackBuffs(b)[0]]),
        desc:'고룡 속성%와 고정 속성·경지의 추가 장비/연성 비용을 함께 비교합니다. 고룡3·속성5를 강제하지 않습니다.'};
      d.targets[1].min=0; d.targets[2].min=0;
      if (dirs.length < 3) dirs.splice(high ? dirs.indexOf(fixed) : dirs.indexOf(fixed)+1,0,d);
      else if (high) { fixed.name=d.name; fixed.targets=d.targets; fixed.desc=d.desc; }
    }
  }
  const row=abStyleRow(b), core=row?.coreSlot!=null && abStyleRule(b).recommended[0];
  return dirs.map(d=>{
    const out={...d,targets:d.targets.map(t=>({...t})),desc:d.desc+(rule ? ' '+rule.desc : '')};
    if (row?.label) out.name=row.label+' · '+d.name;
    // 핵심이 세 칸보다 적으면 끼워 넣고, 다 찼으면 그 칸을 바꾼다.
    if (core && !out.targets.some(t=>t.s===core.s)) out.targets.splice(row.coreSlot,out.targets.length<3?0:1,{...core});
    return out;
  });
}

function abSyncDirection() {
  if (abState.direction === 'manual') return;
  // 사용자가 고친 제안은 덮어쓰지 않고 새 제안이 있음만 알린다.
  if (abState.edited) { abState.stale = true; return; }
  abApplyDirection(abDirections(abState.b,abState.gun)[0]?.id || 'manual');
}

function abChangeWeapon(field, value) {
  const s = abState;
  if (field === 'wt') {
    s.b.wt = value; s.lockon = abMelee(value);
    if (!bdWeaponOf(s.b)) s.b.w = abMonsters(value)[0]?.key || null;
  } else s.b.w = value;
  s.b.st = 0; s.b.style20 = false; s.b.params = [null, null, null];
  delete s.b.snsMode; delete s.b.ammoSlot;
  s.gun = {mode:'cycle'};
  if (!s.edited) abApplyDirection(abDirections(s.b)[0]?.id || 'manual'); else if (s.direction !== 'manual') s.stale = true;
}

function abApplyDirection(id) {
  const d = abDirections(abState.b,abState.gun).find(d => d.id === id);
  Object.assign(abState, { direction:d ? id : 'manual', edited:false, stale:false, chip:null, adding:null, styleOff:[],
    targets:d ? structuredClone(d.targets) : [] });
}

function abScoreBuild(b) {
  const conds = bdStats(b).conds, lv = new Map(bdTotals(b)), row = abStyleRow(b);
  b.cond = Object.fromEntries(conds.map(c => [c.sk, abAssumed(c.sk, b, { lv, row })]));
  for (const s of Object.keys(BD_AMMO_BOOST)) if (s in b.cond && !bdAmmoBoostApplies(s,abGunWeapon(b))) b.cond[s] = false;
  // 앞 스킬이 발동 중이면(조건부는 켠 것, 상시는 장착) 뒤 스킬은 끈다.
  for (const [on, off] of [...(AB_RULES.weapons[b.wt]?.exclusive || []), ...AB_ASSUME.exclusive])
    if (off in b.cond && (on in b.cond ? b.cond[on] : lv.get(on) > 0)) b.cond[off] = false;
  b.bowEfficiency = false; // 집중 주기 보정은 추천 시 사용자가 지정하지 않은 가정이다.
  return bdStats(b).score;
}

function abPolicy(b, direction, targets, styleGuide = true, setting) {
  const c = abContext(b,setting), meta = abDirections(b,setting).find(d => d.id === direction) || {};
  const excluded = (b._abExclude || []).map(x => x.s), style = abOperationRule(b,setting,styleGuide);
  const explicit = new Set(targets.map(t => t.s));
  const skip = new Set(style?.avoid || []);
  for (const x of AB_RULES.avoid) if (x.when(c)) x.skills.forEach(s => skip.add(s));
  // 슈퍼회심은 회심이 높게 보장될 때만 자동 보충한다 (CONCEPTS W1: 변형 회심 방향, 힘의 해방).
  if (direction !== 'morph-critical' && !explicit.has('힘의 해방') && !b._abAssume?.on?.includes('힘의 해방')) skip.add('슈퍼회심');
  // 사용자가 직접 선택한 스킬은 우선한다. 비권장은 장비 자체의 금지가 아니다. 사용자 제외는 항상 제외.
  explicit.forEach(s => skip.delete(s));
  excluded.forEach(s => skip.add(s));
  const investmentSkills = c.element ? [c.element,c.element+'·경지',...BD_ELE_MUL].filter(s=>
    bdEffects(bdSkillDesc(s,abMax(s)) || '',s,c.w).some(e=>e.k==='ele'&&(!e.el||e.el===c.w.e))) : [];
  const contextSkills = [c.status, c.element, ...(c.base.crit > 0 ? ['공격 증강【회심】'] : []),
    ...(['critical','morph-critical'].includes(direction) ? ['간파','약점 특효'] : []), '진가 발휘', ...abAttackBuffs(b),
    ...[...AB_ASSUME.candidate, ...AB_ASSUME.sp].filter(s => abAssumed(s, b, { fill:true }))].filter(Boolean);
  const support = abSupportSkills(b,setting).filter(s => !skip.has(s));
  const styleTargets = [...(style?.required || []), ...(style?.recommended || [])].filter(t => !excluded.includes(t.s));
  const fillers = [...new Set([...explicit, ...styleTargets.map(t => t.s), ...contextSkills, ...investmentSkills, ...support.slice(0, 12), '전심전력'])]
    .filter(s => !skip.has(s) && !abSP(s) && (explicit.has(s) || abAssumed(s, b, { fill:true }))
      && (!BD_STATUS_BOOST[s] || bdStatusBoostApplies(s, c.w))
      && (!BD_SKILL_WEAPONS[s] || BD_SKILL_WEAPONS[s].includes(b.wt))
      && (!BD_AMMO_BOOST[s] || bdAmmoBoostApplies(s, abGunWeapon(b,setting))));
  return { ...meta, style, styleTargets, investmentSkills:investmentSkills.filter(s => !excluded.includes(s)), avoid: [...skip],
    lowPriority: c.base.crit < 0 ? ['전심전력'] : [], fillers,
    prefer: [...new Set([...(meta.prefer || []), ...styleTargets.map(t => t.s), ...contextSkills,
      ...support.filter(s => BD_ELE_MUL.has(s) || /경지/.test(s)).slice(0, 4)])].filter(s => !excluded.includes(s)) };
}

const AB_EXCLUDE_MAX = 3;
function abValidate(targets, exclude = [], b) {
  if (targets.some(t => !t.s)) return '스킬을 선택해 주세요.';
  if (new Set(targets.map(t => t.s)).size !== targets.length) return '핵심 스킬은 중복 없이 선택해 주세요.';
  if (targets.some(t => !abSkills().includes(t.s) || t.min < 0 || t.max < 1 || t.max > abMax(t.s) || t.min > t.max)) return '허용 레벨 범위를 확인해 주세요.';
  return abExcludeError(exclude, targets, b);
}
/* 사용자 제외 충돌: 최대 개수, 필수·투자·선행 조건과 겹침, 무기 기본 스킬. */
function abExcludeError(exclude, required, b) {
  if (exclude.length > AB_EXCLUDE_MAX) return `제외 스킬은 최대 ${AB_EXCLUDE_MAX}개입니다.`;
  const hit = exclude.find(x => required.some(t => t.s === x.s));
  if (hit) return `${hit.s}: 필수·투자 스킬과 겹쳐 제외할 수 없습니다.`;
  const weapon = b && exclude.find(x => bdBuildWSkills(b).some(w => w.s === x.s));
  if (weapon) return `${weapon.s}: 무기 기본 스킬이라 제외할 수 없습니다.`;
  return '';
}

const abSignature = b => BD_PARTS().map(p => b[p.k]).join('|');
const abArmorCompare = (a, b) => {
  for (let i = 0; i < 4; i++) if (a?.[i] !== b?.[i]) return (b?.[i] || 0) - (a?.[i] || 0);
  return 0;
};
/* 선별 평가만 사용. 대체 불가 레벨 → 한 부위 집중 → 유효 레벨 합 → 적은 연성 비용. */
/* 이 빌드에서 쓸모 있는 스킬: 핵심·운용 규칙·보충 후보·점수 밖 운용 스킬. 비권장·꺼진 스킬은 제외. */
function abUsefulSkills(seed, targets, policy) {
  const useful = new Set([...targets, ...policy.styleTargets, ...(policy.operation || [])].map(t => t.s)
    .concat(policy.fillers, abSupportSkills(seed)).filter(s => !policy.avoid.includes(s)));
  if (abSustains(seed)) useful.add('강화 지속');
  return useful;
}
function abArmorEvaluator(seed, targets, policy, stones) {
  const explicit = new Set([...targets, ...policy.styleTargets].map(t => t.s));
  const useful = abUsefulSkills(seed, targets, policy);
  const weaponLevels = new Map();
  for (const x of bdBuildWSkills(seed)) weaponLevels.set(x.s,(weaponLevels.get(x.s)||0)+x.lv);
  const caps = new Map([...useful].map(s => [s, Math.max(0,([...targets,...policy.styleTargets].find(t => t.s === s)?.max ?? abMax(s))-(weaponLevels.get(s)||0))]));
  return b => {
    const levels = new Map(), highest = new Map();
    for (const {k} of BD_PARTS()) for (const x of bdSet(b[k])?.pieces[k]?.skills || []) if (useful.has(x.s)) {
      levels.set(x.s, (levels.get(x.s) || 0) + x.lv);
      highest.set(x.s, Math.max(highest.get(x.s) || 0, x.lv));
    }
    let fixed = 0, concentrated = 0, total = 0, cost = 0;
    for (const [s,n] of levels) {
      const lv = Math.min(caps.get(s),n); total += lv;
      if (!stones.has(s)) fixed += lv;
      else concentrated += Math.min(caps.get(s),highest.get(s)) ** 2;
    }
    for (const t of targets) if (stones.has(t.s)) cost += Math.max(0,t.max-(weaponLevels.get(t.s)||0)-(levels.get(t.s)||0));
    return [fixed,concentrated,total,-cost];
  };
}
/* 결과: 서로 다른 방어구 조합 count개를 각 조합의 최고 ON 점수순으로. 기준별 1위(배지)의 조합은 반드시 포함하고,
   같은 방어구에 연성만 다른 대안은 variants(최대 AB_VARIANTS)로 묶는다. A0: 점수 하나로만 고르지 않는다. */
const AB_VARIANTS = 3;
function abBest(pool, count = 5) {
  const byScore = (a,b) => b.score-a.score || b.baseScore-a.baseScore || a.drifts-b.drifts || abCandidateKey(a.b).localeCompare(abCandidateKey(b.b));
  const sorted = abFrontier(pool).sort(byScore), badges = new Map();
  const award = (name, cmp, value) => {
    if (!sorted.length || (name !== '공격 고점' && new Set(sorted.map(value)).size < 2)) return; // 모두 같으면 배지 없음
    const r = [...sorted].sort((a,b) => cmp(a,b) || byScore(a,b))[0];
    badges.set(r, [...(badges.get(r) || []), name]);
  };
  award('공격 고점', byScore, r => r.score);
  award('조건 OFF 최고', (a,b) => b.baseScore-a.baseScore, r => r.baseScore);
  (sorted[0]?.operationNames || []).forEach((s,i) => award(`${s} 최고`, (a,b) => b.operation[i]-a.operation[i], r => r.operation[i]));
  award('연성 최소', (a,b) => a.drifts-b.drifts, r => r.drifts);
  const groups = new Map();
  for (const r of sorted) { const k = abSignature(r.b); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const keys = [...new Set([...[...badges.keys()].map(r => abSignature(r.b)), ...groups.keys()])].slice(0, count);
  return keys.map(k => groups.get(k)).sort((a,b) => byScore(a[0],b[0])).map(rows => {
    const variants = [];
    for (const r of [rows[0], ...rows.filter(r => badges.has(r)), ...rows])
      if (variants.length < AB_VARIANTS && !variants.some(v => v === r || v.profile === r.profile)) variants.push(r);
    const tagged = variants.map((r,i) => ({ ...r, badges:badges.get(r) || [], role:badges.get(r)?.[0] || (i ? '대안' : '최고 점수') }));
    return { ...tagged[0], variants:tagged, badges:tagged.flatMap(v => v.badges) };
  });
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
      if(score>best){best=score;skill=s;}
    }
    b.ds[slot.k][slot.i] = null;
    if (skill) put(take(skill), skill); else slots.shift();
  }
  abScoreBuild(b);
  return b;
}

/* A0: 점수/운용/연성 비용을 섞지 않고, 실제 교체·보완 결과로 비교한다. */
function abResolvePolicy(seed, targets, policy) {
  const operation = new Map(), sourceRule=AB_RULES.weapons[seed.wt]?.source||'공통 운용 지침';
  for (const t of [...policy.styleTargets,...targets]) if (AB_RULES.operation.includes(t.s) && !policy.avoid.includes(t.s))
    operation.set(t.s,{...t,sourceRule});
  if(abSustains(seed)) operation.set('강화 지속',{s:'강화 지속',max:abMax('강화 지속'),sourceRule:'W6'});
  return {...policy,operation:[...operation.values()],sourceRule:'A0/W1–W8',ruleVersion:'20261014b'};
}
const abCandidateKey = b => abSignature(b)+'|'+JSON.stringify(BD_PARTS().map(p=>b.ds[p.k]));
function abEvaluateCandidate(b, targets, policy) {
  const lv=new Map(bdTotals(b));
  if (!targets.every(t=>(lv.get(t.s)||0)>=t.min)) return null;
  const stones=abStonePool();
  if (BD_PARTS().some(p=>(b.ds[p.k]||[]).some((d,i)=>d && (i>=bdSlotCount(b,p.k)||!stones.has(d.s))))) return null;
  const score=abScoreBuild(b), off={...b,cond:{}};
  return {b,score,baseScore:bdStats(off).score,levels:targets.filter(t=>t.user).map(t=>Math.min(t.max,lv.get(t.s)||0)),
    operation:policy.operation.map(t=>Math.min(t.max,lv.get(t.s)||0)),operationNames:policy.operation.map(t=>t.s),
    drifts:bdStoneList(b).length,profile:[...lv].map(([s,l])=>s+':'+Math.min(abMax(s),l)).sort().join('|'),
    support:[...lv].filter(([s])=>!targets.some(t=>t.user&&t.s===s)&&policy.fillers.includes(s)),
    policyKey:JSON.stringify([policy.ruleVersion,b.w,b.wt,b.st,b.style20,b.params,b._abGun,b.snsMode,targets,policy.operation])};
}
function abDominates(a,b) {
  if(a.policyKey!==b.policyKey) return false;
  return a.score>=b.score && a.baseScore>=b.baseScore && a.drifts<=b.drifts
    && a.operation.every((v,i)=>v>=b.operation[i])
    && (a.score>b.score||a.baseScore>b.baseScore||a.drifts<b.drifts||a.operation.some((v,i)=>v>b.operation[i]));
}
function abFrontier(pool) {
  const same=new Map();
  for(const r of pool) {
    const key=[r.policyKey,r.score,r.baseScore,r.drifts,...r.operation].join('|'), prev=same.get(key);
    if(!prev || abCandidateKey(r.b)<abCandidateKey(prev.b)) same.set(key,r);
  }
  const front=[];
  for(const r of [...same.values()].sort((a,b)=>b.score-a.score||b.baseScore-a.baseScore)) {
    if(front.some(x=>abDominates(x,r))) continue;
    for(let i=front.length-1;i>=0;i--) if(abDominates(r,front[i])) front.splice(i,1);
    front.push(r);
  }
  return front;
}
function abSelectRepresentatives(pool,order,count) {
  const sorted=[...pool].sort((a,b)=>b.score-a.score||b.baseScore-a.baseScore||a.drifts-b.drifts||abCandidateKey(a.b).localeCompare(abCandidateKey(b.b)));
  if(order==='score') {
    const seen=new Set(); return sorted.filter(r=>!seen.has(abSignature(r.b))&&seen.add(abSignature(r.b))).slice(0,count).map(r=>({...r,role:'발동 점수순'}));
  }
  const front=abFrontier(pool), chosen=[], seen=new Set();
  const add=(r,role)=>{if(r&&!seen.has(r.profile)&&chosen.length<count){seen.add(r.profile);chosen.push({...r,role});}};
  const best=fn=>[...front].sort(fn)[0];
  add(best((a,b)=>b.score-a.score||b.baseScore-a.baseScore),'공격 고점');
  add(best((a,b)=>b.baseScore-a.baseScore||b.score-a.score),'조건 OFF 효율');
  for(let i=0;i<(front[0]?.operation.length||0);i++)
    add(best((a,b)=>b.operation[i]-a.operation[i]||b.score-a.score),`${front[0].operationNames[i]} 보완`);
  add(best((a,b)=>a.drifts-b.drifts||b.score-a.score),'연성 저투자');
  for(const r of sorted) if(front.includes(r)) add(r,'투자 대안');
  return chosen;
}
function abOpportunityEvidence(before,after) {
  return {sourceRule:'A0',beforeKey:abCandidateKey(before.b),afterKey:abCandidateKey(after.b),
    changedParts:BD_PARTS().filter(p=>before.b[p.k]!==after.b[p.k]).map(p=>({part:p.k,from:before.b[p.k],to:after.b[p.k]})),
    scoreDelta:after.score-before.score,baseDelta:after.baseScore-before.baseScore,
    operationDelta:after.operation.map((v,i)=>v-before.operation[i]),driftDelta:after.drifts-before.drifts,
    outcome:abDominates(after,before)?'우세':abDominates(before,after)?'열세':'장단점 대안'};
}
/* 연성 개수 조합을 제한 폭으로 탐색. 필수 복구·0투자·선행조건 묶음을 별도 보존한다. */
function abSearchDriftStates(original,targets,policy,stop,width=8,onEvaluate=()=>true) {
  const b=structuredClone(original), stones=abStonePool(), parts=BD_PARTS();
  for(const p of parts) b.ds[p.k]=Array(bdSlotCount(b,p.k)).fill(null);
  const empty=BD_PARTS().flatMap(p=>Array.from({length:bdSlotCount(b,p.k)},(_,i)=>({k:p.k,i})));
  const levels=new Map(bdTotals(b)), required=[];
  for(const t of targets) {
    const need=Math.max(0,t.min-(levels.get(t.s)||0));
    if(need&&!stones.has(t.s)) return [];
    for(let i=0;i<need;i++) required.push(t.s);
  }
  if(required.length>empty.length) return [];
  const put=(build,s)=> {
    const slots=empty.filter(x=>!build.ds[x.k][x.i]);
    const x=slots.find(x=>bdSet(build[x.k]).pieces[x.k].skills.some(y=>y.s===s))||slots[0];
    if(!x)return false; build.ds[x.k][x.i]={s,c:stones.get(s)};return true;
  };
  required.forEach(s=>put(b,s));
  const evaluate=x=>stop()||!onEvaluate()?null:abEvaluateCandidate(x,targets,policy);
  const base=evaluate(b); if(!base)return [];
  let states=[base], results=[base], signatures=new Set([abCandidateKey(b)]);
  // 경지 등 문턱을 한 번에 넘기는 묶음. 단일 칸의 즉시 이득이 없어도 평가한다.
  for(const s of policy.fillers) for(const e of bdEffects(bdSkillDesc(s,abMax(s))||'',s,bdWeaponOf(b))) if(e.need&&(stones.has(s)||(levels.get(s)||0)>0)) {
    const x=structuredClone(b), lv=new Map(bdTotals(x)); let valid=true;
    for(const [name,n] of [[e.need.s,Math.max(0,e.need.lv-(lv.get(e.need.s)||0))],[s,(lv.get(s)||0)?0:1]]) {
      const cap=targets.find(t=>t.s===name)?.max??abMax(name);
      if(n&&(!stones.has(name)||(lv.get(name)||0)+n>cap))valid=false;
      for(let i=0;valid&&i<n;i++) if(!put(x,name))valid=false;
    }
    if(valid){const r=evaluate(x);if(r){states.push(r);results.push(r);}}
  }
  for(let step=required.length;step<empty.length && !stop();step++) {
    const next=[];
    for(const r of states) for(const s of policy.fillers) {
      if(stop())break;
      const lv=new Map(bdTotals(r.b)), cap=targets.find(t=>t.s===s)?.max??abMax(s);
      if(!stones.has(s)||(lv.get(s)||0)>=cap)continue;
      const x=structuredClone(r.b);if(!put(x,s))continue;
      // 개수 벡터가 같으면 배치 순서가 달라도 한 번만 계산한다.
      const counts=new Map();bdStoneList(x).forEach(d=>counts.set(d.s,(counts.get(d.s)||0)+1));
      const key=abSignature(x)+'|'+JSON.stringify([...counts].sort());if(signatures.has(key))continue;signatures.add(key);
      const n=evaluate(x);if(n){next.push(n);results.push(n);}
    }
    states=abSelectRepresentatives(next,'priority',width);if(!states.length)break;
  }
  return abFrontier(results);
}
async function abRepairBuilds(pool,all,targets,policy,config,started,progress,cancelled) {
  const useful=policy.useful||abUsefulSkills(config?.b||pool[0]?.b,targets,policy);
  const seeds=abSelectRepresentatives(pool,'priority',5), found=[], checked=new Set(), parts=BD_PARTS();
  let evaluated=0, jobs=0, expanded=0, constrained=false;
  const stop=()=>cancelled()||performance.now()-started>=AB_LIMIT.ms||evaluated>=2400;
  const budget=()=>{if(stop())return true;evaluated++;return false;};
  for(const before of seeds) {
    // 초기24개 밖의 장비도 재검토. 공급/핵심/전체 이득 경로를 교대로 작업한다.
    const alternatives=parts.map(p=>{
      // 메인 스킬 활용도 조건: 그 부위에 쓸모 있는 장비가 하나라도 있으면 쓸모 있는 장비끼리만 교체한다.
      const partRows=all.find(x=>x.part===p.k).rows, usefulRow=x=>x.piece.skills.some(s=>useful.has(s.s));
      const rows=(partRows.some(usefulRow) ? partRows.filter(usefulRow) : partRows).filter(x=>x.key!==before.b[p.k]);
      if(rows.length>24)constrained=true;
      const rated=rows.map(x=>({...x,relevance:x.piece.skills.reduce((n,s)=>n+(targets.some(t=>t.s===s.s)?s.lv:0),0),
        score:abScoreBuild({...before.b,[p.k]:x.key,ds:{...before.b.ds,[p.k]:[]}})}))
        .sort((a,b)=>b.score-a.score||b.relevance-a.relevance||a.key.localeCompare(b.key));
      const groups=[rated];
      for(const t of [...targets,...policy.styleTargets,...policy.operation]) {
        const levels=x=>x.piece.skills.find(s=>s.s===t.s)?.lv||0;
        groups.push(rated.filter(x=>levels(x)).sort((a,b)=>levels(b)-levels(a)||b.score-a.score));
      }
      const keep=new Map();
      for(let depth=0;keep.size<rated.length;depth++) for(const group of groups)
        if(group[depth])keep.set(group[depth].key,group[depth]);
      return [...keep.values()];
    });
    const test=async (b,mode='직접 교체')=>{
      if(stop())return;const key=abSignature(b);if(checked.has(key))return;checked.add(key);jobs++;
      let local=0;const jobStop=()=>{if(local>=96)constrained=true;return local>=96||stop();};
      const consume=()=>{if(budget())return false;local++;return true;};
      const candidates=config.drift?abSearchDriftStates(b,targets,policy,jobStop,4,consume):budget()?[]:[abEvaluateCandidate(b,targets,policy)].filter(Boolean);
      for(const after of candidates){after.evidence={...abOpportunityEvidence(before,after),mode};found.push(after);}
      expanded++;if(expanded%4===0){progress({stage:5,phase:'교체·보완',expanded,evaluated});await new Promise(r=>setTimeout(r,0));}
    };
    for(let depth=0;depth<24&&!stop();depth++) for(let pi=0;pi<parts.length&&!stop();pi++) {
      const row=alternatives[pi][depth];if(!row)continue;
      const b={...before.b,[parts[pi].k]:row.key};await test(b);
      // 한 장비를 고정하고 나머지 네 부위를 다시 구성하는 제한 빔 경로.
      if(depth===0&&!stop()) {
        let beam=[b];
        for(let qi=0;qi<parts.length&&!stop();qi++) if(qi!==pi) {
          const choices=alternatives[qi].slice(0,2);
          const lv=new Map(bdTotals({...b,ds:bdNewBuild().ds}));
          for(const t of targets) if((lv.get(t.s)||0)<t.max)
            for(const x of alternatives[qi].filter(x=>x.piece.skills.some(s=>s.s===t.s)).slice(0,1))
              if(!choices.some(y=>y.key===x.key))choices.push(x);
          const next=[];
          for(const node of beam) for(const key of [before.b[parts[qi].k],...choices.map(x=>x.key)]) {
            if(stop())break;
            const x={...node,[parts[qi].k]:key,ds:bdNewBuild().ds}, totals=new Map(bdTotals(x));
            next.push({b:x,score:abScoreBuild(x),deficit:targets.reduce((n,t)=>n+Math.max(0,t.min-(totals.get(t.s)||0)),0)});
          }
          const keep=new Map();
          for(const cmp of [(a,b)=>b.score-a.score,(a,b)=>a.deficit-b.deficit||b.score-a.score])
            for(const x of [...next].sort(cmp).slice(0,4))keep.set(abSignature(x.b),x.b);
          beam=[...keep.values()];
        }
        for(const x of beam) {await test(x,'연계 재구성');if(stop())break;}
      }
      // 필수·권장 부족량 및 선행조건의 공급자를 다른 모든 부위에서 찾는다.
      const lv=new Map(bdTotals({...b,ds:bdNewBuild().ds})), needs=new Set();
      for(const t of [...targets,...policy.styleTargets]) if((lv.get(t.s)||0)<t.max)needs.add(t.s);
      for(const s of policy.fillers) for(const e of bdEffects(bdSkillDesc(s,abMax(s))||'',s,bdWeaponOf(b)))
        if(e.need&&(lv.get(e.need.s)||0)<e.need.lv)needs.add(e.need.s);
      for(let qi=0;qi<parts.length&&!stop();qi++) if(qi!==pi) {
        const suppliers=alternatives[qi].filter(x=>x.piece.skills.some(s=>needs.has(s.s))).slice(0,2);
        for(const x of suppliers){await test({...b,[parts[qi].k]:x.key},'부족분 보완');if(stop())break;}
      }
    }
    if(stop())break;
  }
  return {pool:found,evaluated,jobs,limited:stop()||constrained,expanded};
}

/* 부위 후보 선별용 핵심 순위 가중치. 최종 점수에 더하지 않는다. */
const AB_PRIORITY_WEIGHTS = [100, 20, 4];
const abPriorityWeight = i => AB_PRIORITY_WEIGHTS[i] ?? AB_PRIORITY_WEIGHTS.at(-1) * 0.2 ** (i - AB_PRIORITY_WEIGHTS.length + 1);
async function abSearch(config, progress = () => {}, cancelled = () => false) {
  const started = performance.now(), parts = BD_PARTS(), { targets: userTargets, drift } = config;
  const seed = structuredClone(config.b);
  if (abGun(seed)) {
    const g=abGunInfo(seed,config.gun); seed._abGun=g.settings;
    if (g.compare) seed.ammoSlot=g.compare.i;
  }
  // 사용자 제외: 완전 제외는 그 스킬이 붙은 방어구까지 후보에서 빼고, 겸용 허용은 점수에서 효과만 뺀다.
  const exclude = config.exclude || [], banned = new Set(exclude.filter(x => !x.shared).map(x => x.s));
  if (exclude.length) seed._abExclude = exclude.map(x => ({...x}));
  if (exclude.some(x => x.shared)) seed.ignore = exclude.filter(x => x.shared).map(x => x.s);
  // 발동 가정: 사용자가 직접 넣은 스킬·운용 규칙 스킬은 켜고, 칩으로 끈 가정은 끈다.
  const rule = abOperationRule(seed, config.gun, config.styleGuide ?? true);
  seed._abAssume = { off:[...(config.assumeOff || [])],
    on:[...(config.assumeOn || []), ...userTargets.map(t => t.s), ...[...(rule?.required || []), ...(rule?.recommended || [])].map(t => t.s)] };
  const targets = abSearchTargets(config).map(t=>({...t,user:userTargets.some(x=>x.s===t.s)})), requireLock = !!config.lockon && abMelee(seed.wt);
  const policy = abResolvePolicy(seed,targets,abPolicy(seed, config.direction, userTargets, config.styleGuide ?? true)), stones = abStonePool(), fillers = policy.fillers;
  policy.useful = abUsefulSkills(seed, targets, policy);
  const optional = policy.styleTargets.filter(t => !targets.some(x => x.s === t.s));
  const operation = policy.operation;
  const curves = new Map(targets.map(t => [t.s, abCurve(t.s, seed)]));
  let all = parts.map(({ k }) => bdOrderedSets().filter(s => s.pieces[k] && !s.pieces[k].skills.some(x => banned.has(x.s)))
    .map(s => ({ key: s.key, piece: s.pieces[k] })));
  const registered = all.map((rows,i)=>({part:parts[i].k,rows}));
  const driftOnly = userTargets.map(t => stones.has(t.s) && !all.some(rows => rows.some(r=>r.piece.skills.some(x=>x.s===t.s)))
    && !bdBuildWSkills(seed).some(x=>x.s===t.s));
  const armorOf = abArmorEvaluator(seed,targets,policy,stones);
  const totalsFor = b => new Map(bdTotals(b));
  const optimistic = (b, stage) => {
    const levels = totalsFor(b);
    const slots = drift ? parts.slice(0, stage).reduce((n, p) => n + bdSlotCount(b, p.k), 0)
      + all.slice(stage).reduce((n, rows) => n + Math.max(0, ...rows.map(r => r.piece.slot)), 0) : 0;
    const needs = targets.map(t => ({t,need:Math.max(0,t.min-(levels.get(t.s)||0)-all.slice(stage).reduce((n,rows)=>
      n+Math.max(0,...rows.map(r=>r.piece.skills.find(x=>x.s===t.s)?.lv||0)),0))}));
    return needs.every(({t,need})=>!need||stones.has(t.s)) && needs.reduce((n,x)=>n+x.need,0)<=slots;
  };
  const rank = b => {
    const lv = totalsFor(b), priority = targets.reduce((n, t) => {
      const level = Math.min(t.max, lv.get(t.s) || 0), values = curves.get(t.s)?.values;
      const contribution = values ? (values[level - 1] || 0) / (values[t.max - 1] || 1) : level / t.max;
      const index = userTargets.findIndex(x => x.s === t.s);
      return n + contribution * (requireLock && t.s === '록온' ? 500 : index >= 0 ? abPriorityWeight(index) : 80);
    }, 0);
    const score = abScoreBuild(b), stats=bdStats(b);
    const cost=policy.investmentSkills.reduce((n,s)=>n+Math.min(abMax(s),lv.get(s)||0),0);
    const element=cost ? Math.max(0,stats.now.ele-stats.base.ele)/cost : 0;
    return { priority, score, element, armor:armorOf(b) };
  };
  const compare = key => (a,b) => key === 'armor' ? abArmorCompare(a.armor,b.armor) || b.score-a.score
    : b[key]-a[key] || abArmorCompare(a.armor,b.armor);
  // 모든 방어구를 단품 평가한 뒤 핵심 스킬 / 점수 / 슬롯 경로를 묶어 부위 후보를 제한한다.
  /* 메인 스킬 활용도 조건 (AUTO_BUILD A2): 기본 스킬이 하나도 쓸모없는 장비는 연성 칸이 많아도 후보에서 뺀다.
     필수 최소를 연성으로만 채울 수 있을 때의 슬롯 경로만 예외. 쓸모 있는 장비가 없는 부위는 전체를 쓴다. */
  const usefulPiece = r => r.piece.skills.some(x => policy.useful.has(x.s));
  const weaponLv = new Map(); for (const x of bdBuildWSkills(seed)) weaponLv.set(x.s, (weaponLv.get(x.s) || 0) + x.lv);
  const needSlots = drift ? targets.filter(t => stones.has(t.s) && t.min > 0).reduce((n, t) => n + Math.max(0, t.min - (weaponLv.get(t.s) || 0)), 0) : 0;
  const usefulSlots = all.reduce((n, rows) => n + Math.max(0, ...rows.filter(usefulPiece).map(r => r.piece.slot)), 0);
  all = all.map((rows, i) => {
    const every = rows.map(r => ({ ...r, ...rank({ ...seed, [parts[i].k]: r.key }) })), keep = new Map();
    const rated = every.some(usefulPiece) ? every.filter(usefulPiece) : every;
    for (const t of targets) for (const r of [...rated].filter(r => r.piece.skills.some(x => x.s === t.s)).sort((a, b) =>
      (b.piece.skills.find(x => x.s === t.s)?.lv || 0) - (a.piece.skills.find(x => x.s === t.s)?.lv || 0) || b.score - a.score).slice(0, 2)) keep.set(r.key, r);
    for (const s of policy.prefer) for (const r of [...rated].filter(r => r.piece.skills.some(x => x.s === s))
      .sort((a, b) => b.score - a.score).slice(0, 1)) keep.set(r.key, r);
    for (const key of ['priority', 'score','armor','element']) for (const r of [...rated].sort(compare(key)).slice(0, 5)) keep.set(r.key, r);
    // 필수 연성 칸을 확보할 선택지는 별도 보존. 슬롯은 이 경로에서만 자격 확인 용도로 사용.
    if (drift && needSlots > 0) for (const r of [...(needSlots > usefulSlots ? every : rated)].sort((a,b)=>
      b.piece.slot-a.piece.slot || compare('armor')(a,b)).slice(0,2)) keep.set(r.key,r);
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
    for (const key of ['score','armor','element']) for (const n of [...next].sort(compare(key)).slice(0, Math.floor(AB_LIMIT.beam / 4))) keep.set(abSignature(n.b), n);
    // 목표 충족도만 보존하지 않고 서로 다른 핵심 투자량의 최고 전체 점수를 보존한다.
    const buckets = new Map();
    for (const n of [...next].sort(compare('score'))) {
      const lv = totalsFor(n.b), key = targets.map(t=>Math.min(t.max,lv.get(t.s)||0)).join(':');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(n);
    }
    let retained = 0;
    for (let depth=0; retained<Math.floor(AB_LIMIT.beam/4); depth++) {
      let found = false;
      for (const rows of buckets.values()) if (rows[depth] && retained<Math.floor(AB_LIMIT.beam/4)) {
        const n=rows[depth]; keep.set(abSignature(n.b),n); retained++; found=true;
      }
      if (!found) break;
    }
    beam = [...keep.values()];
    if (!beam.length) break;
  }
  const pool = [];
  // 각 핵심의 투자 레벨을 별도 비교한다. 나머지 핵심을 MAX로 연성하지 않는다.
  const investments = [null, 'low', ...[...targets,...optional].flatMap(t => stones.has(t.s) && drift
    ? Array.from({length:t.max-t.min}, (_,i)=>({...t,min:t.min+i+1})) : [])];
  finish: for (const node of beam) for (const mode of investments) {
    if (mode?.s && (totalsFor(node.b).get(mode.s) || 0) >= mode.min) continue;
    const trial = [...targets,...optional].map(t => mode?.s === t.s ? {...t,min:mode.min} : t);
    const b = abFillDrift(node.b, trial, fillers, drift, false, mode === 'low');
    evaluated++;
    if (b) {
      const lv = totalsFor(b), levels = userTargets.map(t => Math.min(t.max, lv.get(t.s) || 0));
      if (targets.every(t => (lv.get(t.s) || 0) >= t.min)) {
        const support = [...lv].filter(([s]) => !userTargets.some(t => t.s === s)
          && (fillers.includes(s) || policy.styleTargets.some(t => t.s === s))).map(([s, level]) => [s, Math.min(abMax(s), level)]);
        const profile = levels.join(':')+'|'+[...support].sort(([a], [b]) => a.localeCompare(b)).map(([s, lv]) => s + ':' + lv).join('|');
        pool.push({ ...abEvaluateCandidate(b,targets,policy), levels, armor:armorOf(b), driftOnly, styleLevels: policy.styleTargets.map(t => Math.min(t.max, lv.get(t.s) || 0)),
          operation:operation.map(t=>Math.min(t.max,lv.get(t.s)||0)),
          support, profile, driftMode: mode?.s ? `${mode.s}:${mode.min}` : mode || 'score' });
      }
    }
    if (evaluated % 8 === 0) {
      progress({ stage: 5, expanded, evaluated }); await pause();
      if (cancelled()) return null;
      if (evaluated >= 2400 || performance.now() - started > AB_LIMIT.ms*0.55) break finish;
    }
    if (evaluated >= 2400 || performance.now() - started > AB_LIMIT.ms*0.55) break finish;
  }
  const evaluatedPool=pool;
  if(cancelled())return null;
  const repair=await abRepairBuilds(evaluatedPool,registered,targets,policy,config,started,progress,cancelled);
  if(cancelled())return null;
  for(const r of repair.pool){r.driftOnly=driftOnly;r.armor=armorOf(r.b);}
  // 관측한 완성 후보 간에도 비교 근거를 남긴다. 미탐색 대안을 만들지 않는다.
  for(const r of evaluatedPool) if(!r.evidence) {
    const other=repair.pool.find(x=>abSignature(x.b)!==abSignature(r.b));
    if(other)r.evidence=abOpportunityEvidence(other,r);
  }
  return { pool:[...evaluatedPool,...repair.pool], expanded:expanded+repair.expanded, evaluated:evaluated+repair.evaluated,
    repair:{jobs:repair.jobs,limited:repair.limited,sourceParts:registered.map(x=>({part:x.part,items:x.rows.length}))},
    limited:repair.limited || performance.now() - started > AB_LIMIT.ms || evaluated >= AB_LIMIT.evaluated,
    ms: Math.round(performance.now() - started) };
}

function abOptions(rows, selected) {
  return rows.map(([value, label]) => `<option value="${esc(String(value))}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`).join('');
}

function abGuideUI(b, direction, targets) {
  const setting = b._abGun || abState.gun;
  const policy = abPolicy(b, direction, targets, abState.styleOff,setting), c = abContext(b);
  const extra = abSearchTargets({ b, targets, gun:setting, styleGuide: abState.styleOff })
    .filter(t => !targets.some(x => x.s === t.s && x.min >= t.min));
  return `<p>${esc(policy.desc || '직접 설정: 사용자 스킬과 레벨을 우선하며 적용 가능한 효과만 평가합니다.')}</p>
    <p>장비 기본 스킬의 대체 불가 여부·한 부위 확보 레벨·유효 스킬 합·연성 비용을 비교합니다. 연성전용 핵심은 최소 충족 후 장비 구성을 우선하며, 슬롯 수 자체에는 가산점을 주지 않습니다.</p>
    ${policy.style ? `<p>스타일 골격: ${esc(policy.style.name)}. ${esc(policy.style.desc)} ${policy.style.required.length ? '필수 조건과 선택한 투자 방향을 결합하며, 규칙 스킬은 제안 카드에서 하나씩 끌 수 있습니다.' : ''} 권장 스킬은 최소 레벨로 강제하지 않습니다.</p>` : ''}
    ${abGun(b) ? abGunGuideUI(b,setting) : ''}
    ${c.nativeNegative && c.tripleCrit ? '<p>회심 파라미터 3개: 흉회심 중심 방향과 자동 추가 연성은 제외합니다. 무기 기본 스킬·장비에 함께 붙은 효과는 실제 계산을 유지합니다.</p>' : ''}
    ${policy.avoid.length ? `<p>자동 보충 제외: ${policy.avoid.map(esc).join(' · ')}. 사용자 '완전 제외'가 아니면 다른 유용한 스킬이 붙은 장비까지 금지하지 않습니다.</p>` : ''}
    ${b.ignore?.length ? `<p>겸용 허용 제외: ${b.ignore.map(esc).join(' · ')}. 장비에 붙어 있어도 이 화면의 점수에서는 효과를 빼며, 내 빌드로 가져오면 효과가 계산됩니다.</p>` : ''}
    ${policy.lowPriority.length ? `<p>낮은 우선순위: ${policy.lowPriority.map(esc).join(' · ')}. 후보에서 제외하지 않고 실제 점수로 비교합니다.</p>` : ''}
    ${extra.length ? `<p>추가 확보 조건: ${extra.filter(t=>t.min>0).map(t => `${esc(t.s)} ${t.min}${t.max>t.min ? ` (목표 ${t.max})` : ''}`).join(' · ')}. 운용 최소와 선택한 경지의 선행 레벨입니다.</p>` : ''}
    ${targets.map(t => { const curve = abCurve(t.s, b); return t.s ? `<p>${esc(t.s)}: ${curve ? `레벨별 효과 ${curve.values.join(' / ')} · 추가 증가량 ${curve.increments.join(' / ')} (동일 단위)` : '복합·확률 또는 비수치 효과: 임의 대미지 환산 없이 레벨 우선순위로 평가'}</p>` : ''; }).join('')}
    <p>명시한 필수 최소는 유지합니다. 권장 핵심은 미채용부터 목표까지 투자안을 비교하며, 장비 전체 효과와 연성 보충 비용을 함께 평가합니다. 모든 레벨 조합의 전수 탐색은 아닙니다.</p>
    ${abStyleRow(b)?.note ? `<p>${esc(abStyleRow(b).note)}</p>` : ''}
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
    <p>비교 기준 탄: ${esc(g.compare?.name || '미확인')}. 통상 &lt; 산탄 &lt; 관통＝참렬 &lt; 용격＝확산의 사용자 선호로 선택합니다. 철갑·기타 탄의 선호 순위는 미지정이며 직접 선택할 수 있습니다.</p>
    <p>점수는 이 탄에 적용되는 효과만 비교하며 탄별 실제 피해·사격 비중·가드 후 탄 강화는 계산하지 않습니다. 전체 탄 순환 DPS가 아닙니다.</p>
    <p><a href="'+esc(BD_BOWGUN_DATA.sources[b.wt])+'" target="_blank" rel="noopener noreferrer">탄별 반동·장전 자료: 나우칼</a></p>`;
}
function abGunUI(b) {
  const g = abGunInfo(b,abState.gun);
  if (!g) return '';
  return `<div class="ab-box ab-form-settings"><h3>보우건 운용 <small>딜링 방향과 별도로 결합</small></h3>
    <div class="ab-config"><label>탄 운용<select data-ab="gunMode">${abOptions(g.modes,g.mode)}</select></label>
    ${g.mode !== 'cycle' ? `<label>반복할 탄<select data-ab="gunSlot">${abOptions(g.choices.map(a=>[a.i,`${a.i+1}번 · ${a.name}`]),g.slot)}</select></label>` : ''}</div>
    <p class="ab-muted">${(g.unknown ? '반동·장전 자료 미확인. 해당 스킬은 직접 지정해 주세요. ' : '')+'필수: '+(g.required.map(t=>`${esc(t.s)} ${t.min}${t.max>t.min ? ` → 목표${t.max}` : ''}`).join(' · ') || '추가 반동·장전 불필요')}
    ${g.recommended.length ? ' · 가드 성능 2~3 권장(필수 아님)' : ''}</p>
    ${g.mode !== 'cycle' ? `<label class="ab-check"><input type="checkbox" data-ab="reload5"${abState.gun.reload5 ? ' checked' : ''}>회피 장전 Lv5까지 투자 비교</label>` : ''}
    <details><summary>탄 운용 근거·한계</summary>${abGunGuideUI(b,abState.gun)}</details></div>`;
}

/* 같은 스타일 안의 운용 성향(규칙의 mode). 규칙에 성향이 있을 때만 고른다. */
function abModeUI(b) {
  const style = bdStylesOf(b.wt)[b.st - 1] || '';
  const rows = AB_RULES.styles.filter(r => r.wt === b.wt && [].concat(r.style).includes(style));
  if (!rows.some(r => r.mode)) return '';
  return `<div class="ab-box ab-form-settings"><label>운용 성향<select data-ab="mode">${abOptions(rows.map(r => [r.mode || '', r.name]), abStyleRow(b)?.mode || '')}</select></label></div>`;
}
/* 발동 가정: 몬스터·전투에 따라 갈리는 조건은 켠 채로, 조건부 후보는 끈 채로 시작한다. 칩으로 바꾼다. */
function abAssumeUI(b) {
  const s = abState, chip = (n, on, title) => `<button type="button" class="ab-chip${on ? ' rule' : ' rule off'}" data-ab-assume="${esc(n)}" title="${title}">${esc(n)}</button>`;
  const control = AB_ASSUME.control.filter(n => abAssumed(n, { ...b, _abAssume:{} }));
  const monster = [...AB_ASSUME.monster, ...control].map(n => chip(n, !s.assumeOff.includes(n), control.includes(n) ? '컨트롤로 유지하는 조건 · 고수 기준으로 켬 · 눌러서 끄기/켜기' : '몬스터·전투에 따라 갈림 · 눌러서 끄기/켜기'));
  const candidate = [...AB_ASSUME.candidate, ...AB_ASSUME.sp].map(n => chip(n, s.assumeOn.includes(n) || (!s.assumeOff.includes(n) && abAutoCandidate(n, b)), '조건부 후보 · 눌러서 켜기/끄기'));
  return `<div class="ab-box ab-form-settings"><h3>발동 가정 <small>켠 것만 점수에 들어갑니다</small></h3>
    <div class="ab-chips">${monster.join('')}</div>
    <p class="ab-muted">조건부 후보 · 이번 세팅에 포함할 스킬만 켜기</p><div class="ab-chips">${candidate.join('')}</div>
    <p class="ab-muted">불굴·재난대처능력·그룹 사냥 강화는 끈 채로 계산합니다. 무기 동작이 필요한 스킬은 무기 특성에 그 동작이 있는 스타일에서만 켭니다. 연격·기습·불퇴전은 켜지는 무기에서 회피·자리 유지를 잘하는 고수 기준으로 켠 채 시작하며 칩으로 끌 수 있습니다. 돌파구·전화위복은 자체 상태이상 스킬이 있을 때만 켭니다. 직접 넣은 스킬은 켭니다.</p></div>`;
}
/* 결과 빌드에 붙어 있지만 포함하지 않은 조건부 후보: 포함했을 때 늘어나는 점수. */
function abCandidateGains(r) {
  return bdTotals(r.b).filter(([s, lv]) => lv && [...AB_ASSUME.candidate, ...AB_ASSUME.sp].includes(s) && r.b.cond[s] === false).map(([s]) => {
    const b = structuredClone(r.b); b._abAssume = { ...(b._abAssume || {}), on:[...(b._abAssume?.on || []), s], off:(b._abAssume?.off || []).filter(x => x !== s) };
    return [s, abScoreBuild(b) - r.score];
  }).filter(([, n]) => n > 0);
}
const abLevelText = t => t.min > 0 ? (t.max > t.min ? `${t.min}→${t.max}` : `${t.min}`) : `→${t.max}`;
/* 펼친 제안 카드: 필수(최소1 이상) / 투자(최소0) / 제외. 칩에서 바로 조정한다. */
function abCardUI(d) {
  const s = abState, b = s.b, rule = abOperationRule(b, s.gun), off = s.styleOff, excluded = s.exclude.map(x => x.s);
  const chip = (key, label, cls = '', title = '') => `<button type="button" class="ab-chip${cls}" data-ab-chip="${esc(key)}"${s.chip === key ? ' aria-expanded="true"' : ''}${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
  const ruleChip = t => off.includes(t.s) ? chip('r:'+t.s, esc(t.s), ' rule off', '꺼짐 · 눌러서 켜기')
    : chip('r:'+t.s, `${esc(t.s)} <b>${abLevelText(t)}</b>`, ' rule', '운용 규칙 · 눌러서 끄기');
  const req = [], inv = [], exc = [];
  if (abMelee(b.wt)) req.push(chip('lock', s.lockon ? '록온 <b>1</b>' : '록온', s.lockon ? ' rule' : ' rule off', s.lockon ? '눌러서 끄기' : '꺼짐 · 눌러서 켜기'));
  for (const t of rule?.required || []) if (!excluded.includes(t.s)) req.push(ruleChip(t));
  s.targets.forEach((t, i) => (t.min > 0 ? req : inv).push(chip('t:'+i, `${esc(t.s)} <b>${abLevelText(t)}</b>`)));
  for (const t of rule?.recommended || []) if (!s.targets.some(x => x.s === t.s) && !excluded.includes(t.s)) inv.push(ruleChip(t));
  const shown = new Set(['록온', ...(rule?.required || []).map(t => t.s), ...s.targets.map(t => t.s)]);
  for (const t of abSearchTargets({ b, targets:s.targets, gun:s.gun, styleGuide:off })) if (t.min > 0 && !shown.has(t.s))
    req.push(`<span class="ab-chip auto" title="선택한 효과의 선행 조건">${esc(t.s)} <b>${t.min}</b></span>`);
  const policy = abPolicy({ ...b, _abExclude:s.exclude }, s.direction, s.targets, off, s.gun);
  for (const x of policy.avoid) if (!excluded.includes(x)) exc.push(`<span class="ab-chip auto" title="자동 보충 제외 · 투자에 추가하면 사용">${esc(x)}</span>`);
  s.exclude.forEach((x, i) => exc.push(chip('x:'+i, `${esc(x.s)} <b>${x.shared ? '↔ 겸용 허용' : '🚫 완전'}</b>`, ' ex')));
  const used = new Set([...shown, ...(rule?.recommended || []).map(t => t.s), ...excluded]);
  const plus = (group, label) => s.adding === group
    ? `<select data-ab-add="${group}" aria-label="${label} 추가">${abOptions([['', label+' 추가…'], ...abSkills().filter(n => !used.has(n)).map(n => [n, n])], '')}</select>`
    : `<button type="button" class="ab-chip plus" data-ab-plus="${group}" aria-label="${label} 추가">＋</button>`;
  const row = (name, chips, group, label) => `<div class="ab-card-row"><span>${name}</span><div class="ab-chips">${chips.join('')}${plus(group, label)}</div></div>`;
  const [kind, id] = [s.chip?.[0], s.chip?.slice(2)], t = kind === 't' && s.targets[+id], x = kind === 'x' && s.exclude[+id];
  const op = (o, label, disabled) => `<button type="button" data-ab-op="${o}"${disabled ? ' disabled' : ''}>${label}</button>`;
  const editor = t ? `<div class="ab-chip-editor"><b>${esc(t.s)}</b> 최소 ${op('min-','−',!t.min)}${t.min}${op('min+','＋',t.min >= abMax(t.s))}
      목표 ${op('max-','−',t.max <= Math.max(1, t.min))}${t.max}${op('max+','＋',t.max >= abMax(t.s))}${op('up','↑ 우선',+id === 0)}${op('del','✕ 빼기')}</div>`
    : x ? `<div class="ab-chip-editor"><b>${esc(x.s)}</b> ${op('shared', x.shared ? '↔ 겸용 허용 → 완전 제외로' : '🚫 완전 제외 → 겸용 허용으로')}${op('del','✕ 빼기')}
      <small>${x.shared ? '자동 투자·연성만 막고 겸용 장비는 허용, 점수에서 효과는 0' : '이 스킬이 붙은 방어구·연성을 후보에서 제외'}</small></div>` : '';
  return `<div class="ab-card open"><div class="ab-card-head"><b>${esc(d.name)}</b>${d.recommended ? '<small>추천</small>' : ''}</div>
    <p class="ab-muted">${esc(d.desc)}</p>
    ${row('필수', req, 'req', '필수 스킬')}${row('투자', inv, 'inv', '투자 스킬')}${row('제외', exc, 'ex', '제외 스킬')}${editor}
    <p class="ab-muted">최소가 1 이상이면 필수, 0이면 투자 후보입니다. 투자는 왼쪽부터 우선합니다. 제외는 최대 ${AB_EXCLUDE_MAX}개입니다.</p>
    ${s.stale ? '<p class="ab-notice">설정이 바뀌어 새 제안이 있습니다. <button type="button" data-ab-reset>제안 새로 보기</button></p>'
      : s.edited ? '<p class="ab-notice">수정됨 · <button type="button" data-ab-reset>되돌리기</button></p>' : ''}
    <div class="ab-actions"><label class="ab-check"><input type="checkbox" data-ab="drift"${s.drift ? ' checked' : ''}>표류연성 사용</label>
    <button class="btn primary" data-ab-search${s.busy ? ' disabled' : ''}>${s.busy ? '후보 탐색 중…' : '이 방향으로 빌드 찾기'}</button>${s.busy ? '<button class="btn ghost" data-ab-cancel>중지</button>' : ''}</div>
    <p id="ab-status" role="status" aria-live="polite">${esc(s.notice)}</p>
    <details><summary>적용 지침과 레벨 근거</summary>${abGuideUI({ ...b, _abExclude:s.exclude }, s.direction, s.targets)}</details></div>`;
}

function abRender() {
  const s = abState, b = s.b, base = bdWeaponBase(b), info = bdStyleInfo(b), w = bdWeaponOf(b);
  const dirs = [...abDirections(b,s.gun).map((d, i) => ({ ...d, recommended:!i })), { id:'manual', name:'직접 구성', desc:'필수·투자 스킬을 직접 고릅니다.', targets:[] }];
  if (!dirs.some(d => d.id === s.direction)) s.direction = 'manual'; // 무기 변경으로 사라진 제안의 수정본은 직접 구성으로 유지
  $('#ab-screen').innerHTML = `<div class="ab-heading"><button class="btn ghost" data-ab-back>← 내 빌드</button><h2>자동빌드 (테스트중)</h2></div>
    <div class="ab-box ab-form-settings ab-weapon-settings"><h3>① 무기 설정</h3><div class="ab-config">
      <label>무기군<select data-ab="wt">${abOptions(BUILD.weaponTypes.filter(t => abMonsters(t.k).length).map(t => [t.k, t.n]), b.wt)}</select></label>
      <label>몬스터·소재<select data-ab="monster">${abOptions(abMonsters(b.wt).map(s => [s.key, s.name]), b.w)}</select></label>
      <label>스타일<select data-ab="st"${info.selectable ? '' : ' disabled'}>${abOptions([[0, '스타일 없음'], ...bdStylesOf(b.wt).map((n, i) => [i + 1, n])], b.st)}</select></label>
      <label class="ab-check"><input type="checkbox" data-ab="style20"${info.active ? ' checked' : ''}${info.available ? '' : ' disabled'}>스타일강화 Lv20 적용</label>
    </div><div class="ab-parameter">${BD_PARAM_LEVELS.map((lv, i) => `<label>Lv${lv} 파라미터<select data-ab-param="${i}"${info.active ? '' : ' disabled'}>${abOptions([['', '미선택'], ...(info.profile?.parameters[lv] || []).map(p => [p.stat, `${{ atk: '공', crit: '회', ele: '속' }[p.stat]} +${p.value}${p.stat === 'crit' ? '%' : ''}`])], b.params[i] || '')}</select></label>`).join('')}</div>
    <p class="ab-base">${esc(w.name)} · 공격력 <b>${base.atk}</b>${w.e ? ` · ${esc(w.e)} <b>${base.ele}</b>` : ''} · 회심 <b>${base.crit}%</b></p></div>
    ${abGunUI(b)}${abModeUI(b)}${abAssumeUI(b)}
    <div class="ab-box"><h3>② 세팅 제안 <small>무기 특성 × 파라미터 × 운용 지침</small></h3><div class="ab-directions" role="group" aria-label="세팅 제안">
      ${dirs.map(d => d.id === s.direction ? abCardUI(d) : `<button class="ab-card" data-ab-dir="${d.id}" aria-pressed="false"><b>${esc(d.name)}${d.recommended ? ' · 추천' : ''}</b>
        <span>${esc(d.desc.split('. ')[0])}</span>${d.targets.length ? `<span class="ab-card-skills">${d.targets.slice(0, 3).map(t => esc(t.s)).join(' · ')}</span>` : ''}</button>`).join('')}</div>
      <details class="ab-basis"><summary>추천 기준과 출처</summary><p>기존 빌드 점수로 평가합니다. 조건부 효과는 '발동 가정'에서 켠 것만 점수에 넣으며 특수 위력·SP 전용 효과는 제외합니다. 동시 발동 가능성·유지율은 보정하지 않아 실제 DPS가 아닙니다. 특수 게이지 가속은 선택 가능한 스킬로 유지하며 임의 대미지 점수는 부여하지 않습니다.</p>
      <p>스타일 골격과 무기의 투자 방향을 함께 적용합니다. 같은 제안이라도 몬스터·스타일·파라미터에 따라 보조 스킬과 연성이 달라질 수 있습니다. 회심 방향은 무기 자체 회심의 투자 효율을 비교하며 특정 회심률을 강제하지 않습니다. 사용자 수정 스킬과 레벨은 설정 변경으로 덮어쓰지 않습니다.</p>
      <p>근접무기는 록온 Lv1을 기본 필수로 확보하며 칩에서 끌 수 있습니다. 록온이 없는 후보는 점수와 관계없이 제외합니다. 원거리 3종은 사용하지 않습니다.</p>
      <p>방어구 전 부위를 제한 폭으로 탐색하고 연성은 필수 스킬 보충 후 소수의 공격 관련 후보로 채웁니다. 최대 ${AB_LIMIT.ms / 1000}초, 탐색 폭 ${AB_LIMIT.beam}. 최적해 보장은 아닙니다. 장비·연성의 보유 여부와 획득 난도는 고려하지 않습니다.</p>
      ${AB_SOURCES.map(([n, url]) => `<a href="${url}" target="_blank" rel="noopener noreferrer">공식 ${esc(n)}</a>`).join(' · ')}</details></div>
    <div id="ab-results"></div>`;
  abRenderResults();
}

/* 빌드의 장비 행/스킬 칩을 공유하되 편집용 인덱스와 버튼은 생성하지 않는다. */
function abEquipmentUI(b) {
  const core = new Set(abState.targets.map(t => t.s));
  abOperationRule(b, undefined, abState.styleOff)?.required.forEach(t => core.add(t.s));
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
  return `${stats.ammo ? `<p>비교 기준 탄: ${esc(stats.ammo)} · ${stats.critApplies ? '회심 기대값 적용' : '회심·흉회심 배율 미적용'}. 탄별 실제 피해/DPS가 아닌 스킬 비교 점수입니다.</p>` : ''}${stats.co.R && x.p > 0 ? `<p>일반 공격 ${f(x.normal)}점 · 회심 공격 ${f(x.critical)}점<br>회심 확률 ${f(x.p * 100)}%</p>`
    : `<p>공격력 + 속성 평균에 대미지·회심 배율을 적용합니다.</p>`}<p class="ab-formula">${bdScoreFormula(stats)}점</p>`;
}

function abOpportunityUI(r) {
  const e=r.evidence;
  if(!e)return '<p>관측 후보는 있으나 이 후보의 교체 비교 기록은 아직 없습니다. 장비 필수·최적이라고 판단하지 않습니다.</p>';
  return `<p>${esc(e.mode||'관측 구성 비교')} · ${esc(e.outcome)}</p><p>${e.changedParts.map(x=>
    `${esc(BD_PARTS().find(p=>p.k===x.part)?.n||x.part)}: ${esc(bdSet(x.from)?.name||'없음')} → ${esc(bdSet(x.to)?.name||'없음')}`).join(' · ')||'같은 방어구에서 연성 투자 비교'}</p>
    <p>비교안 대비 ON ${e.scoreDelta>=0?'+':''}${e.scoreDelta}점 · OFF ${e.baseDelta>=0?'+':''}${e.baseDelta}점 · 연성 ${e.driftDelta>=0?'+':''}${e.driftDelta}칸</p>
    <p>운용 변화: ${e.operationDelta.map((n,i)=>n?`${esc(r.operationNames[i])} ${n>0?'+':''}${n}`:'').filter(Boolean).join(' · ')||'동일'}. 다른 부위·연성을 보완한 관측 구성 차이이며 전역 최적은 아닙니다.</p>`;
}

/* 같은 방어구에서 연성 안 A 대비 달라진 스킬·연성·점수. */
function abVariantDiff(a, r) {
  const x = new Map(bdTotals(a.b)), y = new Map(bdTotals(r.b)), lv = (m, s) => Math.min(abMax(s), m.get(s) || 0);
  const sign = (n, unit = '') => `${n > 0 ? '+' : ''}${n.toLocaleString()}${unit}`;
  const skills = [...new Set([...x.keys(), ...y.keys()])].map(s => [s, lv(y,s) - lv(x,s)]).filter(([, n]) => n).map(([s, n]) => `${s} ${sign(n)}`);
  return `A 대비: ${[...skills, `연성 ${sign(r.drifts - a.drifts, '칸')}`, sign(r.score - a.score, '점')].map(esc).join(' · ')}`;
}
function abRenderResults() {
  const s = abState, groups = abBest(s.pool);
  s.results = groups;
  $('#ab-results').innerHTML = !s.stats ? '' : `<div class="ab-heading"><h3>③ 추천 결과 ${groups.length}개</h3></div>
    <p class="ab-muted">서로 다른 방어구 조합을 조건 ON 점수순으로 보여줍니다. 🏅는 기준별 1위이며 그 조합은 항상 포함합니다. 같은 방어구에 연성만 다른 안은 카드 안 탭으로 비교합니다.</p>
    <p class="ab-muted">${s.stats.expanded.toLocaleString()}개 조합 탐색 · ${s.stats.evaluated}개 연성 구성 검토 · ${s.pool.length}개 유효 후보 · ${(s.stats.ms / 1000).toFixed(1)}초${s.stats.limited ? ' · 탐색 제한 도달' : ''}</p>
    ${s.stats.repair ? `<p class="ab-muted">교체·보완 ${s.stats.repair.jobs}개 구성 검사${s.stats.repair.limited?' · 기회비용 검토 일부 미완료':''}. 모든 장비 조합의 전수 검사가 아닙니다.</p>`:''}
    ${groups.length ? `<div class="bd-cards ab-result-grid">` + groups.map((g, i) => {
      const v = Math.min(s.variant[i] || 0, g.variants.length - 1), r = g.variants[v], lv = new Map(bdTotals(r.b));
      const keys = [...new Map([...(abOperationRule(r.b, undefined, s.styleOff)?.required || []), ...s.targets].map(t => [t.s, t])).values()];
      const ignored = (r.b.ignore || []).filter(x => lv.get(x));
      return `<article class="bd-card ab-result"><div class="ab-heading"><h3>${i + 1}위</h3><b class="ab-score">${r.score.toLocaleString()}점</b></div>
      ${g.badges.length ? `<p class="ab-badges">${[...new Set(g.badges)].map(n => `<span class="ab-badge">🏅 ${esc(n)}</span>`).join('')}</p>` : ''}
      ${g.variants.length > 1 ? `<div class="ab-tabs" role="tablist" aria-label="연성 안">${g.variants.map((x, j) => `<button type="button" role="tab" aria-selected="${j === v}" data-ab-variant="${i}:${j}">${'ABC'[j]} ${esc(x.role)}</button>`).join('')}</div>` : ''}
      <p class="ab-muted" style="padding:0 12px">조건 ON ${r.score.toLocaleString()} · 조건 OFF ${r.baseScore.toLocaleString()} · 연성 ${r.drifts}칸${abCandidateGains(r).map(([n, d]) => ` · ${esc(n)} 포함 시 +${d.toLocaleString()}점`).join('')}</p>
      ${v ? `<p class="ab-diff">${abVariantDiff(g.variants[0], r)}</p>` : ''}
      <div class="ab-levels">${keys.map(t => `<span>${esc(t.s)} <b>Lv${Math.min(abMax(t.s), lv.get(t.s) || 0)}</b> / 목표 ${t.max}</span>`).join('')}</div>
      <p class="ab-muted" style="padding:0 12px">보조 투자: ${(r.support || []).slice(0, 3).map(([n, l]) => `${esc(n)} ${l}`).join(' · ') || '핵심 스킬 중심'}${r.support?.length > 3 ? ` 외 ${r.support.length - 3}개` : ''}</p>
      ${ignored.length ? `<p class="ab-muted" style="padding:0 12px">겸용 허용 ${ignored.map(esc).join(' · ')}: 이 점수에서는 효과 제외, 내 빌드에서는 계산됩니다.</p>` : ''}
      ${abEquipmentUI(r.b)}
      <details><summary>추천 · 계산 근거</summary>
      <div class="ab-reason"><h4>요구 스킬 충족</h4><ul>
      ${s.lockon && abMelee(s.b.wt) ? '<li>필수 록온: Lv1 확보</li>' : ''}
      ${keys.map(t => `<li>${esc(t.s)}: <b>Lv${Math.min(abMax(t.s), lv.get(t.s) || 0)}</b> 확보 <small>(최소 ${t.min} · 목표 ${t.max})</small></li>`).join('')}</ul>
      <h4>기회비용 비교 근거</h4>${abOpportunityUI(r)}
      <h4>적용한 운용 지침</h4>${abGuideUI(r.b, s.direction, s.targets)}
      <h4>연성 배치</h4><p>${r.drifts}개 사용 · 같은 스킬이 기본으로 붙은 부위의 빈 슬롯부터 배치합니다.</p>
      <h4>점수 계산 가정</h4><p>발동 가정: ${Object.entries(r.b.cond).filter(([, on]) => on).map(([n]) => esc(n)).join(' · ') || '없음'}</p>
      <p>특수 위력·SP 전용 효과와 집중 보정은 제외합니다.${r.b.wt === 'switch-axe' || r.b.wt === 'charge-blade' ? ' 변형 공격 강화는 모든 공격에 적용한 값이라 실제보다 높습니다.' : ''} 실제 전투 DPS가 아닌 비교 점수입니다.</p>
      <h4>기대 점수</h4>${abCalculationUI(r.b)}<p class="ab-muted">일반·회심 공격을 회심률로 평균합니다. 표시와 최종 점수만 반올림합니다.</p></div></details>
      <footer><button class="btn primary" data-ab-import="${i}">내 빌드로 가져오기${g.variants.length > 1 ? ` (${'ABC'[v]}안)` : ''}</button></footer></article>`; }).join('') + '</div>'
    : `<p class="ab-box">설정한 최소 레벨을 만족하는 후보를 찾지 못했습니다. ${s.exclude.some(x => !x.shared) ? '완전 제외한 스킬 때문에 후보 방어구가 줄었을 수 있습니다. ' : ''}연성을 켜거나 최소 레벨을 낮춰 보세요. 제한 탐색이므로 불가능한 조합이라는 뜻은 아닙니다.</p>`}`;
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
/* 칩 조정. 규칙·록온 칩은 누르면 켜고 끈다. 사용자 스킬·제외 칩은 조정줄을 연다. */
function abEditChip(key, op) {
  const s = abState, kind = key[0], id = key.slice(2);
  if (key === 'lock') { s.lockon = !s.lockon; return; } // 록온·제외는 제안과 무관한 사용자 설정
  if (kind === 'r') s.styleOff = s.styleOff.includes(id) ? s.styleOff.filter(x => x !== id) : [...s.styleOff, id];
  else if (kind === 't') {
    const i = +id, t = s.targets[i], max = abMax(t.s);
    if (op === 'min-') t.min = Math.max(0, t.min - 1);
    if (op === 'min+') { t.min = Math.min(max, t.min + 1); t.max = Math.max(t.max, t.min); }
    if (op === 'max-') { t.max = Math.max(1, t.max - 1); t.min = Math.min(t.min, t.max); }
    if (op === 'max+') t.max = Math.min(max, t.max + 1);
    if (op === 'up' && i) { [s.targets[i - 1], s.targets[i]] = [t, s.targets[i - 1]]; s.chip = 't:' + (i - 1); }
    if (op === 'del') { s.targets.splice(i, 1); s.chip = null; }
  } else if (kind === 'x') {
    const i = +id;
    if (op === 'shared') s.exclude[i].shared = !s.exclude[i].shared;
    if (op === 'del') { s.exclude.splice(i, 1); s.chip = null; }
    return;
  }
  s.edited = true;
}
function abAddSkill(group, name) {
  const s = abState;
  s.adding = null;
  if (!name) return;
  if (group === 'ex') {
    const exclude = [...s.exclude, { s:name, shared:false }];
    const required = abSearchTargets({ b:s.b, targets:s.targets, gun:s.gun, lockon:s.lockon, styleGuide:s.styleOff });
    const error = abExcludeError(exclude, [...required, ...s.targets], s.b);
    if (error) { s.notice = error; return; }
    s.exclude = exclude; return;
  }
  if (s.exclude.some(x => x.s === name)) { s.notice = `${name}: 제외 스킬입니다. 제외에서 먼저 빼 주세요.`; return; }
  s.targets.push({ s:name, min:group === 'req' ? 1 : 0, max:abMax(name) }); s.edited = true;
}
$('#ab-screen').addEventListener('change', e => {
  const el = e.target, s = abState;
  abInvalidate();
  if (el.hasAttribute('data-ab-add')) { abAddSkill(el.dataset.abAdd, el.value); return abRender(); }
  if (['wt', 'monster'].includes(el.dataset.ab)) abChangeWeapon(el.dataset.ab, el.value);
  if (el.dataset.ab === 'st') { s.b.st = +el.value; if (!s.b.st) s.b.style20 = false; }
  if (el.dataset.ab === 'mode') { if (el.value) s.b.snsMode = el.value; else delete s.b.snsMode; }
  if (el.dataset.ab === 'style20') s.b.style20 = el.checked;
  if (el.dataset.ab === 'drift') s.drift = el.checked;
  if (el.dataset.ab === 'gunMode') s.gun = { ...s.gun, mode:el.value, slot:undefined };
  if (el.dataset.ab === 'gunSlot') s.gun.slot = +el.value;
  if (el.dataset.ab === 'reload5') s.gun.reload5 = el.checked;
  if (['st','gunMode','gunSlot','reload5'].includes(el.dataset.ab) && abGun(s.b)) s.gun = abGunInfo(s.b,s.gun).settings;
  if (el.hasAttribute('data-ab-param')) s.b.params[+el.dataset.abParam] = el.value || null;
  bdNormalizeParams(s.b);
  if (['st', 'style20','mode','gunMode','gunSlot','reload5'].includes(el.dataset.ab) || el.hasAttribute('data-ab-param')) abSyncDirection();
  abRender();
});
$('#ab-screen').addEventListener('click', async e => {
  const el = e.target.closest('button'), s = abState;
  if (!el) return;
  if (el.hasAttribute('data-ab-back')) { location.hash = 'build'; return; }
  if (el.hasAttribute('data-ab-variant')) { const [i, v] = el.dataset.abVariant.split(':').map(Number); s.variant[i] = v; return abRenderResults(); }
  if (el.hasAttribute('data-ab-dir')) { abInvalidate(); abApplyDirection(el.dataset.abDir); abRender(); return; }
  if (el.hasAttribute('data-ab-reset')) { abInvalidate(); abApplyDirection(s.stale ? abDirections(s.b,s.gun)[0]?.id : s.direction); abRender(); return; }
  if (el.hasAttribute('data-ab-assume')) { // 사용자 설정이며 제안 수정으로 보지 않는다
    const n = el.dataset.abAssume, candidate = [...AB_ASSUME.candidate, ...AB_ASSUME.sp].includes(n);
    const on = candidate ? s.assumeOn.includes(n) || (!s.assumeOff.includes(n) && abAutoCandidate(n, s.b)) : !s.assumeOff.includes(n);
    s.assumeOn = s.assumeOn.filter(x => x !== n); s.assumeOff = s.assumeOff.filter(x => x !== n);
    if (on) s.assumeOff.push(n); else if (candidate) s.assumeOn.push(n);
    abInvalidate(); abRender(); return;
  }
  if (el.hasAttribute('data-ab-plus')) { s.adding = el.dataset.abPlus; s.chip = null; abRender(); $(`[data-ab-add="${s.adding}"]`)?.focus(); return; }
  if (el.hasAttribute('data-ab-chip')) {
    const key = el.dataset.abChip;
    if (/^[tx]:/.test(key)) s.chip = s.chip === key ? null : key; else { abInvalidate(); abEditChip(key); }
    s.adding = null; abRender(); return;
  }
  if (el.hasAttribute('data-ab-op')) { abInvalidate(); abEditChip(s.chip, el.dataset.abOp); abRender(); return; }
  if (el.hasAttribute('data-ab-cancel')) { abInvalidate(); s.notice = '탐색을 중지했습니다.'; abRender(); return; }
  if (el.hasAttribute('data-ab-import')) {
    const i = +el.dataset.abImport, g = s.results[i], r = g?.variants[Math.min(s.variant[i] || 0, g.variants.length - 1)];
    if (!r) return;
    const b = structuredClone(r.b), direction = abDirections(b).find(d => d.id === s.direction)?.name || '직접 구성', gun = abGunInfo(b);
    delete b._abGun; delete b._abExclude; delete b._abAssume; delete b.ignore; // 자동추천 메타데이터는 저장 빌드 형식에 추가하지 않는다.
    b.n = `${bdSet(b.w).name} · ${direction}${gun ? ' · '+gun.name+(gun.mode !== 'cycle' ? ' · '+gun.ammo[0]?.name : '') : ''}`;
    if (bdAdopt(bdShareParam(b), b.n)) {
      s.scroll = 0; location.hash = 'build';
      requestAnimationFrame(() => bdFocusBuild(0)); toast('최신 내 빌드로 가져왔습니다');
    }
    return;
  }
  if (!el.hasAttribute('data-ab-search') || s.busy) return;
  const required = abSearchTargets({ b:s.b, targets:s.targets, gun:s.gun, lockon:s.lockon, styleGuide:s.styleOff });
  const error = abValidate(s.targets, s.exclude, s.b) || abExcludeError(s.exclude, required, s.b);
  if (error) { s.notice = error; abRender(); return; }
  abInvalidate(); const run = s.run;
  s.busy = true; s.notice = '후보를 탐색하고 있습니다…'; s.variant = {}; abRender();
  try {
    const result = await abSearch(structuredClone({ b:s.b, gun:s.gun, direction:s.direction, targets:s.targets, drift:s.drift,
      lockon:s.lockon, styleGuide:s.styleOff, exclude:s.exclude, assumeOn:s.assumeOn, assumeOff:s.assumeOff }),
      p => { $('#ab-status').textContent = `${p.phase||'초기 구성'} · ${p.stage}/5부위 · ${p.expanded.toLocaleString()}개 조합 탐색 · ${p.evaluated}개 연성 구성 검토`; },
      () => run !== abState.run);
    if (!result || run !== abState.run) return;
    s.pool = result.pool; s.stats = result; s.notice = '후보 탐색이 완료되었습니다.';
  } catch (err) { if (run === abState.run) s.notice = '추천 중 오류가 발생했습니다. 다시 시도해 주세요.'; console.error(err); }
  if (run === abState.run) { s.busy = false; abRender(); }
});
abApplyDirection('water');
abRoute();
