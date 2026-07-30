/* 재료 계산 회귀 테스트 — 의존성 없이 `node tools/material-test.js`.

   아래 표본은 mhnow.me/material 이 같은 조건에서 내놓은 값입니다.
   material-data.js 를 갱신했거나 material.js 의 계산을 손댔다면 반드시 돌려보세요.
   제작 시작 / 아종·희소종·고룡 예외 / 무기·방어구가 갈리는 칸 / 한 단계만 올리기를 모두 덮습니다. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const ctx = { console, module: {}, document: { addEventListener() {} } };
vm.createContext(ctx);
for (const f of ['material-data.js', 'material.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const MATERIAL = vm.runInContext('MATERIAL', ctx);
const matTotals = vm.runInContext('matTotals', ctx);

/* [재료 id, 개수, 희귀도, 아이콘] 을 화면에 나오는 순서 그대로 적어둡니다. */
const GOLDEN = [
  {"id":"anjanath","gear":"weapon","from":"0_0","to":"10_5","zenny":4900,"steps":35,"list":[["monster_bone_s",110,1,"monster_bone_s"],["fire_herb",43,1,"fire_herb"],["sharp_claw",140,1,"sharp_claw"],["anjanath_r1_w",405,1,"claw_pink"],["monster_bone_m",41,2,"monster_bone_m"],["anjanath_r2",155,2,"tail_pink"],["monster_bone_l",17,3,"monster_bone_l"],["monster_bone_plus",45,3,"monster_bone_plus"],["weapon_refining_parts",5,3,"weapon_refining_parts"],["anjanath_r3",115,3,"bone_pink"],["anjanath_r4",79,4,"scale_pink"],["anjanath_r5",40,5,"plate_pink"],["wyvern_gem_shard",27,6,"wyvern_gem_shard"]]},
  {"id":"anjanath","gear":"armor","from":"0_0","to":"10_5","zenny":428000,"steps":35,"list":[["monster_bone_s",398,1,"monster_bone_s"],["fire_herb",157,1,"fire_herb"],["wingdrake_hide",500,1,"wingdrake_hide"],["anjanath_r1_a",618,1,"scale_pink"],["monster_bone_m",148,2,"monster_bone_m"],["anjanath_r2",109,2,"tail_pink"],["monster_bone_l",67,3,"monster_bone_l"],["monster_bone_plus",160,3,"monster_bone_plus"],["armor_refining_parts",25,3,"armor_refining_parts"],["anjanath_r3",82,3,"bone_pink"],["anjanath_r4",59,4,"scale_pink"],["anjanath_r5",22,5,"plate_pink"],["wyvern_gem_shard",45,6,"wyvern_gem_shard"]]},
  {"id":"khezu","gear":"weapon","from":"0_0","to":"10_5","zenny":4900,"steps":35,"list":[["iron_ore",55,1,"iron_ore"],["monster_bone_s",55,1,"monster_bone_s"],["thunderbug",43,1,"thunderbug"],["sharp_claw",140,1,"sharp_claw"],["khezu_r1_w",405,1,"claw_silver"],["machalite_ore",19,2,"machalite_ore"],["monster_bone_m",22,2,"monster_bone_m"],["khezu_r2",155,2,"blood_silver"],["dragonite_ore",9,3,"dragonite_ore"],["earth_crystal",23,3,"earth_crystal"],["monster_bone_l",8,3,"monster_bone_l"],["monster_bone_plus",22,3,"monster_bone_plus"],["weapon_refining_parts",5,3,"weapon_refining_parts"],["khezu_r3",115,3,"body_silver"],["khezu_r4",79,4,"hide_silver"],["khezu_r5",40,5,"body_silver"],["wyvern_gem_shard",27,6,"wyvern_gem_shard"]]},
  {"id":"mizutsune","gear":"armor","from":"4_1","to":"8_3","zenny":57000,"steps":18,"list":[["iron_ore",105,1,"iron_ore"],["monster_bone_s",68,1,"monster_bone_s"],["flowfern",76,1,"flowfern"],["wingdrake_hide",223,1,"wingdrake_hide"],["mizutsune_r1_a",89,1,"hide_purple"],["machalite_ore",42,2,"machalite_ore"],["monster_bone_m",28,2,"monster_bone_m"],["mizutsune_r2",39,2,"tail_purple"],["dragonite_ore",8,3,"dragonite_ore"],["earth_crystal",33,3,"earth_crystal"],["monster_bone_l",8,3,"monster_bone_l"],["monster_bone_plus",14,3,"monster_bone_plus"],["armor_refining_parts",9,3,"armor_refining_parts"],["mizutsune_r3",29,3,"claw_purple"],["mizutsune_r4",10,4,"hide_purple"],["mizutsune_r5",6,5,"claw_purple"],["mizutsune_r6",4,6,"plate_purple"]]},
  {"id":"nightshade_paolumu","gear":"weapon","from":"0_0","to":"7_2","zenny":1800,"steps":12,"list":[["iron_ore",15,1,"iron_ore"],["monster_bone_s",9,1,"monster_bone_s"],["sleep_herb",6,1,"sleep_herb"],["sharp_claw",34,1,"sharp_claw"],["nightshade_paolumu_r1_w",100,1,"scale_purple"],["machalite_ore",3,2,"machalite_ore"],["monster_bone_m",4,2,"monster_bone_m"],["nightshade_paolumu_r2",13,2,"wing_purple"],["dragonite_ore",2,3,"dragonite_ore"],["earth_crystal",1,3,"earth_crystal"],["monster_bone_plus",4,3,"monster_bone_plus"],["weapon_refining_parts",2,3,"weapon_refining_parts"],["nightshade_paolumu_r3",12,3,"wing_purple"],["nightshade_paolumu_r4",14,4,"scale_purple"],["nightshade_paolumu_r5",5,5,"hide_purple"]]},
  {"id":"zinogre","gear":"armor","from":"0_0","to":"10_5","zenny":425000,"steps":30,"list":[["iron_ore",398,1,"iron_ore"],["thunderbug",156,1,"thunderbug"],["wingdrake_hide",490,1,"wingdrake_hide"],["zinogre_r1_a",294,1,"shell_green"],["machalite_ore",145,2,"machalite_ore"],["zinogre_r2",79,2,"tail_green"],["dragonite_ore",65,3,"dragonite_ore"],["carpenterbug",156,3,"carpenterbug"],["armor_refining_parts",25,3,"armor_refining_parts"],["zinogre_r3",59,3,"body_silver"],["zinogre_r4",40,4,"claw_green"],["zinogre_r5",24,5,"claw_green"],["zinogre_r6",18,6,"plate_green"]]},
  {"id":"deviljho","gear":"weapon","from":"5_2","to":"10_5","zenny":423000,"steps":28,"list":[["monster_bone_s",546,1,"monster_bone_s"],["dragonfell_berry",222,1,"dragonfell_berry"],["sharp_claw",666,1,"sharp_claw"],["deviljho_r1_w",423,1,"scale_forest"],["monster_bone_m",198,2,"monster_bone_m"],["deviljho_r2",158,2,"tail_forest"],["monster_bone_l",91,3,"monster_bone_l"],["monster_bone_plus",223,3,"monster_bone_plus"],["weapon_refining_parts",25,3,"weapon_refining_parts"],["deviljho_r3",115,3,"claw_forest"],["deviljho_r4",77,4,"hide_forest"],["deviljho_r5",45,5,"head_forest"],["deviljho_r6",27,6,"blood_forest"]]},
  {"id":"kushala_daora","gear":"weapon","from":"0_0","to":"10_5","zenny":420000,"steps":25,"list":[["weapon_refining_parts",25,3,"weapon_refining_parts"],["kushala_daora_r3_w",798,3,"scale_grey"],["elder_dragon_blood",440,4,"elder_dragon_blood"],["kushala_daora_r5",170,5,"tail_grey"],["kushala_daora_r6",48,6,"claw_grey"]]},
  {"id":"kushala_daora","gear":"armor","from":"0_0","to":"10_5","zenny":420000,"steps":25,"list":[["armor_refining_parts",25,3,"armor_refining_parts"],["kushala_daora_r3_a",399,3,"shell_grey"],["elder_dragon_blood",220,4,"elder_dragon_blood"],["kushala_daora_r5",86,5,"tail_grey"],["kushala_daora_r6",24,6,"claw_grey"]]},
  {"id":"coral_pukei_pukei","gear":"armor","from":"0_0","to":"6_1","zenny":8000,"steps":6,"list":[["iron_ore",22,1,"iron_ore"],["flowfern",9,1,"flowfern"],["wingdrake_hide",30,1,"wingdrake_hide"],["coral_pukei_pukei_r1_a",40,1,"shell_orange"],["machalite_ore",7,2,"machalite_ore"],["coral_pukei_pukei_r2",5,2,"tail_orange"],["dragonite_ore",3,3,"dragonite_ore"],["earth_crystal",9,3,"earth_crystal"],["armor_refining_parts",1,3,"armor_refining_parts"],["coral_pukei_pukei_r3",2,3,"bag_orange"],["coral_pukei_pukei_r4",5,4,"wing_orange"],["coral_pukei_pukei_r5",2,5,"scale_orange"]]},
  {"id":"gold_rathian","gear":"weapon","from":"6_1","to":"6_2","zenny":1000,"steps":1,"list":[["monster_bone_s",32,1,"monster_bone_s"],["sharp_claw",44,1,"sharp_claw"],["gold_rathian_r1_w",9,1,"scale_yellow"]]},
  {"id":"great_jagras","gear":"armor","from":"10_4","to":"10_5","zenny":62500,"steps":1,"list":[["great_jagras_r1_a",210,1,"hide_yellow"],["dragonite_ore",22,3,"dragonite_ore"],["earth_crystal",44,3,"earth_crystal"],["wyvern_gem_shard",15,6,"wyvern_gem_shard"]]},
  {"id":"black_diablos","gear":"armor","from":"0_0","to":"9_5","zenny":175000,"steps":25,"list":[["monster_bone_s",284,1,"monster_bone_s"],["godbug",110,1,"godbug"],["wingdrake_hide",356,1,"wingdrake_hide"],["black_diablos_r1_a",387,1,"shell_grey"],["monster_bone_m",103,2,"monster_bone_m"],["black_diablos_r2",75,2,"body_grey"],["monster_bone_l",43,3,"monster_bone_l"],["carpenterbug",110,3,"carpenterbug"],["armor_refining_parts",16,3,"armor_refining_parts"],["black_diablos_r3",55,3,"body_grey"],["black_diablos_r4",36,4,"shell_grey"],["black_diablos_r5",12,5,"body_grey"],["wyvern_gem_shard",15,6,"wyvern_gem_shard"]]},
  {"id":"velkhana","gear":"armor","from":"0_0","to":"10_5","zenny":420000,"steps":25,"list":[["armor_refining_parts",25,3,"armor_refining_parts"],["velkhana_r3_a",399,3,"shell_blue"],["elder_dragon_blood",220,4,"elder_dragon_blood"],["velkhana_r5",86,5,"tail_blue"],["velkhana_r6",24,6,"claw_blue"]]}
];

