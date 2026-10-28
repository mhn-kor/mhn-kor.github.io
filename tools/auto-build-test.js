const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const els = {}, ctx = vm.createContext({ console, performance, structuredClone, setTimeout,
  $: s => els[s] ||= { hidden: true, dataset: {}, addEventListener() {}, setAttribute() {}, close() {} },
  location: { hash: '#build' }, requestAnimationFrame() {}, window: {},
  document: { querySelector() { return null; } }, esc: s => String(s), closeOnBackdrop() {}, nickAuto() {},
  localStorage: { getItem() { return null; }, setItem() {} } });
for (const f of ['smelt-data.js', 'skill-desc.js', 'skill-desc-overrides.js', 'build-data.js', 'build-styles.js', 'build-style-data.js', 'build.js', 'build-bowgun-data.js', 'auto-build.js', 'auto-build-meta.js'])
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
  // 상태이상 무기 지침 메타: 해당 추가 공격 + 축적 위력 (수면은 추가 공격 없음, 일반 속성은 없음).
  assert.deepStrictEqual(Array.from(get('abStatusMetas')(poison)),['추가 공격【독】','상태 이상 축적 시 위력 UP']);
  assert.deepStrictEqual(Array.from(get('abStatusMetas')({...get('bdNewBuild')(),w:'rado',wt:'hammer'})),['상태 이상 축적 시 위력 UP']);
  assert.deepStrictEqual(Array.from(get('abStatusMetas')({...get('bdNewBuild')(),w:'mizu',wt:'shield-sword'})),[]);
  // 슬래시액스 기본: 변형 공격 강화 지침 메타 (2026-10-20). 변형 회심 방향의 약점 특효 메타 주축을 이어받는다. 비상용검은 권장 (2026-10-24).
  const waterSa=get('abMonsters("switch-axe").find(s=>s.weapons.find(w=>w.t==="switch-axe").e==="물").key');
  for (const st of [0]) {
    const sa={...get('bdNewBuild')(),w:waterSa,wt:'switch-axe',st,style20:st>0}, metas=get('abmCandidates')(sa,{mode:'cycle'});
    const morph=metas.find(m=>m.name==='변형 공격 강화');
    assert.ok(morph&&morph.guide,`슬래시액스 ${st} 변형 공격 강화 지침 메타`);
    assert.strictEqual(morph.direction,'morph-critical');
    assert.ok(!metas.some(m=>m.id==='d:morph-critical'),'같은 주축의 방향 메타는 지침 메타로 합침');
    if (get('bdWeaponBase')(sa).crit<20) assert.ok(morph.skeleton.some(t=>t.s==='약점 특효'&&t.min>0),'약점 특효 메타 주축 이어받기');
  }
  assert.ok(!get('abmCandidates')({...get('bdNewBuild')(),w:waterSa,wt:'switch-axe',st:2,style20:true},{mode:'cycle'}).some(m=>m.guide&&m.name==='변형 공격 강화'),'속성충전 카운터는 변형 지침 메타 없음');
  // 해머 기본 (weapons/hammer.md, 2026-10-21): 속성 공격 증강【SP】 처음부터 켬, 모으기 계열·연격 끔. 다른 무기는 SP 기본 끔.
  { const hb={...get('bdNewBuild')(),w:'zino',wt:'hammer'}, other={...get('bdNewBuild')(),w:'zino',wt:'shield-sword'};
    assert.strictEqual(get('abAssumed')('속성 공격 증강【SP】',hb),true,'해머 기본 SP 증강 ON');
    assert.strictEqual(get('abAssumed')('속성 공격 증강【SP】',{...hb,_abAssume:{off:['속성 공격 증강【SP】']}}),false,'칩으로 끄면 OFF');
    assert.strictEqual(get('abAssumed')('속성 공격 증강【SP】',other),false,'다른 무기는 SP 기본 OFF');
    for (const s of ['유타·향음 강화','차지 마스터','저스트 모으기 해방','차지 스톡','연격']) assert.strictEqual(get('abAssumed')(s,hb),false,'해머 기본 '+s+' OFF'); }
  // 해머 수면 치기 차지 묶음 (2026-10-22): 유타·향음 강화 + 차지 마스터를 함께 80% / 둘 다 없음 20%로 섞는다.
  { const set=get('BUILD.sets').find(s=>s.key==='zino'), hb={...get('bdNewBuild')(),w:'zino',wt:'hammer',st:1};
    get('BUILD.sets').push({key:'charge-test',name:'검수',weapons:[],weaponSkills:[],pieces:{helm:{name:'검수',skills:[{s:'유타·향음 강화',lv:5},{s:'차지 마스터',lv:5}],slot:0}}});
    try {
      const b={...hb,helm:'charge-test',cond:{'유타·향음 강화':true,'차지 마스터':true}}, st=get('bdStats')(b);
      assert.ok(st.branch&&st.branch.label==='차지 묶음'&&st.branch.rate===80,'차지 묶음 적용');
      assert.strictEqual(st.score,Math.round(st.branch.on*.8+st.branch.off*.2));
      assert.strictEqual(st.branch.off,get('bdStats')({...b,cond:{}}).score,'묶음 미적용 = 두 스킬 없음');
      assert.ok(!get('bdStats')({...b,st:0}).branch,'기본 스타일은 묶음 없음');
    } finally { get('BUILD.sets').pop(); } }
  // 해머 임팩트 크레이터 (2026-10-22): 비연 필수 1 · 발동률 60% 덮어쓰기 · 비연 단일 메타 없음 · SP 증강 켬.
  { const hi={...get('bdNewBuild')(),w:'zino',wt:'hammer',st:2};
    assert.strictEqual(get('bdRateFor')(hi,'비연',get('bdWeaponOf')(hi)),60);
    assert.strictEqual(get('bdRateFor')({...hi,st:0},'비연',get('bdWeaponOf')(hi)),20,'다른 스타일은 나우칼 해머 값');
    assert.strictEqual(get('abAssumed')('비연',hi),true); assert.strictEqual(get('abAssumed')('속성 공격 증강【SP】',hi),true);
    assert.ok(!get('abmCandidates')(hi,{mode:'cycle'}).some(m=>m.name==='비연'),'필수 스킬은 단일 메타 없음'); }
  // 메타 화면 결과(drift:false): 연성을 덜 채운 대안을 따로 두지 않는다 (2026-10-21).
  { const mk=(helm,score,drifts)=>({b:{...get('bdNewBuild')(),helm},score,baseScore:score,drifts,operation:[],operationNames:[],policyKey:'k',profile:helm+drifts});
    const pool=[mk('a',100,5),mk('b',90,4)];
    assert.strictEqual(get('abBest')(pool,5).length,2,'이전 화면: 연성 최소 대안 유지');
    assert.deepStrictEqual(Array.from(get('abBest')(pool,5,{drift:false}).map(r=>r.score)),[100],'메타 화면: 연성 최소 대안 없음'); }
  // 점수 없는 딸린 스킬 흐림 (A6 #7, 2026-10-23): 빼도 점수가 같으면 흐림. 운용 스킬·지정 스킬은 제외.
  get('BUILD.sets').push({key:'inert-test',name:'검수',weapons:[],weaponSkills:[],pieces:{helm:{name:'검수',skills:[{s:'얼음 내성',lv:1},{s:'반사',lv:1},{s:'공격',lv:3}],slot:0}}});
  try {
    const b={...get('bdNewBuild')(),w:'mizu',wt:'long-sword',helm:'inert-test'};
    const inert=get('abInertSkills')(b);
    assert.ok(inert.has('얼음 내성')&&!inert.has('반사')&&!inert.has('공격'),'내성은 흐림, 반사(운용)·공격(점수)은 그대로');
    assert.ok(!get('abInertSkills')(b,new Set(['얼음 내성'])).has('얼음 내성'),'지정 스킬은 흐리지 않음');
  } finally { get('BUILD.sets').pop(); }
  // 아마츠마가즈치 수동 선등록 (2026-10-23): 공격력 미공개 무기는 자동빌드 무기 목록에서 빼고, 방어구는 후보로 쓴다. 신규 스킬은 점수 없음.
  { const amat=get('BUILD.sets').find(s=>s.key==='amat');
    assert.ok(amat&&amat.weapons.length===14&&amat.weapons.every(w=>w.atk==null)&&Object.keys(amat.pieces).length===5);
    assert.ok(!get('abMonsters')('long-sword').some(s=>s.key==='amat'),'공격력 미공개 무기 제외');
    for (const [s,lv] of [['아마츠 스콜',5],['힘의 해방·경지',4],['아마츠 스톰블레이드',1]])
      assert.strictEqual(get('bdEffects')(get('bdSkillDesc')(s,lv),s,null).length,0,`${s} 점수 없음`);
    assert.ok(get('abReachLv')({...get('bdNewBuild')(),w:'mizu',wt:'long-sword'},'하이 차지【물】')>=2,'아마츠 다리로 물 하이 차지 Lv2 가능');
  }
  // 슬래시액스 기본 재설명 (2026-10-24): 변형 공격 강화 50%·검 모드 60% 병(나우칼과 같은 위치)·역회심은 변형 비권장·상태이상 병은 추가 공격 먼저.
  { const sa=(w,st=0)=>({...get('bdNewBuild')(),w,wt:'switch-axe',st,style20:st>0}), ratha=sa('ratha'), lago=sa('lago');
    assert.strictEqual(get('bdRateFor')(ratha,'변형 공격 강화',get('bdWeaponOf')(ratha)),50);
    assert.strictEqual(get('bdStats')(ratha).now.atk,Math.round(get('bdWeaponOf')(ratha).atk*(1+0.15*0.6)),'강격병 공격 +15% × 60%');
    assert.strictEqual(get('bdStats')(lago).now.ele,Math.round(get('bdWeaponOf')(lago).ele*(1+0.25*0.6)),'강속성병 속성 +25% × 60%');
    const em=sa('ratha',1); assert.strictEqual(get('bdStats')(em).now.atk,Math.round(get('bdWeaponBase')(em).atk*(1+0.15*0.8)),'비상용검 병 비중 80%');
    assert.strictEqual(get('bdRateFor')(em,'변형 공격 강화',get('bdWeaponOf')(em)),40);
    assert.strictEqual(get('abAssumed')('변형 공격 강화',em),true,'비상용검 변형 공격 강화 권장 = 처음부터 켬');
    assert.ok(!get('abmCandidates')(em,{mode:'cycle'}).some(m=>m.guide&&m.name==='변형 공격 강화'),'비상용검은 지침 메타 아님');
    assert.strictEqual(get('abStyleRow')(sa('b-diab',1)).id,'sa-emergency-brutal');
    // 변형 공격 묶음 (2026-10-25): 변형 공격 타격만 발동률 비중으로 따로 계산. 그 타격은 회심 100% 상한·체인지 부스트 100%.
    { const stone=s=>({s,c:get('abStonePool')().get(s)});
      const mb={...sa('mizu',1),helm:'goss',mail:'carnival-24',gloves:'nami',belt:'goss',greaves:'s-ratha',
        ds:{helm:[stone('슈퍼회심')],mail:[stone('슈퍼회심')],gloves:[stone('슈퍼회심')],belt:[stone('슈퍼회심')],greaves:[stone('추격')]}};
      const st=get('abScoreStats')(structuredClone(mb)), x=st.branch;
      assert.ok(x&&x.label==='변형 공격'&&x.rate===40);
      assert.strictEqual(st.score,Math.round(x.on*.4+x.off*.6));
      assert.ok(x.onCrit>=100&&x.offCrit<100,'변형 타격만 회심 100%');
      const withB=get('bdStats')({...structuredClone(mb),cond:Object.fromEntries(st.conds.map(c=>[c.sk,true]))},'on');
      assert.ok(withB.effects.filter(e=>e.sk==='체인지 부스트').every(e=>!e.rate),'변형 타격에는 체인지 부스트 100%');
      const noKanpa=get('abScoreStats')(structuredClone({...mb,ignore:['간파']}));
      assert.ok(st.score-noKanpa.score<(st.branch.off-noKanpa.branch.off)*0.61,'간파는 나머지 공격 비중만큼만'); }
    // 속성충전 카운터: 불·물·번개·얼음·용 속성 무기는 앙갚음 1, 무속성·상태이상 무기(병 포함)는 5. 병 비중 70%.
    const ctr=w=>{ const x=sa(w,2); return [get('abStyleRow')(x).id, get('abSearchTargets')({b:x,targets:[],gun:{mode:'cycle'},styleGuide:true}).find(t=>t.s==='앙갚음')?.min]; };
    assert.deepStrictEqual(Array.from(ctr('mizu')),['sa-counter-element',1]);
    assert.deepStrictEqual(Array.from(ctr('ore')),['sa-counter-raw',5],'무속성 + 독병');
    assert.deepStrictEqual(Array.from(ctr('puke')),['sa-counter-raw',5],'상태이상 무기');
    assert.strictEqual(get('bdStats')(sa('ratha',2)).phial.share,70);
    const brutal=sa('b-diab'); assert.strictEqual(get('abStyleRow')(brutal).id,'sa-base-brutal');
    assert.ok(!get('abmCandidates')(brutal,{mode:'cycle'}).some(m=>m.guide&&m.name==='변형 공격 강화'),'역회심 무기는 변형 지침 메타 없음');
    assert.ok(get('abPolicy')(brutal,'manual',[]).avoid.includes('변형 공격 강화'));
    assert.strictEqual(get('abDirections')(sa('barr'),{mode:'cycle'})[0].id,'status','마비병은 추가 공격 방향 먼저');
    assert.strictEqual(get('abDirections')(ratha,{mode:'cycle'})[0].id,'morph-critical','일반 무기는 변형 회심 먼저'); }
  // 차지액스 도끼 강화 (2026-10-25): 무속성·상태이상 무기는 연격 지침 메타, 속성 무기는 점수로만.
  { const cb=w=>({...get('bdNewBuild')(),w,wt:'charge-blade',st:2,style20:true}), guide=b=>Array.from(get('abmCandidates')(b,{mode:'cycle'}).filter(m=>m.guide).map(m=>m.name));
    assert.strictEqual(get('bdStylesOf')('charge-blade')[1],'도끼 강화');
    for (const w of ['barr','basa']) { assert.ok(guide(cb(w)).includes('연격'),`${w} 연격 지침`); assert.strictEqual(get('abStyleRow')(cb(w)).id,'cb-axe-raw'); }
    assert.ok(!guide(cb('tobi')).includes('연격')&&guide(cb('tobi')).includes('속전속결'),'속성 무기는 연격 지침 아님'); }
  // 차지액스 검 강화 비연 (2026-10-25): 엑스호퍼 타격에만 → 변형 공격 묶음(35%)에 함께. 묶음 안 100%, 나머지 0.
  { const sw={...get('bdNewBuild')(),w:'tobi',wt:'charge-blade',st:1,style20:true,helm:'bari'}, br=get('bdBranch')(sw);
    assert.deepStrictEqual(Array.from(br.skills),['변형 공격 강화','비연']); assert.strictEqual(br.rate,35);
    const cond={'비연':true}, off=get('bdStats')({...sw,cond},'off'), on=get('bdStats')({...sw,cond},'on');
    assert.ok(!off.effects.some(e=>e.sk==='비연')&&on.effects.some(e=>e.sk==='비연'&&!e.rate),'나머지 공격엔 비연 없음, 엑스호퍼 타격엔 100%'); }
  // 쌍검 기본 (2026-10-25): 무속성은 연격 5 필수·연격·경지 권장, 속성은 연격 점수 비교. 비연 1 필수(20%). 흉회심은 저투자 먼저, 3·5도 비교 (2026-10-28).
  { const db=w=>({...get('bdNewBuild')(),w,wt:'dual-blades'}), req=b=>Array.from(get('abSearchTargets')({b,targets:[],gun:{mode:'cycle'},styleGuide:true}).map(t=>`${t.s}${t.min}`));
    assert.strictEqual(get('abStyleRow')(db('kulu')).id,'db-base-raw'); assert.ok(req(db('kulu')).includes('연격5')&&req(db('kulu')).includes('비연1'));
    assert.strictEqual(get('abStyleRow')(db('mizu')).id,'db-base-element'); assert.ok(!req(db('mizu')).includes('연격5')&&req(db('mizu')).includes('비연1'));
    assert.strictEqual(get('abAssumed')('비연',db('mizu')),true,'규칙 스킬이라 비연 켬'); assert.strictEqual(get('bdRateFor')(db('mizu'),'비연',get('bdWeaponOf')(db('mizu'))),20);
    assert.deepStrictEqual(Array.from(get('abDirections')(db('b-diab'),{mode:'cycle'}).filter(d=>/^brutal/.test(d.id)).map(d=>d.id)),['brutal-low','brutal-3','brutal-5'],'쌍검 흉회심 1/3/5, 저투자 먼저'); }
  // A6 #3 (2026-10-23): 조건부 목록은 점수 계산 없이 bdStats의 conds와 같고, 발동 여부와 무관하다 (차지 묶음 포함).
  for (const [w,wt,st] of [['mizu','long-sword',0],['zino','hammer',1],['jyur','heavy-gun',2],['rathi','insect-glaive',0]]) {
    const b={...get('bdNewBuild')(),w,wt,st,style20:st>0};
    for (const cond of [{}, Object.fromEntries(get('bdCondNames')(b).map(s=>[s,true]))])
      assert.deepStrictEqual(Array.from(get('bdCondNames')(b)),Array.from(get('bdStats')({...b,cond}).conds.map(c=>c.sk)),`조건부 목록: ${w}/${wt}`);
    assert.strictEqual(get('abScoreStats')(structuredClone(b)).score,get('abScoreBuild')(structuredClone(b)));
  }
  // 견인불발 3은 'Lv2의 효과와 더불어'로 회심 +50%를 물려받고, 조건부 후보라 기본은 끔 (2026-10-23).
  { const ls={...get('bdNewBuild')(),w:'mizu',wt:'long-sword'};
    assert.deepStrictEqual(Array.from(get('bdEffects')(get('bdSkillDesc')('견인불발',3),'견인불발',null).map(e=>e.k+e.v)),['crit50']);
    assert.strictEqual(get('abAssumed')('견인불발',ls),false,'견인불발 기본 OFF');
    assert.strictEqual(get('abAssumed')('견인불발',{...ls,_abAssume:{on:['견인불발']}}),true,'컨셉·직접 추가면 ON');
    // 속성 메타: 경지 = 속성 5 + 경지 1~2, 하이 차지 = Lv2 이상 (만들 수 없는 물속성은 없음).
    const hm={...get('bdNewBuild')(),w:'zino',wt:'hammer'}, metas=get('abmCandidates')(hm,{mode:'cycle'});
    const mastery=metas.find(m=>m.skeleton[0].s==='번개속성 공격 강화');
    assert.deepStrictEqual(Array.from(mastery.skeleton.map(t=>`${t.s} ${t.min}~${t.max}`)),['번개속성 공격 강화 5~5','번개속성 공격 강화·경지 1~2']);
    assert.ok(mastery.extra.some(t=>t.s==='하이 차지【번개】'&&t.min===0),'경지 메타에 하이 차지는 점수 후보');
    const hc=metas.find(m=>m.id==='e:high-charge');
    assert.ok(hc&&hc.skeleton[0].s==='하이 차지【번개】'&&hc.skeleton[0].min===2&&hc.extra[0].s==='체력 증강'&&hc.extra[0].min===0);
    // 물속성 하이 차지는 쇼군기자미 머리 1뿐이었지만 아마츠 다리 2로 Lv2 이상이 가능해져 메타가 열린다 (2026-10-23).
    assert.ok(get('abmCandidates')(ls,{mode:'cycle'}).some(m=>m.id==='e:high-charge'),'아마츠 다리로 물 하이 차지 메타');
    // 컨셉 메타: 조건에 맞는 것만, 앉아쏘기 통상탄 컨셉은 첫째 탄 반복·탄 운용 조건 없음.
    const ids=b=>Array.from(get('abmConcepts')(b,{mode:'cycle'}).map(m=>m.id));
    assert.deepStrictEqual(ids(ls),['c:break-chase','c:sp-roar','c:bloodlust','c:laceration-crit']);
    const crouch={...get('bdNewBuild')(),w:'jyur',wt:'heavy-gun',st:2,style20:true};
    assert.ok(ids(crouch).includes('c:laceration-normal'));
    assert.ok(!ids({...crouch,st:1}).includes('c:laceration-normal'),'가드리로드는 제외');
    const cfg=get('abmConfig')(get('abmConcepts')(crouch,{mode:'cycle'}).find(m=>m.id==='c:laceration-normal'),{b:crouch,gun:{mode:'cycle'},targets:[]});
    assert.strictEqual(cfg.gun.mode,'repeat'); assert.strictEqual(cfg.gun.slot,0); assert.strictEqual(cfg.styleGuide,false); }
  // 역회심 무기 (CONCEPTS W2, 2026-10-21): 흉회심 메타가 아니어도 흉회심을 보충 후보로, 흉회심 메타는 1/3/5.
  const bdiab=p=>({...get('bdNewBuild')(),w:'b-diab',wt:'insect-glaive',style20:true,params:[p,p,p]});
  assert.ok(get('abPolicy')(bdiab('atk'),'manual',[{s:'연격·경지',min:2,max:2}]).fillers.includes('흉회심'),'역회심 무기 단일 메타에서도 흉회심 보충');
  assert.ok(!get('abPolicy')(bdiab('crit'),'manual',[{s:'연격·경지',min:2,max:2}]).fillers.includes('흉회심'),'3회심이면 흉회심 보충 없음');
  assert.deepStrictEqual(Array.from(get('abmCandidates')(bdiab('atk'),{mode:'cycle'}).filter(m=>/^d:brutal-/.test(m.id)).map(m=>m.skeleton[0].min)),[1,3,5]);
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
    // 공격력 미공개 무기(수동 선등록)는 빠진다 (2026-10-23).
    assert.deepStrictEqual(Array.from(sets, s => s.key), Array.from(get('bdOrderedSets()').filter(s => s.weapons.some(w => w.t === type.k && w.atk != null)), s => s.key));
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
