const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const els = {}, ctx = vm.createContext({ console, performance, structuredClone, setTimeout,
  $: s => els[s] ||= { hidden: true, dataset: {}, addEventListener() {}, setAttribute() {}, close() {} },
  location: { hash: '#build' }, requestAnimationFrame() {}, window: {},
  document: { querySelector() { return null; } }, esc: s => String(s), closeOnBackdrop() {}, nickAuto() {},
  localStorage: { getItem() { return null; }, setItem() {} } });
for (const f of ['smelt-data.js', 'skill-desc.js', 'skill-desc-overrides.js', 'build-data.js', 'build-styles.js', 'build-style-data.js', 'build.js', 'build-bowgun-data.js', 'auto-build.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
const get = s => vm.runInContext(s, ctx);
(async () => {
  assert.strictEqual(get('abState.b.wt'), 'shield-sword', '자동빌드 초기 무기는 한손검');
  assert.ok(get('bdWeaponOf(abState.b)'), '초기 몬스터에 한손검이 존재');
  assert.strictEqual(get('abValidate(abTargets(["연격", "연격", "슈퍼회심"]))').includes('중복'), true);
  assert.strictEqual(get('abTargets(["점프 철인"])[0].min'), 0);
  const originalWeapon = get('structuredClone(abState.b)');
  for (const name of ['저스트 교격', '저스트 교격【지속】']) {
    assert.ok(!get('abSupportSkills(abState.b)').includes(name));
    for (let lv = 1; lv <= 5; lv++)
      assert.deepStrictEqual(Array.from(get('bdEffects')(get('bdSkillDesc')(name,lv), name, get('bdWeaponOf(abState.b)'))), []);
  }
  for (const [monster, type, accepted] of [
    ['mizu', 'long-sword', []], ['barr', 'switch-axe', ['마비']],
    ['arzu', 'switch-axe', ['독']], ['brachy', 'hammer', ['폭파']],
  ]) {
    const set = get('BUILD.sets').find(s => s.key === monster || (monster === 'brachy' && s.name === '브라키디오스'));
    assert.ok(set, monster);
    get('abState').b = { ...originalWeapon, w: set.key, wt: type };
    for (const status of ['독', '마비', '폭파'])
      assert.strictEqual(get('abSkills()').includes(`추가 공격【${status}】`), accepted.includes(status));
  }
  get('abState').b = originalWeapon;
  const buildup = '상태 이상 축적 시 위력 UP';
  for (const [w, wt, valid] of [['mizu','long-sword',false],['barr','switch-axe',true],['arzu','switch-axe',true]]) {
    get('abState').b = { ...originalWeapon, w, wt };
    assert.strictEqual(get('abSkills()').includes(buildup), valid);
    assert.strictEqual(get('abSupportSkills(abState.b)').includes(buildup), valid);
    assert.strictEqual(get('bdEffects(bdSkillDesc("상태 이상 축적 시 위력 UP",5),"상태 이상 축적 시 위력 UP",bdWeaponOf(abState.b)).length') > 0, valid);
  }
  get('abState').b = originalWeapon;
  assert.strictEqual(get('abState.lockon'), true);
  assert.strictEqual(get('abMax("록온")'), 1);
  for (const wt of ['light-gun', 'heavy-gun', 'bow']) {
    assert.strictEqual(get('abMelee')(wt), false);
    // 록온 없음. 활 기본은 운용 규칙의 집중5가 함께 붙는다.
    assert.strictEqual(get('abSearchTargets')({b:{wt},targets:[{s:'연격',min:3,max:5}],lockon:true}).map(t=>t.s).join(), wt === 'bow' ? '연격,집중' : '연격');
  }
  assert.strictEqual(get('abDirections(abState.b)[0].id'), 'elder', '높은 자체 속성은 고룡 투자도 우선 비교');
  get('abState.b.st=1; abState.b.style20=true; abState.b.params=["crit","crit","crit"]');
  assert.strictEqual(get('bdWeaponBase(abState.b).crit'), 50);
  assert.strictEqual(get('abDirections(abState.b)[0].id'), 'critical');
  const guideSeed = get('structuredClone(abState.b)');
  // 보우건 스타일은 대체 스킬만 자동 보충에서 제외하고 직접 지정·무기 투자 방향을 보존한다.
  for (const [wt, st, excluded] of [
    ['light-gun',1,'반동 경감'], ['light-gun',2,'장전 속도'],
    ['heavy-gun',1,'장전 속도'], ['heavy-gun',2,'반동 경감'],
  ]) {
    const b = { ...get('bdNewBuild')(), w:'mizu', wt, st };
    const direction = get('abDirections')(b)[0], rule = get('abStyleRule')(b);
    assert.ok(rule.avoid.includes(excluded));
    assert.ok(!get('abStyleRule')({...b, st:0}));
    assert.strictEqual(direction.targets[0].min,0);
    assert.ok(direction.targets.slice(1).every(t => t.min === 0), '탄 운용 필수 조건과 보조 핵심을 분리');
    const policy = get('abPolicy')(b,direction.id,direction.targets);
    assert.ok(!policy.fillers.includes(excluded));
    assert.ok(policy.avoid.includes(excluded));
    const manual = [{s:excluded,min:1,max:3}];
    assert.ok(get('abPolicy')(b,'manual',manual).fillers.includes(excluded));
    assert.ok(!get('abPolicy')(b,direction.id,direction.targets,false).avoid.includes(excluded));
    assert.ok(get('abSearchTargets')({b,targets:direction.targets}).length > direction.targets.length);
    const guard = policy.styleTargets.find(t => t.s === '가드 성능');
    assert.strictEqual(!!guard, wt === 'heavy-gun' && st === 1);
    if (guard) assert.deepStrictEqual([guard.min,guard.max],[0,3]);
    get('abState').b = b;
    get('abRender()');
    assert.ok(els['#ab-screen'].innerHTML.includes('보우건 운용'));
    const guide = get('abGuideUI')(b,direction.id,direction.targets);
    assert.ok(guide.includes('최선 표시 단계에 도달하는 최소 레벨'));
    assert.ok(!guide.includes('매진 2~3'));
  }
  get('abState').b = guideSeed;
  // 지침별 추천 방향·예외·레벨과 자동 보충을 대응 검수한다.
  const negativeSet = get('BUILD.sets').find(s => s.name === '이블조');
  assert.ok(negativeSet);
  const negative = { ...get('bdNewBuild')(), w: negativeSet.key, wt: 'great-sword' };
  const negativeDirections = get('abDirections')(negative);
  assert.deepStrictEqual(Array.from(negativeDirections, d => d.id), ['brutal-5','brutal-3','brutal-low']);
  assert.ok(!negativeDirections.some(d => d.id === 'critical'));
  const fastNegative = { ...negative, wt:'dual-blades' };
  assert.strictEqual(get('abDirections')(fastNegative)[0].id, 'brutal-low');
  const erased = { ...negative, st:1, style20:true, params:['crit','crit','crit'] };
  assert.ok(get('bdStyleInfo')(erased).active);
  assert.ok(!get('abDirections')(erased).some(d => d.id.startsWith('brutal')));
  assert.ok(!get('abPolicy')(erased,'water',[]).fillers.includes('흉회심'));
  assert.ok(get('abPolicy')(erased,'manual',[{s:'흉회심',min:1,max:1}]).fillers.includes('흉회심'), '사용자 명시 선택 우선');
  const critAttack = get('abDirections')(guideSeed).find(d => d.id === 'crit-attack');
  assert.ok(critAttack.targets.some(t => t.s === '공격 증강【회심】'));
  assert.ok(get('abPolicy')(guideSeed, 'crit-attack', critAttack.targets).prefer.includes('공격 증강【회심】'));
  assert.strictEqual(get('abDirections')(guideSeed).find(d=>d.id==='critical').critMin,undefined);
  assert.ok(!get('abDirections')(guideSeed).find(d=>d.id==='critical').targets.some(t=>t.s==='슈퍼회심'));
  const morph = { ...guideSeed, wt:'switch-axe' };
  assert.ok(get('abDirections')(morph).find(d=>d.id==='morph-critical').targets.some(t=>t.s==='슈퍼회심'));
  const lance = { ...get('bdNewBuild')(),w:'mizu',wt:'lance',st:2 };
  const just = get('abDirections')(lance).find(d=>d.id==='water');
  assert.strictEqual(just.id,'water','스타일이 무기의 투자 방향을 대체하지 않음');
  assert.deepStrictEqual(Array.from(get('abStyleRule')(lance).required,t=>[t.s,t.min,t.max]), [['불퇴전',4,5],['반사',1,5]]);
  assert.ok(!get('abSearchTargets')({b:lance,targets:just.targets}).some(t=>t.s==='매진'),'보완 권장 스킬은 필수화하지 않음');
  assert.ok(!get('abPolicy')(lance,just.id,just.targets).fillers.includes('가드 성능'));
  const shield = get('abDirections')({...lance,st:1})[0];
  assert.deepStrictEqual(Array.from(get('abStyleRule')({...lance,st:1}).required,t=>[t.s,t.min,t.max]), [['가드 성능',5,5],['반사',1,5],['불퇴전',4,5]]);
  for (const st of [1,2]) {
    const inverseLance = {...negative,wt:'lance',st};
    assert.deepStrictEqual(Array.from(get('abDirections')(inverseLance),d=>d.id),['brutal-low','brutal-3','brutal-5']);
    const critLance = {...guideSeed,wt:'lance',st};
    assert.deepStrictEqual(Array.from(get('abDirections')(critLance),d=>d.id),['critical','crit-attack','water']);
    const required = get('abSearchTargets')({b:critLance,targets:just.targets,lockon:true});
    assert.ok(required.some(t=>t.s==='반사'&&t.min===1));
    const gated = get('abSearchTargets')({b:critLance,targets:[{s:'물속성 공격 강화·경지',min:1,max:2}]});
    assert.ok(gated.some(t=>t.s==='물속성 공격 강화'&&t.min===5),'필수 경지의 선행 레벨 확보');
    const unrestricted = get('abSearchTargets')({b:critLance,targets:just.targets,styleGuide:false});
    assert.ok(!unrestricted.some(t=>t.s==='반사'),'스타일 자동 기준은 사용자 해제 가능');
    assert.ok(!get('abSupportSkills')(critLance).includes('적정 거리 위력 UP'));
    assert.ok(!get('abSupportSkills')(critLance).includes('차지 마스터'));
    assert.ok(!get('abSupportSkills')(critLance).includes('상태 이상 축적 시 위력 UP'));
    assert.notDeepStrictEqual(Array.from(get('abPolicy')(critLance,'manual',just.targets).fillers),
      Array.from(get('abPolicy')(inverseLance,'manual',just.targets).fillers),'동일 핵심 스킬도 스펙별 보조 후보 변경');
  }
  const poisonSet = get('BUILD.sets').find(s=>s.weapons.some(w=>w.t==='gunlance'&&w.e==='독'));
  const poison = { ...get('bdNewBuild')(),w:poisonSet.key,wt:'gunlance',st:1 };
  const statusDirections = get('abDirections')(poison);
  assert.strictEqual(statusDirections[0].targets[0].s,'추가 공격【독】');
  assert.ok(statusDirections.some(d=>d.id==='status-rear'));
  assert.ok(!get('abDirections')({...poison,st:2}).some(d=>d.id==='status-rear'));
  const phial = { ...get('bdNewBuild')(),w:'barr',wt:'switch-axe' };
  assert.strictEqual(get('abDirections')(phial)[0].targets[0].s,'추가 공격【마비】');
  assert.deepStrictEqual(Array.from(get('abCurve')('불퇴전',lance).increments),[10,5,5,10,10]);
  assert.strictEqual(get('abTargets(["불퇴전"])[0].min'),0);
  assert.strictEqual(get('abCurve')('반사',lance),null,'비수치 효과의 임의 환산 금지');
  // 파라미터/스타일 변경은 자동 지침을 갱신하되 직접 수정은 보존한다.
  get('abState').b=guideSeed; get('abApplyDirection')('water'); get('abSyncDirection')();
  assert.strictEqual(get('abState.direction'),'critical');
  get('abState.edited=true; abState.targets[0]={s:"연격",min:2,max:3}; abSyncDirection()');
  assert.strictEqual(get('abState.targets[0].s'),'연격');
  get('abState').b=guideSeed; get('abApplyDirection')('water');
  get(`BUILD.sets.push({key:'ab-test',name:'검수',weapons:[],pieces:{helm:{slot:1,skills:[
    {s:'특수 스킬 위력 상승',lv:5},{s:'연격',lv:5},{s:'특수 게이지 가속',lv:3}]}}});
    abTestBuild={...abState.b,helm:'ab-test',cond:{'특수 스킬 위력 상승':true}};abScoreBuild(abTestBuild)`);
  assert.strictEqual(get('abTestBuild.cond["특수 스킬 위력 상승"]'), false);
  assert.strictEqual(get('abTestBuild.cond["연격"]'), true);
  assert.strictEqual(get('new Map(bdTotals(abTestBuild)).get("특수 게이지 가속")'), 3);
  const stoneOnly = get(`abFillDrift(abTestBuild,[{s:'불퇴전',min:1,max:1}],[],true,true)`);
  assert.strictEqual(get('bdStoneList')(stoneOnly)[0].s, '불퇴전');
  assert.strictEqual(get('abFillDrift')(get('abTestBuild'), [{ s: '불퇴전', min: 2, max: 2 }], [], true, true), null);
  get('BUILD.sets.pop()');
  // 부족한 핵심 레벨, 핵심 추가 보충, 점수용 연성 모두 동일 기본 스킬 부위를 우선한다.
  get(`BUILD.sets.push({key:'drift-order-test',name:'연성 배치 검수',weapons:[],pieces:{
    helm:{slot:1,skills:[]},belt:{slot:2,skills:[{s:'가드 성능',lv:3}]}}});
    driftOrderBuild={...bdNewBuild(),w:'mizu',wt:'long-sword',helm:'drift-order-test',belt:'drift-order-test'}`);
  const driftSeed = get('driftOrderBuild'), before = JSON.stringify(driftSeed);
  const guardBuild = get('abFillDrift')(driftSeed, [{s:'가드 성능',min:5,max:5}], [], true, true);
  assert.strictEqual(guardBuild.ds.belt.filter(d => d?.s === '가드 성능').length, 2);
  assert.strictEqual(guardBuild.ds.helm.filter(Boolean).length, 0);
  assert.strictEqual(JSON.stringify(driftSeed), before, '원본 빌드는 변경하지 않음');
  get('BUILD.sets.at(-1).pieces.belt.slot=1');
  const overflow = get('abFillDrift')(driftSeed, [{s:'가드 성능',min:5,max:5}], [], true, true);
  assert.strictEqual(overflow.ds.belt[0].s, '가드 성능');
  assert.strictEqual(overflow.ds.helm[0].s, '가드 성능');
  get('BUILD.sets.at(-1).pieces.belt.slot=2; BUILD.sets.at(-1).pieces.belt.skills=[{s:"연격",lv:3}]');
  for (const priority of [false,true]) {
    const filled = get('abFillDrift')(driftSeed, priority ? [{s:'연격',min:3,max:5}] : [], ['연격'], true, priority);
    assert.strictEqual(filled.ds.belt.filter(d => d?.s === '연격').length, 2);
    assert.strictEqual(filled.ds.helm.filter(Boolean).length, 0);
  }
  get('BUILD.sets.pop(); delete driftOrderBuild');
  for (const [b, d] of [[lance,just],[{...lance,st:1},shield],
    [{...guideSeed,wt:'lance',st:2},get('abDirections')({...guideSeed,wt:'lance',st:2}).find(d=>d.id==='critical')],
    [{...negative,wt:'lance',st:1},get('abDirections')({...negative,wt:'lance',st:1})[0]],
    [guideSeed,get('abDirections')(guideSeed).find(d=>d.id==='critical')],
    [guideSeed,critAttack],[negative,negativeDirections[0]],[poison,statusDirections[0]]]) {
    const result = await get('abSearch')({b, direction:d.id, targets:d.targets, drift:true, lockon:true});
    assert.ok(result.pool.length, d.name + ' 후보 필요');
    for (const r of result.pool) {
      const totals = new Map(get('bdTotals')(r.b));
      assert.ok(get('abSearchTargets')({b,targets:d.targets,lockon:true}).every(t=>(totals.get(t.s)||0)>=t.min));
      assert.ok(!d.critMin || get('bdStats')(r.b).now.crit>=d.critMin);
      assert.ok(!(r.b.cond['불퇴전']&&r.b.cond['매진']));
      assert.strictEqual(r.score,get('bdStats')(r.b).score);
    }
    console.log(d.name, '지침 적용 추천 검수 통과', result.ms,'ms');
  }
  // 새 장비의 스킬·슬롯만 등록해도 운용 조건을 확보하는 후보에 들어온다.
  get(`BUILD.sets.push({key:'new-guide-gear',name:'검수용 신규 장비',weapons:[],pieces:{helm:{slot:2,skills:[
    {s:'가드 성능',lv:5},{s:'반사',lv:1},{s:'불퇴전',lv:4},{s:'록온',lv:1}]}}});`);
  const fresh = await get('abSearch')({b:{...lance,st:1},direction:shield.id,targets:shield.targets,drift:true,lockon:true});
  assert.ok(fresh.pool.some(r=>r.b.helm==='new-guide-gear'),'장비 ID를 추천 규칙에 추가하지 않고도 새 후보 발견');
  get('BUILD.sets.pop()');
  // 전체 소재 선택, 공식 순서, 존재하지 않는 무기군 전환과 강화 초기화를 검사한다.
  let selectable = 0;
  for (const type of get('BUILD.weaponTypes')) {
    const sets = get('abMonsters')(type.k);
    assert.deepStrictEqual(Array.from(sets, s => s.key), Array.from(get('bdOrderedSets()').filter(s => s.weapons.some(w => w.t === type.k)), s => s.key));
    get('abChangeWeapon')('wt', type.k);
    for (const set of sets) {
      get('abChangeWeapon')('monster', set.key);
      assert.ok(get('bdWeaponOf(abState.b)'), set.name + ' ' + type.n);
      assert.strictEqual(get('abState.b.st'), 0);
      assert.strictEqual(get('abState.b.style20'), false);
      assert.ok(get('abState.b.params').every(p => p === null));
      assert.ok(Number.isFinite(get('bdWeaponBase(abState.b).atk')));
      if (get('abDirections(abState.b)').length) assert.strictEqual(get('abValidate(abState.targets)'), '', set.name + ' ' + type.n + ': ' + JSON.stringify(get('abState.targets')));
      else assert.strictEqual(get('abState.direction'), 'manual');
      get('abRender()');
      selectable++;
    }
  }
  get('abState.edited=true; abState.targets=abTargets(["연격","간파","슈퍼회심"])');
  get('abChangeWeapon')('monster', 'mizu');
  assert.strictEqual(get('abState.targets[0].s'), '연격', '사용자 지정 스킬 보존');
  for (const [field, value] of [['wt','long-sword'], ['monster','mizu']]) get('abChangeWeapon')(field, value);
  get('abApplyDirection("water")');
  console.log('전체 무기 선택 검수', selectable, '종');
  get('abState.b.st=0; abState.b.style20=false');
  const config = get('({b:abState.b,targets:abState.targets,drift:true})');
  const result = await get('abSearch')(config);
  console.log('탐색', { expanded: result.expanded, evaluated: result.evaluated, valid: result.pool.length, ms: result.ms, limited: result.limited });
  const best = get('abBest')(result.pool);
  assert.strictEqual(best.length, 5, '샘플은 5개 후보를 추천');
  assert.strictEqual(new Set(best.map(r => get('abSignature')(r.b))).size, 5, '결과 5개는 서로 다른 방어구');
  assert.strictEqual(best[0].score, Math.max(...result.pool.map(r => r.score)), '1위는 최고 ON 점수');
  assert.ok(best.every((r, i) => !i || best[i - 1].score >= r.score), 'ON 점수순');
  for (const g of best) {
    assert.ok(g.variants.length >= 1 && g.variants.length <= get('AB_VARIANTS'));
    assert.ok(g.variants.every(v => get('abSignature')(v.b) === get('abSignature')(g.b)), '연성 안은 같은 방어구');
    assert.strictEqual(new Set(g.variants.map(v => v.profile)).size, g.variants.length, '연성 안끼리 스킬 구성이 다름');
    assert.ok(g.variants.every(v => v.score === get('bdStats')(v.b).score), '묶음으로 실제 점수 변경 금지');
  }
  // 기준별 1위(배지)의 방어구는 결과에 반드시 포함된다.
  const front = get('abFrontier')(result.pool);
  assert.ok(best.some(g => g.variants.some(v => v.score === Math.max(...front.map(x => x.score)))));
  assert.ok(best.some(g => g.variants.some(v => v.baseScore === Math.max(...front.map(x => x.baseScore)))), '조건 OFF 1위 포함');
  assert.ok(best.some(g => g.variants.some(v => v.drifts === Math.min(...front.map(x => x.drifts)))), '연성 최소 포함');
  for (const r of best) {
    for (let i = 0; i < 3; i++) assert.ok(r.levels[i] >= config.targets[i].min);
    for (const part of get('BD_PARTS()')) assert.ok(r.b.ds[part.k].filter(Boolean).length <= get('bdSlotCount')(r.b, part.k));
    assert.strictEqual(r.score, get('bdStats')(r.b).score);
    assert.ok(!Object.entries(r.b.cond).some(([s, on]) => on && get('abSP')(s)));
    const parsed = get('bdParse')(get('bdShareParam')(r.b), '테스트');
    assert.ok(parsed); assert.strictEqual(get('bdStats')(parsed).score, r.score);
  }
  const noDrift = await get('abSearch')({ ...config, targets: config.targets.map(t => ({ ...t, min: 1 })), drift: false });
  assert.ok(noDrift.pool.length > 0);
  assert.ok(noDrift.pool.every(r => r.drifts === 0));
  const locked = await get('abSearch')({ ...config, lockon: true });
  assert.strictEqual(get('abBest')(locked.pool).length, 5);
  assert.ok(locked.pool.every(r => new Map(get('bdTotals')(r.b)).get('록온') >= 1));
  assert.ok(locked.pool.every(r => r.levels.length === 3));
  const duplicateLock = get('abSearchTargets')({b:config.b,targets:[{s:'록온',min:1,max:1},...config.targets.slice(1)],lockon:true});
  assert.strictEqual(duplicateLock.filter(t => t.s === '록온').length, 1);
  const lockWithoutDrift = await get('abSearch')({ ...config, targets:config.targets.map(t=>({...t,min:1})), drift:false, lockon:true });
  assert.ok(lockWithoutDrift.pool.length > 0);
  assert.ok(lockWithoutDrift.pool.every(r => r.drifts === 0 && new Map(get('bdTotals')(r.b)).get('록온') >= 1));
  for (const element of ['불', '독', '폭파', null]) {
    const set = get('BUILD.sets').find(s => s.weapons.some(w => w.t === 'long-sword' && (w.e || null) === element));
    assert.ok(set, '대표 속성 소재 필요: ' + element);
    const b = { ...get('bdNewBuild')(), w: set.key, wt: 'long-sword' };
    const targets = get('abTargets')(['연격', '간파', '슈퍼회심']).map(t => ({ ...t, min: 1 }));
    const sample = await get('abSearch')({ b, targets, drift: true, lockon: true });
    assert.ok(sample.pool.length, set.name + ' 추천 후보 필요');
    assert.ok(sample.pool.every(r => Number.isFinite(r.score) && r.b.w === set.key));
    console.log(set.name, '추천 검수 통과');
  }
  assert.strictEqual(await get('abSearch')(config, () => {}, () => true), null);
  // 사용자 제외: 완전 제외는 해당 스킬의 방어구·연성을 빼고, 겸용 허용은 점수에서 효과만 뺀다.
  const banned = best[0].support.map(x => x[0]).find(n => !get('bdBuildWSkills')(config.b).some(w => w.s === n));
  const hard = await get('abSearch')({ ...config, exclude:[{ s:banned, shared:false }] });
  assert.ok(hard.pool.length && hard.pool.every(r => !new Map(get('bdTotals')(r.b)).get(banned)), '완전 제외 스킬 미포함: ' + banned);
  const shared = await get('abSearch')({ ...config, exclude:[{ s:banned, shared:true }] });
  assert.ok(shared.pool.length && shared.pool.every(r => r.b.ignore.includes(banned) && r.score === get('bdStats')(r.b).score));
  const withSkill = shared.pool.find(r => new Map(get('bdTotals')(r.b)).get(banned));
  if (withSkill) assert.ok(get('bdStats')({ ...withSkill.b, ignore:[] }).score >= withSkill.score, '겸용 허용은 효과를 점수에서 제외');
  assert.ok(!get('abPolicy')({ ...config.b, _abExclude:[{ s:banned }] }, 'manual', []).fillers.includes(banned));
  assert.ok(get('abExcludeError')([{ s:'록온' }], [{ s:'록온', min:1, max:1 }]).includes('겹쳐'));
  assert.ok(get('abExcludeError')([1,2,3,4].map(i => ({ s:'x' + i })), []).includes('최대'));
  const weaponSkill = get('bdBuildWSkills')(config.b)[0]?.s;
  if (weaponSkill) assert.ok(get('abExcludeError')([{ s:weaponSkill }], [], config.b).includes('무기 기본'));
  // 규칙 스킬 개별 해제: 끈 스킬만 필수에서 빠지고 나머지 운용 조건은 유지.
  const shieldLance = { ...get('bdNewBuild')(), w:'mizu', wt:'lance', st:1 };
  const off = get('abSearchTargets')({ b:shieldLance, targets:[], styleGuide:['반사'] }).map(t => t.s);
  assert.ok(!off.includes('반사') && off.includes('가드 성능') && off.includes('불퇴전'));
  assert.strictEqual(get('abPriorityWeight')(0), 100);
  const oldLimit = get('AB_LIMIT.ms'); get('AB_LIMIT.ms=0');
  const limited = await get('abSearch')(config); assert.ok(limited.limited); get(`AB_LIMIT.ms=${oldLimit}`);
  if (process.argv.includes('--all-weapons')) for (const type of get('BUILD.weaponTypes')) {
    const b = get('bdNewBuild')(); Object.assign(b, { w: 'mizu', wt: type.k, st: 1, style20: true, params: ['crit', 'crit', 'crit'] });
    get('bdNormalizeParams')(b);
    const direction = get('abDirections')(b).find(d=>d.id==='water') || get('abDirections')(b)[0];
    const result = await get('abSearch')({ ...config, b, direction:direction.id, targets:direction.targets });
    assert.ok(result.pool.length, type.n + ' 추천 후보 필요');
    assert.ok(result.pool.every(r => Number.isFinite(r.score) && r.b.wt === type.k));
    console.log(type.n, '검수 통과', result.pool.length, '후보', result.ms, 'ms');
  }
  console.log('자동빌드 테스트 통과');
})().catch(e => { console.error(e); process.exitCode = 1; });
