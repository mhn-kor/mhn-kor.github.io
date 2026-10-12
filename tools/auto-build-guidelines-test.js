/* 실제 데이터/추천 함수를 사용하는 지침 회귀검수 및 전 소재 탐색 감사. DOM은 출력만 대체. */
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path'),crypto=require('crypto');
const root=path.join(__dirname,'..'), files=['smelt-data.js','skill-desc.js','skill-desc-overrides.js','build-data.js','build-styles.js','build-style-data.js','build.js','build-bowgun-data.js','auto-build.js'];
const ctx=vm.createContext({console,performance,structuredClone,setTimeout,
  $:()=>({hidden:true,dataset:{},addEventListener(){},setAttribute(){},close(){}}),
  location:{hash:'#build'},window:{},requestAnimationFrame(){},document:{querySelector(){return null;}},
  esc:String,closeOnBackdrop(){},nickAuto(){},localStorage:{getItem(){return null;},setItem(){}}});
for(const f of files) vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx);
const get=s=>vm.runInContext(s,ctx), seed=(w,wt,st=0)=>({...get('bdNewBuild')(),w,wt,st});
function rules() {
  const lance=seed('mizu','lance'), rule=get('abStyleRule')(lance);
  assert.deepStrictEqual(Array.from(rule.required,t=>[t.s,t.min,t.max]),[['가드 성능',2,3]]);
  assert.ok(rule.recommended.every(t=>t.min===0));
  for(const st of [0,2]) assert.strictEqual(get('abStyleRule')(seed('mizu','shield-sword',st)).required[0].min,5);
  assert.strictEqual(get('abStyleRule')(seed('mizu','shield-sword',1)).required.length,0);
  const fall={...seed('mizu','shield-sword'),snsMode:'fallbash'};
  assert.ok(get('abDirections')(fall).every(d=>d.targets.some(t=>t.s==='저스트 교격')));
  assert.ok(get('abSupportSkills')(fall).includes('저스트 교격'));
  assert.ok(!get('abSupportSkills')(seed('mizu','shield-sword')).includes('저스트 교격'));
  get('BUILD.sets').push({key:'test-guide',name:'검수',weapons:[],pieces:{helm:{slot:0,skills:[{s:'저스트 교격',lv:5}]}}});
  const on={...fall,helm:'test-guide',cond:{'저스트 교격':true}}, off={...on,cond:{}};
  assert.ok(get('bdStats')(on).score>get('bdStats')(off).score);
  assert.strictEqual(get('bdStats')({...on,snsMode:'guard'}).score,get('bdStats')({...off,snsMode:'guard'}).score);
  assert.strictEqual(get('bdStats')(get('bdParse')(get('bdShareParam')(on))).score,get('bdStats')(on).score);
  get('BUILD.sets').pop();
  for(const element of ['물','독',null]) {
    const set=get('BUILD.sets').find(s=>s.weapons.some(w=>w.t==='great-sword'&&(w.e||null)===element));
    const b=seed(set.key,'great-sword');
    assert.strictEqual(get('abStyleRule')(b).recommended[0].s,element ? '차지 마스터' : '저스트 모으기 해방');
    assert.strictEqual(get('abStyleRule')({...b,st:1}).recommended.length,0);
    assert.strictEqual(get('abStyleRule')({...b,st:2}).recommended[0].s,get('abStyleRule')(b).recommended[0].s);
  }
  const tier=get('abBuffTier');
  for(let pct=0;pct<2;pct++) for(const k of ['dmg','atk','ele']) for(let cond=0;cond<2;cond++)
    assert.strictEqual(tier([{k,pct,cond,v:10}]),(pct?0:4)+(k==='dmg'?1:3)+cond);
  assert.strictEqual(tier([{k:'crit',v:10}]),9);
  assert.strictEqual(tier([{k:'atk',pct:1,v:10},{k:'ele',v:100}]),9);
  for(const wt of ['long-sword','dual-blades','shield-sword']) {
    assert.strictEqual(get('abScopeApplies')({scope:'모으기 공격 기준'},{wt}),false);
    assert.strictEqual(get('abScopeApplies')({scope:'공중 공격 기준'},{wt}),false);
  }
  assert.strictEqual(get('abScopeApplies')({scope:'공중 공격 기준'},fall),true);
  for(const t of ['shield-sword','great-sword','long-sword','hammer','bow'])
    assert.strictEqual(get('bdEffects')(get('bdSkillDesc')('포술',5),'포술',{t}).length,0,'무관한 포술 효과 제외');
  for(const [ammo,distance,artillery,crit] of [['통상탄',true,false,true],['산탄',true,false,true],['관통전격탄',true,false,true],
    ['참렬빙결탄',false,false,true],['철갑유탄',false,true,false],['용격탄',false,true,false],['확산수냉탄',false,false,false]]) {
    const weapon={t:'heavy-gun',e:'물',x:[ammo+' 3']};
    for(const [skill,valid] of [['적정 거리 위력 UP',distance],['포술',artillery]])
      assert.strictEqual(get('bdEffects')(get('bdSkillDesc')(skill,5),skill,weapon).length>0,valid,ammo+'/'+skill);
    get('BUILD.sets').push({key:'test-ammo',name:'검수',weaponSkills:[],weapons:[{...get('bdWeaponOf')(seed('mizu','heavy-gun')),x:[ammo+' 3']}],pieces:{}});
    const b={...seed('test-ammo','heavy-gun'),ammoSlot:0};
    assert.strictEqual(get('bdStats')(b).critApplies,crit,ammo);
    assert.strictEqual(get('bdCompareAmmo')(get('bdParse')(get('bdShareParam')(b))),ammo+' 3');
    get('BUILD.sets').pop();
  }
  const pref=get('abAmmoPreference');
  assert.ok(pref('통상탄')<pref('산탄')&&pref('산탄')<pref('관통탄'));
  assert.strictEqual(pref('관통탄'),pref('참렬탄')); assert.strictEqual(pref('용격탄'),pref('확산탄'));
  assert.strictEqual(pref('철갑유탄'),0,'미지정 선호를 만들지 않음');
  const status=get('BUILD.sets').find(s=>s.weapons.some(w=>w.t==='great-sword'&&w.e==='독'));
  const b=seed(status.key,'great-sword'), stats=get('bdStats')(b);
  assert.strictEqual(stats.score,Math.round(stats.now.atk*stats.co.G));
  console.log('W1~W10/B5 적용·예외 회귀검수 통과');
}
function cases() {
  const rows=[];
  for(const type of get('BUILD.weaponTypes')) for(const set of get('abMonsters')(type.k)) {
    const b=seed(set.key,type.k); rows.push({b,label:set.name+'/'+type.n+'/기본'});
    if(get('bdStyleInfo')(b).selectable) for(let st=1;st<=get('bdStylesOf')(type.k).length;st++)
      rows.push({b:seed(set.key,type.k,st),label:set.name+'/'+type.n+'/'+get('bdStylesOf')(type.k)[st-1]});
    if(type.k==='shield-sword') rows.push({b:{...b,snsMode:'fallbash'},label:set.name+'/'+type.n+'/폴배시'});
  }
  return rows;
}
async function run(row, direction, gun) {
  const config={b:row.b,direction:direction.id,targets:direction.targets,gun,drift:true,lockon:get('abMelee')(row.b.wt),styleGuide:true};
  const original=JSON.stringify(row.b), result=await get('abSearch')(config), requirements=get('abSearchTargets')(config);
  assert.strictEqual(JSON.stringify(row.b),original,'입력 보존');
  for(const r of result.pool) {
    const totals=new Map(get('bdTotals')(r.b));
    assert.ok(requirements.every(t=>(totals.get(t.s)||0)>=t.min),'확정 최소 누락');
    assert.ok(!direction.critMin||get('bdStats')(r.b).now.crit>=direction.critMin);
    assert.strictEqual(r.score,get('bdStats')(r.b).score,'점수 가중치 혼입');
    assert.ok(Number.isFinite(r.score));
    for(const p of get('BD_PARTS')()) assert.ok(r.b.ds[p.k].filter(Boolean).length<=get('bdSlotCount')(r.b,p.k));
    assert.ok(!Object.entries(r.b.cond).some(([s,on])=>on&&get('abSP')(s)));
  }
  const best=get('abBest')(result.pool,'priority');
  assert.ok(best.length<=5&&new Set(best.map(r=>get('abSignature')(r.b))).size===best.length);
  if(best[0]) assert.strictEqual(get('bdStats')(get('bdParse')(get('bdShareParam')(best[0].b))).score,best[0].score,'가져오기 계산 보존');
  return {label:row.label,w:row.b.w,wt:row.b.wt,st:row.b.st,direction:direction.id,
    status:result.limited?'limited':result.pool.length?'pass':'no-candidate',unknown:!!get('abGunInfo')(row.b,gun)?.unknown,
    valid:result.pool.length,expanded:result.expanded,evaluated:result.evaluated,ms:result.ms,score:best[0]?.score};
}
(async()=>{
  if(process.argv.includes('--merge')) {
    const shards=[0,1].map(i=>JSON.parse(fs.readFileSync(path.join(__dirname,'data',`auto-build-audit-${i}.json`),'utf8')));
    for(const shard of shards) for(const [f,hash] of Object.entries(shard.hashes))
      assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex'),hash,'감사 실행 후 소스 변경: '+f);
    const results=shards.flatMap(s=>s.results), expected=cases();
    assert.strictEqual(results.length,expected.length); assert.strictEqual(new Set(results.map(r=>r.label)).size,expected.length);
    assert.ok(expected.every(row=>results.some(r=>r.label===row.label)),'누락 설정');
    const summary=results.reduce((n,r)=>(n[r.status]=(n[r.status]||0)+1,n),{});
    const unknown=[...new Set(results.filter(r=>r.unknown).map(r=>r.w+'/'+r.wt))];
    fs.writeFileSync(path.join(__dirname,'data','auto-build-audit.json'),JSON.stringify({date:new Date().toISOString(),hashes:shards[0].hashes,
      scope:shards[0].scope,summary,unknown,results},null,2));
    console.log(JSON.stringify({total:results.length,basic:results.filter(r=>r.st===0&&!r.label.endsWith('/폴배시')).length,summary,unknown,
      issues:results.filter(r=>r.status!=='pass'),expanded:results.reduce((n,r)=>n+(r.expanded||0),0),evaluated:results.reduce((n,r)=>n+(r.evaluated||0),0)},null,2));
    return;
  }
  rules();
  if(!process.argv.includes('--all')) {
    for(const row of cases().filter(r=>r.b.w==='mizu'&&['lance','shield-sword','great-sword'].includes(r.b.wt)))
      for(const d of get('abDirections')(row.b)) console.log(await run(row,d));
    return;
  }
  const spec=process.argv.find(s=>s.startsWith('--shard='))?.split('=')[1]||'0/1', [index,count]=spec.split('/').map(Number);
  const selected=cases().filter((_,i)=>i%count===index), results=[];
  const hashes=Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
  for(const row of selected) {
    const d=get('abDirections')(row.b)[0];
    try {results.push(d ? await run(row,d) : {label:row.label,status:'no-direction'});}
    catch(e){results.push({label:row.label,status:'error',error:e.stack});}
    if(results.length%10===0) console.log(`${index}/${count}: ${results.length}/${selected.length}`,results.at(-1));
  }
  const summary=results.reduce((n,r)=>(n[r.status]=(n[r.status]||0)+1,n),{});
  fs.writeFileSync(path.join(__dirname,'data',`auto-build-audit-${index}.json`),JSON.stringify({date:new Date().toISOString(),spec,hashes,
    scope:'모든 소재/무기군 기본 및 선택 가능한 스타일, 한손검 폴배시. 각 설정의 첫 추천 방향, 연성ON·근접 록온ON·강화OFF. 전 파라미터/방향 조합은 아님.',summary,results},null,2));
  console.log('전수 실제 탐색 완료',summary);
  if(results.some(r=>r.status==='error'||r.status==='no-direction')) process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
