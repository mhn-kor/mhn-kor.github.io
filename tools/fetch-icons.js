/* build-data.js 에 있는데 저장소에 아이콘이 없는 세트를 받아 채웁니다.
 *
 *   node tools/fetch-icons.js
 *
 * 참조 사이트가 200px 남짓으로 주는 그림을 64×64 로 줄여 담습니다. 종횡비를 지키고
 * 남는 곳은 투명하게 둡니다 — 정사각으로 눌러 담으면 기존 아이콘과 눈에 띄게 다릅니다.
 * ImageMagick 같은 도구 없이 PNG 를 직접 읽고 씁니다(의존성 0).
 *
 * 이벤트 장비처럼 참조 사이트에도 그림이 없는 것은 404 로 건너뜁니다.
 * 그 키는 build.js 의 BD_NOICON 에 적어 두면 이벤트 표류석 아이콘으로 대신 나옵니다.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'assets', 'monster');
/* 참조 사이트는 «great_jagras» 처럼 영문 스네이크로 파일을 둡니다. 짧은 키(g-jagr)로는
   주소가 안 만들어져서, 생성기가 남긴 영문 이름표를 먼저 쓰고 키를 예비로 둡니다
   (이벤트 장비는 키가 곧 파일 이름입니다). */
const snake = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const EN = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'monster-en.json'), 'utf8'));
const candidates = (key) => [...new Set([snake(EN[key] || ''), key].filter(Boolean))];
const SRC = (name) => `https://mhnow.me/images/icon/${name}.png`;
const SIZE = 64;

/* ── PNG 읽기/쓰기 (8비트, 모든 색 타입) ───────────────────────────── */
function decode(buf) {
  let i = 8, w, h, ct, pal = null, trns = null, idat = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const body = buf.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); ct = body[9]; }
    else if (type === 'PLTE') pal = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    i += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  const stride = w * ch;
  const px = [];
  let prev = Buffer.alloc(stride), o = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[o++];
    const line = Buffer.from(raw.subarray(o, o + stride)); o += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      if (f === 1) line[x] = (line[x] + a) & 255;
      else if (f === 2) line[x] = (line[x] + b) & 255;
      else if (f === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    prev = line;
    const row = [];
    for (let x = 0; x < w; x++) {
      const s = line.subarray(x * ch, (x + 1) * ch);
      if (ct === 6) row.push([s[0], s[1], s[2], s[3]]);
      else if (ct === 2) row.push([s[0], s[1], s[2], 255]);
      else if (ct === 4) row.push([s[0], s[0], s[0], s[1]]);
      else if (ct === 0) row.push([s[0], s[0], s[0], 255]);
      else row.push([pal[s[0] * 3], pal[s[0] * 3 + 1], pal[s[0] * 3 + 2], trns && s[0] < trns.length ? trns[s[0]] : 255]);
    }
    px.push(row);
  }
  return { w, h, px };
}

/* 투명 여백을 잘라냅니다. 원본마다 여백 폭이 달라, 그대로 줄이면 어떤 아이콘은
   작게 어떤 것은 크게 보입니다. 기존 아이콘도 잘라낸 뒤 담았습니다. */
function trim({ w, h, px }) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (px[y][x][3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { w, h, px };                       // 전부 투명하면 그대로
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, px: px.slice(y0, y1 + 1).map(r => r.slice(x0, x1 + 1)) };
}

/* 알파를 곱해 평균 냅니다. 그냥 평균 내면 투명한 가장자리에서 검은 테가 생깁니다. */
function fit({ w, h, px }, N) {
  const [tw, th] = w >= h ? [N, Math.max(1, Math.round(h * N / w))] : [Math.max(1, Math.round(w * N / h)), N];
  const ox = (N - tw) >> 1, oy = (N - th) >> 1;
  const out = Array.from({ length: N }, () => Array.from({ length: N }, () => [0, 0, 0, 0]));
  for (let j = 0; j < th; j++) {
    const y0 = Math.floor(j * h / th), y1 = Math.max(y0 + 1, Math.floor((j + 1) * h / th));
    for (let i = 0; i < tw; i++) {
      const x0 = Math.floor(i * w / tw), x1 = Math.max(x0 + 1, Math.floor((i + 1) * w / tw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const p = px[y][x]; r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; a += p[3]; n++;
      }
      out[oy + j][ox + i] = a ? [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a / n)] : [0, 0, 0, 0];
    }
  }
  return out;
}

function encode(px, N) {
  const raw = Buffer.concat(px.map(row => Buffer.concat([Buffer.from([0]), Buffer.from(row.flat())])));
  const chunk = (type, body) => {
    const t = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(t) : crc32(t));
    return Buffer.concat([len, t, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* node 20 이하에는 zlib.crc32 가 없습니다. */
let TBL;
function crc32(buf) {
  if (!TBL) {
    TBL = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TBL[n] = c; }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TBL[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

async function main() {
  const BUILD = new Function(fs.readFileSync(path.join(ROOT, 'build-data.js'), 'utf8') + ';return BUILD;')();
  const need = BUILD.sets.map(s => s.key).filter(k => !fs.existsSync(path.join(DIR, `${k}.png`)));
  if (!need.length) { process.stderr.write('아이콘 전부 있습니다.\n'); return; }
  process.stderr.write(`아이콘 없는 세트 ${need.length}개: ${need.join(', ')}\n`);

  const got = [], missing = [];
  for (const key of need) {
    let done = false;
    for (const name of candidates(key)) {
      try {
        const r = await fetch(SRC(name), { headers: { 'user-agent': 'Mozilla/5.0' } });
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.subarray(0, 4).toString('hex') !== '89504e47') continue;
        const img = decode(buf);
        const cut = trim(img);
        fs.writeFileSync(path.join(DIR, `${key}.png`), encode(fit(cut, SIZE), SIZE));
        got.push(`${key} ← ${name} (${img.w}×${img.h} → ${cut.w}×${cut.h} → ${SIZE})`);
        done = true; break;
      } catch (e) { /* 다음 후보 */ }
    }
    if (!done) missing.push(key);
  }
  if (got.length) process.stderr.write(`받음 ${got.length}개: ${got.join(', ')}\n`);
  if (missing.length) {
    process.stderr.write(`참조 사이트에 없음 ${missing.length}개: ${missing.join(', ')}\n`
      + '  → 이벤트 장비라면 build.js 의 BD_NOICON 에 키를 넣어 주세요.\n');
  }
}

main().catch(e => { process.stderr.write('실패: ' + e.message + '\n'); process.exit(1); });
