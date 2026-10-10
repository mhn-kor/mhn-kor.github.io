/* 스타일20 자료 수집 전용. 화면·BUILD·저장된 빌드를 변경하지 않는다.
   node --use-system-ca tools/build-styledata.js --fetch
   node tools/build-styledata.js  (저장된 원본으로 재생성) */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { exportedObj, SET_KEYS } = require('./build-builddata');
const ROOT = path.join(__dirname, '..'), DATA = path.join(__dirname, 'data');
const SOURCE = path.join(DATA, 'style-source.json');
const CALC_SOURCE = path.join(DATA, 'style-nowcalc-source.json');
const OUTPUT = path.join(DATA, 'weapon-style-data.json');
const STATS = ['atk', 'ele', 'crit'], ELEMENTS = ['fire', 'water', 'thunder', 'ice', 'dragon'];
const AILMENTS = ['poison', 'paralysis', 'sleep', 'blast'];
const zero = () => ({ atk: 0, ele: 0, crit: 0 });
// 소재명과 무기군을 함께 비교한다. 이름의 부분 일치로 장비를 추측하지 않는다.
const CALC_SETS = { puke: 'Pukei', barr: 'Barroth', 'g-girr': 'Girros', tobi: 'Kadachi',
  rado: 'Radobaan', lago: 'Lagombi', paol: 'Paolumu', jyur: 'Jyuratodus', banb: 'Banbaro',
  akno: 'Aknosom', bish: 'Bishaten', anja: 'Anjanath', rathi: 'Rathian', bari: 'Barioth',
  khez: 'Khezu', magn: 'Sinister', somn: 'Somnacanth', legi: 'Legiana', diab: 'Diablos',
  ratha: 'Rathalos', 'a-ratha': 'AzureRathalos', zino: 'Zinogre', devi: 'Deviljho',
  mizu: 'Mizutsune', baze: 'Bazel', glav: 'Glavenus', 'spring-26': 'Spring2026',
  'summer-26': 'Summer2026', hope: 'Hope' };
const CALC_TYPES = Object.fromEntries(['shield-sword', 'dual-blades', 'great-sword', 'long-sword',
  'hammer', 'hunting-horn', 'lance', 'gunlance', 'switch-axe', 'charge-blade', 'insect-glaive',
  'light-gun', 'heavy-gun', 'bow'].map((t, i) => [t, ['SwordAndShield', 'DualBlades', 'GreatSword',
  'LongSword', 'Hammer', 'HuntingHorn', 'Lance', 'Gunlance', 'SwitchAxe', 'ChargeBlade',
  'InsectGlaive', 'LightBowgun', 'HeavyBowgun', 'Bow'][i]]));

function summarizeCalc(style) {
  if (!style?.enabled || style.max_level < 20) throw Error('나우칼 스타일20 미지원');
  const bonus20 = zero(), parameters = {}, seen = new Set();
  const names = { Attack: 'atk', Element: 'ele', Critical: 'crit' };
  const choices = style.choices?.map(p => ({ stat: names[p.key], value: p.value }));
  if (!choices?.length || choices.some(p => !p.stat || !Number.isFinite(p.value))) throw Error('나우칼 선택지 형식 변경');
  for (const row of style.level_rules || []) {
    const lv = row.level_no;
    if (!Number.isInteger(lv) || lv < 1 || seen.has(lv)) throw Error('나우칼 레벨 규칙 형식 변경');
    seen.add(lv);
    if (lv > 20) continue;
    for (const [stat, field] of [['atk', 'attack_add'], ['ele', 'element_add'], ['crit', 'affinity_add']]) {
      if (!Number.isFinite(row[field])) throw Error('나우칼 자동상승 수치 없음');
      bonus20[stat] += row[field];
    }
  }
  for (let lv = 1; lv <= 20; lv++) {
    if (![5, 10, 15, 20].includes(lv) && !seen.has(lv)) throw Error(`나우칼 Lv${lv} 누락`);
  }
  for (const lv of [10, 15, 20]) {
    if (!style.milestone_levels?.includes(lv)) throw Error(`나우칼 Lv${lv} 선택지 없음`);
    parameters[lv] = choices;
  }
  return { bonus20, parameters };
}