let fail = 0;
for (const g of GOLDEN) {
  const mon = MATERIAL.monsters.find(m => m.id === g.id);
  assert.ok(mon, g.id + ' 몬스터가 material-data.js 에 없습니다');
  const got = matTotals(mon, g.gear, g.from, g.to);
  // vm 안에서 만든 값은 프로토타입이 달라 deepStrictEqual 이 걸립니다. JSON 을 거쳐 눕혀서 비교합니다.
  const flat = JSON.parse(JSON.stringify(got.list.map(m => [m.id, m.qty, m.rare, m.icon])));
  const where = `${g.id} ${g.gear} ${g.from}→${g.to}`;
  try {
    assert.deepStrictEqual(flat, g.list, where + ' 재료 목록');
    assert.strictEqual(got.zenny, g.zenny, where + ' 제니');
    assert.strictEqual(got.steps, g.steps, where + ' 강화 횟수');
    for (const m of got.list) {
      assert.ok(MATERIAL.names[m.id], where + ' 이름 없음: ' + m.id);
      assert.ok(fs.existsSync(path.join(root, 'assets/material', m.icon + '.png')), where + ' 아이콘 파일 없음: ' + m.icon);
    }
  } catch (e) { fail++; console.error('✗ ' + e.message); }
}

/* 몬스터 아이콘이 전부 있는지도 함께 봅니다 — 데이터만 늘리고 그림을 빠뜨리기 쉽습니다. */
for (const m of MATERIAL.monsters) {
  if (!fs.existsSync(path.join(root, 'assets/monster', m.icon + '.png'))) {
    fail++; console.error('✗ 몬스터 아이콘 없음: ' + m.id + ' → assets/monster/' + m.icon + '.png');
  }
}

