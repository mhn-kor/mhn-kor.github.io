/* 제한 탐색 회귀검수: 핵심 충족보다 부위 전체 이득, 명시 최소·운용 가치 유지. */
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const ctx=vm.createContext({console,performance,structuredClone,setTimeout,
  $:()=>({hidden:true,dataset:{},addEventListener(){},setAttribute(){},close(){}}),
  location:{hash:'#build'},window:{},requestAnimationFrame(){},document:{querySelector(){return null;}},
  esc:String,closeOnBackdrop(){},nickAuto(){},localStorage:{getItem(){return null;},setItem(){}}});
for(const f of ['smelt-data.js','skill-desc.js','skill-desc-overrides.js','build-data.js','build-styles.js','build-style-data.js','build.js','build-bowgun-data.js','auto-build.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),ctx);
const get=s=>vm.runInContext(s,ctx), b={...get('bdNewBuild')(),w:'mizu',wt:'long-sword'};
const d=get('abDirections')(b).find(d=>d.id==='elder'), parts=get('BD_PARTS')();
assert.ok(d.targets.every(t=>t.min===0),'일반 권장 미채용 허용');
const negative=get('BUILD.sets').find(s=>s.weapons.some(w=>w.t==='great-sword'&&w.crit<0));
assert.ok(get('abDirections')({...b,w:negative.key,wt:'great-sword'}).every(d=>d.targets.every(t=>t.min===0)),'흉회심 방향도 투자 상한이지 강제 최소가 아님');
assert.ok(get('abSearchTargets')({b,targets:[{s:'물속성 공격 강화·경지',min:1,max:2}]}).some(t=>t.s==='물속성 공격 강화'&&t.min===5));
assert.ok(get('abCompare')({operation:[3],levels:[0],score:100,b},{operation:[1],levels:[5],score:200,b},'priority')<0,'점수 밖 운용 가치 유지');
assert.ok(get('abCompare')({operation:[3],levels:[0],score:100,b},{operation:[1],levels:[5],score:200,b},'score')>0,'점수순은 순수 점수');
// 통제된 장비 집합: 고룡 MAX와 다른 강한 부위의 비교. 실제 공개 스킬 효과 사용.
const add=(key,k,skills)=>get('BUILD.sets').push({key,name:key,weapons:[],pieces:{[k]:{name:key,slot:0,skills}}});
(async()=>{
  for (const [wt,st,id] of [['long-sword',0,'elder'],['lance',2,'critical']]) {
    const weapon={...get('bdNewBuild')(),w:'mizu',wt,st}, direction=get('abDirections')(weapon).find(d=>d.id===id);
    const actual=await get('abSearch')({b:weapon,direction:id,targets:direction.targets,drift:true,lockon:true});
    assert.ok(actual.pool.length,`${wt}/${id}: 실제 후보 생성`);
    const required=get('abSearchTargets')({b:weapon,targets:direction.targets,lockon:true});
    for(const r of actual.pool) {
      const lv=new Map(get('bdTotals')(r.b));
      assert.ok(required.every(t=>(lv.get(t.s)||0)>=t.min));
      if(id==='critical') assert.ok(direction.critMin==null,'회심80% 강제 없음');
    }
    const chosen=get('abBest')(actual.pool,'priority');
    console.log(wt,id,{candidates:actual.pool.length,ms:actual.ms,investments:chosen.map(r=>Array.from(r.levels)),scores:chosen.map(r=>r.score)});
  }
  get('BUILD.sets').forEach(s=>s.pieces={});
  for(const p of parts) add('neutral-'+p.k,p.k,[]);
  add('elder-max','helm',[{s:d.targets[0].s,lv:3}]);
  add('whole-gain','helm',[{s:'추격',lv:5}]);
  const config={b,direction:d.id,targets:d.targets,drift:false,lockon:false,styleGuide:false};
  const result=await get('abSearch')(config);
  assert.ok(!result.limited&&result.pool.length);
  assert.ok(result.pool.some(r=>r.levels[0]===0)&&result.pool.some(r=>r.levels[0]===3),'미채용/MAX 후보 모두 탐색');
  const best=get('abBest')(result.pool,'priority')[0];
  assert.strictEqual(best.b.helm,'whole-gain','고룡MAX보다 전체 이득이 높은 부위 선택');
  for(const r of result.pool) assert.strictEqual(r.score,get('bdStats')(r.b).score,'임의 가중치 없는 공유 점수');
  const forced=await get('abSearch')({...config,targets:config.targets.map((t,i)=>i===0?{...t,min:3}:t)});
  assert.ok(forced.pool.length&&forced.pool.every(r=>r.levels[0]===3),'직접 지정 최소 유지');
  console.log('핵심 미채용/MAX·고룡 교체 이득·운용/점수 분리·명시 최소 검수 통과');
})().catch(e=>{console.error(e);process.exitCode=1;});
