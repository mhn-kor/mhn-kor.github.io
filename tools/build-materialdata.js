/* material-data.js + assets/material/*.png 를 다시 만듭니다.  `node tools/build-materialdata.js`

   mhnow.me/material 의 스크립트는 난독화되어 있지만 데이터는 그냥 상수라, 브라우저 흉내를 낸
   샌드박스에서 실행하면 그대로 꺼낼 수 있습니다. 게임이 패치되어 몬스터가 늘면 이걸 다시 돌리세요.
   돌린 뒤에는 반드시 `node tools/material-test.js` 로 계산이 안 깨졌는지 확인하고,
   새 몬스터가 있으면 ICON_FIX(기존 아이콘) 또는 FETCH_MONSTER(다운로드), QUEST_KEY 를 확인하세요.

   의존성 없음 (node 18+ 의 fetch 와 zlib 만 씁니다). 아이콘은 200px 원본을 64px 로 줄여 담습니다 —
   원본 그대로면 147개가 4MB 를 넘습니다. */
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SRC = 'https://mhnow.me/';
const SCRIPTS = ['app-secure.js', 'i18n-secure.js', 'map-secure.js', 'suit-secure.js'];
const QUEST = 'https://mhn.quest/';
const MAX_PX = 64;

/* mhnow.me 의 한국어 표기가 공식 표기와 다른 몬스터. 몬스터 이름은 물론 «○○의 비늘» 같은
   재료 이름에도 들어가므로, 아래 ko() 에서 한국어 문자열마다 통째로 바꿔치웁니다. */
const NAME_FIX = { 쿠루루야쿠: '쿠루루야크', 치치야쿠: '치치야크', 푸르푸르: '푸루푸루', 랑그로트라: '랑그로토라', 가란고름: '가란고르무', 오오나즈치: '오나즈치' };
/* 저장소에 아이콘이 없어 mhnow.me 에서 받아오는 몬스터 (고룡은 표류석을 안 줘서 표류연성 탭에 없습니다). */
const FETCH_MONSTER = ['kushala_daora', 'teostra', 'nergigante', 'kirin', 'chameleos', 'namielle', 'malzeno', 'velkhana'];
const ICON_FIX = { aurorasomnacanth: 'a-somna', brachydios: 'brachy' };
/* 출현 구역은 mhn.quest 에서 옵니다. 몬스터 키가 표류연성 탭 아이콘 키와 같아서 그대로 이어지는데,
   키가 다른 몬스터는 여기서 짝을 지어줍니다. */
const QUEST_KEY = {
  kushala_daora: 'kush', teostra: 'teos', nergigante: 'nerg', kirin: 'kiri',
  chameleos: 'cham', namielle: 'nami', malzeno: 'malz', velkhana: 'velk',
  aurorasomnacanth: 'a-somn', brachydios: 'brac',
};
/* mhnow.me 번역에 없는 출현 구역 이름. */
const BIOME_KO = { tundra: '설원', volcano: '화산' };

/* ── mhnow.me 에서 데이터 꺼내기 ────────────────────────────────── */
async function pull() {
  const box = {
    console, JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Map, Set, Promise, Error,
    parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, URL, URLSearchParams, Intl,
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    setTimeout: () => 0, clearTimeout() {}, addEventListener() {},
    document: {
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {} }),
      addEventListener() {}, cookie: '',
    },
    // ?lang=ko 를 보고 한국어를 고릅니다.
    location: { href: SRC + 'material?lang=ko', search: '?lang=ko', pathname: '/material', hostname: 'mhnow.me' },
    navigator: { language: 'ko' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  box.window = box; box.self = box;
  box.sessionStorage = box.localStorage;
  vm.createContext(box);

  for (const f of SCRIPTS) {
    const r = await fetch(SRC + f);
    if (!r.ok) throw new Error(f + ' 를 못 받았습니다: HTTP ' + r.status);
    // app-secure.js 는 브라우저 API 를 더 쓰다가 중간에 멈추는데, 그 전에 필요한 값은 다 만들어집니다.
    try { vm.runInContext(await r.text(), box, { filename: f }); } catch { /* 무시 */ }
  }
  const get = n => { try { return vm.runInContext(n, box); } catch { return null; } };
  const out = {};
  for (const n of ['MONSTER_MAP', 'MATERIAL_CATALOG', 'UPGRADE_RECIPES', 'i18n', 'suit']) {
    out[n] = get(n);
    if (!out[n]) throw new Error(n + ' 을 못 찾았습니다. 사이트 구조가 바뀐 것 같습니다.');
  }
  return out;
}

