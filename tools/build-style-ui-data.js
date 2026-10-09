/* 수집·교차검증된 스타일 자료를 file://에서도 읽을 수 있는 작은 JS로 만든다. */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const source = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/weapon-style-data.json'), 'utf8'));
const data = { profiles: source.profiles, weapons: Object.fromEntries(source.weapons.map(w =>
  [w.set + ':' + w.type, w.style.status === 'supported'
    ? { status: w.style.status, profile: w.style.profile, base: w.base } : { status: w.style.status }])) };
fs.writeFileSync(path.join(root, 'build-style-data.js'), '/* tools/build-style-ui-data.js로 생성. */\nconst BD_STYLE_DATA = ' + JSON.stringify(data) + ';\n');
console.log('스타일 UI 데이터 생성:', source.weapons.length, '무기');
