/* 재료 계산기 — 데이터는 material-data.js 의 MATERIAL.
   app.js 보다 먼저 읽히므로, app.js 의 $ / esc 는 함수 안에서만(=호출 시점에) 씁니다.
   계산은 순수 함수라 node 로도 검증합니다 → tools/material-test.js */

/* 강화 단계: 제작 전(0_0) 다음에 G1-1 … G10-5. 인덱스 차이가 곧 강화 횟수입니다. */
const MAT_LEVELS = ['0_0'];
for (let g = 1; g <= 10; g++) for (let l = 1; l <= 5; l++) MAT_LEVELS.push(g + '_' + l);

/* 구간 합계.
   from 이 제작 등급보다 낮으면 제작 비용부터 포함하고, 제작 등급 다음 단계부터 이어 더합니다.
   레시피의 몬스터별 예외는 'craft' → 그룹(rare·sub·elder) → 몬스터 id 순으로 덮어씁니다. */
function matTotals(mon, gear, from, to) {
  const R = MATERIAL.recipes[gear];
  const qty = {}, rare = {}, icon = {};
  let zenny = 0;

  const apply = (step, craft) => {
    if (!step) return;
    let s = step;
    for (const tag of [craft ? 'craft' : null, mon.group, mon.id]) {
      if (!tag) continue;
      // 키는 'zinogre, deviljho' 처럼 여러 몬스터를 묶어 씁니다.
      const k = Object.keys(step).find(x => x.split(',').some(y => y.trim() === tag));
      if (k) s = { ...s, ...step[k] };
    }
    zenny += s.zenny || 0;

    for (const [slot, n] of Object.entries(s.common || {})) {
      let id = mon.commons[slot];
      if (id && typeof id === 'object') id = id[gear];
      // 몬스터가 안 가진 칸은 공용 재료(뾰족한 발톱·제련 소재·용옥 조각…)로 대체됩니다.
      if (!id) id = Object.keys(MATERIAL.catalog).find(k => {
        const c = MATERIAL.catalog[k];
        return c.fb === slot && (c.scope === gear || c.scope === 'both');
      });
      if (!id) continue;
      qty[id] = (qty[id] || 0) + n;
      icon[id] = id;
      const c = MATERIAL.catalog[id];
      rare[id] = Math.max(rare[id] || 0, c ? c.r : Number((/r(\d+)/.exec(slot) || [])[1]) || 0);
    }

    (s.exclusive || []).forEach((n, i) => {
      if (!(n > 0)) return;
      const r = i + 1, ex = mon.exclusive[i], two = ex && typeof ex === 'object';
      // R1 과 무기/방어구가 갈리는 칸만 _w/_a 로 나뉩니다.
      const id = mon.id + '_r' + r + (two || r === 1 ? (gear === 'weapon' ? '_w' : '_a') : '');
      qty[id] = (qty[id] || 0) + n;
      rare[id] = Math.max(rare[id] || 0, r);
      icon[id] = two ? ex[gear] : ex;
    });
  };

  const craftAt = MAT_LEVELS.indexOf(mon.grade + '_1');
  let i = MAT_LEVELS.indexOf(from);
  let steps = 0;
  if (i < craftAt) { apply(R[mon.grade] && R[mon.grade][1], true); steps++; i = craftAt; }
  const end = MAT_LEVELS.indexOf(to);
  for (i++; i <= end; i++) {
    const [g, l] = MAT_LEVELS[i].split('_');
    if (R[g] && R[g][l]) { apply(R[g][l], false); steps++; }
  }

  /* 희귀도 오름차순 → 공용 재료(카탈로그 순서) 먼저 → 나머지는 이름순. */
  const order = Object.keys(MATERIAL.catalog);
  const list = Object.keys(qty).sort((a, b) => {
    const d = (rare[a] || 1) - (rare[b] || 1);
    if (d) return d;
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  }).map(id => ({ id, icon: icon[id], rare: rare[id] || 1, qty: qty[id] }));

  return { list, zenny, steps };
}

if (typeof module !== 'undefined') module.exports = { MAT_LEVELS, matTotals };


/* ── 화면 ──────────────────────────────────────────────────────── */
let matMon = null;                 // 고른 몬스터 (MATERIAL.monsters 의 항목)
let matGear = 'weapon';
let matFrom = '0_0';
let matTo = '10_5';
let matDrawn = false;

const matLabel = p => (p === '0_0' ? '제작 전' : 'G' + p.replace('_', '-'));

