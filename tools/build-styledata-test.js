/* 네트워크 없이 수집 스냅샷·분리 저장·예외 규칙을 검사한다. */
const fs = require('fs'), path = require('path'), assert = require('assert');
const { profileOf, summarize, summarizeCalc, collect, applyCalc } = require('./build-styledata');
const root = path.join(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'data', name), 'utf8'));
const source = read('style-source.json'), calc = read('style-nowcalc-source.json'), saved = read('weapon-style-data.json');
const build = new Function(fs.readFileSync(path.join(root, 'build-data.js'), 'utf8') + ';return BUILD;')();
const before = JSON.stringify(build), output = applyCalc(collect(build, source), calc);
assert.deepStrictEqual(output, saved, '저장 결과가 오프라인 재생성과 다름');
assert.strictEqual(JSON.stringify(build), before, '기존 BUILD 변경');
assert.strictEqual(output.weapons.length, build.sets.reduce((n, s) => n + s.weapons.length, 0));
assert.strictEqual(new Set(output.weapons.map(w => w.set + ':' + w.type)).size, output.weapons.length);
assert.deepStrictEqual(summarize(source.sc.white).bonus20, { atk: 352, ele: 0, crit: 0 });
assert.deepStrictEqual(summarize(source.sc['ele-zino']).bonus20, { atk: 120, ele: 120, crit: 0 });
assert.ok(summarize(source.sc.ailment).parameters[10].some(p => p.stat === 'ele' && p.value === 50));
assert.ok(!summarize(source.sc.white).parameters[10].some(p => p.stat === 'ele'));
for (const [mon, item, type, element, want] of [
  [{ 'sc-type': { all: 'ele-zino' } }, {}, 'bow', 'thunder', 'ele-zino'],
  [{ 'sc-type': { 'heavy-gun': 'magn-gun' } }, {}, 'heavy-gun', null, 'magn-gun'],
  [{ subspecies: 1 }, {}, 'bow', 'fire', 'ele-subspecies'],
  [{}, { f: 'rare' }, 'bow', 'fire', 'ele-f'],
  [{ unlock: 5 }, {}, 'bow', 'fire', 'ele-g5'],
  [{ unlock: 5 }, {}, 'bow', 'poison', 'ailment-g5'],
  [{ unlock: 6, ammo: [['pierce', 4]] }, {}, 'light-gun', null, 'white-g6'],
  [{ ammo: [['poison', 3]] }, {}, 'light-gun', null, 'ailment-gun'],
]) assert.strictEqual(profileOf(mon, item, type, element), want);
assert.throws(() => profileOf({}, {}, 'heavy-gun', null), /탄 정보/);
assert.throws(() => summarize({}), /누락/);
for (const weapon of output.weapons) {
  if (weapon.style.status !== 'supported') { assert.ok(!weapon.style.stats20); continue; }
  const profile = output.profiles[weapon.style.profile];
  assert.ok(profile);
  for (const stat of ['atk', 'ele', 'crit']) {
    assert.strictEqual(weapon.style.stats20[stat], weapon.base[stat] + profile.bonus20[stat]);
    assert.ok(Number.isFinite(weapon.style.stats20[stat]));
  }
  assert.deepStrictEqual(Object.keys(profile.parameters), ['10', '15', '20']);
}
// 확인 불가인 원본 무기군·지원 테이블은 0이나 기본 계열로 대체하지 않는다.
const missing = structuredClone(source);
missing.sc['ele-zino'] = undefined;
delete missing.sc['ele-zino'];
assert.ok(collect(build, missing).weapons.filter(w => w.set === 'zino').every(w => w.style.status === 'unknown'));
console.log('스타일20 수집·오프라인 재생성·파라미터 분리·예외 규칙 검사 통과', output.meta.counts);
const get = (set, type) => output.weapons.find(w => w.set === set && w.type === type);
const data = (set, type) => output.profiles[get(set, type).style.profile];
assert.strictEqual(get('rado', 'shield-sword').base.atk, 1912, '1596(10-1)로 교체하면 안 됨');
assert.deepStrictEqual(data('paol', 'shield-sword').bonus20, { atk: 392, ele: 0, crit: 0 });
assert.deepStrictEqual(data('lago', 'great-sword').bonus20, { atk: 184, ele: 80, crit: 0 });
assert.deepStrictEqual(data('somn', 'great-sword').bonus20, { atk: 144, ele: 52, crit: 0 });
assert.deepStrictEqual(data('mizu', 'shield-sword').bonus20, { atk: 64, ele: 96, crit: 0 });
assert.deepStrictEqual(data('rathi', 'heavy-gun').bonus20, { atk: 204, ele: 0, crit: 0 });
for (const lv of [10, 15, 20]) assert.deepStrictEqual(data('spring-26', 'light-gun').parameters[lv], [{ stat: 'atk', value: 100 }]);
assert.strictEqual(output.meta.crossCheckCounts.compared, output.meta.counts.supported);
const missingCalc = structuredClone(calc);
delete missingCalc.weapons.Kadachi_SwordAndShield;
assert.strictEqual(applyCalc(collect(build, source), missingCalc).weapons.find(w => w.set === 'tobi' && w.type === 'shield-sword').style.status, 'unknown');
assert.throws(() => summarizeCalc({ enabled: true, max_level: 5 }), /미지원/);
const malformed = structuredClone(calc.weapons.Kadachi_SwordAndShield.style);
malformed.level_rules.pop();
assert.throws(() => summarizeCalc(malformed), /누락/);
console.log('나우칼 출처 우선순위·라도발킨 10-5·로즈어썰트 선택지·불완전 원본 검사 통과');