/* mhn.quest guide 객체: 출현 구역과 재료별 부파 보상을 함께 읽습니다.
   본체를 실행하지 않고 해당 객체만 격리된 VM에서 해석합니다. */
async function pullQuest() {
  const home = await (await fetch(QUEST)).text();
  const file = (home.match(/src="(\/assets\/index-[^"]+\.js)"/) || [])[1];
  if (!file) throw new Error('mhn.quest 묶음 파일을 못 찾았습니다. 첫 화면 구조가 바뀐 듯합니다.');
  const index = await (await fetch(new URL(file, QUEST))).text();
  const chunk = index.match(/import\("\.\/(data-[^"]+\.js)"\)/)?.[1];
  const src = chunk ? await (await fetch(new URL('/assets/' + chunk, QUEST))).text() : index;

  const alias = src.match(/export\{([^}]*)\}/)?.[1].match(/(?:^|,)\s*([\w$]+) as guide\s*(?:,|$)/)?.[1];
  if (!alias) throw new Error('mhn.quest guide 내보내기를 찾지 못했습니다.');
  const decl = new RegExp('[,;]' + alias + '=\\{').exec(src);
  if (!decl) throw new Error('mhn.quest guide 객체를 찾지 못했습니다.');
  const start = decl.index + decl[0].length - 1;
  let depth = 0, quote = null, end;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && !--depth) { end = i + 1; break; }
  }
  if (!end) throw new Error('mhn.quest guide 객체가 닫히지 않았습니다.');
  const out = vm.runInNewContext('(' + src.slice(start, end) + ')', {}, { timeout: 1000 });
  if (Object.keys(out).length < 50) throw new Error('mhn.quest 몬스터 목록이 부족합니다.');
  return out;
}

/* 공식 부위명·소재명만 사용합니다. 보상 부위 연결은 공식 페이지에 없어 quest와 분리합니다. */
async function pullOfficial(names) {
  const base = 'https://monsterhunternow.com';
  const home = await (await fetch(base + '/ko/monsters/beotodus')).text();
  const links = Object.fromEntries([...home.matchAll(/href="(\/ko\/monsters\/[^"?#]+)"><mh-sidebar-item data-content="([^"]+)"/g)].map(m => [m[2], m[1]]));
  const out = {}, queue = names.slice();
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const name = queue.shift();
      if (!links[name]) throw new Error('공식 몬스터 링크 없음: ' + name);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch(base + links[name]);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const html = await r.text();
          const raw = html.match(/component="ObtainableMaterials" props="([^"]+)"/)?.[1];
          if (!raw) throw new Error('공식 소재 데이터 없음');
          const d = JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'"));
          const section = html.split('파괴 가능 부위</h3>')[1]?.split('</ul>')[0];
          if (!section) throw new Error('공식 파괴 가능 부위 없음');
          out[name] = {
            parts: [...section.matchAll(/<li>(.*?)<\/li>/g)].map(m => m[1].replace(/<[^>]+>/g, '')),
            materials: d.monster.itemData.filter(x => !x.driftMaterial && x.name !== 'WYVERN_PRIME_GEM')
              .map(x => ({ r: x.itemRarity, name: d.guideTranslations[x.name] })),
          };
          break;
        } catch (e) { if (attempt === 2) throw new Error(name + ': ' + e.message); }
      }
    }
  }));
  return out;
}