function drawMaterial() {
  if (matDrawn || typeof MATERIAL === 'undefined') return;
  matDrawn = true;

  /* 출현 구역 필터. 여러 개 고르면 그중 하나라도 겹치는 몬스터를 보여줍니다.
     고룡은 특정 구역에 안 나와서 구역이 비어 있으므로 '없음' 칩으로 따로 걸립니다. */
  $('#mt-filter').innerHTML = `
    <p class="stone-label">출현 구역 <i>여러 개 고를 수 있습니다</i></p>
    <div class="mt-chips">
      ${Object.entries(MATERIAL.biomes).map(([k, name]) => `
        <button class="mt-chip" data-biome="${k}">
          <img src="assets/biome/${esc(k)}.png" width="18" height="18" alt="" loading="lazy">${esc(name)}
        </button>`).join('')}
      <button class="mt-chip" data-biome="none">없음</button>
    </div>
    <label class="search">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
      </svg>
      <input id="mt-q" type="search" placeholder="몬스터 이름" autocomplete="off" aria-label="몬스터 이름 검색">
    </label>`;
  // 한 번만 그리는 입력칸이라 위임 없이 바로 붙입니다.
  $('#mt-q').addEventListener('input', filterMonsters);

  /* data-mon 은 MATERIAL.monsters 의 원래 첨자입니다 — 고룡을 따로 그려도 그대로 씁니다. */
  const btn = ([m, i]) => `
    <button class="mt-mon" data-mon="${i}" title="${esc(m.name)}">
      <img src="assets/monster/${esc(m.icon)}.png" width="44" height="44" alt="" loading="lazy">
      <span>${esc(m.name)}</span>
    </button>`;
  const pairs = MATERIAL.monsters.map((m, i) => [m, i]);
  $('#mt-mons').innerHTML = pairs.filter(([m]) => m.group !== 'elder').map(btn).join('');
  $('#mt-elders').innerHTML = pairs.filter(([m]) => m.group === 'elder').map(btn).join('');

  pickMonster(0);
}

/* 고른 구역 (비어 있으면 전체). 'none' 은 구역이 없는 고룡을 뜻합니다. */
const matBiome = new Set();

/* 판정만 따로 떼어 둡니다 — DOM 없이 검증할 수 있습니다 (tools/material-test.js). */
function matVisible(m, q) {
  const okBiome = !matBiome.size
    || m.biome.some(x => matBiome.has(x))
    || (matBiome.has('none') && !m.biome.length);
  return okBiome && (!q || m.name.toLowerCase().includes(q));
}

function filterMonsters() {
  const q = $('#mt-q').value.trim().toLowerCase();
  let shown = 0;
  for (const b of document.querySelectorAll('#panel-material .mt-mon')) {
    b.hidden = !matVisible(MATERIAL.monsters[Number(b.dataset.mon)], q);
    if (!b.hidden) shown++;
  }
  // 한 묶음이 통째로 걸러지면 제목까지 감춥니다. 제목만 남으면 빈 칸처럼 보입니다.
  for (const g of ['mt-mons', 'mt-elders']) {
    const empty = !$('#' + g).querySelector('.mt-mon:not([hidden])');
    $('#' + g).hidden = empty;
    $('#' + g + '-h').hidden = empty;
  }
  $('#mt-none').hidden = shown > 0;
}

function pickMonster(i) {
  matMon = MATERIAL.monsters[i];
  matFrom = '0_0';
  matTo = '10_5';
  for (const b of document.querySelectorAll('#panel-material .mt-mon')) {
    b.classList.toggle('on', Number(b.dataset.mon) === i);
  }
  drawMatControls();
  drawMatResult();
}

/* 강등급 버튼. 제작 등급보다 낮은 칸은 애초에 존재할 수 없어 잠급니다. */
function drawMatControls() {
  const G = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], L = [1, 2, 3, 4, 5];
  const [fg, fl] = matFrom.split('_').map(Number);
  const [tg, tl] = matTo.split('_').map(Number);

  const row = (side, kind, list, cur) => list.map(v => {
    // 제작 전에는 소단계가 없고, 제작 등급보다 낮은 강등급은 존재하지 않습니다.
    const off = kind === 'g' ? (v > 0 && v < matMon.grade) : (side === 'from' && fg === 0);
    return `<button class="lvb${v === cur ? ' on' : ''}" data-set="${side}" data-kind="${kind}" data-v="${v}"${off ? ' disabled' : ''}>${
      v === 0 ? '제작' : (kind === 'g' ? 'G' + v : v)
    }</button>`;
  }).join('');

  $('#mt-ctl').innerHTML = `
    <div class="mt-gear">
      <button class="${matGear === 'weapon' ? 'on' : ''}" data-gear="weapon">무기</button>
      <button class="${matGear === 'armor' ? 'on' : ''}" data-gear="armor">방어구</button>
      <b>${esc(matMon.name)}</b>
    </div>
    <div class="mt-lv">
      <div>
        <p class="stone-label">현재 <i>${matLabel(matFrom)}</i></p>
        <div class="lvrow">${row('from', 'g', [0, ...G], fg)}</div>
        <div class="lvrow">${row('from', 'l', L, fl)}</div>
      </div>
      <div>
        <p class="stone-label">목표 <i>${matLabel(matTo)}</i></p>
        <div class="lvrow">${row('to', 'g', G, tg)}</div>
        <div class="lvrow">${row('to', 'l', L, tl)}</div>
      </div>
    </div>`;
}

