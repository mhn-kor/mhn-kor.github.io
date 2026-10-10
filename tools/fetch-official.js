/* 공식 사이트에서 장비·스킬의 한국어 이름을 받아 tools/data/ 를 갱신합니다.
 *
 *   node tools/fetch-official.js          새로 생긴 것만 받습니다(보통 이걸 쓰면 됩니다)
 *   node tools/fetch-official.js --all    전부 다시 받습니다
 *
 * 목록 페이지는 자바스크립트로 그려져서 원본 HTML 에 이름이 없습니다. 대신
 * 아무 상세 페이지나 열면 그 분류의 링크가 «공식 나열 순서 그대로» 전부 들어 있어,
 * 슬러그 목록과 순서는 요청 한 번으로 얻습니다. 이름은 상세 페이지 <title> 에 있어
 * 모르는 슬러그만 골라 받습니다 — 신규 몬스터 하나면 20쪽 남짓입니다.
 *
 * 여기서 만든 official-names.json 의 키 순서가 곧 방어구 일괄선택 모달의 순서입니다.
 */
const fs = require('fs');
const path = require('path');

const BASE = 'https://monsterhunternow.com';
const OUT = path.join(__dirname, 'data');
const CONCURRENCY = 8;

/* 분류마다 «목록을 품고 있는» 상세 페이지 하나. 아무거나 상관없지만 사라지지 않을
   기본 장비를 골랐습니다. */
const INDEX = {
  armor: '/ko/armor/ore_head',
  weapon: '/ko/weapons/ore_swordshield',
  skill: '/ko/skills/attack_boost',
};
const SEG = { armor: 'armor', weapon: 'weapons', skill: 'skills' };

const get = async (url) => {
  const r = await fetch(BASE + url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
};

/* 상세 페이지의 <title> 은 «이름 – Monster Hunter Now» 형식입니다. */
const titleOf = (html) => {
  const m = /<title>([^<]*)<\/title>/.exec(html);
  if (!m) return null;
  return m[1].replace(/\s*[–|-]\s*Monster Hunter Now\s*$/, '').trim() || null;
};

/* 링크는 나열 순서대로 나오고 중복이 있어 첫 등장만 남깁니다. */
function slugs(html, seg) {
  const out = [];
  const re = new RegExp(`href="/ko/${seg}/([a-z0-9_]+)"`, 'g');
  let m;
  while ((m = re.exec(html))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

async function pool(items, fn) {
  let i = 0;
  const out = new Array(items.length);
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); } catch (e) { out[k] = { slug: items[k], err: e.message }; }
    }
  }));
  return out;
}

