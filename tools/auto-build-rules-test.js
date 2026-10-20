/* docs/weapons/*.md 운용 규칙 표와 auto-build.js AB_RULES의 1:1 일치 검수. 한쪽만 고치면 실패한다. */
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.join(__dirname,'..');
const ctx=vm.createContext({console,performance,structuredClone,setTimeout,
  $:()=>({hidden:true,dataset:{},addEventListener(){},setAttribute(){},close(){}}),
  location:{hash:'#build'},window:{},requestAnimationFrame(){},document:{querySelector(){return null;}},
  esc:String,closeOnBackdrop(){},nickAuto(){},localStorage:{getItem(){return null;},setItem(){}}});
for(const f of ['smelt-data.js','skill-desc.js','skill-desc-overrides.js','build-data.js','build-styles.js','build-style-data.js','build.js','build-bowgun-data.js','auto-build.js'])
  vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx);
const get=s=>vm.runInContext(s,ctx), rules=get('AB_RULES'), abMax=get('abMax');
const dir=path.join(root,'docs','weapons'), rows=new Map();
for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.md'))) {
  let cols=null;
  for(const line of fs.readFileSync(path.join(dir,file),'utf8').split('\n')) {
    const cells=line.split('|').slice(1,-1).map(c=>c.trim());
    if(cells[0]==='ID') { cols=Object.fromEntries(cells.map((c,i)=>[c,i])); continue; }
    const id=cells[0]?.match(/^`(.+)`$/)?.[1];
    if(!id||!cols) continue;
    assert.ok(!rows.has(id),'문서 ID 중복: '+id);
    rows.set(id,{file,required:cells[cols['필수 최소']],recommended:cells[cols['권장']],avoid:cells[cols['비권장']],metas:cells[cols['지침 메타']],status:cells[cols['상태 · 근거']]});
  }
}
const fmt=list=>list.map(t=>t.min===t.max?`${t.s} ${t.min}`:`${t.s} ${t.min}~${t.max}`).join(' · ')||'—';
const names=list=>list.join(' · ')||'—';
const known=new Set([...Object.keys(get('BUILD.maxLv')),...get('abStonePool')().keys()]);
const data=[...rules.styles.map(r=>[r.id,r]),...Object.entries(rules.gunModes).map(([k,m])=>['gun-'+k,{required:m.required,recommended:[],avoid:m.avoid||[]}])];
for(const [id,r] of data) {
  const row=rows.get(id);
  assert.ok(row,`운용 가이드 규칙 표에 없음: ${id}`);
  assert.ok(row.status.startsWith('구현'),`구현 규칙의 상태 표기: ${id}`);
  // 보우건 스타일의 필수 칸 'B1' = 탄 자료로 계산하는 반동·장전 요구 (데이터 행 아님).
  assert.strictEqual(row.required.replace(/^B1( · )?/,'')||'—',fmt(r.required),`필수 불일치: ${id}`);
  assert.strictEqual(row.recommended,fmt(r.recommended),`권장 불일치: ${id}`);
  assert.strictEqual(row.avoid,names(r.avoid),`비권장 불일치: ${id}`);
  assert.strictEqual(row.metas,names(r.metas||[]),`지침 메타 불일치: ${id}`);
  for(const s of r.metas||[]) assert.ok(known.has(s),`없는 스킬: ${id}/${s}`);
  for(const t of [...r.required,...r.recommended]) {
    assert.ok(known.has(t.s),`없는 스킬: ${id}/${t.s}`);
    const max=t.max==='MAX'?abMax(t.s):t.max;
    assert.ok(t.min>=0&&t.min<=max&&max<=abMax(t.s),`레벨 범위: ${id}/${t.s}`);
  }
  for(const s of r.avoid) assert.ok(known.has(s),`없는 스킬: ${id}/${s}`);
}
for(const id of rows.keys()) assert.ok(data.some(([x])=>x===id),`AB_RULES에 없는 문서 ID: ${id}`);
// 모든 무기가 무기 특성 표에 나오고, 모든 무기·스타일에 운용 가이드 파일이 있다.
const weapons=fs.readFileSync(path.join(root,'docs','WEAPONS.md'),'utf8');
for(const t of get('BUILD.weaponTypes')) {
  assert.ok(weapons.includes(`| ${t.n} |`),`무기 특성 누락: ${t.n}`);
  const file=['light-gun','heavy-gun'].includes(t.k)?'bowgun':t.k;
  assert.ok(fs.existsSync(path.join(dir,file+'.md')),`운용 가이드 파일 누락: ${file}.md`);
}
for(const r of rules.styles) for(const st of [].concat(r.style)) if(st)
  assert.ok(get('bdStylesOf')(r.wt).includes(st),`게임 데이터에 없는 스타일: ${r.id}/${st}`);