function applyCalc(output, calc) {
  const comparisons = [];
  for (const weapon of output.weapons) {
    if (weapon.style.status !== 'supported') continue;
    const key = `${CALC_SETS[weapon.set]}_${CALC_TYPES[weapon.type]}`, item = calc.weapons[key];
    try {
      if (!item || item.series !== CALC_SETS[weapon.set] || item.type !== CALC_TYPES[weapon.type]) throw Error('나우칼 대응 장비 없음');
      const data = summarizeCalc(item.style), original = output.profiles[weapon.style.profile];
      const matches = { base: STATS.every(s => weapon.base[s] === item.base[s]),
        bonus20: STATS.every(s => original.bonus20[s] === data.bonus20[s]),
        parameters: JSON.stringify(original.parameters) === JSON.stringify(data.parameters) };
      comparisons.push({ set: weapon.set, type: weapon.type, calcKey: key, matches,
        ...(!Object.values(matches).every(Boolean) ? { quest: { base: weapon.base, ...original },
          nowcalc: { base: item.base, ...data } } : {}) });
      const profile = `nowcalc:${item.style.profile_key}`;
      if (output.profiles[profile] && JSON.stringify(output.profiles[profile]) !== JSON.stringify(data)) throw Error(`나우칼 동일 프로필 수치 불일치: ${profile}`);
      output.profiles[profile] = data;
      weapon.style = { status: 'supported', profile, source: 'mhnowcalc.com', sourceKey: key,
        questProfile: weapon.style.profile,
        stats20: Object.fromEntries(STATS.map(s => [s, weapon.base[s] + data.bonus20[s]])) };
    } catch (e) {
      weapon.style = { status: 'unknown', reason: e.message };
      output.issues.push({ set: weapon.set, type: weapon.type, reason: e.message });
    }
  }
  // 공식 신규 무기군은 같은 몬스터의 검증된 강화치를 공유한다.
  // 속성·보우건 계열의 기존 예외는 섞지 않고, 후보가 일치할 때만 연결한다.
  const verified = output.weapons.filter(w => w.style.status === 'supported');
  const gun = type => ['light-gun', 'heavy-gun'].includes(type);
  let inherited = 0;
  for (const weapon of output.weapons) {
    if (weapon.style.reason !== '공식 무기 확인됨; 스타일강화 수치 미확인') continue;
    const peers = verified.filter(w => w.set === weapon.set && w.element === weapon.element && gun(w.type) === gun(weapon.type));
    if (!peers.length || new Set(peers.map(w => w.style.profile)).size !== 1) continue;
    const reference = peers[0], profile = reference.style.profile, data = output.profiles[profile];
    weapon.style = { status: 'supported', profile, source: 'same_monster', referenceType: reference.type,
      stats20: Object.fromEntries(STATS.map(s => [s, weapon.base[s] + data.bonus20[s]])) };
    inherited++;
  }
  output.issues = output.issues.filter(issue => !output.weapons.some(w => w.set === issue.set && w.type === issue.type && w.style.source === 'same_monster'));
  output.schemaVersion = 2;
  output.meta.nowcalc = calc.meta;
  output.meta.sourcePolicy = { base: 'mhn.quest (10-5)', bonus20: 'mhnowcalc.com', parameters: 'mhnowcalc.com' };
  output.meta.crossCheck = 'completed_with_source_policy';
  output.meta.crossCheckCounts = { compared: comparisons.length, inherited,
    ...Object.fromEntries(['base', 'bonus20', 'parameters'].map(k => [k + 'Matches', comparisons.filter(c => c.matches[k]).length])) };
  output.meta.counts = Object.fromEntries(['supported', 'unsupported', 'unknown'].map(s => [s, output.weapons.filter(w => w.style.status === s).length]));
  output.comparisons = comparisons;
  return output;
}

function profileOf(mon, item, type, element) {
  const override = mon['sc-type']?.[type] || mon['sc-type']?.all;
  if (override) return override;
  if (ELEMENTS.includes(element)) return mon.subspecies ? 'ele-subspecies' : item.f ? 'ele-f' : mon.unlock === 5 ? 'ele-g5' : 'ele';
  if (!['light-gun', 'heavy-gun'].includes(type)) {
    return element ? mon.unlock === 5 ? 'ailment-g5' : 'ailment' : mon.unlock === 5 ? 'white-g5' : 'white';
  }
  const ammo = mon[type === 'light-gun' ? 'ammo' : 'heavy-ammo'];
  if (!Array.isArray(ammo)) throw Error('보우건 탄 정보 없음');
  return ammo.some(row => AILMENTS.includes(row[0])) ? 'ailment-gun' : mon.unlock === 5 ? 'white-g5' : mon.unlock === 6 ? 'white-g6' : 'white';
}

