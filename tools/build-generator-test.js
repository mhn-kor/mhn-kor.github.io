/* 수동 세트 보호·공식 이벤트 무기 검사. 네트워크·파일 쓰기 없이 갱신을 재현한다.
   node tools/build-generator-test.js */
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(__dirname, 'build-builddata.js'), 'utf8').split('main().catch')[0];
const current = new Function(fs.readFileSync(path.join(root, 'build-data.js'), 'utf8') + ';return BUILD;')();
const keys = ['guardian', 'summer-26'];

async function generate(only, upstreamExists) {
  let output = '';
  const eq = upstreamExists ? Object.fromEntries(keys.map(key => [key, {
    helm: [{ skill: '덮어쓰면 안 되는 원본 스킬', lv: 5 }], slot: { helm: [5, 8] },
  }])) : {};
  const events = ['mr-beast', 'halloween-24', 'halloween-25', 'winter-25'];
  for (const key of events) eq[key] = { weapon: [] };
  const set = Object.fromEntries(events.map(key => [key, {
    evtOnly: 1, forge: { weapon: {} }, eff: { all: 'dragon' }, dragon: { base: 'atk', ele: 'ele' },
  }]));
  const run = new Function('require', '__dirname', 'process', 'bundle', source + `
    fetchBundle = async () => bundle;
    exportedObj = (data, alias) => data[alias];
    koSkillTable = () => ({});
    pickTable = () => ({});
    return main();
  `);
  await run(name => name === 'fs' ? { ...fs, writeFileSync() {} } : require(name), __dirname, {
    argv: ['node', 'build-builddata.js', ...(only ? ['--sets=' + only.join(',')] : [])], env: {},
    stdout: { write: text => { output += text; } }, stderr: { write() {} },
  }, { src: '', ko: '', data: { eq, set, weaponVal: { atk: [100, 200], ele: [10, 20] } } });
  return new Function(output + ';return BUILD;')();
}

(async () => {
  for (const upstreamExists of [false, true]) {
    for (const only of [null, keys, ['guardian'], ['summer-26']]) {
      const generated = await generate(only, upstreamExists);
      for (const key of keys) {
        const sets = generated.sets.filter(s => s.key === key);
        assert.strictEqual(sets.length, 1, `${key} 누락/중복`);
        assert.deepStrictEqual(sets[0], current.sets.find(s => s.key === key), `${key} 수동값 변경`);
      }
      if (only) for (const s of current.sets.filter(s => !only.includes(s.key))) {
        assert.deepStrictEqual(generated.sets.find(x => x.key === s.key), s, `${s.key} 부분 갱신 영향`);
      }
      assert.strictEqual(generated.maxLv['점프 철인'], 1);
    }
  }
  const expected = {
    'mr-beast': [['shield-sword', 'MrBeast 소드']],
    'halloween-24': [['long-sword', '데스퍼레이션']],
    'halloween-25': [['hunting-horn', '스컬휘슬']],
    'winter-25': [['dual-blades', '트윈리스'], ['bow', '래핑애로우']],
  };
  for (const only of [null, Object.keys(expected)]) {
    const generated = await generate(only, false);
    for (const [key, weapons] of Object.entries(expected)) {
      assert.deepStrictEqual(generated.sets.find(s => s.key === key).weapons.map(w => [w.t, w.name]), weapons);
      assert.deepStrictEqual(current.sets.find(s => s.key === key).weapons.map(w => [w.t, w.name]), weapons);
    }
  }
  console.log('수동 세트 보호 8가지 시나리오 통과');
  console.log('공식 이벤트 4종 무기 목록·이름 및 전체/부분 생성 통과');
})().catch(error => { console.error(error); process.exit(1); });