function rewardParts(guide, official, rarity, monsterId) {
  const tokens = {
    head: '머리', body: '몸통', forelegs: monsterId === 'nargacuga' ? '칼날개' : '앞다리',
    hindlegs: '뒷다리', tail: '꼬리', back: '등', wings: '날개', horn: '뿔', horns: '뿔',
    stomach: '배', spikes: '가시', claws: '발톱', 'arm-blades': '칼날발톱', shell: '갑각',
    'left-foreleg': '왼쪽 앞다리', 'right-foreleg': '오른쪽 앞다리',
    'left-horn': '왼쪽 뿔', 'right-horn': '오른쪽 뿔', 'neck-pouch': '목 주머니',
  };
  const letter = String.fromCharCode(96 + rarity), result = [];
  for (const [raw, values] of Object.entries(guide.physiology)) {
    if (!values[4]?.includes(letter)) continue;
    const key = raw.replace(/^[*^→]/, ''), token = tokens[key];
    if (!token) throw new Error('모르는 부파 부위: ' + monsterId + ' ' + raw);
    let labels = official.parts.filter(p => p.replace(/\s/g, '').includes(token.replace(/\s/g, '')));
    if (!labels.length && key === 'neck-pouch') labels = ['목 주머니'];
    if (!labels.length) throw new Error('공식 부위 연결 실패: ' + monsterId + ' ' + raw);
    const condition = raw.startsWith('^') || monsterId === 'espinas' ? '분노 상태'
      : raw.startsWith('*') ? '파괴 후' : raw.startsWith('→') ? '2차 파괴' : '';
    result.push(...labels.map(p => condition ? p + ' (' + condition + ')' : p));
  }
  return [...new Set(result)].join(', ');
}

/* ── PNG 축소 (ImageMagick 없이) ───────────────────────────────── */
const CHAN = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function pngDecode(buf) {
  let p = 8, h = null, idat = [], plte = null, trns = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') h = { w: d.readUInt32BE(0), h: d.readUInt32BE(4), depth: d[8], color: d[9], interlace: d[12] };
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'PLTE') plte = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (h.depth !== 8 || h.interlace) throw new Error('예상 못한 PNG 형식');
  const ch = CHAN[h.color], stride = h.w * ch;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const flat = Buffer.alloc(h.h * stride);
  let off = 0;
  for (let y = 0; y < h.h; y++) {
    const ft = raw[off++], line = raw.subarray(off, off + stride); off += stride;
    const cur = flat.subarray(y * stride, (y + 1) * stride);
    const prev = y ? flat.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev ? prev[i] : 0, c = (prev && i >= ch) ? prev[i - ch] : 0;
      let v = line[i];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
  }
  const rgba = Buffer.alloc(h.w * h.h * 4);
  for (let i = 0, n = h.w * h.h; i < n; i++) {
    let r, g, b, a = 255;
    if (h.color === 6) [r, g, b, a] = [flat[i * 4], flat[i * 4 + 1], flat[i * 4 + 2], flat[i * 4 + 3]];
    else if (h.color === 2) [r, g, b] = [flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]];
    else if (h.color === 0) r = g = b = flat[i];
    else if (h.color === 4) { r = g = b = flat[i * 2]; a = flat[i * 2 + 1]; }
    else { const k = flat[i]; [r, g, b] = [plte[k * 3], plte[k * 3 + 1], plte[k * 3 + 2]]; a = trns && k < trns.length ? trns[k] : 255; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }
  return { w: h.w, h: h.h, rgba };
}

/* 알파를 곱해서 평균내야 투명한 부분의 색이 가장자리로 번지지 않습니다. */
function pngResize({ w, h, rgba }, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = y * h / dh, y1 = (y + 1) * h / dh;
    for (let x = 0; x < dw; x++) {
      const x0 = x * w / dw, x1 = (x + 1) * w / dw;
      let r = 0, g = 0, b = 0, a = 0, sum = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const fy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const f = (Math.min(x1, sx + 1) - Math.max(x0, sx)) * fy, i = (sy * w + sx) * 4, al = rgba[i + 3] / 255;
          r += rgba[i] * al * f; g += rgba[i + 1] * al * f; b += rgba[i + 2] * al * f;
          a += rgba[i + 3] * f; sum += f;
        }
      }
      const o = (y * dw + x) * 4, av = a / sum, un = av > 0 ? 255 / av : 0;
      out[o] = Math.min(255, Math.round(r / sum * un));
      out[o + 1] = Math.min(255, Math.round(g / sum * un));
      out[o + 2] = Math.min(255, Math.round(b / sum * un));
      out[o + 3] = Math.round(av);
    }
  }
  return { w: dw, h: dh, rgba: out };
}