function summarize(table) {
  const bonus20 = zero(), parameters = {};
  for (let lv = 1; lv <= 20; lv++) {
    const row = table[lv];
    if (!Array.isArray(row)) throw Error(`스타일 Lv${lv} 누락`);
    if (lv === 5) {
      if (row[0] !== 'styles') throw Error('Lv5 형식 변경');
    } else if ([10, 15, 20].includes(lv)) {
      if (!row.length || row.some(r => !STATS.includes(r[0]) || !Number.isFinite(r[1]))) throw Error(`Lv${lv} 선택지 형식 변경`);
      parameters[lv] = row.map(([stat, value]) => ({ stat, value }));
    } else {
      if (!STATS.includes(row[0]) || !Number.isFinite(row[1])) throw Error(`Lv${lv} 상승값 형식 변경`);
      bonus20[row[0]] += row[1];
    }
  }
  return { bonus20, parameters };
}

function collect(build, source) {
  const profiles = Object.fromEntries(Object.entries(source.sc).map(([k, table]) => [k, summarize(table)]));
  const reverseKeys = Object.fromEntries(Object.entries(SET_KEYS).map(([a, b]) => [b, a]));
  const weapons = [], issues = [];
  for (const set of build.sets) for (const weapon of set.weapons) {
    const key = reverseKeys[set.key] || set.key, type = weapon.t, mon = source.set[key];
    const record = { set: set.key, sourceSet: key, type, name: weapon.name, element: weapon.e,
      base: { atk: weapon.atk, ele: weapon.ele ?? 0, crit: weapon.crit ?? 0 }, baseSource: 'build-data.js', style: { status: 'unknown' } };
    weapons.push(record);
    const unknown = reason => { record.style = { status: 'unknown', reason }; issues.push({ set: set.key, type, reason }); };
    if (!mon) { unknown('원본 소재 정보 없음'); continue; }
    if (!source.matForge[key]?.includes(type)) {
      unknown(weapon.officialId ? '공식 무기 확인됨; 스타일강화 수치 미확인' : '원본에서 해당 소재의 무기군 존재를 확인하지 못함'); continue;
    }
    const rawElement = mon.eff?.[type] || mon.eff?.all;
    const curve = mon[rawElement];
    if (!curve || !curve.base || Object.values(curve).some(k => typeof k === 'string' && !source.weaponVal[k]?.length)) { unknown('10-5 원본 곡선 없음'); continue; }
    if (STATS.some(stat => curve[stat === 'atk' ? 'base' : stat] && !Number.isFinite(source.weaponVal[curve[stat === 'atk' ? 'base' : stat]]?.[49]))) { unknown('10-5 원본 수치 없음'); continue; }
    const base = Object.fromEntries(STATS.map(stat => [stat, source.weaponVal[curve[stat === 'atk' ? 'base' : stat]]?.[49] ?? 0]));
    if (!Number.isFinite(base.atk) || base.atk <= 0) { unknown('10-5 원본 수치 없음'); continue; }
    record.siteBaseMatches = STATS.every(stat => record.base[stat] === base[stat]);
    record.base = base; record.baseSource = 'mhn.quest';
    if (!record.siteBaseMatches) issues.push({ set: set.key, type, reason: '현재 사이트의 기본 수치와 원본 불일치' });
    if (!source.guide[key]?.riftborne && !mon.upgradable) { record.style = { status: 'unsupported' }; continue; }
    try {
      const element = rawElement === 'white' ? null : rawElement?.replace(/\d/g, '');
      if (ELEMENTS.includes(element) && !mon.subspecies && !mon['sc-type']?.[type] && !mon['sc-type']?.all && !source.item[key]) throw Error('속성 상승 계열 판정에 필요한 소재 정보 없음');
      const profile = profileOf(mon, source.item[key] || {}, type, element), data = profiles[profile];
      if (!data) throw Error(`상승 테이블 없음: ${profile}`);
      record.style = { status: 'supported', profile,
        stats20: Object.fromEntries(STATS.map(stat => [stat, base[stat] + data.bonus20[stat]])) };
    } catch (e) { unknown(e.message); }
  }
  return { schemaVersion: 1, meta: { ...source.meta, grade: '10-5', styleLevel: 20,
    excludesParameters: true, critUnit: 'percentage_points', crossCheck: 'pending',
    crossCheckSite: 'https://mhnowcalc.com/calc/',
    counts: Object.fromEntries(['supported', 'unsupported', 'unknown'].map(status => [status, weapons.filter(w => w.style.status === status).length])) }, profiles, weapons, issues };
}

