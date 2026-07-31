/* 빌드 탭 데이터 생성기.
 *
 *   node tools/build-builddata.js > build-data.js
 *
 * 인자가 없습니다. mhn.quest 번들은 직접 받고, 장비 이름표는 tools/data/ 에서,
 * 스킬 최대 레벨은 skill-desc.js 에서 읽습니다. 번들을 미리 받아 뒀다면
 * MHNKR_BUNDLE=경로 로 넘겨 오프라인에서도 돌릴 수 있습니다.
 *
 * 스킬·표류슬롯·공격력 곡선은 mhn.quest 번들에서, 장비 이름은 monsterhunternow.com
 * 공식 목록에서 가져온다. 두 곳의 키가 달라 영문 몬스터명을 다리로 매핑한다.
 *
 * 장비 등급은 항상 최대(10 Lv5) 기준이다. 실전에서 강화를 끝낸 상태로 비교하므로
 * 등급별 해금 과정은 담지 않는다 — 곡선의 마지막 값과 최고 스킬 레벨만 쓴다.
 * 갱신 방법은 README 의 빌드 탭 절 참고.
 */
const fs = require('fs');
const path = require('path');

const SLOTS = ['helm', 'mail', 'gloves', 'belt', 'greaves'];
const PART_SUFFIX = { helm: 'head', mail: 'chest', gloves: 'arms', belt: 'waist', greaves: 'legs' };
const PART_KO = { helm: '머리', mail: '몸', gloves: '팔', belt: '허리', greaves: '다리' };

/* 무기 종류: 번들 키 → 공식 슬러그 접미사 + 한국어 이름 */
const WEAPONS = [
  ['shield-sword', 'swordshield', '한손검'],
  ['great-sword', 'greatsword', '대검'],
  ['long-sword', 'longsword', '태도'],
  ['dual-blades', 'dualblades', '쌍검'],
  ['hammer', 'hammer', '해머'],
  ['hunting-horn', 'huntinghorn', '수렵피리'],
  ['lance', 'lance', '랜스'],
  ['gunlance', 'gunlance', '건랜스'],
  ['switch-axe', 'switchaxe', '슬래시액스'],
  ['charge-blade', 'chargeblade', '차지액스'],
  ['insect-glaive', 'insectglaive', '조충곤'],
  ['light-gun', 'lightbowgun', '라이트보우건'],
  ['heavy-gun', 'heavybowgun', '헤비보우건'],
  ['bow', 'bow', '활'],
];
const WEAPON_KEYS = new Set(WEAPONS.map(w => w[0]));

/* 이벤트 무기 중에는 공식 목록에도 번들 비용표에도 없는 것이 있다
   (matUnknown = 재료 미상이라 제작비용 표 자체가 없음).
   게임에서 확인한 것만 여기 적는다. 비워 두면 종류를 못 좁혀 전 종류로 나온다. */
const EVENT_WEAPONS = {
  'spring-26': { types: ['light-gun'], names: { 'light-gun': '로즈어썰트' } },
};

const ELEM_KO = {
  fire: '불', water: '물', thunder: '번개', thunder2: '번개', ice: '얼음', dragon: '용',
  poison: '독', paralysis: '마비', sleep: '수면', blast: '폭파', white: '무속성',
};

/* 공식 슬러그가 규칙에서 벗어나는 소재. B8 'leather' 세트가 공식 'ore' 슬러그다. */
const SLUG_FIX = { leather: 'ore', ore: 'ore' };

/* 몬스터가 아닌 기본 소재. 목록 최하단에 둔다. */
const BASIC = new Set(['ore', 'bone', 'leather', 'alloy']);

/* 정렬 그룹: 몬스터(0) → 이벤트(1) → 기본 소재(2).
   몬스터 장비를 먼저 찾는 일이 대부분이라 기타 소재를 아래로 내린다. */
function groupOf(key, mon) {
  if (BASIC.has(key)) return 2;
  if (mon.evtOnly || /^(halloween|lunar|ny-|carnival|easter|summer|winter|spring|mr-beast|hope)/.test(key)) return 1;
  return 0;
}

