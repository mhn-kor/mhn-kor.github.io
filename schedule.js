/* 일정 탭 — 공식 뉴스의 파밍 이벤트를 월간 달력으로 (schedule-data.js, tools/fetch-events.js 로 생성).
 *
 * 막대 하나가 이벤트 기간 하나입니다(핼러윈처럼 전반·후반이 나뉘면 둘). 막대나 날짜를 누르면
 * 아래에 그 이벤트·그날 진행되는 이벤트의 파밍 혜택 요약이 펼쳐집니다. 칩은 혜택 필터입니다.
 * 날짜는 모두 한국 시간입니다. app.js 의 $ / esc 를 함수 안에서만 씁니다.
 */
const SCH_DAY = 864e5, SCH_KST = 9 * 3600e3;
const SCH_WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const schState = { month: null, cats: new Set(), pick: null };

/* 한국 시간 날짜 키(YYYY-MM-DD)와 그날 0시(UTC 기준 ms). */
const schKey = ms => new Date(ms + SCH_KST).toISOString().slice(0, 10);
const schDay = key => Date.parse(key + 'T00:00:00+09:00');
const schFmt = iso => { const d = new Date(Date.parse(iso) + SCH_KST);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${SCH_WEEK[d.getUTCDay()]}) ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const schCats = ev => SCHEDULE.cats.filter(c => ev.effects.some(e => e.cat === c.k));

/* 기간 막대: 끝이 다음 날 아침(8:59)이어도 그날까지 칠한다. */
function schItems() {
  const on = schState.cats;
  return SCHEDULE.events.filter(ev => !on.size || ev.effects.some(e => on.has(e.cat))).flatMap(ev => ev.periods.map((p, i) => ({
    ev, p, i, from: schKey(Date.parse(p.start)), to: schKey(Date.parse(p.end) - 1), main: schCats(ev)[0]?.k || 'extra' })));
}

function schStatus(ev, now = Date.now()) {
  const start = Math.min(...ev.periods.map(p => Date.parse(p.start))), end = Math.max(...ev.periods.map(p => Date.parse(p.end)));
  if (now < start) return { k: 'soon', t: `${Math.ceil((schDay(schKey(start)) - schDay(schKey(now))) / SCH_DAY)}일 뒤 시작` };
  if (now <= end) return { k: 'live', t: `진행 중 · ${Math.max(0, Math.ceil((schDay(schKey(end)) - schDay(schKey(now))) / SCH_DAY))}일 남음` };
  return { k: 'done', t: '종료' };
}

function schCard(ev) {
  const st = schStatus(ev), main = ev.effects.filter(e => e.cat !== 'extra'), extra = ev.effects.filter(e => e.cat === 'extra');
  const cat = k => SCHEDULE.cats.find(c => c.k === k)?.n || '';
  return `<article class="sch-card ${st.k}">
    <header><span class="sch-st">${esc(st.t)}</span><h3>${esc(ev.short || ev.title)}</h3></header>
    <p class="sch-when">${ev.periods.map(p => `${p.label ? `<b>${esc(p.label)}</b> ` : ''}${schFmt(p.start)} ~ ${schFmt(p.end)}`).join('<br>')}</p>
    ${main.length ? `<ul class="sch-fx">${main.map(e => `<li class="sch-c-${e.cat}"><i>${esc(cat(e.cat))}</i><span>${esc(e.detail || e.name)}</span></li>`).join('')}</ul>` : ''}
    ${extra.length ? `<p class="sch-extra">그 밖의 혜택: ${extra.map(e => esc(e.name)).join(' · ')}</p>` : ''}
    <a class="sch-link" href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer">${esc(ev.title)} · 공식 공지 보기</a>
  </article>`;
}

function schDetail(items, today) {
  const pick = schState.pick, uniq = list => [...new Map(list.map(x => [x.ev.id, x.ev])).values()];
  if (pick?.ev) {
    const ev = SCHEDULE.events.find(e => e.id === pick.ev);
    return ev ? `<h2 class="sec">선택한 일정</h2>${schCard(ev)}` : '';
  }
  if (pick?.day) {
    const list = uniq(items.filter(x => x.from <= pick.day && pick.day <= x.to));
    const d = new Date(schDay(pick.day) + SCH_KST);
    return `<h2 class="sec">${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${SCH_WEEK[d.getUTCDay()]}) 일정</h2>`
      + (list.length ? list.map(schCard).join('') : '<p class="state">이날 진행되는 파밍 일정이 없습니다.</p>');
  }
  const live = uniq(items.filter(x => x.from <= today && today <= x.to));
  const soon = uniq(items.filter(x => x.from > today)).sort((a, b) => a.periods[0].start.localeCompare(b.periods[0].start));
  return `<h2 class="sec">진행 중</h2>${live.length ? live.map(schCard).join('') : '<p class="state">지금 진행 중인 파밍 일정이 없습니다.</p>'}
    <h2 class="sec">다가오는 일정</h2>${soon.length ? soon.map(schCard).join('') : '<p class="state">공지된 다음 일정이 아직 없습니다.</p>'}`;
}

