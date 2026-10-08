/* 빌드 탭 무기 스킬 회귀 테스트 — 의존성 없이 `node tools/build-test.js`.

   무기 스킬은 소재 공통(weaponSkills)이 원칙이지만, 종류마다 다른 소재가 있습니다
   (바젤기우스·이블조·라잔·티가렉스 아종·이스터25·동계 축제25). 그런 무기는 자기
   스킬을 weapons[].sk 로 들고 옵니다. 예전에는 공통 자리에 «무기 종류에 따라 다름»
   이라는 자리표시자가 들어가, 무기를 골라도 그 문구가 스킬 합계에 섞였습니다.
   build-data.js 를 다시 만들었거나 build.js 의 bdWSkills 를 손댔다면 돌려보세요. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');

/* 화면이 없으므로 요소를 흉내만 냅니다. 선택자마다 «같은» 껍데기를 돌려줘야
   bdOpen 이 써 넣은 제목·본문을 되읽어 검사할 수 있습니다. */
const els = {};
const handlers = {};
const $stub = sel => (els[sel] = els[sel]
  || { hidden: true, dataset: {}, addEventListener(type, fn) { handlers[sel + ':' + type] = fn; }, showModal() {}, close() {} });

const ctx = {
  console,
  /* hidden 을 참으로 두면 build.js 가 스스로 그리지 않아 계산 함수만 꺼내 쓸 수 있습니다. */
  $: $stub,
  /* 공유 링크 길이를 배포 주소 기준으로 재야 해서 og:url 만 진짜 값을 돌려줍니다. */
  document: { querySelector: sel => (/og:url/.test(sel) ? { content: 'https://mhn-kor.github.io/' } : null) },
  /* app.js 것. 그리는 함수(bdTotalRow 등)를 부르려면 있어야 합니다 — 여기서는 표시가 아니라
     «무엇이 들어갔는가» 만 보므로 최소한만 바꿉니다. */
  esc: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  nickAuto() {},                    // record.js 것. 화면이 없으니 빈 껍데기면 됩니다.
  closeOnBackdrop() {},             // app.js 것. 위와 같은 이유로 껍데기입니다.
  localStorage: { getItem: () => null, setItem() {} },
};
vm.createContext(ctx);
/* 표류석은 smelt-data.js 에서 옵니다 — 공유 링크 길이의 대부분이 표류석입니다.
   skill-desc.js 도 실어야 브라우저와 같은 조건이 됩니다. 빼면 SKILLDESC 가 없어서
   bdSkillDesc 가 늘 표류연성 쪽으로 떨어지고, 진짜로 빠진 스킬이 무엇인지 가려집니다. */