/* 번들 번역과 게임 내 공식 명칭이 다른 스킬. 표류연성 탭과 표기를 맞춘다. */
const SKILL_ALIAS = {
  '저스트 공격': '저스트 교격',
  '저스트 공격【지속】': '저스트 교격【지속】',
  '저스트 공격【상태 이상】': '저스트 교격【상태 이상】',
  '독속성 공격강화': '독속성 강화',
  '마비속성 공격강화': '마비속성 강화',
  '수면 공격 강화': '수면속성 강화',
  '특수 게이지 가속【방어】': '특수 게이지 가속【가드】',
  '즉시 반격': '앙갚음',
  '특수스킬 위력상승': '특수 스킬 위력 상승',
  '특수게이지 가속': '특수 게이지 가속',
  /* 아래는 최대 레벨을 붙이면서 발견한 표기 차이. 공식 스킬 목록과 대조해 확인했다. */
  '통상탄/속성 통상탄 강화': '통상탄·속성 통상탄 강화',
  '귀화전': '귀화 망토',
  '회심격 ［속성】': '회심격【속성】',
  '공격·경계': '공격·경지',
  '공격 활성화': '공격 활성',
  '공격 강화【회심】': '공격 증강【회심】',
  '진짜 실력': '진가 발휘',
  '강룡의 동풍': '강룡의 얼음바람',
  '빙룡의 갑옷': '빙룡의 얼음 갑옷',
};

function objAt(src, idx) {
  let d = 0;
  for (let i = idx; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return eval('(' + src.slice(idx, i + 1) + ')'); }
  }
  throw new Error('닫히지 않은 객체 리터럴');
}

/* 이름표는 언어별로 같은 모양이 반복된다. 값이 해당 언어인 것을 골라야 한다. */
function pickTable(src, anchor) {
  const i = src.indexOf(anchor);
  if (i < 0) throw new Error('앵커 없음: ' + anchor);
  return objAt(src, src.lastIndexOf('{', i));
}

function koSkillTable(src) {
  const ko = /[가-힣]/;
  let i = -1;
  while ((i = src.indexOf('"skill-name":{', i + 1)) >= 0) {
    const t = objAt(src, src.indexOf('{', i + 13));
    const v = Object.values(t);
    if (v.filter(x => typeof x === 'string' && ko.test(x)).length / v.length > 0.8) return t;
  }
  throw new Error('한국어 skill-name 테이블을 찾지 못했습니다');
}

/* 단일값과 배열을 섞어 쓰므로 항상 배열로 맞춘다. */
const arr = v => (Array.isArray(v) ? v : [v]);
/* 등급을 최대로 보므로 해금 단계 중 마지막(=가장 높은) 레벨만 남는다. */
const maxLv = e => Math.max(...arr(e.lv).map(Number));

function skillNamer(skillKo, officialNames) {
  const norm = s => String(s).replace(/[\s　]+/g, '');
  const byNorm = new Map(officialNames.map(n => [norm(n), n]));
  return zh => {
    const ko = skillKo[zh] || zh;
    const aliased = SKILL_ALIAS[ko] || ko;
    return byNorm.get(norm(aliased)) || aliased;
  };
}

/* 공식 슬러그는 두 갈래다. 기본 몬스터는 전부 붙여 쓰고("Great Jagras" → greatjagras),
   아종·희소종은 수식어만 밑줄로 뗀다("Coral Pukei-Pukei" → coral_pukeipukei). */
function slugCandidates(en) {
  const w = String(en).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/);
  const joined = w.join('');
  return w.length === 1 ? [joined] : [joined, w[0] + '_' + w.slice(1).join('')];
}

/* 무기 종류별 부가 정보 — 어떤 종류에 무엇을 붙일지.
   보우건은 탄, 활은 화살·병, 슬래시액스/차지액스는 병, 건랜스는 포격,
   수렵피리는 연주, 조충곤은 곤충. 종류와 무관한 값은 보여주지 않는다. */
const EXTRA_FOR = {
  'light-gun': ['ammo'],
  'heavy-gun': ['heavy-ammo'],
  bow: ['arrow', 'bottle'],
  'switch-axe': ['sa-phial'],
  'charge-blade': ['phial'],
  gunlance: ['shelling'],
  'hunting-horn': ['songs'],
  /* 조충곤(kinsect)은 번들에 한국어 이름표가 없어 중국어만 나옵니다.
     번역이 생기면 'insect-glaive': ['kinsect'] 를 되살리세요. */
};

/* 탄·화살은 [종류, 레벨…] 배열, 병·포격은 문자열, 연주는 {키:곡}, 곤충은 {속성…}.
   화면에 그대로 쓸 수 있도록 짧은 문자열 배열로 눌러 담는다. */
