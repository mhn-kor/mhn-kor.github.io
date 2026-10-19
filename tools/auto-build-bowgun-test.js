const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const ctx = vm.createContext({ console, performance, structuredClone, setTimeout,
  $: () => ({hidden:true,dataset:{},addEventListener(){},setAttribute(){},close(){}}), location:{hash:'#build'}, window:{}, requestAnimationFrame(){},
  document:{querySelector(){return null;}}, esc:String, closeOnBackdrop(){}, nickAuto(){},
  localStorage:{getItem(){return null;},setItem(){}} });
for (const file of ['smelt-data.js','skill-desc.js','skill-desc-overrides.js','build-data.js','build-styles.js','build-style-data.js','build.js','build-bowgun-data.js','auto-build.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
const get = code => vm.runInContext(code,ctx), info = get('abGunInfo');
const seed = (w,wt,st=0) => ({...get('bdNewBuild')(),w,wt,st,style20:st>0}); // 스타일 선택은 Lv20 기준
for (const [key, row] of Object.entries(get('BD_BOWGUN_DATA.weapons'))) {
  const [w,wt] = key.split('/'), g = info(seed(w,wt));
  assert.ok(!g.unknown,key);
  for (const [field, skill] of [['recoil','반동 경감'],['reload','장전 속도']]) {
    const expected = Math.max(...row.ammo.map(a=>a[field].indexOf(Math.min(...a[field]))));
    assert.strictEqual(g.required.find(t=>t.s===skill)?.min || 0,expected,key+'/'+skill);
  }
}
for (const key of ['rathi/light-gun','s-ratha/light-gun','e-odog/light-gun','magn/heavy-gun','bone/heavy-gun']) {
  const [w,wt]=key.split('/'); assert.ok(info(seed(w,wt)).unknown,key);
}
for (const [wt,st,avoid] of [['light-gun',1,'반동 경감'],['light-gun',2,'장전 속도'],['heavy-gun',1,'장전 속도'],['heavy-gun',2,'반동 경감']]) {
  const b=seed('mizu',wt,st), g=info(b);
  assert.ok(g.avoid.includes(avoid)); assert.ok(!g.required.some(t=>t.s===avoid));
  assert.strictEqual(info(b,{mode:'sp'}).mode,'cycle');
  if (g.modes.some(([id])=>id==='repeat')) {
    const r=info(b,{mode:'repeat',slot:999});
    assert.strictEqual(r.ammo.length,1);
    assert.strictEqual(get('abAmmoPreference')(r.ammo[0].name),Math.max(...r.slots.map(a=>get('abAmmoPreference')(a.name))));
    assert.strictEqual(r.required.find(t=>t.s==='회피 장전').min,4);
  }
}
const repeat=info(seed('mizu','light-gun',1),{mode:'repeat'});
assert.deepStrictEqual([repeat.required[0].s,repeat.required[0].min,repeat.required[0].max],['회피 장전',4,4]);
assert.strictEqual(info(seed('mizu','light-gun',1),{mode:'repeat',reload5:true}).required[0].max,5);
const saved=get('BD_BOWGUN_DATA.weapons')["mizu/light-gun"], fingerprint=saved.x;
saved.x=['다른 탄 1']; assert.ok(info(seed('mizu','light-gun')).unknown,'stale mapping rejected'); saved.x=fingerprint;
const wyvernKey=Object.keys(get('BD_BOWGUN_DATA.weapons')).find(k=>k.endsWith('/heavy-gun') && get('BD_BOWGUN_DATA.weapons')[k].x.some(a=>a.includes('용격탄')));
const wyvern=seed(wyvernKey.split('/')[0],'heavy-gun',2), sp=info(wyvern,{mode:'sp'});
assert.strictEqual(sp.mode,'sp'); assert.ok(sp.ammo[0].name.includes('용격탄'));
for (const skill of ['특수 게이지 가속','특수 게이지 가속【저스트 회피】']) assert.strictEqual(sp.required.find(t=>t.s===skill).min,3);
const dodge=sp.required.find(t=>t.s==='절대 회피【SP】'); assert.deepStrictEqual([dodge.min,dodge.max],[1,3]);
assert.strictEqual(info({...wyvern,st:1},{mode:'sp'}).mode,'cycle');
assert.ok(!get('abSearchTargets')({b:wyvern,gun:{mode:'sp'},targets:[],styleGuide:false}).length);
// Selected ammo, not other ammo in the same weapon, determines ammo boost applicability.
for (const skill of Object.keys(get('BD_AMMO_BOOST'))) {
  const weapon=get('abGunWeapon')(wyvern,{mode:'sp'});
  assert.ok(!get('bdAmmoBoostApplies')(skill,weapon),'용격탄 반복에 통상·참렬 강화 제외');
}
const before=JSON.stringify(get('BUILD'));
(async()=>{
  for (const [b,gun] of [[seed('mizu','light-gun',1),{mode:'cycle'}],[seed('mizu','light-gun',2),{mode:'cycle'}],
    [seed('mizu','light-gun',1),{mode:'repeat'}],[seed('mizu','heavy-gun',1),{mode:'cycle'}],
    [seed('mizu','heavy-gun',2),{mode:'repeat'}],[wyvern,{mode:'sp'}]]) {
    const d=get('abDirections')(b,gun)[0], config={b,gun,targets:d.targets,direction:d.id,drift:true,styleGuide:true};
    const original=JSON.stringify(b), result=await get('abSearch')(config);
    assert.strictEqual(JSON.stringify(b),original,'input preserved');
    assert.ok(result.pool.length,`${b.w}/${b.wt}/${gun.mode}: no candidates`);
    const required=get('abSearchTargets')(config);
    for (const r of result.pool) {
      const totals=new Map(get('bdTotals')(r.b));
      for (const t of required) assert.ok((totals.get(t.s)||0)>=t.min,t.s);
      assert.strictEqual(r.score,get('bdStats')(r.b).score);
      const parsed=get('bdParse')(get('bdShareParam')(r.b),'보우건 검수');
      assert.ok(parsed); assert.strictEqual(get('bdStats')(parsed).score,r.score);
    }
    console.log(b.w,b.wt,gun.mode,result.pool.length,'candidates',result.ms,'ms');
  }
  assert.strictEqual(JSON.stringify(get('BUILD')),before,'base data preserved');
  console.log('보우건 운용 및 실제 추천 검수 통과');
})().catch(e=>{console.error(e);process.exitCode=1;});