for (const f of ['smelt-data.js', 'skill-desc.js', 'skill-desc-overrides.js', 'build-data.js', 'build.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
/* const 선언은 컨텍스트 객체에 얹히지 않아 이름으로 꺼내야 합니다. */
const [SMELT, BUILD, bdWSkills, bdTotals, bdNewBuild, bdBulkRows, bdArmorSkills,
  bdShareParam, bdShareAbs, bdParse, bdStones, bdStoneLevels, bdSkillLevels, bdSkillDesc, bdTotalRow, bdOpenSkill, BD_KAKAO_URL_MAX] =
  ['SMELT', 'BUILD', 'bdWSkills', 'bdTotals', 'bdNewBuild', 'bdBulkRows', 'bdArmorSkills',
    'bdShareParam', 'bdShareAbs', 'bdParse', 'bdStones', 'bdStoneLevels', 'bdSkillLevels', 'bdSkillDesc', 'bdTotalRow', 'bdOpenSkill',
    'BD_KAKAO_URL_MAX'].map(n => vm.runInContext(n, ctx));

let fail = 0;
const check = (label, fn) => {
  try { fn(); } catch (e) { fail++; console.log('✗ ' + label + '\n  ' + e.message); }
};

/* 테스트 장비로 실제 스킬 합계·계산·조건 체크 표시를 함께 통과시킨다. */
function calcSkills(skills, weapon = {}, cond = {}) {
  const set = { key: 'calc-test', name: '계산 테스트', pieces: {},
    weaponSkills: skills.map(([s, lv]) => ({ s, lv })),
    weapons: [{ t: 'hammer', atk: 1000, ele: 500, crit: 0, e: '불', ...weapon }] };
  const state = vm.runInContext('bdState', ctx);
  const b = { ...bdNewBuild(), w: set.key, wt: set.weapons[0].t, cond };
  BUILD.sets.push(set); state.builds.push(b); ctx.calcTestBuild = b;
  try {
    return { stats: vm.runInContext('bdStats(calcTestBuild)', ctx),
      html: vm.runInContext('bdCalc(calcTestBuild)', ctx) };
  } finally {
    BUILD.sets.pop(); state.builds.pop(); delete ctx.calcTestBuild;
  }
}

check('파괴왕 3종은 모든 레벨에서 대미지와 조건부 체크에 들어가지 않는다', () => {
  const baseline = calcSkills([]).stats;
  for (const name of ['파괴왕', '파괴왕【특수 스킬】', '파괴왕【꼬리】']) {
    for (const [lv] of bdSkillLevels(name)) {
      const { stats, html } = calcSkills([[name, lv]], {}, { [name]: true });
      assert.strictEqual(stats.score, baseline.score, `${name} Lv${lv}`);
      assert.strictEqual(stats.co.F, 1);
      assert.ok(!stats.conds.some(c => c.sk === name));
      assert.ok(!html.includes(`data-cond=`));
      assert.ok(bdSkillDesc(name, lv), '설명은 유지해야 합니다');
    }
  }
});

check('차지 마스터는 체크한 모으기 공격의 실제 속성만 증가시킨다', () => {
  const name = '차지 마스터', rates = [10, 25, 40, 55, 70];
  for (const element of ['불', '물', '번개', '얼음', '용']) for (let lv = 1; lv <= 5; lv++) {
    const off = calcSkills([[name, lv]], { e: element });
    const on = calcSkills([[name, lv]], { e: element }, { [name]: true });
    assert.strictEqual(off.stats.now.ele, 500);
    assert.strictEqual(on.stats.now.ele, Math.round(500 * (1 + rates[lv - 1] / 100)));
    assert.strictEqual(on.stats.now.atk, 1000);
    assert.strictEqual(on.stats.co.F, 1);
    assert.ok(off.stats.conds.some(c => c.sk === name));
    assert.ok(on.html.includes('모으기 공격 기준') && on.html.includes(' checked'));
    assert.ok(!on.html.includes('상태 이상 축적'));
  }
  for (const element of ['독', '마비', '수면', '폭파', null]) {
    const weapon = { e: element, ele: element ? 500 : 0 };
    const baseline = calcSkills([], weapon).stats;
    const { stats, html } = calcSkills([[name, 5]], weapon, { [name]: true });
    assert.strictEqual(stats.score, baseline.score);
    assert.ok(!stats.conds.some(c => c.sk === name));
    assert.ok(!html.includes('data-cond='));
  }
});

check('유타·향음 강화는 해머·수렵피리만 조건 체크로 계산한다', () => {
  const name = '유타·향음 강화', rates = [15, 25, 40, 55, 70];
  for (const type of BUILD.weaponTypes.map(w => w.k)) for (let lv = 1; lv <= 5; lv++) {
    const off = calcSkills([[name, lv]], { t: type });
    const on = calcSkills([[name, lv]], { t: type }, { [name]: true });
    const allowed = ['hammer', 'hunting-horn'].includes(type);
    assert.strictEqual(off.stats.co.F, 1);
    assert.strictEqual(on.stats.co.F, allowed ? 1 + rates[lv - 1] / 100 : 1);
    assert.strictEqual(on.stats.conds.some(c => c.sk === name), allowed);
    assert.strictEqual(on.stats.now.atk, 1000);
    assert.strictEqual(on.stats.now.ele, 500);
    if (allowed) assert.ok(on.html.includes(type === 'hammer' ? '모으기 공격 기준' : '향음 공격 기준'));
    else assert.ok(!on.html.includes('data-cond='));
  }
});

check('용맹은 첫 포효 조건 체크 시 공격력 정액만 더한다', () => {
  const name = '용맹', values = [400, 550, 700, 850, 1000];
  for (const type of BUILD.weaponTypes.map(w => w.k)) for (let lv = 1; lv <= 5; lv++) {
    const off = calcSkills([[name, lv]], { t: type });
    const on = calcSkills([[name, lv]], { t: type }, { [name]: true });
    assert.strictEqual(off.stats.now.atk, 1000);
    assert.strictEqual(off.stats.score, 1500);
    assert.strictEqual(on.stats.now.atk, 1000 + values[lv - 1]);
    assert.strictEqual(on.stats.score, 1500 + values[lv - 1]);
    assert.strictEqual(on.stats.co.A, values[lv - 1]);
    assert.strictEqual(on.stats.co.B, 1);
    assert.strictEqual(on.stats.co.F, 1);
    assert.strictEqual(on.stats.now.ele, 500);
    assert.ok(off.stats.conds.some(c => c.sk === name));
    assert.ok(on.html.includes('첫 포효 이후') && on.html.includes(' checked'));
    assert.ok(!on.html.includes('특수 게이지'));
  }
  const combined = calcSkills([[name, 3], ['공격', 3], ['공격 활성', 1]], {}, { [name]: true }).stats;
  assert.strictEqual(combined.now.atk, 1950, '기본 공격력 × 1.1 + 공격 150 + 용맹 700');
  assert.ok(bdSkillDesc(name, 5).includes('특수 게이지'), '스킬 설명은 그대로 유지');
});

check('추가 공격 독·마비는 몬스터 상태 조건 체크 시에만 대미지를 높인다', () => {
  for (const [name, values, status] of [
    ['추가 공격【독】', [30, 45, 60, 80, 100], '독'],
    ['추가 공격【마비】', [50, 75, 100, 130, 160], '마비'],
  ]) for (let lv = 1; lv <= 5; lv++) for (const element of [null, '불', '독', '마비']) {
    const weapon = { e: element, ele: element ? 500 : 0 };
    const off = calcSkills([[name, lv]], weapon);
    const on = calcSkills([[name, lv]], weapon, { [name]: true });
    assert.strictEqual(off.stats.co.F, 1);
    assert.strictEqual(on.stats.co.F, 1 + values[lv - 1] / 100);
    assert.strictEqual(off.stats.now.atk, on.stats.now.atk);
    assert.strictEqual(off.stats.now.ele, on.stats.now.ele);
    assert.strictEqual(on.stats.score, Math.round((1000 + weapon.ele) * on.stats.co.F));
    assert.ok(off.stats.conds.some(c => c.sk === name));
    assert.ok(off.html.includes(`몬스터 ${status} 상태`));
    assert.ok(!off.html.includes(' checked'));
    assert.ok(on.html.includes(' checked'));
  }
});

check('추가 지정한 일곱 스킬은 조건 체크 시에만 대미지를 높인다', () => {
  for (const name of ['비연', '추격', '불퇴전', '특수 스킬 위력 상승', '적정 거리 위력 UP',
    '통상탄·속성 통상탄 강화', '참렬탄/속성 참렬탄 강화']) {
    for (const [lv, desc] of bdSkillLevels(name)) {
      const percent = +/대미지가 (\d+)%/.exec(desc)[1];
      const off = calcSkills([[name, lv]]), on = calcSkills([[name, lv]], {}, { [name]: true });
      assert.strictEqual(off.stats.co.F, 1, `${name} Lv${lv} 끔`);
      assert.strictEqual(on.stats.co.F, 1 + percent / 100, `${name} Lv${lv} 켬`);
      assert.ok(off.stats.conds.some(c => c.sk === name));
      assert.ok(!off.html.includes(' checked') && on.html.includes(' checked'));
    }
  }
  for (const name of ['라스트 샷', '후발 주자', '각성의 일격', '사냥꾼의 결속']) {
    const { stats } = calcSkills([[name, 1]], {}, { [name]: true });
    assert.strictEqual(stats.score, 1500);
    assert.ok(!stats.conds.some(c => c.sk === name));
  }
  assert.strictEqual(calcSkills([['포술', 1]]).stats.co.F, 1.1, '포술은 이번 변경에서 제외');
});

check('연격 경지는 원래 체크에 병합하고 조건부 레벨·수치를 상한으로 표시한다', () => {
  for (const lv of [4, 5, 7]) for (const advanced of [0, 1, 2, 3]) {
    const skills = [['연격', lv], ...(advanced ? [['연격·경지', advanced]] : [])];
    const percent = lv < 5 ? 20 : 30 + Math.min(advanced, 2) * 5;
    const applied = lv >= 5 && advanced > 0;
    const off = calcSkills(skills, {}, { '연격·경지': true });
    const on = calcSkills(skills, {}, { '연격': true });
    assert.strictEqual(off.stats.co.B, 1, '경지 단독 체크로 활성화하면 안 됨');
    assert.ok(Math.abs(on.stats.co.B - (1 + percent / 100)) < 1e-12);
    const row = on.stats.conds.find(c => c.sk === '연격');
    assert.strictEqual(row.lv, Math.min(lv, 5));
    assert.strictEqual(row.list.length, 1);
    assert.strictEqual(row.list[0].v, percent);
    assert.strictEqual(on.stats.conds.length, 1, '경지 별도 체크·중복 효과 금지');
    assert.ok(on.html.includes(`연격 <b>${Math.min(lv, 5)}</b>`));
    assert.strictEqual(on.html.includes('(연격·경지 적용)'), applied);
    assert.ok(on.html.includes(`공격력 +${percent}%`));
  }
  assert.strictEqual(calcSkills([['연격·경지', 2]]).stats.co.B, 1, '연격 없이 경지 적용 금지');
  assert.strictEqual(calcSkills([['공격', 5], ['공격·경지', 1]]).stats.co.A, 450, '상시 스킬 경지는 레벨 조건으로 자동 적용');
});

check('특수 스킬 위력 상승 경지도 부모 체크와 합산 수치를 사용한다', () => {
  const gateOf = vm.runInContext('bdSkillGate', ctx);
  for (const desc of [
    "Lv5 이상의 '연격' 스킬이 발동 중일 때, 공격력이 5% 증가한다.",
    "스킬 '연격' Lv5 이상이 발동 중일 때 공격력이 5% 증가한다.",
    '연격 Lv5 이상이 활성화되어 있을 때, 공격력이 5% 증가한다.',
  ]) {
    const gate = gateOf(desc);
    assert.strictEqual(gate.s, '연격');
    assert.strictEqual(gate.lv, 5);
    assert.ok(desc.slice(gate.end).includes('공격력이 5%'));
  }
  for (const lv of [4, 5, 6]) for (const advanced of [1, 2]) {
    const name = '특수 스킬 위력 상승', skills = [[name, lv], [name + '·경지', advanced]];
    const base = +/대미지가 (\d+)%/.exec(bdSkillDesc(name, lv))[1];
    const percent = base + (lv >= 5 ? advanced * 20 : 0);
    const off = calcSkills(skills), on = calcSkills(skills, {}, { [name]: true });
    assert.strictEqual(off.stats.co.F, 1);
    assert.ok(Math.abs(on.stats.co.F - (1 + percent / 100)) < 1e-12);
    assert.strictEqual(on.stats.conds.length, 1);
    assert.strictEqual(on.stats.conds[0].list[0].v, percent);
    assert.ok(on.html.includes(`대미지 +${percent}%`));
    assert.strictEqual(on.html.includes('(특수 스킬 위력 상승·경지 적용)'), lv >= 5);
  }
  assert.strictEqual(calcSkills([['특수 스킬 위력 상승·경지', 1]]).stats.co.F, 1);
  const effects = vm.runInContext('bdEffects("Lv5 이상의 \'파괴왕\' 스킬이 발동 중일 때, 누적 대미지가 20% 증가한다.", "파괴왕·경지")', ctx);
  assert.strictEqual(effects.length, 0, '향후 파괴왕 경지도 HP 대미지에서 제외');
});

check('힘의 해방은 체크 시 회심 증가분만 적용한다', () => {
  const name = '힘의 해방', values = [20, 30, 40, 50, 60];
  for (const type of BUILD.weaponTypes.map(w => w.k)) for (let lv = 1; lv <= 5; lv++) {
    const off = calcSkills([[name, lv]], { t: type });
    const on = calcSkills([[name, lv]], { t: type }, { [name]: true });
    assert.strictEqual(off.stats.now.crit, 0);
    assert.strictEqual(on.stats.now.crit, values[lv - 1]);
    assert.strictEqual(on.stats.co.G, 1 + values[lv - 1] / 100 * 0.25);
    assert.strictEqual(on.stats.now.atk, 1000);
    assert.strictEqual(on.stats.now.ele, 500);
    assert.ok(off.stats.conds.some(c => c.sk === name));
    assert.ok(on.html.includes('발동 조건 충족') && on.html.includes(' checked'));
    assert.ok(!on.html.includes('SP 게이지'));
  }
  const combined = calcSkills([[name, 5], ['공격 증강【회심】', 1]], { crit: -20 }, { [name]: true }).stats;
  assert.strictEqual(combined.now.crit, 40);
  assert.strictEqual(combined.co.A, 0, '힘의 해방은 무기 기본 회심을 바꾸지 않음');
});

check('완전 충전은 빌드에 있어도 체크하지 않으면 공격력을 더하지 않는다', () => {
  const name = '완전 충전';
  for (const type of BUILD.weaponTypes.map(w => w.k)) for (let lv = 1; lv <= 5; lv++) {
    const off = calcSkills([[name, lv]], { t: type });
    const on = calcSkills([[name, lv]], { t: type }, { [name]: true });
    assert.strictEqual(off.stats.now.atk, 1000);
    assert.strictEqual(off.stats.co.A, 0);
    assert.strictEqual(on.stats.now.atk, 1000 + lv * 100);
    assert.strictEqual(on.stats.co.A, lv * 100);
    assert.strictEqual(on.stats.now.crit, 0);
    assert.ok(off.stats.conds.some(c => c.sk === name));
    assert.ok(on.html.includes(' checked'));
  }
  const both = calcSkills([[name, 5], ['힘의 해방', 1]], {}, { [name]: true, '힘의 해방': true }).stats;
  assert.strictEqual(both.now.atk, 1500);
  assert.strictEqual(both.now.crit, 20);
  assert.strictEqual(both.score, 2100);
});

check('공격 증강【회심】은 양수 무기 기본 회심 1%당 공격력 8을 더한다', () => {
  const name = '공격 증강【회심】';
  for (const crit of [-20, 0, 10, 30, 60]) {
    const { stats, html } = calcSkills([[name, 1]], { crit });
    assert.strictEqual(stats.co.A, Math.max(crit, 0) * 8);
    assert.strictEqual(stats.now.atk, 1000 + Math.max(crit, 0) * 8);
    assert.strictEqual(stats.now.crit, crit);
    assert.ok(!stats.conds.some(c => c.sk === name));
    assert.ok(!html.includes('data-cond='));
  }
  const increased = calcSkills([[name, 1], ['간파', 5]], { crit: -20 }).stats;
  assert.ok(increased.now.crit > 0);
  assert.strictEqual(increased.co.A, 0, '간파로 양수가 되어도 기본 역회심이면 +0');
  const decreased = calcSkills([[name, 1], ['흉회심', 5]], { crit: 30 }).stats;
  assert.strictEqual(decreased.now.crit, 0);
  assert.strictEqual(decreased.co.A, 240, '흉회심으로 감소해도 무기 기본 회심 30% 기준');
  const combined = calcSkills([[name, 1], ['공격', 3], ['공격 활성', 1]], { crit: 30 }).stats;
  assert.strictEqual(combined.now.atk, 1490, '기본 공격력 × 1.1 + 공격 150 + 회심 증강 240');
  const serg = BUILD.sets.find(s => s.key === 'serg');
  const actual = calcSkills([...serg.weaponSkills, ...serg.pieces.helm.skills].map(x => [x.s, x.lv]), serg.weapons[0]).stats;
  assert.strictEqual(actual.co.A, 240, '셀레기오스 무기 + 레기오스헬름');
});

check('흉회심은 최종 역회심 확률의 30%를 자동 기대값에 반영한다', () => {
  const name = '흉회심', reductions = [10, 15, 20, 25, 30];
  const multipliers = [1.5, 1.75, 2, 2.25, 2.5];
  for (let lv = 1; lv <= 5; lv++) for (const crit of [-200, -30, 0, 30, 50, 200]) {
    const { stats, html } = calcSkills([[name, lv]], { crit });
    const final = crit - reductions[lv - 1], q = Math.max(-100, Math.min(100, final)) / 100;
    const r = Math.max(0, -q);
    const expected = q >= 0 ? 1 + q * 0.25 : r * 0.3 * multipliers[lv - 1] + r * 0.7 * 0.75 + (1 - r);
    assert.strictEqual(stats.now.crit, final);
    assert.ok(Math.abs(stats.co.G - expected) < 1e-12, `${crit}%/Lv${lv}`);
    assert.strictEqual(stats.score, Math.round(1500 * expected));
    assert.ok(!stats.conds.some(c => c.sk === name));
    assert.ok(!html.includes('data-cond='));
    assert.strictEqual(html.includes('역회심 중 30%'), final < 0);
    if (final < 0) assert.ok(html.includes(' × 0.3 × ') && html.includes(' × 0.7 × 0.75'));
    assert.strictEqual(calcSkills([[name, lv]], { crit }, { [name]: true }).stats.score, stats.score);
  }
  const ordinary = calcSkills([], { crit: -20 }).stats;
  assert.strictEqual(ordinary.co.G, 0.95, '흉회심 없는 역회심 배율');
  assert.strictEqual(calcSkills([], { crit: 20 }).stats.co.G, 1.05, '기존 양수 회심 배율');
  assert.strictEqual(calcSkills([['공격', 3]]).stats.now.atk, 1150, '기존 공격 스킬');
});

check('신규 스킬 설명과 이소네미쿠니 아종 허리', () => {
  const max = { '점프 철인': 1, '특수 스킬 위력 상승·경지': 2, '추가 공격【폭파】': 5, '포술·경지': 2, '차지 스톡': 3 };
  for (const [name, lv] of Object.entries(max)) {
    assert.strictEqual(bdSkillLevels(name).length, lv, `${name} 레벨 수`);
    assert.ok(bdSkillDesc(name, lv), `${name} 최고 레벨 설명`);
  }
  const belt = BUILD.sets.find(s => s.key === 'a-somna').pieces.belt;
  assert.strictEqual(belt.skills.find(s => s.s === '차지 스톡').lv, 2);
});

check('수수께끼의[U]는 메인 스킬 세 개를 3.3%로 표시한다', () => {
  const group = SMELT.groups.find(g => g.group === '수수께끼의[U]');
  assert.ok(group && group.mystery, '수수께끼의[U]가 없습니다');
  assert.strictEqual(group.code, 'u');
  assert.strictEqual(JSON.stringify(group.skills.map(s => [s.name, s.rate, s.star, s.code])),
    JSON.stringify([['상태 이상 축적 시 위력 UP', '3.3%', true, 'b'], ['포술', '3.3%', true, 'a'], ['특수 스킬 위력 상승', '3.3%', true, 's']]));
  for (const skill of group.skills) assert.strictEqual(skill.levels.length, 5, `${skill.name} 레벨 수`);
});

check('가디언 이벤트 방어구는 다섯 부위와 표류 슬롯을 가진다', () => {
  const set = BUILD.sets.find(s => s.key === 'guardian');
  assert.ok(set && set.g === 1, '가디언이 이벤트 세트가 아닙니다');
  const want = {
    helm: ['가디언헬름', [['폭파 피해 내성', 3]]],
    mail: ['가디언슈트', [['귀마개', 3]]],
    gloves: ['가디언암', [['록온', 1], ['점프 철인', 1]]],
    belt: ['가디언코일', [['장전 속도', 2]]],
    greaves: ['가디언부츠', [['반동 경감', 1], ['특수 스킬 위력 상승', 1]]],
  };
  for (const [part, [name, skills]] of Object.entries(want)) {
    const item = set.pieces[part];
    assert.strictEqual(item.name, name, `${part} 이름`);
    assert.strictEqual(item.slot, 1, `${part} 표류 슬롯`);
    assert.strictEqual(JSON.stringify(item.skills.map(x => [x.s, x.lv])), JSON.stringify(skills), `${part} 스킬`);
  }
});

check('공식 전환 몬스터 무기는 10-5 수치와 전용 정보를 쓴다', () => {
  const brachy = BUILD.sets.find(s => s.key === 'brachy');
  assert.ok(!brachy.weaponSpecNote, '10-1 기준 안내가 남아 있습니다');
  for (const w of brachy.weapons) {
    const gun = ['light-gun', 'heavy-gun'].includes(w.t);
    assert.deepStrictEqual([w.e, w.atk, w.ele, w.crit], gun ? [null, 2510, null, 0] : ['폭파', 2007, 416, 10]);
    assert.strictEqual(JSON.stringify(bdWSkills(brachy, w)), gun ? '[{"s":"포술","lv":1}]' : '[{"s":"추가 공격【폭파】","lv":1}]');
  }
  assert.strictEqual(JSON.stringify(brachy.weapons.find(w => w.t === 'bow').x), '["Lv1 확산","Lv1 확산","Lv4 연사","Lv4 연사"]');
  const somna = BUILD.sets.find(s => s.key === 'a-somna');
  assert.ok(!somna.weaponSpecNote, '10-1 기준 안내가 남아 있습니다');
  for (const w of somna.weapons) {
    assert.deepStrictEqual([w.e, w.atk, w.ele, w.crit], ['얼음', 1450, 1614, -20]);
    assert.strictEqual(JSON.stringify(bdWSkills(somna, w)), '[{"s":"속성 공격 증강【SP】","lv":1}]');
  }
});

check('공식 전환은 임시 키를 유지하고 장비 이름·슬롯을 가져온다', () => {
  const names = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/official-names.json'), 'utf8'));
  const parts = { helm: 'head', mail: 'chest', gloves: 'arms', belt: 'waist', greaves: 'legs' };
  const types = { 'shield-sword': 'swordshield', 'great-sword': 'greatsword', 'long-sword': 'longsword',
    'dual-blades': 'dualblades', hammer: 'hammer', 'hunting-horn': 'huntinghorn', lance: 'lance',
    gunlance: 'gunlance', 'switch-axe': 'switchaxe', 'charge-blade': 'chargeblade',
    'insect-glaive': 'insectglaive', 'light-gun': 'lightbowgun', 'heavy-gun': 'heavybowgun', bow: 'bow' };
  for (const [key, slug, id, count] of [['brachy', 'brachydios', 85, 14], ['a-somna', 'aurora_somnacanth', 86, 7]]) {
    const sets = BUILD.sets.filter(s => s.key === key);
    assert.strictEqual(sets.length, 1, `${key} 중복/누락`);
    const set = sets[0];
    assert.strictEqual(set.id, id);
    assert.strictEqual(set.u, 5);
    assert.strictEqual(set.weapons.length, count);
    for (const [part, suffix] of Object.entries(parts)) {
      assert.strictEqual(set.pieces[part].name, names.armor[`${slug}_${suffix}`]);
      assert.strictEqual(set.pieces[part].slot, 1);
    }
    for (const w of set.weapons) assert.strictEqual(w.name, names.weapon[`${slug}_${types[w.t]}`]);
    const old = { ...bdNewBuild(), w: key, wt: 'great-sword',
      helm: key, mail: key, gloves: key, belt: key, greaves: key };
    const back = bdParse(bdShareParam(old));
    for (const field of ['w', 'wt', ...BUILD.parts.map(p => p.k)]) assert.strictEqual(back[field], old[field]);
    assert.ok(new Map(bdTotals(back)).get('록온') >= 1, '옛 빌드의 방어구 스킬 누락');
  }
  assert.ok(!BUILD.sets.some(s => ['brac', 'a-somn'].includes(s.key)), '원본 키가 중복 세트를 만들었습니다');
});

check('공식 공개된 세 스킬은 임시 번역 대신 공식 설명을 사용한다', () => {
  for (const n of ['추가 공격【폭파】', '포술·경지', '차지 스톡']) {
    assert.ok(!vm.runInContext('SKILLDESC_MANUAL', ctx)[n], `${n} 임시 설명 잔존`);
    const levels = vm.runInContext('SKILLDESC', ctx)[n];
    for (const [lv, desc] of levels) assert.strictEqual(bdSkillDesc(n, lv), desc);
  }
});

check('요청 무기는 같은 소재의 수치를 쓰고 특성이 맞다', () => {
  const cases = [
    ['rathi', 'great-sword', null], ['ratha', 'dual-blades', null],
    ['barr', 'charge-blade', '유탄병'], ['barr', 'long-sword', null],
    ['puke', 'gunlance', '확산형 포격'],
  ];
  for (const [key, type, extra] of cases) {
    const set = BUILD.sets.find(s => s.key === key), weapon = set.weapons.find(w => w.t === type);
    assert.ok(weapon, `${key}/${type} 무기가 없습니다`);
    const base = set.weapons.find(w => w.t !== type);
    for (const field of ['e', 'atk', 'ele', 'crit']) assert.strictEqual(weapon[field], base[field], `${key}/${type} ${field}`);
    assert.strictEqual(extra ? weapon.x?.[0] : weapon.x, extra, `${key}/${type} 특성`);
  }
});

/* 표류석으로만 붙는 스킬은 build-data.js 의 maxLv 와 skill-desc.js 양쪽에서 빠집니다 —
   생성기가 «빌드에 쓰이는 스킬» 을 장비·무기에서만 추리기 때문입니다. build.js 가
   bdStoneLevels 로 표류연성 데이터에서 메워 주는데, 그게 끊기면 막대가 칸 하나로 그려지고
   상세 수치 줄이 사라집니다 — 화면을 봐야만 알 수 있으므로 여기서 잡습니다. */
check('표류석 스킬은 모두 상한과 설명을 얻는다', () => {
  const names = [...new Set(bdStones().flatMap(g => g.skills.map(s => s.name)))];
  assert.ok(names.length > 50, `표류석 스킬이 ${names.length}종뿐입니다`);
  /* 헬퍼가 아니라 «그리는 함수» 를 부릅니다 — bdTotalRow 에서 폴백을 빼면 여기서 걸려야 합니다.
     막대 칸 수는 style 의 --n 에 그대로 실립니다. */
  const cells = name => Number((bdTotalRow(name, 1).match(/--n:(\d+)/) || [])[1] || 0);
  const flat = [], noDesc = [];
  for (const n of names) {
    const lv = (bdStoneLevels(n) || []).length;
    if (lv > 1 && cells(n) !== lv) flat.push(`${n}(${cells(n)}칸, ${lv}단계)`);
    if (!bdSkillDesc(n, 1)) noDesc.push(n);
  }
  assert.strictEqual(flat.join(', '), '', `막대 칸이 단계 수와 다른 표류석 스킬: ${flat.join(', ')}`);
  assert.strictEqual(noDesc.join(', '), '', `설명을 못 얻는 표류석 스킬: ${noDesc.join(', ')}`);
});

/* 합계에서 스킬을 누르면 뜨는 창. 표는 표류연성 탭과 같지만 굵게 서는 줄이 «MAX» 가 아니라
   «지금 이 빌드의 레벨» 이어야 합니다 — 강조가 엉뚱한 줄로 가도 화면은 멀쩡해 보입니다. */
check('스킬 창은 지금 레벨을 짚는다', () => {
  const body = () => $stub('#bd-modal-body').innerHTML || '';
  const onRow = () => (body().match(/<tr class="on"><td>(\d+)<\/td>/) || [])[1];
  /* 머리글 행은 <th> 라 안 걸립니다 — 레벨 줄만 셉니다. */
  const lvRows = () => (body().match(/<tr[^>]*><td>/g) || []).length;

  bdOpenSkill('몸통 강화', 2);
  assert.strictEqual(onRow(), '2', '2레벨로 낀 스킬인데 다른 줄이 굵습니다');
  assert.strictEqual(lvRows(), 3, '몸통 강화는 3단계여야 합니다');
  assert.ok($stub('#bd-modal-title').innerHTML.includes('Lv2'), '제목에 지금 레벨이 없습니다');
  assert.ok($stub('#bd-srow').hidden, '스킬 창에는 검색줄이 필요 없습니다');

  /* 표류석으로만 붙는 스킬도 같은 창이 떠야 합니다(설명을 표류연성 데이터에서 빌려 옵니다). */
  bdOpenSkill('더블임팩트', 1);
  assert.strictEqual(onRow(), '1', '표류석 스킬의 강조 줄이 다릅니다');
  assert.strictEqual(lvRows(), 5, '더블임팩트는 5단계여야 합니다');

  /* 상한을 넘겨 낀 빌드는 표에 없는 레벨입니다 — 마지막 줄을 짚습니다. */
  bdOpenSkill('몸통 강화', 9);
  assert.strictEqual(onRow(), '3', '상한을 넘겼는데 강조가 사라졌습니다');
  assert.ok($stub('#bd-modal-title').innerHTML.includes('/3'), '넘긴 것을 제목이 알려주지 않습니다');
});

check('설명이 없는 스킬은 누를 수 없다', () => {
  /* 눌러 봐야 빈 창이라 단추로 만들지 않습니다. 반대로 설명이 있으면 반드시 단추여야 합니다. */
  const some = [...new Set(bdStones().flatMap(g => g.skills.map(s => s.name)))].slice(0, 5);
  for (const n of some) assert.ok(bdTotalRow(n, 1).includes('data-sk='), `${n} 을 누를 수 없습니다`);
  assert.ok(!bdTotalRow('있을 리 없는 스킬', 1).includes('data-sk='), '설명 없는 스킬이 단추가 됐습니다');
});

check('자리표시자가 데이터에 남아 있지 않다', () => {
  assert.ok(!JSON.stringify(BUILD).includes('무기 종류에 따라'), '«무기 종류에 따라 다름» 이 남아 있습니다');
});

check('레벨 0 스킬이 없다', () => {
  for (const s of BUILD.sets) {
    for (const x of s.weaponSkills) assert.ok(x.lv > 0, `${s.key} 공통 ${x.s} lv0`);
    for (const w of s.weapons) for (const x of (w.sk || [])) assert.ok(x.lv > 0, `${s.key}/${w.t} ${x.s} lv0`);
  }
});

check('공통 스킬이 없는 소재는 무기마다 스킬이 있다', () => {
  for (const s of BUILD.sets) {
    if (s.weaponSkills.length || !s.weapons.length) continue;
    for (const w of s.weapons) assert.ok(w.sk && w.sk.length, `${s.key}/${w.t} 스킬 없음`);
  }
});

check('종류 전용 스킬이 공통을 갈음한다', () => {
  /* vm 밖이라 객체를 그대로 견주면 프로토타입이 달라 어긋납니다. 글로 견줍니다. */
  const J = assert.strictEqual.bind(assert);
  const baze = BUILD.sets.find(s => s.key === 'baze');
  const of = t => JSON.stringify(bdWSkills(baze, baze.weapons.find(w => w.t === t)));
  J(of('long-sword'), '[{"s":"속전속결","lv":1}]');
  J(of('gunlance'), '[{"s":"포술","lv":1}]');
  /* 종류 전용이 없는 소재는 공통을 그대로 씁니다. */
  const jagr = BUILD.sets.find(s => s.key === 'g-jagr');
  const w = jagr.weapons[0];
  assert.ok(!w.sk, '이 소재는 종류 전용 스킬이 없어야 합니다');
  J(JSON.stringify(bdWSkills(jagr, w)), JSON.stringify(jagr.weaponSkills));
});

check('스킬 합계에 고른 무기의 스킬이 들어간다', () => {
  const b = { ...bdNewBuild(), w: 'baze', wt: 'gunlance' };
  const total = new Map(bdTotals(b));
  assert.strictEqual(total.get('포술'), 1, '건랜스인데 포술이 없습니다');
  assert.ok(!total.has('속전속결'), '태도 스킬이 섞였습니다');
  assert.ok(!total.has('무기 종류에 따라 다름'), '자리표시자가 합계에 섞였습니다');
});

/* 일괄선택 검색 — 스킬은 전체 일치, 이름은 부분 일치, 걸린 부위만 남습니다. */
check('일괄선택: 빈 검색은 가진 부위를 모두 보여 준다', () => {
  const rows = bdBulkRows('');
  assert.strictEqual(rows.length, BUILD.sets.filter(s => Object.keys(s.pieces).length).length);
  for (const r of rows) assert.strictEqual(r.hit.length, Object.keys(r.s.pieces).length, `${r.s.key} 부위 수가 다릅니다`);
});

check('일괄선택: 스킬은 이름 전체가 같아야 걸린다', () => {
  const rows = bdBulkRows('공격');
  assert.ok(rows.length, '«공격» 스킬을 가진 방어구가 있어야 합니다');
  for (const r of rows) for (const k of r.hit) {
    const pc = r.s.pieces[k];
    const byName = (r.s.name + pc.name).replace(/\s+/g, '').includes('공격');
    assert.ok(byName || pc.skills.some(x => x.s === '공격'),
      `${r.s.key}/${k}: «공격» 이 아닌 스킬(${pc.skills.map(x => x.s)})이 걸렸습니다`);
  }
  /* 자동완성으로 고른 전체 이름은 그대로 걸려야 합니다. */
  assert.ok(bdArmorSkills().includes('불속성 공격 강화'), '자동완성 목록에 스킬이 빠졌습니다');
  assert.ok(bdBulkRows('불속성 공격 강화').length, '전체 이름으로 검색해도 결과가 없습니다');
});

/* 스킬 뱃지 여러 개 — OR 로 남기고, 겹친 개수가 많은 세트가 위로 옵니다.
   AND 로 좁히면 스킬이 부위마다 나뉘어 붙는 탓에 거의 늘 빈 목록이 됩니다. */
check('일괄선택: 스킬 뱃지 둘이면 OR 로 남고 많이 겹친 세트가 앞에 온다', () => {
  const setSk = list => vm.runInContext(`bdBulkSk = ${JSON.stringify(list)}`, ctx);
  const two = [{ s: '록온', c: '#E9A13B' }, { s: '반동 경감', c: '#4BC49A' }];
  setSk(two);
  const rows = bdBulkRows('');
  try {
    assert.ok(rows.length, '뱃지 두 개로 걸리는 방어구가 없습니다');
    let both = 0;
    for (const r of rows) {
      for (const k of r.hit) {
        const names = r.s.pieces[k].skills.map(x => x.s);
        assert.ok(two.some(x => names.includes(x.s)), `${r.s.key}/${k}: 뱃지와 무관한 부위가 남았습니다`);
        /* 칸에 찍는 숫자는 그 부위가 실제로 주는 레벨이어야 합니다. */
        for (const { c, lv } of r.m[k]) {
          const want = r.s.pieces[k].skills.find(x => x.s === two.find(y => y.c === c).s);
          assert.strictEqual(lv, want.lv, `${r.s.key}/${k}: 레벨 숫자가 다릅니다`);
        }
      }
      if (r.n === 2) both++;
    }
    assert.ok(both, '두 스킬을 다 덮는 세트가 하나도 없습니다(정렬을 확인하세요)');
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1].n >= rows[i].n, '많이 겹친 세트가 뒤로 밀렸습니다');
    }
    /* 이름 검색은 뱃지와 AND 로 걸립니다 — 뱃지로 좁힌 뒤 이름으로 또 좁히는 흐름입니다. */
    const named = bdBulkRows(rows[0].s.name);
    assert.ok(named.every(r => r.s.name.includes(rows[0].s.name)), '이름 검색이 뱃지를 무시했습니다');
  } finally {
    setSk([]);                       // 뒤 검사가 뱃지에 물들지 않게 되돌립니다
  }
});