function weaponExtra(wkey, mon, X) {
  const out = [];
  for (const field of EXTRA_FOR[wkey] || []) {
    const v = mon[field];
    if (v == null) continue;
    if (field === 'ammo' || field === 'heavy-ammo') {
      const t = X.ammo || {};
      /* [종류, 발수, 재장전, 반동]. 속성탄은 [종류, 발수] 두 칸뿐이다.
         이름표가 «LV1 관통탄» 처럼 1레벨 기준이라 접두사를 떼고 발수를 붙인다.
         접두사만 보고 갈랐더니 속성탄(화염탄·수냉탄)에서 발수가 통째로 빠졌다. */
      out.push(...v.map(a => {
        const nm = String(t[a[0]] || a[0]).replace(/^LV\d+\s*/, '');
        return a[1] != null ? `${nm} ${a[1]}` : nm;
      }));
    } else if (field === 'arrow') {
      const t = X.arrow || {};
      /* 활은 Lv1~4 네 단계이고 단계마다 종류가 다르다(연사·관통·확산).
         종류만 모으면 몇 단계에서 무엇이 나오는지가 사라진다. */
      out.push(...v.map(a => `Lv${a[1]} ${t[a[0]] || a[0]}`));
    } else if (field === 'bottle') {
      const t = X.bottle || {};
      if (t[v] && v !== 'none') out.push(t[v]);
    } else if (field === 'sa-phial' || field === 'phial') {
      const t = X[field] || {};
      if (t[v]) out.push(t[v]);
    } else if (field === 'shelling') {
      const t = X.shelling || {};
      if (t[v]) out.push(t[v] + ' 포격');
    } else if (field === 'songs') {
      const t = X.songs || {};
      // 값이 [정식명, 약칭] 형태다. 정식명을 쓴다.
      out.push(...Object.values(v).map(z => (Array.isArray(t[z]) ? t[z][0] : t[z]) || z));
    } else if (field === 'kinsect') {
      out.push(...Object.values(v).filter(z => typeof z === 'string'));
    }
  }
  return out.length ? out : null;
}

const DATA = require('path').join(__dirname, 'data');
const QUEST = 'https://mhn.quest/';

/* mhn.quest 의 번들 주소는 배포 때마다 바뀝니다. 첫 페이지에서 script 태그를 읽어 찾습니다. */
async function fetchBundle() {
  const home = await (await fetch(QUEST, { headers: { 'user-agent': 'Mozilla/5.0' } })).text();
  const cands = [...home.matchAll(/<script[^>]+src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
  let best = null;
  for (const c of cands) {
    const url = new URL(c, QUEST).href;
    const t = await (await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })).text();
    /* 장비 표(B8)와 곡선 표(K7)가 같이 든 파일이 우리가 찾는 번들입니다. */
    if (t.includes('B8={') && t.includes('K7={')) { best = t; break; }
    if (!best && t.length > 500000) best = null;
  }
  if (!best) throw new Error('mhn.quest 번들을 찾지 못했습니다 (사이트 구조가 바뀌었을 수 있습니다)');
  return best;
}

