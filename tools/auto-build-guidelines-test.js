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
  // 무기 동작 조건: 무기 특성에 그 동작이 있는 스타일에서만 ON (WEAPONS.md, AB_ASSUME.actions).
  const assumed=(s,b)=>get('abAssumed')(s,b);
  for(const wt of ['long-sword','dual-blades','shield-sword']) {
    assert.strictEqual(assumed('차지 스톡',{wt}),false);
    assert.strictEqual(assumed('비연',{wt}),false);
  }
  assert.strictEqual(assumed('비연',fall),true);
  assert.strictEqual(assumed('비연',{wt:'charge-blade',st:1}),true,'차지액스 검 강화 엑스호퍼는 공중 공격');
  for(const [wt,st,valid] of [['switch-axe',0,true],['switch-axe',1,true],['switch-axe',2,false],['charge-blade',0,false],['charge-blade',1,true],['charge-blade',2,false]])
    assert.strictEqual(assumed('변형 공격 강화',{wt,st}),valid,`변형 공격 강화 ${wt}/${st}`);
  assert.strictEqual(assumed('차지 스톡',{wt:'bow',st:1}),false,'활 회피 근접공격은 모으기 없음');
  assert.strictEqual(assumed('저스트 모으기 해방',{wt:'bow',st:0}),true);
  assert.strictEqual(assumed('공격적인 방어',{wt:'gunlance'}),false,'미확인 동작은 OFF');
  assert.strictEqual(assumed('공격적인 방어',{wt:'great-sword',st:2,w:seed('mizu','great-sword').w}),true);
  // 기본 가정: OFF·조건부 후보·SP 구간·연계 스킬, 사용자 칩·직접 지정.
  for(const s of ['불굴','재난대처능력','그룹 사냥 강화【공격】','힘의 해방','투기 활성','속성 공격 증강【SP】','돌파구'])
    assert.strictEqual(assumed(s,seed('mizu','long-sword')),false,s);
  assert.strictEqual(assumed('투기 활성',{wt:'long-sword',_abAssume:{on:['투기 활성']}}),true);
  assert.strictEqual(assumed('힘의 해방',{wt:'long-sword',_abAssume:{on:['힘의 해방']}}),true);
  assert.strictEqual(assumed('용맹',{wt:'long-sword',_abAssume:{off:['용맹']}}),false);
  // 회심 의지 (CONCEPTS W1): 스타일강화는 회심 파라미터 3개, 미적용은 기본 회심 30% 이상 또는 20% 이상 + 회심 관련 무기 스킬.
  const dirs=b=>Array.from(get('abDirections')(b),d=>d.id);
  const ansan=get('bdOrderedSets().find(s=>s.name==="안쟈나프 아종").key');
  assert.ok(dirs(seed(ansan,'shield-sword')).includes('critical'),'회심 20% + 회심격【속성】 무기 스킬');
  assert.ok(!dirs(seed('mizu','shield-sword')).includes('critical'),'회심 의지 없음');
  assert.ok(dirs({...seed('mizu','shield-sword',1),style20:true,params:['crit','crit','crit']}).includes('critical'),'회심 파라미터 3개');
  const bari={...seed('bari','shield-sword',1),style20:true};
  assert.ok(get('bdStyleInfo')(bari).available&&get('bdWeaponOf')(bari).crit>=20,'스타일 지원 + 기본 회심 20% 검수 무기');
  assert.ok(!dirs({...bari,params:['atk','atk','atk']}).includes('critical'),'기본 회심이 있어도 공격 파라미터면 회심 방향 없음');
  assert.ok(dirs({...bari,params:['crit','crit','crit']}).includes('critical'));
  // 변형 공격 강화 중심: 첫 추천, 회심 100%까지 약점 특효 레벨 자동.
  const water=get('abMonsters("switch-axe").find(s=>s.weapons.find(w=>w.t==="switch-axe").e==="물").key');
  for(const [wt,w,st] of [['switch-axe',water,0],['switch-axe',water,1],['charge-blade','mizu',1]]) {
    const d=get('abDirections')(seed(w,wt,st))[0], crit=get('bdWeaponBase')(seed(w,wt,st)).crit;
    assert.strictEqual(d.id,'morph-critical',`${wt}/${st} 변형 회심 첫 추천`);
    const weak=d.targets.find(t=>t.s==='약점 특효');
    if(crit<20) assert.ok(weak&&[20,25,30,40,50][weak.max-1]>=100-80-crit,`${wt}/${st} 약점 특효 레벨`); else assert.ok(!weak);
  }
  assert.ok(!dirs(seed(water,'switch-axe',2)).includes('morph-critical'),'속성충전 카운터는 변형 없음');
  // 연격: 무기 특성 연속 타격이 있을 때만 ON·핵심. 없으면 가드 무기는 공격적인 방어, 그 외 공격 활성·용맹.
  for(const [wt,st,on] of [['dual-blades',0,true],['bow',1,true],['bow',0,false],['lance',0,false],['switch-axe',0,false],['hammer',1,false]])
    assert.strictEqual(assumed('연격',seed('mizu',wt,st)),on,`연격 ${wt}/${st}`);
  assert.strictEqual(assumed('연격',{...seed('mizu','lance'),_abAssume:{on:['연격']}}),true,'직접 넣은 연격은 켬');
  const core=(wt,st,w='mizu')=>Array.from(get('abDirections')(seed(w,wt,st)),d=>Array.from(d.targets,t=>t.s)).flat();
  const raw=get('abMonsters("lance").find(s=>!s.weapons.find(w=>w.t==="lance").e)').key;
  assert.ok(core('lance',0,raw).includes('공격적인 방어')&&!core('lance',0,raw).includes('연격'),'가드 무기는 공격적인 방어');
  const hraw=get('abMonsters("hammer").find(s=>!s.weapons.find(w=>w.t==="hammer").e)').key;
  assert.ok(core('hammer',0,hraw).includes('공격 활성')&&!core('hammer',0,hraw).includes('연격'),'비가드 무기는 공격 활성·용맹');
  // 기습: 솔로에서 후방을 잡기 쉬운 무기(무기 특성 후방)에서만 ON.
  for(const [wt,st,on] of [['dual-blades',0,true],['long-sword',1,true],['gunlance',1,true],['gunlance',0,false],['great-sword',0,false],['bow',0,false]])
    assert.strictEqual(assumed('기습',seed('mizu',wt,st)),on,`기습 ${wt}/${st}`);
  assert.strictEqual(assumed('기습',{...seed('mizu','great-sword'),_abAssume:{on:['기습']}}),true,'직접 넣은 기습은 켬');
  // 매진은 앞회피로 발동해 불퇴전을 끈다 (불퇴전이 매진을 끄는 게 아님).
  // 불퇴전은 방어구에 없어 연성으로 넣는다. 매진을 쓰는 무기(태도)는 불퇴전 OFF, 매진을 쓰지 않는 랜스는 불퇴전 유지.
  const withBoth=(wt,st)=>{ const x={...seed('mizu',wt,st),belt:'quem'};
    x.ds={...x.ds,belt:Array(get('bdSlotCount')(x,'belt')).fill(null)}; assert.ok(x.ds.belt.length,'검수용 연성 칸');
    x.ds.belt[0]={s:'불퇴전',c:get('abStonePool()').get('불퇴전')}; get('abScoreBuild')(x); return x.cond; };
  // 불퇴전: 가드·카운터 무기에서만 ON.
  for(const [wt,st,on] of [['lance',0,true],['shield-sword',0,true],['switch-axe',2,true],['great-sword',0,true],['long-sword',0,true],['charge-blade',1,true],['hammer',1,true],['hammer',0,false],['dual-blades',0,false],['switch-axe',0,false]]) {
    assert.strictEqual(assumed('불퇴전',seed('mizu',wt,st)),on,`불퇴전 ${wt}/${st}`);
    assert.strictEqual(assumed('매진',seed('mizu',wt,st)),!on,`매진 ${wt}/${st}`);
  }
  const ls=withBoth('shield-sword',0), ln=withBoth('lance',2), us={...ls};
  assert.ok(ls['매진']===false&&ls['불퇴전']===true,'가드·카운터 보유 무기는 매진 OFF·불퇴전 유지');
  assert.ok(ln['매진']===false&&ln['불퇴전']===true,'랜스는 매진 비권장이라 불퇴전 유지');
  assert.ok(get('abStyleRule')(seed('mizu','lance',2)).avoid.includes('매진'),'랜스는 매진 비권장');
  const levels=get('(l=>new Map(l))')([['귀화 망토',1]]);
  assert.strictEqual(get('abAssumed')('돌파구',{wt:'long-sword'},{lv:levels}),true,'자체 상태이상이 있으면 돌파구 ON');
  assert.strictEqual(get('abAssumed')('돌파구',{wt:'long-sword'},{fill:true}),true,'자동 보충 후보로는 유지');
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
  const best=get('abBest')(result.pool);
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