/* ── 공유 링크 ────────────────────────────────────────────────────
   카카오톡 공유는 완성된 메시지가 1만 자를 넘으면 카카오 오류 페이지로 튕깁니다.
   카드가 링크를 열아홉 번 담으므로 «링크 길이 × 스무 배» 가 곧 메시지 크기입니다.
   여섯 부위를 다 갖춘 빌드가 그 한도를 넘겨서 공유가 깨졌던 적이 있습니다. */

/* 여섯 부위 + 부위마다 표류석 하나 — 추천빌드에서 가져오는 빌드의 흔한 모습입니다. */
function fullBuild() {
  const b = bdNewBuild();
  const wset = BUILD.sets.find(s => (s.weapons || []).some(w => w.wt === b.wt));
  if (wset) b.w = wset.key;
  for (const { k } of BUILD.parts) {
    /* 링크가 가장 길어지는 쪽으로 고릅니다 — 키가 길고 표류 슬롯이 있는 방어구. */
    const s = BUILD.sets.filter(x => x.pieces[k] && x.pieces[k].slot > 0)
      .sort((x, y) => y.key.length - x.key.length)[0];
    if (!s) continue;
    b[k] = s.key;
    const g = bdStones().slice().sort((x, y) =>
      (y.group.length + y.skills[0].name.length) - (x.group.length + x.skills[0].name.length))[0];
    b.ds[k] = [{ c: g.group, s: g.skills.map(x => x.name).sort((x, y) => y.length - x.length)[0] }];
  }
  return b;
}

