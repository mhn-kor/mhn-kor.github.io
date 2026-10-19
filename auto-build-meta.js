/* 메타 자동빌드 (docs/CONCEPTS.md '메타 탐색').
   메타 = 뼈대(핵심 스킬, Lv4 이상 보장) + 수단(나머지는 점수로 채움, 레벨 강제 없음).
   탐색 엔진(abSearch·abBest)과 판정(abAssumed·abDirections 등)은 auto-build.js를 그대로 쓰고,
   화면·상태는 이 파일에만 둔다. 기존 화면(auto-build.js의 ab*UI, #auto-build-legacy)과 섞지 않는다. */
const ABM = { maxMetas: 4, coreMin: 4, perMetaMs: 5000, quick: { ms: 250, beam: 40, armor: 12 }, shown: 8, perMeta: 5 };

/* 메타 후보: 기존 투자 방향(회심·속성·흉회심·상태이상)은 첫 핵심을 뼈대로, 그 무기에서 켜지는 공격력·대미지 버프는 단일 스킬 메타로. */
function abmCandidates(b, gun) {
  const core = s => ({ s, min: Math.min(ABM.coreMin, abMax(s)), max: abMax(s) });
  const metas = [];
  for (const d of abDirections(b, gun)) {
    const first = d.targets[0];
    if (!first || metas.some(m => m.skeleton[0].s === first.s)) continue;
    const skeleton = [core(first.s)];
    // 변형 회심 메타는 회심 100%까지 필요한 약점 특효 레벨도 뼈대로 둔다 (CONCEPTS W1).
    for (const t of d.targets.slice(1)) if (t.s === '약점 특효' && d.id === 'morph-critical') skeleton.push({ s:t.s, min:t.max, max:t.max });
    metas.push({ id:'d:'+d.id, name:d.name.replace(/^(.*?) · 추천$/, '$1'), direction:d.id, skeleton,
      extra:d.targets.filter(t => !skeleton.some(x => x.s === t.s)).map(t => ({ ...t, min:0 })), desc:d.desc });
  }
  const used = new Set(metas.flatMap(m => m.skeleton.map(t => t.s)));
  const buff = s => bdEffects(bdSkillDesc(s, abMax(s)) || '', s, abGunWeapon(b, gun)).some(e => ['atk','dmg'].includes(e.k) && !e.onCrit);
  // 경지는 기본 스킬이 켜지는 무기에서만 (예: 연격이 꺼지는 랜스의 연격·경지 제외).
  const gate = s => !/·경지$/.test(s) || abAssumed(s.replace(/·경지$/, ''), b);
  const pool = abSupportSkills(b, gun).filter(s => !used.has(s) && abAssumed(s, b) && buff(s) && gate(s)
    && !AB_ASSUME.linked.skills.includes(s) && !AB_ASSUME.candidate.includes(s) && !AB_ASSUME.sp.includes(s));
  for (const s of pool) metas.push({ id:'s:'+s, name:s, direction:'manual', skeleton:[core(s)], extra:[],
    desc:`${s} Lv${core(s).min} 이상을 확보하고, 나머지는 점수가 오르는 스킬로 채웁니다.` });
  return metas;
}

/* 메타 탐색 설정: 사용자 필수 + 뼈대 + 방향의 투자 후보. 같은 스킬은 큰 최소로 합친다. */
function abmConfig(meta, base) {
  const merged = new Map();
  for (const t of [...meta.skeleton, ...base.targets, ...meta.extra]) {
    const old = merged.get(t.s);
    merged.set(t.s, old ? { ...old, min:Math.max(old.min, t.min), max:Math.max(old.max, t.max) } : { ...t });
  }
  return { b:base.b, gun:base.gun, direction:meta.direction, targets:[...merged.values()], drift:base.drift, lockon:base.lockon,
    styleGuide:true, exclude:base.exclude, assumeOn:base.assumeOn, assumeOff:base.assumeOff };
}

/* 탐색 한도를 잠시 바꿔 돌린다. AB_LIMIT은 auto-build.js의 공유 상수라 끝나면 반드시 되돌린다. */
async function abmRun(config, limit, progress, cancelled) {
  const saved = { ...AB_LIMIT };
  Object.assign(AB_LIMIT, limit);
  try { return await abSearch(structuredClone(config), progress, cancelled); }
  finally { Object.assign(AB_LIMIT, saved); }
}

