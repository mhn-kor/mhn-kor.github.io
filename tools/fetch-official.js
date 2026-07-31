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
      try { out[k] = await fn(items[k]); } catch (e) { out[k] = { err: e.message }; }
    }
  }));
  return out;
}

async function main() {
  const all = process.argv.includes('--all');
  const file = path.join(OUT, 'official-names.json');
  const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { armor: {}, weapon: {} };

  const names = { armor: {}, weapon: {} };
  const skillUrls = {};
  let fetched = 0;
  const failed = [];

  for (const kind of ['armor', 'weapon', 'skill']) {
    const seg = SEG[kind];
    const list = slugs(await get(INDEX[kind]), seg);
    process.stderr.write(`${kind}: ${list.length}개\n`);

    const known = kind === 'skill' ? {} : (old[kind] || {});
    const need = all || kind === 'skill' ? list : list.filter(s => !known[s]);
    if (need.length) process.stderr.write(`  이름 받는 중 ${need.length}개…\n`);

    const got = await pool(need, async (slug) => {
      fetched++;
      return { slug, name: titleOf(await get(`/ko/${seg}/${slug}`)) };
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

  fs.writeFileSync(file, JSON.stringify(names, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'skill-urls.json'), JSON.stringify(skillUrls, null, 1) + '\n');

  const added = (k) => Object.keys(names[k]).filter(s => !(old[k] || {})[s]);
  process.stderr.write(
    `\n방어구 ${Object.keys(names.armor).length}개 (신규 ${added('armor').length})` +
    ` / 무기 ${Object.keys(names.weapon).length}개 (신규 ${added('weapon').length})` +
    ` / 스킬 ${Object.keys(skillUrls).length}개\n` +
    `요청 ${fetched}쪽${failed.length ? `, 실패 ${failed.length}: ${failed.slice(0, 5).join(', ')}` : ''}\n`);
  for (const k of ['armor', 'weapon']) {
    if (added(k).length) process.stderr.write(`신규 ${k}: ${added(k).join(', ')}\n`);
  }
}

main();