check('공유 링크에 쿼리를 끊는 글자가 없다', () => {
  const p = bdShareParam(fullBuild());
  /* 이 글자들이 날것으로 들어가면 주소가 거기서 잘립니다(record.js 의 rkBuildParam 도
     [^&#\s]+ 로 떼어 갑니다). 한글·구분자는 일부러 그대로 둡니다 — 길이가 세 배가 됩니다. */
  assert.ok(!/[&#?\s]/.test(p), `공유 파라미터에 끊기는 글자가 있습니다: ${p}`);
});

check('여섯 부위 빌드의 공유 링크가 카카오 한도 안에 든다', () => {
  const len = bdShareAbs(fullBuild()).length;
  assert.ok(len <= BD_KAKAO_URL_MAX,
    `여섯 부위 빌드 링크가 ${len}자입니다(한도 ${BD_KAKAO_URL_MAX}). 이대로면 모바일 카톡 공유가 오류 페이지로 튕깁니다`);
});

check('공유 링크를 다시 읽으면 같은 빌드가 된다', () => {
  const b = fullBuild();
  const back = bdParse(bdShareParam(b));
  assert.ok(back, '방금 만든 공유 파라미터를 못 읽었습니다');
  for (const k of ['w', 'wt', 'st', ...BUILD.parts.map(p => p.k)]) {
    assert.strictEqual(back[k], b[k], `${k} 가 왕복에서 바뀌었습니다`);
  }
  /* deepStrictEqual 은 프로토타입까지 봅니다. bdParse 가 만든 객체는 vm 안쪽 것이라
     바깥에서 만든 객체와 늘 다르게 나옵니다 — 값만 견주면 됩니다. */
  assert.strictEqual(JSON.stringify(back.ds), JSON.stringify(b.ds), '표류석이 왕복에서 바뀌었습니다');
});

check('전부 인코딩된 옛 링크도 그대로 읽힌다', () => {
  const now = bdShareParam(fullBuild());
  const old = encodeURIComponent(decodeURIComponent(now));
  assert.strictEqual(JSON.stringify(bdParse(old)), JSON.stringify(bdParse(now)), '옛 형식 링크가 깨졌습니다');
});

check('무기군 비활성화 및 소재 선택 유지', () => {
  vm.runInContext('bdState = { builds: [bdNewBuild(), bdNewBuild()], detail: false };', ctx);
  const state = vm.runInContext('bdState', ctx);
  const open = vm.runInContext('bdOpenType', ctx);
  const buttons = () => els['#bd-modal-body'].innerHTML.match(/<button\b[^>]*data-v="[^"]+"[^>]*>/g);
  open(0);
  assert.strictEqual(buttons().length, BUILD.weaponTypes.length);
  assert.ok(buttons().every(tag => !tag.includes(' disabled')));
  for (const key of ['a-somna', 'halloween-24', 'mr-beast', 'ore']) {
    const set = BUILD.sets.find(s => s.key === key);
    state.builds[0].w = key;
    state.builds[0].wt = set.weapons[0].t;
    open(0);
    for (const tag of buttons()) {
      const type = tag.match(/data-v="([^"]+)"/)[1];
      assert.strictEqual(!tag.includes(' disabled'), set.weapons.some(w => w.t === type), `${key}/${type}`);
    }
  }
  const b = state.builds[0];
  b.w = 'a-somna'; b.wt = 'great-sword'; b.st = 1;
  open(0);
  const before = JSON.stringify(state);
  const click = type => handlers['#bd-modal-body:click']({ target: {
    closest: sel => sel === '.bd-gi' ? { dataset: { v: type } } : null,
  } });
  for (const type of ['bow', 'unknown', 'great-sword']) click(type);
  assert.strictEqual(JSON.stringify(state), before, '미지원·동일 무기군은 상태를 바꾸면 안 됩니다');
  vm.runInContext('globalThis.typeTestSave = bdSave; globalThis.typeTestRender = bdRender; bdSave = () => {}; bdRender = () => {};', ctx);
  try {
    const other = JSON.stringify(state.builds[1]);
    click('long-sword');
    assert.strictEqual(b.w, 'a-somna');
    assert.strictEqual(b.wt, 'long-sword');
    assert.strictEqual(b.st, 0);
    assert.strictEqual(JSON.stringify(state.builds[1]), other);
    b.w = null; open(0); click('bow');
    assert.strictEqual(b.w, null);
    assert.strictEqual(b.wt, 'bow');
  } finally {
    vm.runInContext('bdSave = typeTestSave; bdRender = typeTestRender;', ctx);
  }
});

check('장비 선택창은 공식 방어구 순번을 공유하고 검색·아이콘 표시에도 유지한다', () => {
  const sorted = [...BUILD.sets].sort((a, b) => a.o - b.o || a.g - b.g || a.u - b.u || a.id - b.id);
  const keys = list => list.map(s => s.key).join(',');
  const before = JSON.stringify(BUILD);
  assert.strictEqual(keys(vm.runInContext('bdOrderedSets()', ctx)), keys(sorted));
  const save = vm.runInContext('({ state: bdState, pick: bdPick, sk: bdGearSk, wf: bdGearWf, bulkSk: bdBulkSk })', ctx);
  ctx.orderTestSave = save;
  try {
    vm.runInContext('bdState = { builds: [bdNewBuild()] }; bdGearWf = null; bdBulkSk = [];', ctx);
    const armor = sorted.filter(s => Object.keys(s.pieces).length);
    assert.strictEqual(keys(bdBulkRows('').map(r => r.s)), keys(armor));
    // 스킬 일치 개수가 같으면 공식 순서, 다르면 일치 개수를 우선한다.
    vm.runInContext('bdBulkSk = [{ s: "록온", c: "a" }, { s: "반동 경감", c: "b" }];', ctx);
    const skillRows = bdBulkRows('');
    assert.ok(skillRows.length);
    for (let i = 1; i < skillRows.length; i++) {
      const a = skillRows[i - 1], b = skillRows[i];
      assert.ok(a.n >= b.n);
      if (a.n === b.n) assert.ok(sorted.indexOf(a.s) < sorted.indexOf(b.s));
    }
    for (const target of ['weapon', ...BUILD.parts.map(p => p.k)]) {
      for (const type of target === 'weapon' ? BUILD.weaponTypes.map(w => w.k) : ['shield-sword']) {
        const expected = sorted.filter(s => target === 'weapon' ? s.weapons.some(w => w.t === type) : s.pieces[target]);
        for (const on of [true, false]) {
          vm.runInContext(`bdPick = { kind: "gear", bi: 0, target: ${JSON.stringify(target)} }; bdState.builds[0].wt = ${JSON.stringify(type)}; bdGearSk = ${on}; bdFillGear("");`, ctx);
          const rendered = () => [...els['#bd-modal-body'].innerHTML.matchAll(/data-v="([^"]+)"/g)].map(m => m[1]);
          assert.strictEqual(rendered().join(','), keys(expected), `${target}/${type}/${on}`);
          vm.runInContext('bdFillGear("리오")', ctx);
          const filtered = rendered();
          assert.ok(filtered.length);
          assert.deepStrictEqual(filtered, expected.filter(s => filtered.includes(s.key)).map(s => s.key));
        }
      }
    }
    assert.strictEqual(JSON.stringify(BUILD), before, '정렬하면서 원본 데이터 변경');
  } finally {
    vm.runInContext('bdState = orderTestSave.state; bdPick = orderTestSave.pick; bdGearSk = orderTestSave.sk; bdGearWf = orderTestSave.wf; bdBulkSk = orderTestSave.bulkSk;', ctx);
    delete ctx.orderTestSave;
  }
});

/* 이 검사는 $ 를 바꿔치기하므로 맨 마지막에 둡니다. */
check('스킬 표시를 끄면 같은 목록이 아이콘 격자가 된다', () => {
  const out = {};
  ctx.esc = String;                 // app.js 것. 여기서는 그대로 돌려주면 됩니다.
  ctx.$ = sel => ({
    hidden: true, value: '', addEventListener() {}, setAttribute() {}, classList: { toggle() {} },
    set innerHTML(v) { out[sel] = v; },
    set textContent(v) { out[sel + '/text'] = v; },
  });
  vm.runInContext('bdState = { builds: [bdNewBuild()], detail: false }; bdPick = { kind: "gear", bi: 0, target: "helm" };', ctx);
  const fill = on => {
    vm.runInContext(`bdGearSk = ${on}; bdFillGear("")`, ctx);
    return out['#bd-modal-body'];
  };
  const on = fill(true), off = fill(false);
  const items = h => (h.match(/data-v="/g) || []).length;
  assert.ok(items(on) > 10, '목록이 비었습니다');
  assert.strictEqual(items(on), items(off), '스킬을 끄면 고를 수 있는 방어구 수가 달라집니다');
  assert.ok(on.includes('bd-ls') && !on.includes('bd-list grid'), '스킬 켬이 지금까지의 목록이 아닙니다');
  assert.ok(off.includes('bd-list grid') && !off.includes('bd-ls'), '스킬 끔이 아이콘 격자가 아닙니다');
  /* 격자는 소재 구분 없이 통으로 봅니다 — 머리글이 줄을 끊으면 한 화면에 덜 들어갑니다. */
  assert.ok(on.includes('bd-gh') && !off.includes('bd-gh'), '격자에 소재 머리글이 남아 있습니다');
});

console.log(fail ? `실패 ${fail}건` : '모두 통과');
process.exit(fail ? 1 : 0);
