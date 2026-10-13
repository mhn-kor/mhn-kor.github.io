/* A0: 통제된 교체/연성 묶음과 실제 데이터의 ON/OFF·운용·비용을 검수. */
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const ctx=vm.createContext({console,performance,structuredClone,setTimeout,
  $:()=>({hidden:true,dataset:{},addEventListener(){},setAttribute(){},close(){}}),
  location:{hash:'#build'},window:{},requestAnimationFrame(){},document:{querySelector(){return null;}},
  esc:String,closeOnBackdrop(){},nickAuto(){},localStorage:{getItem(){return null;},setItem(){}}});
for(const f of ['smelt-data.js','skill-desc.js','skill-desc-overrides.js','build-data.js','build-styles.js','build-style-data.js','build.js','build-bowgun-data.js','auto-build.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),ctx);
const get=s=>vm.runInContext(s,ctx), seed={...get('bdNewBuild')(),w:'mizu',wt:'long-sword'}, parts=get('BD_PARTS')();
const targets=get('abTargets')(['물속성 공격 강화','물속성 공격 강화·경지','추격']).map(t=>({...t,user:true}));
const policy=get('abResolvePolicy')(seed,targets,get('abPolicy')(seed,'manual',targets,false));
const metric=(score,baseScore,operation,drifts)=>({score,baseScore,operation,drifts,policyKey:'same'});
assert.ok(get('abDominates')(metric(110,90,[2],2),metric(100,80,[1],3)));
assert.ok(!get('abDominates')(metric(110,70,[2],2),metric(100,80,[1],3)),'OFF 효율 손실이면 장단점 대안');
assert.ok(!get('abDominates')(metric(110,90,[0],2),metric(100,80,[1],3)),'운용 손실이면 장단점 대안');
assert.ok(!get('abDominates')({...metric(110,90,[2],2),policyKey:'different'},metric(100,80,[1],3)));
assert.ok(get('abDirections')(seed).find(d=>d.id==='critical').critMin==null);
get('BUILD.sets').forEach(s=>s.pieces={});
const add=(key,k,skills,slot=0)=>get('BUILD.sets').push({key,name:key,weapons:[],pieces:{[k]:{name:key,slot,skills}}});
for(const p of parts){add('neutral-'+p.k,p.k,[]);seed[p.k]='neutral-'+p.k;}
add('pair-old','helm',[{s:'추격',lv:1}]);add('pair-water','gloves',[{s:'물속성 공격 강화',lv:4}]);
add('pair-new','helm',[{s:'물속성 공격 강화',lv:1}]);add('pair-mastery','mail',[{s:'물속성 공격 강화·경지',lv:1}]);
seed.helm='pair-old';seed.gloves='pair-water';
const snapshot=JSON.stringify(seed), evaluate=b=>get('abEvaluateCandidate')(structuredClone(b),targets,policy);
const before=evaluate(seed), head=evaluate({...seed,helm:'pair-new'}), chest=evaluate({...seed,mail:'pair-mastery'});
const coupled=evaluate({...seed,helm:'pair-new',mail:'pair-mastery'});
console.log('교체 통제 점수',{before:before.score,head:head.score,chest:chest.score,coupled:coupled.score});
assert.ok(before.score>before.baseScore,'조건ON/OFF 별도 계산');
assert.ok(head.score<before.score&&chest.score===before.score&&coupled.score>before.score,'단일 교체 무이득/손해, 두부위 연계 이득');
assert.strictEqual(JSON.stringify(seed),snapshot,'기존 구성·조건 변경 없음');
const registry=parts.map(p=>({part:p.k,rows:get('bdOrderedSets')().filter(s=>s.pieces[p.k]).map(s=>({key:s.key,piece:s.pieces[p.k]}))}));
(async()=>{
  const repaired=await get('abRepairBuilds')([before],registry,targets,policy,{drift:false},performance.now(),()=>{},()=>false);
  const winner=repaired.pool.find(r=>r.b.helm==='pair-new'&&r.b.mail==='pair-mastery');
  assert.ok(winner&&winner.score>before.score,'나머지 부위·공급자 보완 경로에서 실제 유리한 연계안 발견');
  assert.ok(winner.evidence.changedParts.length>=2&&winner.evidence.scoreDelta===winner.score-before.score);
  assert.ok(winner.evidence.baseDelta===winner.baseScore-before.baseScore);
  const explanation=get('abOpportunityUI')(winner);
  assert.ok(explanation.includes('ON')&&explanation.includes('OFF')&&explanation.includes('연성'),'실제 비교 근거 출력');
  const representatives=get('abBest')([before,...repaired.pool],'priority');
  assert.ok(representatives.length&&representatives.length<=5);
  assert.ok(representatives.every(r=>r.role&&Number.isFinite(r.baseScore)),'역할별 제목·OFF 점수 제공');
  assert.ok(representatives.every(r=>!get('abFrontier')([before,...repaired.pool]).some(x=>get('abDominates')(x,r))));
  // 표류연성으로만 속성5+경지1을 완성하는 문턱 사례. 한칸씩의 탐욕 채우기에 의존하지 않음.
  add('bundle','helm',[{s:'물속성 공격 강화·경지',lv:1}],2);
  const bundle={...seed,helm:'bundle',mail:'neutral-mail'}, hard=targets.map(t=>({...t,min:0}));
  const p=get('abResolvePolicy')(bundle,hard,get('abPolicy')(bundle,'manual',hard,false));
  let calls=0;const states=get('abSearchDriftStates')(bundle,hard,p,()=>++calls>300,8);
  assert.ok(states.some(r=>(new Map(get('bdTotals')(r.b)).get('물속성 공격 강화')||0)>=5),'필요 레벨 묶음 보존');
  for(const r of states){assert.strictEqual(r.score,get('bdStats')(r.b).score);assert.ok(r.drifts<=2);}
  // 수동 최소·록온은 비교 점수와 무관하게 자격 검사.
  assert.strictEqual(get('abEvaluateCandidate')(bundle,[...hard,{s:'록온',min:1,max:1}],p),null);
  assert.strictEqual(await get('abSearch')({b:seed,targets,drift:false,styleGuide:false},()=>{},()=>true),null);
  console.log('A0 ON/OFF·우열/장단점·연계교체·실제 비교증거·경지 묶음·필수·원본 보존 통과',repaired.jobs,'교체 구성');
})().catch(e=>{console.error(e);process.exitCode=1;});
