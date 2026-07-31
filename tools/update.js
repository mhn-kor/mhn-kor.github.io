/* 게임 패치(신규 몬스터·장비)를 한 번에 반영합니다.
 *
 *   node tools/update.js            평소 갱신
 *   node tools/update.js --all      장비 이름을 전부 다시 받습니다(이름이 바뀌었을 때)
 *   node tools/update.js --skip-material   재료 탭은 건드리지 않습니다
 *
 * 순서에 이유가 있습니다.
 *   1) 공식 이름·순서  → 2) 스킬 설명(최대 레벨의 근거) → 3) 빌드 데이터
 *   → 4) 몬스터 아이콘(빌드 데이터가 알려 준 새 세트) → 5) 재료 → 6) 재료 검증
 * 3번이 2번의 결과를 읽고, 4번이 3번의 결과를 읽습니다.
 *
 * 끝나면 무엇이 몇 개 늘었는지 보여 줍니다. 늘어난 게 없으면 패치에 새 장비가
 * 없었다는 뜻입니다. 마친 뒤에는 index.html 의 ?v= 를 올려 주세요 — 안 올리면
 * 방문자가 열 시간 동안 옛 파일을 봅니다.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const all = process.argv.includes('--all');
const skipMaterial = process.argv.includes('--skip-material');

/* stdout 을 파일로 받는 단계가 있어 직접 씁니다. */
function exec(label, args, outFile) {
  process.stderr.write(`\n── ${label}\n`);
  const r = execFileSync(process.execPath, args, {
    cwd: ROOT, maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', outFile ? 'pipe' : 'inherit', 'inherit'],
  });
  if (outFile) fs.writeFileSync(path.join(ROOT, outFile), r);
}

/* 갱신 전후를 견줄 수 있게 숫자를 세어 둡니다. */
function snapshot() {
  const load = (f) => {
    const p = path.join(ROOT, f);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };
  const bd = load('build-data.js');
  const BUILD = bd ? new Function(bd + ';return BUILD;')() : null;
  const sd = load('skill-desc.js');
  const md = load('material-data.js');
  return {
    세트: BUILD ? BUILD.sets.length : 0,
    방어구: BUILD ? BUILD.sets.reduce((n, s) => n + Object.keys(s.pieces).length, 0) : 0,
    무기: BUILD ? BUILD.sets.reduce((n, s) => n + s.weapons.length, 0) : 0,
    스킬설명: sd ? Object.keys(new Function(sd + ';return SKILLDESC;')()).length : 0,
    몬스터아이콘: fs.readdirSync(path.join(ROOT, 'assets/monster')).length,
    재료데이터: md ? md.length : 0,
  };
}

const before = snapshot();

exec('1/6 공식 장비·스킬 이름', ['tools/fetch-official.js', ...(all ? ['--all'] : [])]);
exec('2/6 스킬 레벨별 설명', ['tools/build-skilldesc.js', 'tools/data/skill-urls.json'], 'skill-desc.js');
exec('3/6 빌드 데이터', ['tools/build-builddata.js'], 'build-data.js');
exec('4/6 몬스터 아이콘', ['tools/fetch-icons.js']);
if (skipMaterial) process.stderr.write('\n── 5·6/6 재료 건너뜀 (--skip-material)\n');
else {
  exec('5/6 재료 데이터', ['tools/build-materialdata.js']);
  exec('6/6 재료 계산 검증', ['tools/material-test.js']);
}

const after = snapshot();
process.stderr.write('\n── 결과\n');
let changed = false;
for (const k of Object.keys(after)) {
  const d = after[k] - before[k];
  if (d) changed = true;
  process.stderr.write(`  ${k.padEnd(7)} ${String(before[k]).padStart(5)} → ${String(after[k]).padStart(5)}`
    + `${d ? `  (${d > 0 ? '+' : ''}${d})` : ''}\n`);
}
process.stderr.write(changed
  ? '\n바뀐 게 있습니다. index.html 의 ?v= 를 올리고, 브라우저에서 빌드·재료 탭을 확인한 뒤 커밋하세요.\n'
  : '\n바뀐 게 없습니다. 이번 패치에는 새 장비가 없었습니다.\n');
