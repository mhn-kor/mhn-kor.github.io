const fs = require('fs'), path = require('path'), assert = require('assert');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/bowgun-handling-reference.json'), 'utf8'));
assert.strictEqual(data.status, 'reference-only-not-runtime');
assert.deepStrictEqual(data.levels, [0, 1, 2, 3]);
const recoil = ['Low', 'Average', 'High', 'Very High', 'Wyvern'];
const reload = ['Fast', 'Normal', 'Slow', 'Very Slow'];
const keys = new Set();
for (const w of data.weapons) {
  assert.ok(data.sources[w.type] && w.series && w.name && w.ammo.length);
  const key = `${w.type}|${w.series}|${w.name}`;
  assert.ok(!keys.has(key), key); keys.add(key);
  w.ammo.forEach((a, i) => {
    assert.strictEqual(a.slot, i + 1);
    assert.ok(a.name && Number.isInteger(a.capacity) && a.capacity > 0);
    for (const [field, labels] of [['recoil', recoil], ['reload', reload]]) {
      assert.strictEqual(a[field].length, 4);
      assert.ok(a[field].every(v => labels.includes(v)), `${key}: ${field}`);
    }
  });
}
for (const [type, weapons, slots] of [['light-gun',56,140], ['heavy-gun',53,126]]) {
  const rows = data.weapons.filter(w => w.type === type);
  assert.strictEqual(rows.length, weapons);
  assert.strictEqual(rows.reduce((n,w) => n + w.ammo.length, 0), slots);
}
console.log('보우건 참고자료 검사 통과: 109개 무기 / 266개 탄 슬롯');
