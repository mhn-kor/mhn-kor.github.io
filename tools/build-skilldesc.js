/* 공식 스킬 페이지에서 레벨별 설명을 받아 skill-desc.js 를 만듭니다.
 *
 *   node tools/build-skilldesc.js <skill-urls.json> > skill-desc.js
 *
 * 설명에는 «공격력이 50 상승한다» 처럼 수치가 그대로 적혀 있어서,
 * 빌드 탭이 이 문장을 읽어 공격력·속성·회심 합산에 씁니다.
 * 이벤트 전용 스킬 6종은 공식 페이지가 없어 빠집니다(설명도 수치도 없음).
 */
const fs = require('fs');

const BASE = 'https://monsterhunternow.com';
const CONCURRENCY = 4;

const strip = (h) => h
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/\s+/g, ' ').trim();

/* 레벨 표는 «firstColumn = 레벨, lastColumn = 설명» 두 칸짜리 행이 이어집니다. */
function levels(html) {
  const out = [];
  /* 마지막 행만 class 가 «firstColumn lastRow» 라서 정확히 일치로 잡으면 최고 레벨이 빠집니다. */
  const re = /<td[^>]*class="[^"]*firstColumn[^"]*"[^>]*>\s*<b>(\d+)<\/b>\s*<\/td>\s*<td[^>]*class="[^"]*lastColumn[^"]*"[^>]*>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(html))) {
    const d = strip(m[2]);
    if (d) out.push([+m[1], d]);
  }
  return out;
}

async function main() {
  const urls = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const only = process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',');
  if (only) for (const name of only) if (!urls[name]) throw new Error(`공식 스킬 주소 없음: ${name}`);
  const names = only || Object.keys(urls);
  const desc = {};
  const failed = [];

  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < names.length) {
      const name = names[i++];
      const url = BASE + urls[name];
      try {
        const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
        if (!r.ok) { failed.push(`${name} HTTP ${r.status}`); continue; }
        const lv = levels(await r.text());
        if (lv.length) desc[name] = lv; else failed.push(`${name} 표 없음`);
      } catch (e) {
        failed.push(`${name} ${e.message}`);
      }
    }
  }));

  /* 이름 순이 아니라 원래 순서를 지켜 diff 가 조용하게 나오도록 합니다. */
  if (only && failed.length) throw new Error(`공식 설명 수집 실패: ${failed.join(', ')}`);
  const ordered = only ? new Function(fs.readFileSync(require('path').join(__dirname, '..', 'skill-desc.js'), 'utf8')
    + ';return SKILLDESC;')() : {};
  for (const n of names) if (desc[n]) ordered[n] = desc[n];

  process.stderr.write(`스킬 ${Object.keys(desc).length}/${names.length}종\n`);
  if (failed.length) process.stderr.write(`못 받음 ${failed.length}: ${failed.join(', ')}\n`);

  const output = '/* 공식 스킬 페이지의 레벨별 설명. tools/build-skilldesc.js 가 만듭니다. */\n'
    + 'const SKILLDESC = ' + JSON.stringify(ordered) + ';\n';
  if (process.argv.includes('--write')) fs.writeFileSync(require('path').join(__dirname, '..', 'skill-desc.js'), output);
  else process.stdout.write(output);
}

main();
