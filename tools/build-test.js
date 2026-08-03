/* 빌드 탭 무기 스킬 회귀 테스트 — 의존성 없이 `node tools/build-test.js`.

   무기 스킬은 소재 공통(weaponSkills)이 원칙이지만, 종류마다 다른 소재가 있습니다
   (바젤기우스·이블조·라잔·티가렉스 아종·이스터25·동계 축제25). 그런 무기는 자기
   스킬을 weapons[].sk 로 들고 옵니다. 예전에는 공통 자리에 «무기 종류에 따라 다름»
   이라는 자리표시자가 들어가, 무기를 골라도 그 문구가 스킬 합계에 섞였습니다.
   build-data.js 를 다시 만들었거나 build.js 의 bdWSkills 를 손댔다면 돌려보세요. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const ctx = {
  console,
  /* 화면이 없으므로 요소를 흉내만 냅니다. hidden 을 참으로 두면 build.js 가
     스스로 그리지 않아, 계산 함수만 꺼내 쓸 수 있습니다. */
  $: () => ({ hidden: true, addEventListener() {} }),
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
for (const f of ['smelt-data.js', 'skill-desc.js', 'build-data.js', 'build.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
/* const 선언은 컨텍스트 객체에 얹히지 않아 이름으로 꺼내야 합니다. */
const [BUILD, bdWSkills, bdTotals, bdNewBuild, bdBulkRows, bdArmorSkills,
  bdShareParam, bdShareAbs, bdParse, bdStones, bdStoneLevels, bdSkillDesc, bdTotalRow, BD_KAKAO_URL_MAX] =
  ['BUILD', 'bdWSkills', 'bdTotals', 'bdNewBuild', 'bdBulkRows', 'bdArmorSkills',
    'bdShareParam', 'bdShareAbs', 'bdParse', 'bdStones', 'bdStoneLevels', 'bdSkillDesc', 'bdTotalRow',
    'BD_KAKAO_URL_MAX'].map(n => vm.runInContext(n, ctx));

let fail = 0;
const check = (label, fn) => {
  try { fn(); } catch (e) { fail++; console.log('✗ ' + label + '\n  ' + e.message); }
};

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
