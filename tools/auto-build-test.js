const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const els = {}, ctx = vm.createContext({ console, performance, structuredClone, setTimeout,
  $: s => els[s] ||= { hidden: true, dataset: {}, addEventListener() {}, setAttribute() {}, close() {} },
  location: { hash: '#build' }, requestAnimationFrame() {}, window: {},
  document: { querySelector() { return null; } }, esc: s => String(s), closeOnBackdrop() {}, nickAuto() {},
  localStorage: { getItem() { return null; }, setItem() {} } });
for (const f of ['smelt-data.js', 'skill-desc.js', 'skill-desc-overrides.js', 'build-data.js', 'build-styles.js', 'build-style-data.js', 'build.js', 'auto-build.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
const get = s => vm.runInContext(s, ctx);
(async () => {
  assert.strictEqual(get('abValidate(abTargets(["연격", "연격", "슈퍼회심"]))').includes('중복'), true);
  assert.strictEqual(get('abTargets(["점프 철인"])[0].min'), 1);
  const originalWeapon = get('structuredClone(abState.b)');
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
  assert.strictEqual(get('abState.lockon'), true);
  assert.strictEqual(get('abMax("록온")'), 1);
  for (const wt of ['light-gun', 'heavy-gun', 'bow']) {
    assert.strictEqual(get('abMelee')(wt), false);
    assert.strictEqual(get('abSearchTargets')({b:{wt},targets:[{s:'연격',min:3,max:5}],lockon:true}).length, 1);
  }
  assert.strictEqual(get('abDirections(abState.b)[0].id'), 'water');
  get('abState.b.st=1; abState.b.style20=true; abState.b.params=["crit","crit","crit"]');
  assert.strictEqual(get('bdWeaponBase(abState.b).crit'), 50);
  assert.strictEqual(get('abDirections(abState.b)[0].id'), 'critical');
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
  get('abState.b.st=0; abState.b.style20=false');
  const config = get('({b:abState.b,targets:abState.targets,drift:true})');
  const result = await get('abSearch')(config);
  console.log('탐색', { expanded: result.expanded, evaluated: result.evaluated, valid: result.pool.length, ms: result.ms, limited: result.limited });
  const best = get('abBest')(result.pool, 'priority');
  assert.strictEqual(best.length, 5, '샘플은 5개 후보를 추천');
  assert.strictEqual(new Set(best.map(r => get('abSignature')(r.b))).size, 5);
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
  assert.strictEqual(get('abBest')(locked.pool, 'priority').length, 5);
  assert.ok(locked.pool.every(r => new Map(get('bdTotals')(r.b)).get('록온') >= 1));
  assert.ok(locked.pool.every(r => r.levels.length === 3));
  const duplicateLock = get('abSearchTargets')({b:config.b,targets:[{s:'록온',min:1,max:1},...config.targets.slice(1)],lockon:true});
  assert.strictEqual(duplicateLock.filter(t => t.s === '록온').length, 1);
  const lockWithoutDrift = await get('abSearch')({ ...config, targets:config.targets.map(t=>({...t,min:1})), drift:false, lockon:true });
  assert.ok(lockWithoutDrift.pool.length > 0);
  assert.ok(lockWithoutDrift.pool.every(r => r.drifts === 0 && new Map(get('bdTotals')(r.b)).get('록온') >= 1));
  assert.strictEqual(await get('abSearch')(config, () => {}, () => true), null);
  const sorted = [...result.pool].sort((a, b) => get('abCompare')(a, b, 'score'));
  assert.strictEqual(get('abBest')(result.pool, 'score')[0].score, sorted[0].score);
  assert.ok(get('abCompare')({levels:[5,3,3],score:100,drifts:0,b:best[0].b},
    {levels:[4,5,5],score:10000,drifts:0,b:best[1].b},'priority') < 0);
  const oldLimit = get('AB_LIMIT.ms'); get('AB_LIMIT.ms=0');
  const limited = await get('abSearch')(config); assert.ok(limited.limited); get(`AB_LIMIT.ms=${oldLimit}`);
  if (process.argv.includes('--all-weapons')) for (const type of get('BUILD.weaponTypes')) {
    const b = get('bdNewBuild')(); Object.assign(b, { w: 'mizu', wt: type.k, st: 1, style20: true, params: ['crit', 'crit', 'crit'] });
    get('bdNormalizeParams')(b);
    const result = await get('abSearch')({ ...config, b });
    assert.ok(result.pool.length, type.n + ' 추천 후보 필요');
    assert.ok(result.pool.every(r => Number.isFinite(r.score) && r.b.wt === type.k));
    console.log(type.n, '검수 통과', result.pool.length, '후보', result.ms, 'ms');
  }
  console.log('자동빌드 테스트 통과');
})().catch(e => { console.error(e); process.exitCode = 1; });
