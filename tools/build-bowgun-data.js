/* 조사 원본을 현재 빌드의 소재·탄 슬롯에 연결. stdout 출력, --check는 재현성 검사. */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.join(__dirname, '..'), ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'build-data.js'), 'utf8') + ';this.data=BUILD', ctx);
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/bowgun-handling-reference.json'), 'utf8'));
const SERIES = {
  Hunter:'ore', Jagras:'g-jagr', CoralPukei:'c-puke', Barroth:'barr', Kadachi:'tobi', Paolumu:'paol',
  NightshadePaolume:'n-paol', Jyuratodus:'jyur', Anjanath:'anja', Fulgur:'f-anja', Rathian:'rathi',
  GoldenLune:'g-rathi', Legiana:'legi', Rathalos:'ratha', AzureRathalos:'a-ratha', SilverSol:'s-ratha',
  Banbaro:'banb', Barioth:'bari', Zinogre:'zino', Stygian:'s-zino', Odogaron:'odog', DeathGaron:'e-odog',
  Basarios:'basa', Deviljho:'devi', Khezu:'khez', Kushala:'kush', Mizutsune:'mizu', Kaiser:'teos',
  Sinister:'magn', Golden:'raja', Nergigante:'nerg', Tigrex:'tigr', RexRoar:'b-tigr', Kirin:'kiri',
  Bazel:'baze', Glavenus:'glav', Mizuha:'cham', Bishaten:'bish', Beotodus:'beot', Narugacuga:'narg',
  Tentacle:'nami', Golm:'gara', Lunagaron:'luna', Espinas:'espi', Malzeno:'malz', GossHarag:'goss',
  Astalos:'asta', Almudron:'almu', Regios:'serg', Rimeguard:'velk', Brachydios:'brachy',
  Carnival2024:'carnival-24', Bone:'bone', LunarNewYear:'lunar-25', Hope:'hope', Spring2026:'spring-26',
  Pukei:'puke', ViperKadachi:'v-tobi', Diablos:'diab', BlackDiables:'b-diab', Radobaan:'rado',
  Tzitzi:'tzit', Lagombi:'lago', Volvidon:'volv', Chatacabra:'chat', Arzuros:'arzu', Ceanataur:'s-cean', Summer2025:'summer-25',
};
function ammoName(name) {
  const match = /^(?:(Piercing|Spread|Sticky|Slicing|Cluster|Wyvern) )?(Fire|Water|Thunder|Ice|Dragon) Ammo$/.exec(name);
  if (!match) return { 'Normal Ammo':'통상탄', 'Pierce Ammo':'관통탄', 'Spread Ammo':'산탄',
    'Sticky Ammo':'철갑유탄', 'Slicing Ammo':'참렬탄', 'Cluster Ammo':'확산탄', 'Wyvern Ammo':'용격탄',
    'Poison Ammo':'독탄', 'Paralysis Ammo':'마비탄', 'Sleep Ammo':'수면탄' }[name];
  const element = {Fire:'화염', Water:'수냉', Thunder:'전격', Ice:'빙결', Dragon:'멸룡'}[match[2]];
  const kind = {Piercing:'관통', Spread:'산탄', Sticky:'철갑유탄', Slicing:'참렬', Cluster:'확산탄', Wyvern:'용격탄'}[match[1]];
  return !kind ? element + '탄' : ['관통','참렬'].includes(kind) ? kind + element + '탄' : element + kind;
}
const recoil = ['Low','Average','High','Very High','Wyvern'], reload = ['Fast','Normal','Slow','Very Slow'];
const weapons = {}, missing = [];
for (const w of ref.weapons) {
  const key = SERIES[w.series]; assert.ok(key, w.series);
  const live = ctx.data.sets.find(s => s.key === key)?.weapons.find(x => x.t === w.type);
  const fingerprint = w.ammo.map(a => { const n = ammoName(a.name); assert.ok(n, a.name); return `${n} ${a.capacity}`; });
  const id = key + '/' + w.type;
  if (!live || JSON.stringify(live.x) !== JSON.stringify(fingerprint)) {
    missing.push({ id, sourceName:w.name, reason:!live ? '무기 없음' : '탄 구성 불일치', sourceAmmo:fingerprint }); continue;
  }
  assert.ok(!weapons[id], id);
  weapons[id] = { x:fingerprint, ammo:w.ammo.map(a => ({
    recoil:a.recoil.map(v => { const i=recoil.indexOf(v); assert.ok(i>=0); return i; }),
    reload:a.reload.map(v => { const i=reload.indexOf(v); assert.ok(i>=0); return i; }),
  })) };
}
const output = '/* 나우칼 탄 슬롯별 Lv0~3 참고값. tools/build-bowgun-data.js로 재생성. 공식 전수 검증값은 아님. */\n'
  + 'const BD_BOWGUN_DATA = ' + JSON.stringify({checkedAt:ref.checkedAt, sources:ref.sources, weapons, missing}) + ';\n';
if (process.argv.includes('--check')) {
  assert.strictEqual(fs.readFileSync(path.join(root,'build-bowgun-data.js'),'utf8').replace(/\r\n/g,'\n'), output);
  console.log('보우건 연결 재현성 검사 통과', {mapped:Object.keys(weapons).length, missing:missing.length});
} else process.stdout.write(output);