async function main() {
  const all = process.argv.includes('--all');
  const onlySets = process.argv.find(a => a.startsWith('--sets='))?.slice(7).split(',');
  const selected = slug => !onlySets || onlySets.some(s => slug.startsWith(s + '_'));
  const file = path.join(OUT, 'official-names.json');
  const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { armor: {}, weapon: {} };

  const names = onlySets ? { armor: { ...old.armor }, weapon: { ...old.weapon } } : { armor: {}, weapon: {} };
  const skillUrls = onlySets
    ? JSON.parse(fs.readFileSync(path.join(OUT, 'skill-urls.json'), 'utf8')) : {};
  let fetched = 0;
  const failed = [];
  const relatedSkills = new Set();

  for (const kind of ['armor', 'weapon', 'skill']) {
    if (onlySets && kind === 'skill') continue;
    const seg = SEG[kind];
    const list = slugs(await get(INDEX[kind]), seg).filter(selected);
    if (!list.length) throw new Error(`${kind} 공식 목록이 비어 있습니다`);
    process.stderr.write(`${kind}: ${list.length}개\n`);

    const known = kind === 'skill' ? {} : (old[kind] || {});
    const need = all || onlySets || kind === 'skill' ? list : list.filter(s => !known[s]);
    if (need.length) process.stderr.write(`  이름 받는 중 ${need.length}개…\n`);

    const got = await pool(need, async (slug) => {
      fetched++;
      const html = await get(`/ko/${seg}/${slug}`);
      if (onlySets) for (const s of slugs(html, 'skills')) relatedSkills.add(s);
      return { slug, name: titleOf(html) };
    });
    const fresh = {};
    for (const g of got) {
      if (!g || g.err || !g.name) { failed.push(`${kind}/${g && g.slug}`); continue; }
      fresh[g.slug] = g.name;
    }

    /* 공식 순서를 그대로 다시 씁니다. 이 순서가 방어구 일괄선택 목록의 순서입니다. */
    for (const slug of list) {
      const nm = fresh[slug] || known[slug];
      if (!nm) continue;
      if (kind === 'skill') skillUrls[nm] = `/ko/skills/${slug}`;
      else names[kind][slug] = nm;
    }
  }

  if (onlySets) for (const slug of relatedSkills) {
    const url = `/ko/skills/${slug}`;
    if (Object.values(skillUrls).includes(url)) continue;
    const name = titleOf(await get(url));
    if (!name) throw new Error(`공식 스킬 이름 없음: ${slug}`);
    skillUrls[name] = url;
  }
  if (onlySets && failed.length) throw new Error(`공식 이름 수집 실패: ${failed.join(', ')}`);
  fs.writeFileSync(file, JSON.stringify(names, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'skill-urls.json'), JSON.stringify(skillUrls, null, 1) + '\n');

  /* 조충곤 사냥벌레. 무기 목록 페이지에 전 무기 데이터가 JSON 으로 내장돼 있고,
     조충곤에만 insectGlaiveSpec(타입·공격 계통·성능·보너스 열거값)이 붙습니다.
     mhn.quest 번들이 이 값을 틀리게 담은 적이 있어(쿠루루블레이드) 공식을 정답으로 둡니다. */
  const kinsect = onlySets
    ? JSON.parse(fs.readFileSync(path.join(OUT, 'kinsect.json'), 'utf8')) : {};
  const wpage = (await get('/ko/weapons')).replace(/&quot;/g, '"');
  let ki = -1;
  while ((ki = wpage.indexOf('"insectGlaiveSpec":{', ki + 1)) >= 0) {
    const id = /"id":"([a-z0-9_]+)"/i.exec(wpage.slice(wpage.lastIndexOf('"id":"', ki), ki));
    const spec = JSON.parse(wpage.slice(ki + 19, wpage.indexOf('}', ki) + 1));
    if (!id || !/_INSECTGLAIVE$/.test(id[1])) continue;
    if (!selected(id[1].toLowerCase())) continue;
    kinsect[id[1].toLowerCase()] = {
      type: spec.attackType,                                      // SMASH(공투)·PIERCE(비상)·POWDER(가루)
      attack: spec.attackAttribute.replace('ATTACK_ATTRIBUTE_', ''),   // BLUNT(타격)·CUT(절단)
      perf: spec.parameterType.replace('PARAMETER_TYPE_', ''),    // QUICK·STAMINA·POWER
      bonus: spec.bonusKind,
    };
  }
  fs.writeFileSync(path.join(OUT, 'kinsect.json'), JSON.stringify(kinsect, null, 1) + '\n');

  // 공식 10-5 스펙·병/포격형·스타일 선택 지원. 수집 범위 밖의 기록은 보존한다.
  const specFile = path.join(OUT, 'weapon-specs.json');
  const specs = fs.existsSync(specFile) ? JSON.parse(fs.readFileSync(specFile, 'utf8')) : {};
  for (const match of wpage.matchAll(/"id":"([A-Z0-9_]+)","target":/g)) {
    const id = match[1].toLowerCase();
    if (!selected(id)) continue;
    const start = wpage.lastIndexOf('{', match.index);
    let depth = 0, quote = false, end;
    for (let i = start; i < wpage.length; i++) {
      const c = wpage[i];
      if (quote) { if (c === '\\') i++; else if (c === '"') quote = false; }
      else if (c === '"') quote = true;
      else if (c === '{') depth++;
      else if (c === '}' && !--depth) { end = i + 1; break; }
    }
    const weapon = JSON.parse(wpage.slice(start, end));
    const base = weapon.grades?.find(g => g.grade === 10)?.levels.find(l => l.level === 5);
    if (!base) throw new Error('공식 10-5 스펙 없음: ' + id);
    specs[id] = { atk: base.attack, ele: base.elementAttack, crit: base.critical,
      styleSelectable: weapon.customizationSpec?.styleSelectable === true,
      ...(weapon.gunlanceSpec ? { shelling: weapon.gunlanceSpec.shellingType.replace('SHELLING_', '').toLowerCase() } : {}),
      ...(weapon.chargeBladeSpec ? { phial: weapon.chargeBladeSpec.phialType.replace('PHIAL_', '').toLowerCase() } : {}) };
  }
  fs.writeFileSync(specFile, JSON.stringify(specs, null, 1) + '\n');

  const added = (k) => Object.keys(names[k]).filter(s => !(old[k] || {})[s]);
  process.stderr.write(
    `\n방어구 ${Object.keys(names.armor).length}개 (신규 ${added('armor').length})` +
    ` / 무기 ${Object.keys(names.weapon).length}개 (신규 ${added('weapon').length})` +
    ` / 스킬 ${Object.keys(skillUrls).length}개 / 사냥벌레 ${Object.keys(kinsect).length}개\n` +
    `요청 ${fetched}쪽${failed.length ? `, 실패 ${failed.length}: ${failed.slice(0, 5).join(', ')}` : ''}\n`);
  for (const k of ['armor', 'weapon']) {
    if (added(k).length) process.stderr.write(`신규 ${k}: ${added(k).join(', ')}\n`);
  }
}

main();