async function main() {
  const src = process.env.MHNKR_BUNDLE
    ? fs.readFileSync(process.env.MHNKR_BUNDLE, 'utf8')   // 오프라인 재생성용
    : await fetchBundle();
  const off = JSON.parse(fs.readFileSync(path.join(DATA, 'official-names.json'), 'utf8'));
  /* 병·탄·포격 등의 한국어 이름표. 게임 패치와 무관하게 거의 바뀌지 않아 저장소에 둡니다. */
  const X = JSON.parse(fs.readFileSync(path.join(DATA, 'wextra.json'), 'utf8'));

  /* 스킬 최대 레벨은 공식 스킬 페이지의 레벨 표 행 수입니다.
     skill-desc.js 가 그 표를 그대로 담고 있어 따로 표를 두지 않습니다. */
  const descSrc = fs.readFileSync(path.join(__dirname, '..', 'skill-desc.js'), 'utf8');
  const SKILLDESC = new Function(descSrc + ';return SKILLDESC;')();
  const official = Object.keys(SKILLDESC);

  /* 공식 방어구 목록의 세트 나열 순서. official-names.json 의 키 순서가 곧 그 순서입니다. */
  const armorOrder = [];
  for (const k of Object.keys(off.armor)) {
    const set = k.replace(/_(head|chest|arms|waist|legs)$/, '');
    if (!armorOrder.includes(set)) armorOrder.push(set);
  }

  const skillMax = {};   // 이름은 maxLv() 함수와 겹치지 않게 둔다
  /* 스킬 이름은 별칭 적용 전 표기일 수 있어, 장비 스킬과 같은 규칙으로 정규화해야
     짝이 맞습니다(예: '공격 활성화' → '공격 활성'). */
  const normName = (n) => {
    const a = SKILL_ALIAS[n] || n;
    const key = String(a).replace(/[\s　]+/g, '');
    return official.find(o => String(o).replace(/[\s　]+/g, '') === key) || a;
  };
  for (const [k, rows] of Object.entries(SKILLDESC)) {
    const n = rows[rows.length - 1][0];
    if (n > 0) skillMax[normName(k)] = n;
  }

  const B8 = objAt(src, src.indexOf('B8={') + 3);       // 장비 스킬·표류슬롯
  const I8 = objAt(src, src.indexOf('I8={') + 3);       // 몬스터별 속성·곡선 참조
  const K7 = objAt(src, src.indexOf('K7={') + 3);       // 등급별 공격력·속성 곡선
  const skillKo = koSkillTable(src);
  const monKo = pickTable(src, 'anja:"안쟈나프"');
  const monEn = pickTable(src, 'anja:"Anjanath"');
  const skillName = skillNamer(skillKo, official);

  const armorSets = new Set(Object.keys(off.armor).map(k => k.replace(/_(head|chest|arms|waist|legs)$/, '')));
  const sets = [];
  const warn = [];

  for (const [key, raw] of Object.entries(B8)) {
    const en = monEn[key] || key;
    const cands = slugCandidates(en);
    const slug = SLUG_FIX[key] || cands.find(c => armorSets.has(c)) || null;
    const mon = I8[key] || {};

    const pieces = {};
    for (const s of SLOTS) {
      if (!Array.isArray(raw[s])) continue;
      const name = slug ? off.armor[`${slug}_${PART_SUFFIX[s]}`] : null;
      if (!name) warn.push(`${key}/${s}`);
      pieces[s] = {
        name: name || `${monKo[key] || key} ${PART_KO[s]}`,
        skills: raw[s].map(e => ({ s: skillName(e.skill), lv: maxLv(e) })),
        slot: ((raw.slot && raw.slot[s]) || []).length,   // 최대 등급이면 전부 해금
      };
    }

    /* 무기: 소재 하나에 최대 14종류. 스킬은 소재 공통이고 이름·속성만 종류별로 다르다.
       공격력은 무기 종류와 무관하게 같은 곡선을 쓴다(공식 페이지로 확인). */
    /* 공식 목록에 이 소재의 무기가 하나라도 있으면 그 목록만 믿는다.
       종류마다 실제로 존재하는지가 다르므로(랜스 46종 vs 슬래시액스 53종),
       eff 만 보고 채우면 없는 무기를 만들어낸다. */
    const officialName = (suffix) => [slug, ...cands].filter(Boolean)
      .map(c => off.weapon[`${c}_${suffix}`]).find(Boolean);
    const hasOfficial = WEAPONS.some(([, suffix]) => officialName(suffix));

    /* 이벤트 장비는 공식 목록에 없어서 종류를 알 방법이 제작비용 표뿐이다.
       forge/craft 에 weapon 이 없으면 무기가 아예 없고(봄 축제26 등),
       무기 종류 키가 있으면 그 종류만 따로 제작된다는 뜻이다(이스터25 = 대검·차지액스).
       종류 키가 하나도 없으면 비용표 하나로 전 종류를 만드는 형태라 그대로 둔다.
       몬스터 소재는 공식 목록이 있으므로 이 규칙을 쓰지 않는다. */
    const isEvent = groupOf(key, mon) === 1;
    const ovr = isEvent ? EVENT_WEAPONS[key] : null;
    const forgeKeys = new Set([...Object.keys(mon.forge || {}), ...Object.keys(mon.craft || {})]);
    const evtTypes = new Set([...forgeKeys, ...Object.keys(raw)].filter(k => WEAPON_KEYS.has(k)));
    /* 비용표가 없어도 확인된 무기가 있으면 만든다(봄 축제26 로즈어썰트). */
    const evtNoWeapon = isEvent && !ovr && !forgeKeys.has('weapon');
    const evtOnly = ovr ? new Set(ovr.types) : (isEvent && evtTypes.size ? evtTypes : null);

    /* noWeapon 소재(가죽·합금)는 방어구만 있다. 이걸 안 보면 공식 'ore' 슬러그를
       공유하는 가죽에 광석 무기 이름이 붙는다. */
    const weapons = [];
    for (const [wkey, suffix, wko] of ((raw.noWeapon || evtNoWeapon) ? [] : WEAPONS)) {
      if (evtOnly && !evtOnly.has(wkey)) continue;
      const official = officialName(suffix);
      const elem = (mon.eff && (mon.eff[wkey] || mon.eff.all)) || null;
      /* 이벤트 장비는 공식 목록에 아예 없다. 그때만 "소재명 + 종류" 로 대체한다.
         (mhn.quest 도 이벤트 장비를 소재명으로 표시한다) */
      const name = (ovr && ovr.names[wkey]) || official || (hasOfficial ? null : (elem ? `${monKo[key] || key} ${wko}` : null));
      if (!name) continue;
      const curve = elem && mon[elem];
      const atk = curve && K7[curve.base] ? K7[curve.base].at(-1) : null;
      const ele = curve && curve.ele && K7[curve.ele] ? K7[curve.ele].at(-1) : null;
      /* 회심(%). 음수인 무기가 많아 0 과 없음을 구분해야 한다. */
      const crit = curve && curve.crit && K7[curve.crit] ? K7[curve.crit].at(-1) : null;
      weapons.push({
        t: wkey, tn: wko, name,
        e: elem && elem !== 'white' ? ELEM_KO[elem] || elem : null,
        atk, ele, crit,
        x: weaponExtra(wkey, mon, X),
      });
    }

    if (!Object.keys(pieces).length && !weapons.length) continue;
    sets.push({
      key,
      name: monKo[key] || key,
      /* 게임 진행(해금) 순서. 목록을 이 순서로 두면 실제 플레이 흐름과 같아
         원하는 장비를 훑어 찾기 쉽습니다. */
      u: mon.unlock ?? 99,
      id: mon.id ?? 9999,
      g: groupOf(key, mon),
      /* 공식 방어구 페이지 순서. 목록에 없으면(이벤트 장비) 뒤로 보냅니다. */
      o: (i => (i < 0 ? 999 : i))(armorOrder.indexOf(slug)),
      pieces,
      weaponSkills: (raw.weapon || []).map(e => ({ s: skillName(e.skill), lv: maxLv(e) })),
      weapons,
    });
  }

  sets.sort((a, b) => a.g - b.g || a.u - b.u || a.id - b.id);

  const out = {
    parts: SLOTS.map(s => ({ k: s, n: PART_KO[s] })),
    weaponTypes: WEAPONS.map(([k, , n]) => ({ k, n })),
    /* 빌드에 실제로 쓰이는 스킬만 남긴다 */
    maxLv: Object.fromEntries(Object.entries(skillMax).filter(([k]) =>
      sets.some(s => [...Object.values(s.pieces).flatMap(p => p.skills), ...s.weaponSkills].some(x => x.s === k)))),
    sets,
  };

  const nw = sets.reduce((n, s) => n + s.weapons.length, 0);
  const withAtk = sets.reduce((n, s) => n + s.weapons.filter(w => w.atk).length, 0);
  process.stderr.write(`세트 ${sets.length} / 방어구 ${sets.reduce((n, s) => n + Object.keys(s.pieces).length, 0)} / `
    + `무기 ${nw} (공격력 있음 ${withAtk})\n`);
  if (warn.length) process.stderr.write(`공식 이름 없어 대체 ${warn.length}개 (이벤트 장비)\n`);

  /* 아이콘 받는 도구가 쓸 영문 이름표. 참조 사이트가 «great_jagras» 처럼 영문
     스네이크로 파일을 두어서, 짧은 키(g-jagr)만으로는 주소를 만들 수 없습니다. */
  fs.writeFileSync(path.join(DATA, 'monster-en.json'),
    JSON.stringify(Object.fromEntries(sets.map(s => [s.key, monEn[s.key] || s.key])), null, 1) + '\n');

  process.stdout.write('/* 자동 생성 파일 — tools/build-builddata.js 로 다시 만듭니다. 직접 수정하지 마세요. */\n'
    + 'const BUILD = ' + JSON.stringify(out) + ';\n');
}

main().catch(e => { process.stderr.write('실패: ' + e.message + '\n'); process.exit(1); });