/* 출현 구역: 이름·아이콘이 다 있고, 구역 없는 몬스터는 고룡뿐이어야 합니다. */
for (const b of Object.keys(MATERIAL.biomes)) {
  if (!fs.existsSync(path.join(root, 'assets/biome', b + '.png'))) {
    fail++; console.error('✗ 구역 아이콘 없음: assets/biome/' + b + '.png');
  }
}
for (const m of MATERIAL.monsters) {
  for (const b of m.biome) {
    if (!MATERIAL.biomes[b]) { fail++; console.error('✗ 모르는 출현 구역: ' + m.id + ' → ' + b); }
  }
  if (!m.biome.length && m.group !== 'elder') {
    fail++; console.error('✗ 출현 구역이 비었습니다(고룡이 아닌데): ' + m.id);
  }
}

/* 필터 판정. matBiome 은 material.js 안의 Set 이라 vm 을 통해 직접 만집니다. */
const matVisible = vm.runInContext('matVisible', ctx);
const pick = (...bs) => vm.runInContext(`matBiome.clear(); ${bs.map(b => `matBiome.add(${JSON.stringify(b)})`).join(';')}`, ctx);
const anja = MATERIAL.monsters.find(m => m.id === 'anjanath');       // 삼림·사막
const kush = MATERIAL.monsters.find(m => m.id === 'kushala_daora');  // 구역 없음
const cases = [
  ['아무것도 안 고르면 전부', () => { pick(); return matVisible(anja, '') && matVisible(kush, ''); }],
  ['삼림 → 안쟈나프 O, 크샬다오라 X', () => { pick('forest'); return matVisible(anja, '') && !matVisible(kush, ''); }],
  ['늪지 → 안쟈나프 X', () => { pick('swamp'); return !matVisible(anja, ''); }],
  ['여러 개는 OR', () => { pick('swamp', 'desert'); return matVisible(anja, ''); }],
  ['없음 → 고룡만', () => { pick('none'); return matVisible(kush, '') && !matVisible(anja, ''); }],
  ['이름 검색은 함께 걸립니다', () => { pick('forest'); return matVisible(anja, '안쟈') && !matVisible(anja, '리오'); }],
];
for (const [what, run] of cases) {
  if (!run()) { fail++; console.error('✗ 필터: ' + what); }
}
pick();

console.log(fail ? `실패 ${fail}건` : `통과 — 표본 ${GOLDEN.length}건, 몬스터 ${MATERIAL.monsters.length}마리`);
process.exit(fail ? 1 : 0);