/* 빠른 계산: 메타마다 짧게 탐색해 예상 최고 점수를 낸다. 빠른 계산에서 뼈대를 못 채우면 score:null. */
async function abmEstimate(metas, base, cancelled = () => false, onEach = () => {}) {
  const out = [];
  for (const m of metas) {
    if (cancelled()) return null;
    const r = await abmRun(abmConfig(m, base), ABM.quick, () => {}, cancelled);
    if (!r) return null;
    out.push({ ...m, score: r.pool.length ? Math.max(...r.pool.map(x => x.score)) : null });
    onEach(out.length, metas.length);
  }
  return out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

/* 선택한 메타마다 5초 탐색해 서로 다른 방어구 조합 5개. 메타 하나가 끝날 때마다 onMeta. */
async function abmSearch(metas, base, progress = () => {}, cancelled = () => false, onMeta = () => {}) {
  const out = [];
  for (const [i, m] of metas.entries()) {
    const r = await abmRun(abmConfig(m, base), { ms: ABM.perMetaMs }, p => progress({ ...p, meta:m, index:i, total:metas.length }), cancelled);
    if (!r) return null;
    out.push({ meta:m, stats:r, builds:abBest(r.pool, ABM.perMeta) });
    onMeta(out);
  }
  return out;
}

/* ── 화면 ─────────────────────────────────────────────────────── */
const abmState = { b: { ...bdNewBuild(), w: 'mizu', wt: 'shield-sword' }, gun:{ mode:'cycle' }, drift:true, lockon:true,
  targets:[], exclude:[], assumeOn:[], assumeOff:[], adding:null, chip:null,
  metas:null, estimated:0, selected:[], results:null, busy:'', run:0, notice:'', scroll:0, active:false };

const abmBase = () => { const s = abmState; return { b:s.b, gun:s.gun, targets:s.targets, drift:s.drift, lockon:s.lockon,
  exclude:s.exclude, assumeOn:s.assumeOn, assumeOff:s.assumeOff }; };

/* 설정이 바뀌면 진행 중 계산을 멈추고 결과를 비운 뒤 메타 후보를 다시 계산한다. 선택은 같은 메타가 남아 있으면 유지. */
async function abmRefresh() {
  const s = abmState, run = ++s.run;
  s.results = null; s.metas = null; s.estimated = 0; s.busy = 'estimate'; s.notice = '';
  const excluded = new Set(s.exclude.map(x => x.s));
  const metas = abmCandidates(s.b, s.gun).filter(m => !m.skeleton.some(t => excluded.has(t.s)));
  abmRender();
  try {
    const out = await abmEstimate(metas, abmBase(), () => run !== s.run, (n, total) => {
      const el = $('#abm-status'); if (el) el.textContent = `메타 후보 계산 중 ${n}/${total}`;
    });
    if (!out || run !== s.run) return;
    s.metas = out.slice(0, ABM.shown);
    s.selected = s.selected.filter(id => s.metas.some(m => m.id === id));
    if (!s.selected.length && s.metas[0]?.score != null) s.selected = [s.metas[0].id];
  } catch (err) { if (run === s.run) s.notice = '메타 후보 계산 중 오류가 발생했습니다.'; console.error(err); }
  if (run === s.run) { s.busy = ''; abmRender(); }
}

function abmChangeWeapon(field, value) {
  const s = abmState;
  if (field === 'wt') {
    s.b.wt = value; s.lockon = abMelee(value);
    if (!bdWeaponOf(s.b)) s.b.w = abMonsters(value)[0]?.key || null;
  } else s.b.w = value;
  s.b.st = 0; s.b.style20 = false; s.b.params = [null, null, null];
  delete s.b.snsMode; delete s.b.ammoSlot;
  s.gun = { mode:'cycle' };
}

function abmWeaponUI(b) {
  const info = bdStyleInfo(b), w = bdWeaponOf(b), base = bdWeaponBase(b);
  const style = bdStylesOf(b.wt)[b.st - 1] || '';
  const modes = AB_RULES.styles.filter(r => r.wt === b.wt && [].concat(r.style).includes(style));
  const g = abGunInfo(b, abmState.gun);
  return `<div class="ab-box ab-form-settings"><h3>① 무기 설정</h3><div class="ab-config">
      <label>무기군<select data-abm="wt">${abOptions(BUILD.weaponTypes.filter(t => abMonsters(t.k).length).map(t => [t.k, t.n]), b.wt)}</select></label>
      <label>몬스터·소재<select data-abm="monster">${abOptions(abMonsters(b.wt).map(s => [s.key, s.name]), b.w)}</select></label>
      <label>스타일<select data-abm="st"${info.selectable ? '' : ' disabled'}>${abOptions([[0, '스타일 없음'], ...bdStylesOf(b.wt).map((n, i) => [i + 1, n])], b.st)}</select></label>
      <label class="ab-check"><input type="checkbox" data-abm="style20"${info.active ? ' checked' : ''}${info.available ? '' : ' disabled'}>스타일강화 Lv20 적용</label>
    </div><div class="ab-parameter">${BD_PARAM_LEVELS.map((lv, i) => `<label>Lv${lv} 파라미터<select data-abm-param="${i}"${info.active ? '' : ' disabled'}>${abOptions([['', '미선택'], ...(info.profile?.parameters[lv] || []).map(p => [p.stat, `${{ atk: '공', crit: '회', ele: '속' }[p.stat]} +${p.value}${p.stat === 'crit' ? '%' : ''}`])], b.params[i] || '')}</select></label>`).join('')}</div>
    ${modes.some(r => r.mode) || g ? `<div class="ab-config abm-extra">
      ${modes.some(r => r.mode) ? `<label>운용 성향<select data-abm="mode">${abOptions(modes.map(r => [r.mode || '', r.name]), abStyleRow(b)?.mode || '')}</select></label>` : ''}
      ${g ? `<label>탄 운용<select data-abm="gunMode">${abOptions(g.modes, g.mode)}</select></label>
        ${g.mode !== 'cycle' ? `<label>반복할 탄<select data-abm="gunSlot">${abOptions(g.choices.map(a => [a.i, `${a.i + 1}번 · ${a.name}`]), g.slot)}</select></label>` : ''}` : ''}</div>` : ''}
    <p class="ab-base">${esc(w.name)} · 공격력 <b>${base.atk}</b>${w.e ? ` · ${esc(w.e)} <b>${base.ele}</b>` : ''} · 회심 <b>${base.crit}%</b></p></div>`;
}

/* 발동 가정: 기존 화면과 같은 규칙(AB_ASSUME)을 쓰되 이 화면의 상태만 바꾼다. */
function abmAssumeOn(n) {
  const s = abmState, candidate = [...AB_ASSUME.candidate, ...AB_ASSUME.sp].includes(n);
  return candidate ? s.assumeOn.includes(n) || (!s.assumeOff.includes(n) && abAutoCandidate(n, s.b)) : !s.assumeOff.includes(n);
}
function abmAssumeUI(b) {
  const chip = (n, title) => `<button type="button" class="ab-chip rule${abmAssumeOn(n) ? '' : ' off'}" data-abm-assume="${esc(n)}" title="${title}">${esc(n)}</button>`;
  const control = AB_ASSUME.control.filter(n => abAssumed(n, { ...b, _abAssume:{} }));
  return `<div class="ab-box ab-form-settings"><h3>② 발동 가정 <small>켠 것만 점수에 들어갑니다</small></h3>
    <div class="ab-chips">${[...AB_ASSUME.monster, ...control].map(n => chip(n, control.includes(n) ? '컨트롤로 유지하는 조건 · 고수 기준으로 켬' : '몬스터·전투에 따라 갈림')).join('')}</div>
    <p class="ab-muted">조건부 후보 · 이번 세팅에 포함할 스킬만 켜기</p>
    <div class="ab-chips">${[...AB_ASSUME.candidate, ...AB_ASSUME.sp].map(n => chip(n, '조건부 후보')).join('')}</div></div>`;
}

/* 추가 조건: 모든 메타에 공통으로 붙는 사용자 필수 스킬·완전 제외·록온·표류연성. */
function abmConditionUI() {
  const s = abmState, used = new Set([...s.targets, ...s.exclude].map(t => t.s));
  const plus = (group, label) => s.adding === group
    ? `<select data-abm-add="${group}" aria-label="${label} 추가">${abOptions([['', label + ' 추가…'], ...abSkills().filter(n => !used.has(n)).map(n => [n, n])], '')}</select>`
    : `<button type="button" class="ab-chip plus" data-abm-plus="${group}" aria-label="${label} 추가">＋</button>`;
  const req = s.targets.map((t, i) => `<button type="button" class="ab-chip" data-abm-chip="t:${i}"${s.chip === 't:' + i ? ' aria-expanded="true"' : ''}>${esc(t.s)} <b>${t.min}</b></button>`);
  if (abMelee(s.b.wt)) req.unshift(`<button type="button" class="ab-chip rule${s.lockon ? '' : ' off'}" data-abm-lock>록온${s.lockon ? ' <b>1</b>' : ''}</button>`);
  const exc = s.exclude.map((x, i) => `<button type="button" class="ab-chip ex" data-abm-chip="x:${i}" title="눌러서 빼기">${esc(x.s)} <b>🚫</b></button>`);
  const t = s.chip?.[0] === 't' && s.targets[+s.chip.slice(2)], op = (o, label, off) => `<button type="button" data-abm-op="${o}"${off ? ' disabled' : ''}>${label}</button>`;
  return `<div class="ab-box"><h3>③ 추가 조건 <small>모든 메타에 공통 · 선택 사항</small></h3>
    <div class="ab-card-row"><span>필수</span><div class="ab-chips">${req.join('')}${plus('req', '필수 스킬')}</div></div>
    ${t ? `<div class="ab-chip-editor"><b>${esc(t.s)}</b> 최소 ${op('min-', '−', t.min <= 1)}${t.min}${op('min+', '＋', t.min >= abMax(t.s))}${op('del', '✕ 빼기')}</div>` : ''}
    <div class="ab-card-row"><span>제외</span><div class="ab-chips">${exc.join('')}${s.exclude.length < AB_EXCLUDE_MAX ? plus('ex', '제외 스킬') : ''}</div></div>
    <label class="ab-check"><input type="checkbox" data-abm="drift"${s.drift ? ' checked' : ''}>표류연성 사용</label></div>`;
}

function abmMetaUI() {
  const s = abmState, n = s.selected.length;
  if (!s.metas) return `<div class="ab-box"><h3>④ 메타 선택</h3><p id="abm-status" class="ab-notice" role="status" aria-live="polite">${s.busy === 'estimate' ? '메타 후보 계산 중…' : esc(s.notice)}</p></div>`;
  const chip = m => { const on = s.selected.includes(m.id), full = !on && n >= ABM.maxMetas;
    return `<button type="button" class="abm-meta" data-abm-meta="${esc(m.id)}" aria-pressed="${on}"${full || s.busy ? ' disabled' : ''} title="${esc(m.desc)}">
      <b>${esc(m.name)}</b><span>${m.skeleton.map(t => `${esc(t.s)} Lv${t.min}+`).join(' · ')}</span>
      <small>${m.score == null ? '빠른 계산에서 구성 못 찾음' : `예상 ${m.score.toLocaleString()}점`}</small></button>`; };
  return `<div class="ab-box"><h3>④ 메타 선택 <small>최대 ${ABM.maxMetas}개 · 예상 점수순</small></h3>
    <div class="abm-metas" role="group" aria-label="메타 후보">${s.metas.map(chip).join('')}</div>
    <p class="ab-muted">메타는 핵심 스킬(뼈대)을 Lv${ABM.coreMin} 이상(최대 레벨이 더 낮으면 최대) 확보하고, 나머지 칸은 점수가 오르는 스킬로 채운 구성입니다. 예상 점수는 짧은 탐색 값이라 실제 결과와 다를 수 있습니다.</p>
    <p class="ab-notice">메타 하나당 최대 약 ${ABM.perMetaMs / 1000}초 걸립니다. 많이 고를수록 오래 걸립니다.</p>
    <div class="ab-actions"><button class="btn primary" data-abm-search${!n || s.busy ? ' disabled' : ''}>${s.busy === 'search' ? '빌드 찾는 중…' : `메타 ${n}개로 빌드 찾기 (최대 약 ${n * ABM.perMetaMs / 1000}초)`}</button>
    ${s.busy === 'search' ? '<button class="btn ghost" data-abm-cancel>중지</button>' : ''}</div>
    <p id="abm-status" role="status" aria-live="polite">${esc(s.notice)}</p></div>`;
}

/* 결과 카드의 장비 목록. 뼈대 스킬을 강조한다. */
function abmEquipmentUI(b, core) {
  const chips = (skills, drift = false) => skills.map(x => `<span class="chip${core.has(x.s) ? ' ab-core' : ''}${drift ? ' ab-drift-skill' : ''}">${esc(x.s)}<b>${x.lv}</b></span>`).join('');
  const row = (part, name, set, skills, stones = []) => `<div class="bd-row"><span class="bd-ti static"><img src="assets/part/${esc(part)}.png" width="24" height="24" alt=""></span>
    <div class="bd-body"><div class="bd-line">${bdMon(set.key)}<span class="ab-name"><span class="bd-nm">${esc(name)}</span></span></div>
    <div class="bd-inline">${chips(skills)}${chips(stones.map(d => ({ s:d.s, lv:1 })), true)}</div></div></div>`;
  const w = bdWeaponOf(b), ws = bdSet(b.w);
  return `<div class="bd-rows ab-equipment">${row(b.wt, w.name, ws, bdBuildWSkills(b))}
    ${BD_PARTS().map(({ k }) => { const set = bdSet(b[k]); return row(k, set.pieces[k].name, set, set.pieces[k].skills, bdStoneList(b, k)); }).join('')}</div>`;
}

function abmCardUI(r, i, total, meta) {
  const lv = new Map(bdTotals(r.b)), core = new Set(meta.skeleton.map(t => t.s));
  return `<article class="abm-slide bd-card ab-result" aria-label="${i + 1}/${total}">
    <div class="ab-heading"><h3>${i + 1}/${total}</h3><b class="ab-score">${r.score.toLocaleString()}점</b></div>
    <div class="ab-levels">${meta.skeleton.map(t => `<span>${esc(t.s)} <b>Lv${Math.min(abMax(t.s), lv.get(t.s) || 0)}</b></span>`).join('')}<span>연성 ${r.drifts}칸</span></div>
    <div class="ab-totals"><h4>스킬 합계</h4><div class="bd-inline">${bdTotals(r.b).map(([s, n]) => `<span class="chip${core.has(s) ? ' ab-core' : ''}">${esc(s)}<b>${n}</b></span>`).join('')}</div></div>
    ${abmEquipmentUI(r.b, core)}
    <footer><button class="btn primary" data-abm-import="${esc(meta.id)}:${i}">내 빌드로 가져오기</button></footer></article>`;
}

function abmResultsUI() {
  const s = abmState;
  if (!s.results?.length) return '';
  return `<h3 class="abm-title">⑤ 메타별 빌드</h3>` + s.results.map(({ meta, stats, builds }) => `<section class="ab-box abm-group" data-abm-group="${esc(meta.id)}">
    <div class="ab-heading"><h3>${esc(meta.name)}</h3><span class="abm-count" aria-live="polite">${builds.length ? '1' : '0'}/${builds.length}</span></div>
    <p class="ab-muted">${esc(meta.desc)} · ${stats.expanded.toLocaleString()}개 조합 · ${(stats.ms / 1000).toFixed(1)}초</p>
    ${builds.length ? `<div class="abm-carousel"><button type="button" class="abm-arrow prev" data-abm-scroll="-1" aria-label="이전 빌드">‹</button>
      <div class="abm-track">${builds.map((r, i) => abmCardUI(r, i, builds.length, meta)).join('')}</div>
      <button type="button" class="abm-arrow next" data-abm-scroll="1" aria-label="다음 빌드">›</button></div>
      <div class="abm-dots" aria-hidden="true">${builds.map((_, i) => `<span${i ? '' : ' class="on"'}></span>`).join('')}</div>`
    : '<p>이 메타의 뼈대를 채우는 조합을 찾지 못했습니다. 제외 스킬을 줄이거나 표류연성을 켜 보세요.</p>'}</section>`).join('');
}

function abmRender() {
  const s = abmState;
  $('#abm-screen').innerHTML = `<div class="ab-heading"><button class="btn ghost" data-abm-back>← 내 빌드</button><h2>자동빌드 (테스트중)</h2>
    <a class="ab-muted" href="#auto-build-legacy">이전 화면</a></div>
    ${abmWeaponUI(s.b)}${abmAssumeUI(s.b)}${abmConditionUI()}${abmMetaUI()}<div id="abm-results">${abmResultsUI()}</div>`;
  abmBindCarousels();
}

/* 가로 넘김: 스크롤 위치로 n/5와 점을 갱신한다. */
function abmBindCarousels() {
  for (const g of document.querySelectorAll('#abm-screen .abm-group')) {
    const track = g.querySelector('.abm-track');
    if (!track) continue;
    const update = () => {
      const slides = [...track.children], left = track.scrollLeft;
      const i = slides.reduce((best, el, j) => Math.abs(el.offsetLeft - track.offsetLeft - left) < Math.abs(slides[best].offsetLeft - track.offsetLeft - left) ? j : best, 0);
      g.querySelector('.abm-count').textContent = `${i + 1}/${slides.length}`;
      g.querySelectorAll('.abm-dots span').forEach((d, j) => d.classList.toggle('on', j === i));
    };
    track.addEventListener('scroll', update, { passive:true });
  }
}

function abmRoute() {
  const active = location.hash === '#auto-build';
  if (active) for (const selector of ['#panel-build .hero', '#panel-build .bd-tools', '#bd-weapon-filter', '#bd-cards']) $(selector).hidden = true;
  $('#abm-screen').hidden = !active;
  if (active && !abmState.active) { abmState.active = true; abmRefresh(); }
  if (!active && abmState.active) {
    abmState.active = false; abmState.run++; abmState.busy = '';
    if (location.hash === '#build') requestAnimationFrame(() => window.scrollTo(0, abmState.scroll));
  }
}

$('#bd-auto').addEventListener('click', () => { abmState.scroll = window.scrollY; location.hash = 'auto-build'; });
$('#abm-screen').addEventListener('change', e => {
  const el = e.target, s = abmState, k = el.dataset.abm;
  if (el.hasAttribute('data-abm-add')) {
    const name = el.value, group = el.dataset.abmAdd; s.adding = null;
    if (!name) return abmRender();
    if (group === 'ex') {
      const error = abExcludeError([...s.exclude, { s:name, shared:false }], s.targets, s.b);
      if (error) { s.notice = error; return abmRender(); }
      s.exclude.push({ s:name, shared:false });
    } else s.targets.push({ s:name, min:1, max:abMax(name) });
    return abmRefresh();
  }
  if (['wt', 'monster'].includes(k)) abmChangeWeapon(k, el.value);
  if (k === 'st') { s.b.st = +el.value; if (!s.b.st) s.b.style20 = false; }
  if (k === 'style20') s.b.style20 = el.checked;
  if (k === 'mode') { if (el.value) s.b.snsMode = el.value; else delete s.b.snsMode; }
  if (k === 'drift') s.drift = el.checked;
  if (k === 'gunMode') s.gun = { ...s.gun, mode:el.value, slot:undefined };
  if (k === 'gunSlot') s.gun.slot = +el.value;
  if (['st', 'gunMode', 'gunSlot'].includes(k) && abGun(s.b)) s.gun = abGunInfo(s.b, s.gun).settings;
  if (el.hasAttribute('data-abm-param')) s.b.params[+el.dataset.abmParam] = el.value || null;
  bdNormalizeParams(s.b);
  abmRefresh();
});
$('#abm-screen').addEventListener('click', async e => {
  const el = e.target.closest('button'), s = abmState;
  if (!el) return;
  if (el.hasAttribute('data-abm-back')) { location.hash = 'build'; return; }
  if (el.hasAttribute('data-abm-scroll')) {
    const track = el.parentElement.querySelector('.abm-track');
    track.scrollBy({ left:+el.dataset.abmScroll * track.firstElementChild.offsetWidth, behavior:'smooth' }); return;
  }
  if (el.hasAttribute('data-abm-assume')) {
    const n = el.dataset.abmAssume, on = abmAssumeOn(n), candidate = [...AB_ASSUME.candidate, ...AB_ASSUME.sp].includes(n);
    s.assumeOn = s.assumeOn.filter(x => x !== n); s.assumeOff = s.assumeOff.filter(x => x !== n);
    if (on) s.assumeOff.push(n); else if (candidate) s.assumeOn.push(n);
    return abmRefresh();
  }
  if (el.hasAttribute('data-abm-lock')) { s.lockon = !s.lockon; return abmRefresh(); }
  if (el.hasAttribute('data-abm-plus')) { s.adding = el.dataset.abmPlus; s.chip = null; abmRender(); $(`[data-abm-add="${s.adding}"]`)?.focus(); return; }
  if (el.hasAttribute('data-abm-chip')) {
    const [kind, i] = [el.dataset.abmChip[0], +el.dataset.abmChip.slice(2)];
    if (kind === 'x') { s.exclude.splice(i, 1); return abmRefresh(); }
    s.chip = s.chip === el.dataset.abmChip ? null : el.dataset.abmChip; return abmRender();
  }
  if (el.hasAttribute('data-abm-op')) {
    const i = +s.chip.slice(2), t = s.targets[i], op = el.dataset.abmOp;
    if (op === 'min-') t.min = Math.max(1, t.min - 1);
    if (op === 'min+') t.min = Math.min(abMax(t.s), t.min + 1);
    if (op === 'del') { s.targets.splice(i, 1); s.chip = null; }
    return abmRefresh();
  }
  if (el.hasAttribute('data-abm-meta')) {
    const id = el.dataset.abmMeta;
    s.selected = s.selected.includes(id) ? s.selected.filter(x => x !== id) : [...s.selected, id].slice(0, ABM.maxMetas);
    return abmRender();
  }
  if (el.hasAttribute('data-abm-cancel')) { s.run++; s.busy = ''; s.notice = '탐색을 중지했습니다.'; return abmRender(); }
  if (el.hasAttribute('data-abm-import')) {
    const [id, i] = [el.dataset.abmImport.replace(/:\d+$/, ''), +el.dataset.abmImport.match(/\d+$/)[0]];
    const group = s.results?.find(x => x.meta.id === id), r = group?.builds[i];
    if (!r) return;
    const b = structuredClone(r.b), gun = abGunInfo(b);
    delete b._abGun; delete b._abExclude; delete b._abAssume; delete b.ignore; // 자동추천 메타데이터는 저장 빌드 형식에 추가하지 않는다.
    b.n = `${bdSet(b.w).name} · ${group.meta.name}${gun ? ' · ' + gun.name + (gun.mode !== 'cycle' ? ' · ' + gun.ammo[0]?.name : '') : ''}`;
    if (bdAdopt(bdShareParam(b), b.n)) {
      s.scroll = 0; location.hash = 'build';
      requestAnimationFrame(() => bdFocusBuild(0)); toast('최신 내 빌드로 가져왔습니다');
    }
    return;
  }
  if (!el.hasAttribute('data-abm-search') || s.busy) return;
  const metas = s.selected.map(id => s.metas.find(m => m.id === id)).filter(Boolean), run = ++s.run;
  s.busy = 'search'; s.results = []; s.notice = '빌드를 찾고 있습니다…'; abmRender();
  try {
    const out = await abmSearch(metas, abmBase(),
      p => { const st = $('#abm-status'); if (st) st.textContent = `메타 ${p.index + 1}/${p.total} · ${p.meta.name} · ${p.expanded.toLocaleString()}개 조합 탐색`; },
      () => run !== s.run,
      done => { if (run !== s.run) return; s.results = [...done]; $('#abm-results').innerHTML = abmResultsUI(); abmBindCarousels(); });
    if (!out || run !== s.run) return;
    s.notice = '빌드 탐색이 완료되었습니다.';
  } catch (err) { if (run === s.run) s.notice = '탐색 중 오류가 발생했습니다. 다시 시도해 주세요.'; console.error(err); }
  if (run === s.run) { s.busy = ''; abmRender(); }
});
abmRoute();