async function fetchSource() {
  const get = async url => {
    const r = await fetch(url);
    if (!r.ok) throw Error(`HTTP ${r.status}: ${url}`);
    return r.text();
  };
  const homeUrl = 'https://mhn.quest/', home = await get(homeUrl);
  const indexPath = home.match(/<script[^>]*src="([^\"]*\/index-[^\"]+\.js)"/)?.[1];
  const enPath = home.match(/href="([^\"]*\/en-[^\"]+\.json)"/)?.[1];
  if (!indexPath || !enPath) throw Error('사이트의 번들·언어 파일 구조 변경');
  const indexUrl = new URL(indexPath, homeUrl).href, index = await get(indexUrl);
  const dataPath = index.match(/import\("\.\/(data-[^\"]+\.js)"\)/)?.[1];
  if (!dataPath) throw Error('데이터 청크 없음');
  const dataUrl = new URL(dataPath, indexUrl).href, enUrl = new URL(enPath, homeUrl).href;
  const [data, enText] = await Promise.all([get(dataUrl), get(enUrl)]);
  const en = JSON.parse(enText);
  const result = Object.fromEntries(['set', 'guide', 'sc', 'weaponVal', 'matForge'].map(k => [k, exportedObj(data, k)]));
  result.item = en.item;
  result.meta = { source: homeUrl, collectedAt: new Date().toISOString(), urls: { index: indexUrl, data: dataUrl, en: enUrl },
    sha256: Object.fromEntries([['index', index], ['data', data], ['en', enText]].map(([k, v]) => [k, crypto.createHash('sha256').update(v).digest('hex')])) };
  return result;
}

async function main() {
  const refresh = process.argv.includes('--fetch');
  const [source, calc] = refresh ? await Promise.all([fetchSource(), fetchCalcSource()])
    : [SOURCE, CALC_SOURCE].map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
  const build = new Function(fs.readFileSync(path.join(ROOT, 'build-data.js'), 'utf8') + ';return BUILD;')();
  const output = applyCalc(collect(build, source), calc);
  if (output.weapons.some(w => w.style.reason?.startsWith('나우칼'))) throw Error('나우칼 검증 실패: 원본·대응표를 확인하세요');
  // 검증·수집이 모두 끝난 후에만 저장한다. 원본을 보관해 오프라인 재생성 가능.
  if (refresh) {
    fs.writeFileSync(SOURCE, JSON.stringify(source) + '\n');
    fs.writeFileSync(CALC_SOURCE, JSON.stringify(calc) + '\n');
  }
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({ counts: output.meta.counts, issues: output.issues.length, output: OUTPUT }));
}

async function fetchCalcSource() {
  const url = 'https://mhnowcalc.com/calc/build_editor_simple.php?lang=ko';
  const r = await fetch(url);
  if (!r.ok) throw Error(`HTTP ${r.status}: ${url}`);
  const html = await r.text();
  const raw = html.split('window.BUILD_EDITOR_BOOTSTRAP = ')[1]?.split('</script>')[0].trim().replace(/;$/, '');
  if (!raw) throw Error('나우칼 공개 데이터 구조 변경');
  const details = JSON.parse(raw).equipDetails;
  if (!details || typeof details !== 'object') throw Error('나우칼 장비 목록 없음');
  const weapons = Object.fromEntries(Object.values(details).filter(w => w.category === 'Weapon').map(w => [w.equip_key,
    { series: w.series_key, type: w.weapon_type, name: w.equip_name_ko,
      base: { atk: w.attack, ele: w.element_value ?? 0, crit: w.affinity ?? 0 }, style: w.custom_style }]));
  return { meta: { source: url, collectedAt: new Date().toISOString(),
    sha256: crypto.createHash('sha256').update(html).digest('hex') }, weapons };
}

module.exports = { profileOf, summarize, summarizeCalc, collect, applyCalc };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