/* 완전히 투명한 여백을 잘라냅니다 (저장소의 기존 아이콘도 여백 없이 잘려 있습니다). */
function pngTrim({ w, h, rgba }) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] > 2) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return { w, h, rgba };
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1, out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) rgba.copy(out, y * nw * 4, ((y + y0) * w + x0) * 4, ((y + y0) * w + x1 + 1) * 4);
  return { w: nw, h: nh, rgba: out };
}

function pngEncode({ w, h, rgba }) {
  const stride = w * 4, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const cur = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y ? rgba.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    let best = null, bestSum = Infinity, bestFt = 0;
    for (const ft of [0, 1, 2, 4]) {          // 행마다 절대값 합이 가장 작은 필터를 고릅니다
      const line = Buffer.alloc(stride);
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? cur[i - 4] : 0, b = prev[i], c = i >= 4 ? prev[i - 4] : 0;
        let v;
        if (ft === 0) v = cur[i]; else if (ft === 1) v = cur[i] - a; else if (ft === 2) v = cur[i] - b;
        else { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v = cur[i] - ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)); }
        line[i] = v & 0xff;
        sum += Math.min(line[i], 256 - line[i]);
      }
      if (sum < bestSum) { bestSum = sum; best = line; bestFt = ft; }
    }
    raw[y * (stride + 1)] = bestFt;
    best.copy(raw, y * (stride + 1) + 1);
  }
  let crcTable = pngEncode.tbl;
  if (!crcTable) {
    crcTable = pngEncode.tbl = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); crcTable[n] = c; }
  }
  const chunk = (type, data) => {
    const b = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    let c = ~0;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    const out = Buffer.alloc(b.length + 8);
    out.writeUInt32BE(data.length, 0); b.copy(out, 4); out.writeUInt32BE(~c >>> 0, b.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function saveIcon(url, dest) {
  if (fs.existsSync(dest)) return 0;
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' HTTP ' + r.status);
  const img = pngTrim(pngDecode(Buffer.from(await r.arrayBuffer())));
  const s = MAX_PX / Math.max(img.w, img.h);
  const png = pngEncode(s < 1 ? pngResize(img, Math.max(1, Math.round(img.w * s)), Math.max(1, Math.round(img.h * s))) : img);
  fs.writeFileSync(dest, png);
  return png.length;
}

/* ── 본작업 ────────────────────────────────────────────────────── */
(async () => {
  const { MONSTER_MAP, MATERIAL_CATALOG, UPGRADE_RECIPES, i18n, suit } = await pull();
  const quest = await pullQuest();
  const ko = o => {
    let s = (o && (o.ko || (o.name && o.name.ko))) || null;
    if (s) for (const [from, to] of Object.entries(NAME_FIX)) s = s.split(from).join(to);
    return s;
  };

  // 사이트가 실제로 보여주는 순서·목록 그대로 (commons 가 없는 몬스터는 재료 표가 없습니다).
  const order = Object.keys(suit).filter(k => MONSTER_MAP[k] && MONSTER_MAP[k].commons);
  const official = await pullOfficial(order.map(k => ko(i18n.monsters[MONSTER_MAP[k].id])));

  // 표류연성 탭이 쓰는 아이콘을 한국어 이름으로 이어줍니다.
  const smelt = {}; vm.createContext(smelt);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'smelt-data.js'), 'utf8'), smelt);
  const iconByName = {};
  for (const g of vm.runInContext('SMELT', smelt).groups) for (const m of g.monsters) iconByName[m.name] = m.key;

  /* 원본 tData('materials', id) 와 같은 규칙: `<몬스터>_r<희귀도>[_w|_a]` 를 쪼개 이름을 찾습니다. */
  const matName = id => {
    const m = /^(.+)_r(\d+)(?:_([wa]))?$/.exec(id);
    if (m) {
      const e = i18n.monsters[m[1]] && i18n.monsters[m[1]].materials && i18n.monsters[m[1]].materials['r' + m[2]];
      const side = m[3] === 'w' ? 'weapon' : m[3] === 'a' ? 'armor' : null;
      if (e) { if (side && e[side]) return ko(e[side]); if (ko(e)) return ko(e); }
    }
    return (i18n.materials && ko(i18n.materials[id])) || null;
  };

  /* 이름이 없는 칸도 있습니다 — 고룡처럼 R1·R2·R4 소재를 아예 안 쓰는 몬스터의 빈 칸입니다.
     실제로 계산에 나오는 id 인지는 아래에서 matTotals 로 확인합니다. */
  const names = {};
  const put = id => { const n = matName(id); if (n) names[id] = n; };
  Object.keys(MATERIAL_CATALOG).forEach(put);

  const monsters = order.map(k => {
    const m = MONSTER_MAP[k], name = ko(i18n.monsters[m.id]) || m.id;
    Object.values(m.commons).forEach(v => (typeof v === 'object' ? Object.values(v) : [v]).forEach(x => x && x !== 'none' && put(x)));
    // exclusive 의 순서가 곧 희귀도. R1 과 무기/방어구가 갈리는 칸만 _w/_a 로 나뉩니다.
    m.exclusive.forEach((e, i) => {
      const r = i + 1, two = e && typeof e === 'object';
      (two || r === 1 ? [`${m.id}_r${r}_w`, `${m.id}_r${r}_a`] : [`${m.id}_r${r}`]).forEach(put);
    });
    const icon = ICON_FIX[m.id] || iconByName[name] || (FETCH_MONSTER.includes(m.id) ? m.id : null);
    if (!icon) console.log(`! ${m.id}(${name}) 아이콘을 못 찾았습니다 — NAME_FIX 나 FETCH_MONSTER 에 넣어주세요`);
    /* 출현 구역. 아이콘 키가 곧 mhn.quest 키입니다(고룡만 QUEST_KEY 로 이어줍니다).
       고룡은 특정 구역에 안 나오므로 빈 배열이 정상 — 화면에서 '없음' 으로 걸립니다. */
    const qk = QUEST_KEY[m.id] || icon;
    const guide = quest[qk], verified = official[name];
    if (!guide) throw new Error('mhn.quest 몬스터 연결 실패: ' + m.id);
    for (const r of new Set(verified.materials.map(x => x.r))) {
      const items = verified.materials.filter(x => x.r === r);
      if (r === 4 && m.recipeGroup === 'elder') { names.elder_dragon_blood = items[0].name; continue; }
      const two = r === 1 || typeof m.exclusive[r - 1] === 'object';
      if (two && items.length !== 2) throw new Error('공식 무기/방어구 소재 수 확인 필요: ' + m.id + ' R' + r);
      if (two) { names[m.id + '_r' + r + '_w'] = items[0].name; names[m.id + '_r' + r + '_a'] = items[1].name; }
      else if (names[m.id + '_r' + r]) names[m.id + '_r' + r] = items[0].name;
      else if (r === 6 && items[0].name === '용옥 조각') names.wyvern_gem_shard = items[0].name;
    }
    const o = {
      id: m.id, name, icon: icon || m.id, grade: m.grade || 1,
      biome: guide.biome,
      commons: m.commons, exclusive: m.exclusive,
      break: [2, 3, 4, 5, 6].map(r => rewardParts(guide, verified, r, m.id)),
      breakable: verified.parts,
    };
    if (m.recipeGroup === 'elder') o.bloodBreak = rewardParts(guide, verified, 4, m.id);
    if (m.recipeGroup) o.group = m.recipeGroup;
    return o;
  });

  const catalog = {};
  for (const [k, v] of Object.entries(MATERIAL_CATALOG)) {
    catalog[k] = { r: v.rarity, scope: v.scope };
    if (v.fallback) catalog[k].fb = v.fallback;   // 몬스터가 그 칸을 안 가질 때 쓰는 공용 재료
  }
  const parts = {};
  for (const [k, v] of Object.entries(i18n.monster_parts || {})) parts[k] = ko(v);

  /* 출현 구역 이름. 여기 적힌 순서가 곧 필터 칩 순서라 공식 사이트와 같게 둡니다. */
  const biomes = {};
  for (const b of ['forest', 'desert', 'swamp', 'tundra', 'volcano']) {
    biomes[b] = ko((i18n.habitats || {})[b]) || BIOME_KO[b] || b;
  }
  for (const b of new Set(monsters.flatMap(m => m.biome))) {
    if (!biomes[b]) console.log('! 모르는 출현 구역:', b, '— 이 파일의 구역 목록에 넣어주세요');
  }

  const data = { monsters, catalog, parts, biomes, names, recipes: { weapon: UPGRADE_RECIPES.weapon.level, armor: UPGRADE_RECIPES.armor.level } };
  fs.writeFileSync(path.join(ROOT, 'material-data.js'),
    `/* 강화 재료 수량: mhnow.me/material · 부파 보상: mhn.quest · 소재/부위명: monsterhunternow.com/ko.\n`
    + `   갱신: node tools/build-materialdata.js → node tools/material-test.js */\n`
    + `const MATERIAL = ${JSON.stringify(data)};\n`);

  /* 방금 쓴 데이터로 실제 계산을 돌려, 화면에 나올 수 있는 재료만 추립니다.
     몬스터 × 무기/방어구 × 모든 시작 등급을 훑으므로 빠진 이름·아이콘이 여기서 다 걸립니다. */
  const box2 = { console, module: {}, document: { addEventListener() {} } };
  vm.createContext(box2);
  for (const f of ['material-data.js', 'material.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), box2, { filename: f });
  }
  const totals = vm.runInContext('matTotals', box2), LV = vm.runInContext('MAT_LEVELS', box2);
  const need = new Set(['zenny']);      // 화폐 아이콘. 레시피에는 안 나오지만 결과 마지막 칸에 씁니다.
  const noName = new Set();
  for (const m of monsters) for (const gear of ['weapon', 'armor']) for (let a = 0; a < LV.length - 1; a++) {
    for (const x of totals(m, gear, LV[a], LV[LV.length - 1]).list) {
      if (x.icon && x.icon !== 'none') need.add(x.icon);
      if (!names[x.id]) noName.add(x.id);
    }
  }
  if (noName.size) console.log('! 이름을 못 찾은 재료:', [...noName].join(', '));
  fs.mkdirSync(path.join(ROOT, 'assets/material'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'assets/biome'), { recursive: true });

  const jobs = [
    ...[...need].map(n => [SRC + `images/material/${n}.png?v=2`, path.join(ROOT, 'assets/material', n + '.png')]),
    ...FETCH_MONSTER.map(n => [SRC + `images/icon/${n}.png`, path.join(ROOT, 'assets/monster', n + '.png')]),
    // 출현 구역 아이콘은 데이터와 같은 곳(mhn.quest)에서 받습니다.
    ...Object.keys(biomes).map(b => [QUEST + `icon/${b}.png`, path.join(ROOT, 'assets/biome', b + '.png')]),
  ];
  let saved = 0, bytes = 0;
  const queue = jobs.slice();
  await Promise.all(Array.from({ length: 6 }, async () => {       // 6개씩 병렬. 더 늘려도 별 차이 없습니다.
    while (queue.length) {
      const [url, dest] = queue.shift();
      try { const n = await saveIcon(url, dest); if (n) { saved++; bytes += n; } }
      catch (e) { console.log('! 아이콘 실패', url, e.message); }
    }
  }));

  console.log(`material-data.js — 몬스터 ${monsters.length}마리 · 이름 ${Object.keys(names).length}개`);
  console.log(`아이콘 — 필요 ${jobs.length}개 중 새로 받은 것 ${saved}개 (${Math.round(bytes / 1024)}KB)`);
  console.log('이제 node tools/material-test.js 로 계산을 확인하세요.');
})();