function drawMatResult() {
  const { list, zenny, steps } = matTotals(matMon, matGear, matFrom, matTo);
  const gearTxt = matGear === 'weapon' ? '무기' : '방어구';

  /* 인게임 아이템 칸과 같은 배치: 희귀도 색으로 두른 아이콘 + 아래 RARE 띠,
     오른쪽에 파괴 부위 → 이름 → 개수. */
  const cards = list.map(m => {
    // 파괴 부위는 R2 부터 한 칸씩 밀려 들어갑니다. 용옥 조각(R6)도 부위 영향을 받습니다.
    const own = m.id.startsWith(matMon.id + '_r');
    const parts = (own || m.rare === 6) ? (matMon.break[m.rare - 2] || '') : '';
    const badge = parts.split(',').map(p => p.trim()).filter(Boolean)
      .map(p => `<i>${esc(MATERIAL.parts[p] || p)}</i>`).join('');
    const name = MATERIAL.names[m.id] || m.id;
    return `
      <li class="mt-item r${m.rare}">
        <span class="mt-ico">
          <img src="assets/material/${esc(m.icon || 'none')}.png" width="40" height="40" alt="" loading="lazy">
          <i>RARE ${m.rare}</i>
        </span>
        <div>
          ${badge ? `<p class="mt-brk">${badge}</p>` : ''}
          <p class="mt-mname">${esc(name)}</p>
          <b>${m.qty.toLocaleString()}</b>
        </div>
      </li>`;
  }).join('');

  /* 제니는 재료가 아니지만 같이 준비해야 하는 값이라, 원본 사이트처럼 목록 맨 뒤에 붙입니다. */
  const money = `
      <li class="mt-item zen">
        <span class="mt-ico"><img src="assets/material/zenny.png" width="40" height="40" alt="" loading="lazy"></span>
        <div>
          <p class="mt-mname">제니</p>
          <b>${zenny.toLocaleString()}</b>
        </div>
      </li>`;

  $('#mt-result').innerHTML = list.length ? `
    <p class="stone-label">${gearTxt} ${matLabel(matFrom)} → ${matLabel(matTo)} <i>강화 ${steps}회</i></p>
    <ul class="mt-list">${cards}${money}</ul>`
    : '<p class="state">이 구간에는 필요한 재료가 없습니다.</p>';
}

/* 클릭 한 곳에서 처리. 버튼이 매번 새로 그려지므로 위임이 안전합니다. */
document.addEventListener('click', e => {
  const panel = e.target.closest('#panel-material');
  if (!panel) return;

  const mon = e.target.closest('[data-mon]');
  if (mon) {
    pickMonster(Number(mon.dataset.mon));
    /* 몬스터 목록이 67마리라 등급 버튼이 화면 밖에 있습니다. 골랐으면 바로 등급을 정하도록
       '현재 = 제작 전' 이 보이는 곳까지 내려줍니다. behavior 는 CSS 에 맡겨
       '동작 최소화' 설정을 쓰는 사람에게는 튀지 않게 둡니다. */
    $('#mt-ctl').scrollIntoView({ block: 'start' });
    return;
  }

  const chip = e.target.closest('[data-biome]');
  if (chip) {
    const b = chip.dataset.biome;
    matBiome.has(b) ? matBiome.delete(b) : matBiome.add(b);
    chip.classList.toggle('on', matBiome.has(b));
    filterMonsters();
    return;
  }

  const gear = e.target.closest('[data-gear]');
  if (gear) {
    matGear = gear.dataset.gear;
    drawMatControls();
    drawMatResult();
    return;
  }

  const lv = e.target.closest('[data-set]');
  if (lv) {
    setMatLevel(lv.dataset.set, lv.dataset.kind, Number(lv.dataset.v));
    drawMatControls();
    drawMatResult();
  }
});

/* 제작 등급 아래로는 내려갈 수 없고, 목표는 항상 현재보다 최소 한 단계 위입니다. */
function setMatLevel(side, kind, v) {
  let [fg, fl] = matFrom.split('_').map(Number);
  let [tg, tl] = matTo.split('_').map(Number);

  if (side === 'from') {
    if (kind === 'g') { fg = v; fl = v === 0 ? 0 : (fl === 0 ? 1 : fl); }
    else { fl = v; if (fg === 0) fg = matMon.grade; }
    if (fg > 0 && fg < matMon.grade) fg = matMon.grade;
  } else {
    if (kind === 'g') tg = v; else tl = v;
  }

  let fi = MAT_LEVELS.indexOf(fg + '_' + fl);
  if (fi === MAT_LEVELS.length - 1) { fi -= 1; fg = 10; fl = 4; }   // 만렙에서 시작할 수는 없습니다
  let ti = MAT_LEVELS.indexOf(tg + '_' + tl);
  if (ti <= fi) [tg, tl] = MAT_LEVELS[fi + 1].split('_').map(Number);

  matFrom = fg + '_' + fl;
  matTo = tg + '_' + tl;
}
