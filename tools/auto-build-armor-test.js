const fs=require('fs'), vm=require('vm'), assert=require('assert'), path=require('path');
const ctx=vm.createContext({console,performance,structuredClone,setTimeout,
  $:()=>({hidden:true,dataset:{},addEventListener(){},setAttribute(){},close(){}}),
  location:{hash:'#build'},window:{},requestAnimationFrame(){},document:{querySelector(){return null;}},
  esc:String,closeOnBackdrop(){},nickAuto(){},localStorage:{getItem(){return null;},setItem(){}}});
for(const file of ['smelt-data.js','skill-desc.js','skill-desc-overrides.js','build-data.js','build-styles.js','build-style-data.js','build.js','build-bowgun-data.js','auto-build.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
const get=s=>vm.runInContext(s,ctx), seed=get('structuredClone(abState.b)'), stones=get('abStonePool')();
const targets=['공격','간파','기습'].map(s=>({s,min:1,max:1}));
assert.ok(targets.every(t=>stones.has(t.s)));
const policy=get('abPolicy')(seed,'manual',targets), evaluate=get('abArmorEvaluator')(seed,targets,policy,stones);
const original=get('structuredClone(BUILD.sets)'), parts=get('BD_PARTS')();
const fixed=get('abSupportSkills')(seed).filter(s=>!stones.has(s)).slice(0,5);
assert.strictEqual(fixed.length,5);
// Same useful skill, different sockets: sockets alone never change armor value.
const add=(key,part,skills,slot)=>get('BUILD.sets').push({key,name:key,weapons:[],pieces:{[part]:{name:key,skills,slot}}});
add('armor-one','helm',[{s:fixed[0],lv:1}],1); add('armor-two','helm',[{s:fixed[0],lv:1}],2);
assert.deepStrictEqual(Array.from(evaluate({...seed,helm:'armor-one'})),Array.from(evaluate({...seed,helm:'armor-two'})));
add('dense-three','helm',[{s:'공격',lv:3}],1); add('dense-two','helm',[{s:'공격',lv:2}],1);
const dense=get('abArmorEvaluator')(seed,[{s:'공격',min:1,max:5}],get('abPolicy')(seed,'manual',[{s:'공격',min:1,max:5}]),stones);
assert.ok(get('abArmorCompare')(dense({...seed,helm:'dense-three'}),dense({...seed,helm:'dense-two'}))<0);
assert.ok(evaluate({...seed,helm:'armor-one'})[0]>evaluate({...seed,helm:'dense-three'})[0],'nonreplaceable useful skill preferred');
add('utility','helm',[{s:'귀마개',lv:5},{s:'풍압 내성',lv:5}],2);
assert.strictEqual(evaluate({...seed,helm:'utility'})[2],0,'irrelevant utility does not inflate density');
add('duration','helm',[{s:'강화 지속',lv:1}],1);
assert.ok(get('abArmorEvaluator')({...seed,wt:'lance'},[],get('abPolicy')({...seed,wt:'lance'},'manual',[]),stones)({...seed,helm:'duration'})[2]>0);
assert.strictEqual(evaluate({...seed,helm:'duration'})[2],0,'unsupported weapon duration excluded');
// Controlled full search: useful 1-slot armor beats empty 2-slot armor, unless minimum slots require it.
get('BUILD.sets').forEach(s=>s.pieces={});
for(let i=0;i<parts.length;i++) {
  add('useful-'+i,parts[i].k,[{s:fixed[i],lv:1}],1);
  add('slots-'+i,parts[i].k,[{s:'귀마개',lv:1}],2);
}
(async()=>{
  try {
    const config={b:seed,direction:'manual',targets,drift:true,lockon:false,styleGuide:false};
    const result=await get('abSearch')(config), best=get('abBest')(result.pool);
    // 메인 스킬 활용도 조건: 기본 스킬이 쓸모없는 2소켓 장비는 연성 칸 때문에 채용되지 않는다.
    assert.ok(best.length); assert.ok(result.pool.every(r=>parts.every(p=>r.b[p.k].startsWith('useful-'))),'main gear must not be socket bait');
    assert.ok(result.pool.every(r=>r.driftOnly.every(Boolean)));
    const expensive=await get('abSearch')({...config,targets:targets.map(t=>({...t,min:2,max:2}))});
    assert.ok(expensive.pool.length,'preserve feasible 6-slot combinations');
    assert.ok(expensive.pool.every(r=>parts.reduce((n,p)=>n+get('bdSlotCount')(r.b,p.k),0)>=6));
    for(const r of [...result.pool,...expensive.pool]) assert.strictEqual(r.score,get('bdStats')(r.b).score,'no bonus in damage score');
    console.log('방어구 기본 스킬·연성 대체 비용·필수 슬롯 검수 통과');
  } finally { get('BUILD').sets=original; }
})().catch(e=>{console.error(e);process.exitCode=1;});