function schCalendar(items, today) {
  const [y, m] = schState.month;
  const first = schDay(`${y}-${String(m).padStart(2, '0')}-01`), firstDow = new Date(first + SCH_KST).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate(), weeks = Math.ceil((firstDow + days) / 7);
  let html = `<div class="sch-dow">${SCH_WEEK.map(d => `<span>${d}</span>`).join('')}</div>`;
  for (let w = 0; w < weeks; w++) {
    const keys = Array.from({ length: 7 }, (_, i) => schKey(first + (w * 7 + i - firstDow) * SCH_DAY + 12 * 3600e3));
    const segs = items.filter(x => x.from <= keys[6] && x.to >= keys[0])
      .map(x => ({ ...x, a: Math.max(0, keys.indexOf(x.from) < 0 ? 0 : keys.indexOf(x.from)), b: keys.indexOf(x.to) < 0 ? 6 : keys.indexOf(x.to) }))
      .sort((p, q) => p.a - q.a || q.b - q.a - (p.b - p.a));
    const lanes = [];
    for (const s of segs) { let l = lanes.findIndex(end => end < s.a); if (l < 0) l = lanes.push(-1) - 1; lanes[l] = s.b; s.lane = l; }
    html += `<div class="sch-week" style="--lanes:${Math.max(lanes.length, 1)}">`
      + keys.map((k, i) => `<button type="button" class="sch-day${k.slice(5, 7) !== String(m).padStart(2, '0') ? ' out' : ''}${k === today ? ' today' : ''}${schState.pick?.day === k ? ' on' : ''}" data-sch-day="${k}" style="grid-column:${i + 1}" aria-label="${+k.slice(5, 7)}월 ${+k.slice(8)}일"><span>${+k.slice(8)}</span></button>`).join('')
      + segs.map(s => `<button type="button" class="sch-bar sch-c-${s.main}${s.to < today ? ' done' : ''}${schState.pick?.ev === s.ev.id ? ' on' : ''}" data-sch-ev="${esc(s.ev.id)}" style="grid-column:${s.a + 1}/${s.b + 2};grid-row:${s.lane + 2}" title="${esc(s.ev.title)}">`
        + `<span>${esc((s.p.label ? s.p.label + ' · ' : '') + (s.ev.short || s.ev.title))}</span></button>`).join('')
      + '</div>';
  }
  return html;
}

function drawSchedule() {
  const box = $('#sch-box');
  if (!box || typeof SCHEDULE === 'undefined') return;
  const today = schKey(Date.now());
  if (!schState.month) schState.month = [+today.slice(0, 4), +today.slice(5, 7)];
  const all = SCHEDULE.events.flatMap(ev => ev.periods.map(p => [schKey(Date.parse(p.start)), schKey(Date.parse(p.end) - 1)]));
  const minM = (all.map(x => x[0]).sort()[0] || today).slice(0, 7), maxM = [today, ...all.map(x => x[1])].sort().at(-1).slice(0, 7);
  const cur = `${schState.month[0]}-${String(schState.month[1]).padStart(2, '0')}`, items = schItems();
  const upd = new Date(Date.parse(SCHEDULE.updatedAt) + SCH_KST);
  box.innerHTML = `
    <div class="card-box sch-filter">
      <p class="stone-label">혜택 <i>고르면 그 혜택이 있는 일정만 보입니다</i></p>
      <div class="mt-chips">${SCHEDULE.cats.map(c => `<button type="button" class="mt-chip sch-chip sch-c-${c.k}${schState.cats.has(c.k) ? ' on' : ''}" data-sch-cat="${c.k}" aria-pressed="${schState.cats.has(c.k)}"><i></i>${esc(c.n)}</button>`).join('')}</div>
    </div>
    <div class="sch-head">
      <button type="button" class="btn ghost" data-sch-move="-1"${cur <= minM ? ' disabled' : ''} aria-label="이전 달">‹</button>
      <h2>${schState.month[0]}년 ${schState.month[1]}월</h2>
      <button type="button" class="btn ghost" data-sch-move="1"${cur >= maxM ? ' disabled' : ''} aria-label="다음 달">›</button>
      <button type="button" class="btn ghost sch-today" data-sch-move="0">오늘</button>
    </div>
    <div class="sch-cal" role="group" aria-label="파밍 일정 달력">${schCalendar(items, today)}</div>
    <p class="sch-note">공식 뉴스 기준 · 한국 시간 · ${upd.getUTCMonth() + 1}/${upd.getUTCDate()} 갱신 · 기간 한정 퀘스트·프리미엄 퀘스트는 빼고 파밍 혜택만 모았습니다.</p>
    <div class="sch-detail" id="sch-detail">${schDetail(items, today)}</div>`;
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-sch-cat],[data-sch-move],[data-sch-day],[data-sch-ev]');
  if (!t || !t.closest('#sch-box')) return;
  if (t.dataset.schCat) { const s = schState.cats; s.has(t.dataset.schCat) ? s.delete(t.dataset.schCat) : s.add(t.dataset.schCat); }
  else if (t.dataset.schMove) {
    const step = +t.dataset.schMove, today = schKey(Date.now());
    if (!step) { schState.month = [+today.slice(0, 4), +today.slice(5, 7)]; schState.pick = null; }
    else { const [y, m] = schState.month, n = y * 12 + m - 1 + step; schState.month = [Math.floor(n / 12), n % 12 + 1]; }
  } else if (t.dataset.schEv) schState.pick = schState.pick?.ev === t.dataset.schEv ? null : { ev: t.dataset.schEv };
  else schState.pick = schState.pick?.day === t.dataset.schDay ? null : { day: t.dataset.schDay };
  drawSchedule();
  if (t.dataset.schEv || t.dataset.schDay) $('#sch-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