// 무기 특성 표 ↔ AB_TRAITS ([기본, 스타일1, 스타일2]의 [있음, 없음]).
const traits=get('AB_TRAITS'), tableRows=s=>s.split('\n').map(l=>l.split('|').slice(1,-1).map(c=>c.trim())).filter(c=>c.length>3);
let traitRows=0;
for(const [name,style,has,no] of tableRows(weapons)) {
  const t=get('BUILD.weaponTypes').find(x=>x.n===name);
  if(!t) continue;
  const i=style==='기본'?0:get('bdStylesOf')(t.k).indexOf(style)+1;
  assert.ok(i>=0&&traits[t.k]?.[i],`무기 특성 행 없음: ${name}/${style}`);
  assert.strictEqual(JSON.stringify(traits[t.k][i]),JSON.stringify([has,no]),`무기 특성 불일치: ${name}/${style}`);
  traitRows++;
}
assert.strictEqual(traitRows,Object.values(traits).flat().length,'AB_TRAITS에만 있는 행');
// 스킬 사전 기본 가정 칸 ↔ AB_ASSUME.
const assume=get('AB_ASSUME'), skills=tableRows(fs.readFileSync(path.join(root,'docs','SKILLS.md'),'utf8')).filter(c=>c.length>=10&&c[0]!=='스킬'&&!/^-+$/.test(c[0]));
const pick=(fn)=>skills.filter(fn).map(c=>c[0]).sort();
const sorted=a=>[...a].sort();
const same=(a,b,m)=>assert.strictEqual(JSON.stringify(a),JSON.stringify(b),m);
same(pick(c=>c[4]==='OFF'),sorted(assume.off),'기본 가정 OFF 불일치');
same(pick(c=>c[4]==='조건부 후보'),sorted([...assume.candidate,...assume.sp]),'조건부 후보 불일치');
same(pick(c=>c[4]==='ON'&&c[3]==='조건부'),sorted(assume.monster),'몬스터 의존 ON 불일치');
same(pick(c=>c[4]==='조건부 ON (연계 스킬)'),sorted(assume.linked.skills),'연계 스킬 불일치');
for(const [s,code] of Object.entries(assume.blockedBy)) assert.strictEqual(skills.find(c=>c[0]===s)?.[4],`ON (${code} 무기는 OFF)`,`무기 동작 OFF 불일치: ${s}`);
same(pick(c=>/^ON \(.+ 무기는 OFF\)$/.test(c[4])),sorted(Object.keys(assume.blockedBy)),'무기 동작 OFF 목록 불일치');
const actions=skills.filter(c=>c[4]==='조건부 ON (무기 동작)'&&!get('abSP')(c[0]));
same(actions.map(c=>c[0]).sort(),sorted(Object.keys(assume.actions)),'무기 동작 스킬 불일치');
for(const c of actions) assert.strictEqual(assume.actions[c[0]],c[5],`액션 조건 불일치: ${c[0]}`);
// 스킬 사전 발동률 표 ↔ BD_RATE (무기별 값 포함).
const rateDoc=fs.readFileSync(path.join(root,'docs','SKILLS.md'),'utf8').split('## 발동률')[1].split('\n## ')[0];
const typeKo=Object.fromEntries(get('BUILD.weaponTypes').map(t=>[t.n,t.k]));
const rateRows=tableRows(rateDoc).filter(c=>c.length>=3&&c[0]!=='스킬'&&!/^-+$/.test(c[0]));
const docRates=Object.fromEntries(rateRows.map(c=>{
  const w=c[2]?Object.fromEntries(c[2].split(' · ').map(x=>{const m=/^(.+) (\d+)$/.exec(x);assert.ok(m&&typeKo[m[1]],`발동률 무기별 표기: ${x}`);return [typeKo[m[1]],+m[2]];})):null;
  return [c[0],w?{d:+c[1],w}:+c[1]];
}));
same(JSON.parse(JSON.stringify(get('BD_RATE'))),docRates,'발동률 표 ↔ BD_RATE 불일치');
for(const s of Object.keys(docRates)) assert.ok(skills.some(c=>c[0]===s),`발동률 표의 스킬이 스킬 사전에 없음: ${s}`);
console.log(`운용 가이드 ↔ AB_RULES 일치 (${data.length}개 규칙) · 무기 특성 ${traitRows}행 · 기본 가정 일치 · 발동률 ${rateRows.length}종 일치`);
