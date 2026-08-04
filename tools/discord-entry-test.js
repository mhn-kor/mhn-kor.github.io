/* 이벤트 응모 Edge Function 의 검사가 실제로 도는지 봅니다.
 *
 *   node tools/discord-entry-test.js
 *
 * 로컬에는 Deno 도 Edge Runtime 도 없습니다. Deno 전역과 fetch 만 가짜로 세우고
 * handle() 을 직접 부릅니다 — 디스코드로는 아무것도 나가지 않습니다.
 * 검사가 여기밖에 없어서(디스코드에 한 번 나가면 되돌릴 수 없습니다) 이 파일이
 * 그 자리를 대신합니다.
 */
const assert = require('assert');

let fail = 0;
const ok = (cond, what) => {
  console.log(`${cond ? '  ok  ' : '  FAIL'}  ${what}`);
  if (!cond) fail++;
};

const WEBHOOK = 'https://discord.test/api/webhooks/1/abc';
globalThis.Deno = {
  env: {
    get: k => ({
      DISCORD_WEBHOOK: WEBHOOK,
      SUPABASE_URL: 'http://sb.test',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
    }[k]),
  },
  // serve 를 두지 않으면 모듈이 서버를 띄우려 하지 않습니다.
};

/* 나간 요청을 여기 쌓아 두고 봅니다. 자리 확보(claim_event_slot)는 실제로는 DB 가
   한 문장 안에서 판정합니다 — 동시성은 이 파일이 아니라 DB 에서 확인했습니다.
   여기서는 «함수가 그 답을 어떻게 다루는가» 만 봅니다. */
let sent = [];
const OPEN = { ok: true, title: '첫 사냥 인증 이벤트', entries: 3, capacity: null };
let claim = OPEN;
let discordStatus = 200;
let lookupStatus = 200;
globalThis.fetch = async (url, opts) => {
  sent.push({ url: String(url), opts });
  if (String(url).startsWith(WEBHOOK)) return new Response('{}', { status: discordStatus });
  if (String(url).includes('release_event_slot')) return new Response('null', { status: 200 });
  return new Response(JSON.stringify(claim), { status: lookupStatus });
};
const claimed = () => sent.filter(s => s.url.includes('claim_event_slot')).length;
const released = () => sent.filter(s => s.url.includes('release_event_slot')).length;

const post = (fields) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) fd.append(k, v);
  }
  return new Request('http://fn.test/', { method: 'POST', body: fd });
};

const png = (bytes = 10) =>
  new File([new Uint8Array(bytes)], '내 사진.png', { type: 'image/png' });

const good = () => ({ event_id: '1', title: '제 첫 토벌', nickname: '보노보노', body: '잡았습니다' });

(async () => {
  const { handle } = await import('../supabase/functions/discord-entry/index.ts');
  const call = async (req) => { sent = []; const r = await handle(req); return { r, body: await r.json() }; };

  // ── 검사 ──────────────────────────────────────────────────────────
  for (const [what, patch, code] of [
    ['이벤트 번호가 없으면',     { event_id: undefined }, 'BAD_EVENT'],
    ['이벤트 번호가 숫자가 아니면', { event_id: 'abc' },   'BAD_EVENT'],
    ['제목이 비면',             { title: '  ' },         'BAD_TITLE'],
    ['제목이 너무 길면',         { title: 'ㅋ'.repeat(61) }, 'BAD_TITLE'],
    ['닉네임이 비면',            { nickname: '' },        'BAD_NICK'],
    ['닉네임이 너무 길면',        { nickname: 'ㅋ'.repeat(21) }, 'BAD_NICK'],
    ['내용이 비면',             { body: '' },            'BAD_BODY'],
    ['내용이 너무 길면',         { body: 'ㅋ'.repeat(1001) }, 'BAD_BODY'],
  ]) {
    const { r, body } = await call(post({ ...good(), ...patch }));
    ok(r.status === 400 && body.error === code, `${what} 막는다 (${body.error})`);
    ok(sent.length === 0, `${what} 디스코드로 아무것도 안 나간다`);
  }

  {
    const big = new File([new Uint8Array(9 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    const { body } = await call(post({ ...good(), image: big }));
    ok(body.error === 'IMG_TOO_BIG', '8MB 넘는 이미지를 막는다');
  }
  {
    const txt = new File(['nope'], 'x.txt', { type: 'text/plain' });
    const { body } = await call(post({ ...good(), image: txt }));
    ok(body.error === 'IMG_TYPE', '이미지가 아닌 첨부를 막는다');
  }
  /* DB 가 자리를 안 주는 네 가지. 화면의 잠긴 버튼과 별개로 여기서도 막혀야 합니다 —
     이 주소는 누구나 직접 부를 수 있고, 창을 띄워 둔 채로 이벤트가 끝나기도 합니다. */
  for (const [reason, code, what] of [
    ['NO_EVENT',    404, '없는 이벤트'],
    ['NOT_STARTED', 409, '시작 전'],
    ['ENDED',       409, '끝난 뒤'],
    ['FULL',        409, '선착순 마감'],
    ['DUP',         409, '같은 닉네임 중복 응모'],
  ]) {
    claim = { ok: false, reason };
    const { r, body } = await call(post(good()));
    ok(r.status === code && body.error === reason, `${what}에는 응모를 막는다 (${code})`);
    ok(!sent.some(s => s.url.startsWith(WEBHOOK)), `${what}에는 디스코드로 안 나간다`);
    ok(released() === 0, `${what}에는 자리를 되돌릴 일이 없다`);
  }
  claim = OPEN;
  {
    // 자리 확보 «호출» 자체가 실패한 것과 «자리를 못 준 것» 은 달라야 합니다.
    // 섞으면 설정이 틀렸을 때 응모자에게 «마감되었습니다» 로 보여 원인을 못 찾습니다.
    lookupStatus = 401;
    const { r, body } = await call(post(good()));
    ok(r.status === 502 && body.error === 'LOOKUP', '자리 확보 호출 실패는 따로 알린다');
    lookupStatus = 200;
  }
  {
    // 선착순: 자리를 «먼저» 잡고 보내야 정원을 넘지 않습니다. 순서가 뒤집히면
    // 동시에 들어온 두 사람이 둘 다 보내고 나서 세게 되어 정원을 넘깁니다.
    claim = { ok: true, title: '선착순 10명', entries: 7, capacity: 10 };
    const { body } = await call(post(good()));
    ok(claimed() === 1, '보내기 전에 자리를 먼저 잡는다');
    // 중복은 DB 가 닉네임으로 가립니다. 닉네임을 안 넘기면 아무도 못 막습니다.
    ok(JSON.parse(sent.find(s => s.url.includes('claim_event_slot')).opts.body).p_who === '보노보노',
       '자리를 잡을 때 닉네임을 같이 넘긴다');
    const iClaim = sent.findIndex(s => s.url.includes('claim_event_slot'));
    const iSend = sent.findIndex(s => s.url.startsWith(WEBHOOK));
    ok(iClaim < iSend, '자리 확보가 전송보다 «먼저» 일어난다');
    ok(body.entries === 7 && body.capacity === 10, '남은 자리를 계산할 값을 돌려준다');
    claim = OPEN;
  }
  {
    // 전송이 실패하면 잡아 둔 자리를 돌려놔야 합니다. 안 그러면 아무도 응모하지
    // 않은 자리가 영영 잠깁니다.
    discordStatus = 500;
    const { r, body } = await call(post(good()));
    ok(r.status === 502 && body.error === 'DISCORD', '전송 실패는 502 로 알린다');
    ok(released() === 1, '전송이 실패하면 잡아 둔 자리를 되돌린다');
    // 중복 표시도 같이 지워야 실패한 사람이 다시 낼 수 있습니다.
    ok(JSON.parse(sent.find(s => s.url.includes('release_event_slot')).opts.body).p_who === '보노보노',
       '되돌릴 때도 닉네임을 넘겨 중복 표시를 지운다');
    discordStatus = 200;
  }

  // ── 정상 전송 ─────────────────────────────────────────────────────
  {
    const { r, body } = await call(post({ ...good(), image: png() }));
    ok(r.ok && body.ok === true, '제대로 채우면 통과한다');
    const hit = sent.find(s => s.url.startsWith(WEBHOOK));
    ok(!!hit, '디스코드 웹훅으로 나간다');
    const out = hit.opts.body;
    const payload = JSON.parse(out.get('payload_json'));
    const em = payload.embeds[0];
    ok(em.title === '제 첫 토벌', '제목이 임베드 제목이 된다');
    ok(em.description === '잡았습니다', '내용이 임베드 본문이 된다');
    // 이벤트 이름은 클라이언트가 아니라 DB 에서 읽은 값이어야 합니다.
    ok(em.author.name.includes('첫 사냥 인증 이벤트'), '이벤트 이름은 DB 가 돌려준 값을 쓴다');
    ok(em.footer.text.includes('보노보노'), '닉네임이 붙는다');
    // 첨부 참조가 실제 올린 파일 이름과 같아야 그림이 붙습니다.
    const fileName = out.get('files[0]').name;
    ok(em.image.url === `attachment://${fileName}`, `첨부 참조가 파일 이름과 맞는다 (${fileName})`);
    ok(!/[^\x20-\x7e]/.test(fileName), '파일 이름에 한글·공백이 남지 않는다');
    ok(payload.allowed_mentions.parse.length === 0, '@everyone 을 울리지 않는다');
  }
  {
    // 이미지가 없으면 image 키 자체가 없어야 합니다(빈 값이면 임베드가 깨집니다).
    const { body } = await call(post(good()));
    ok(body.ok === true, '이미지 없이도 응모된다');
    const payload = JSON.parse(sent.find(s => s.url.startsWith(WEBHOOK)).opts.body.get('payload_json'));
    ok(!('image' in payload.embeds[0]), '이미지가 없으면 image 를 넣지 않는다');
  }
  {
    // jpeg 는 확장자를 jpg 로 고칩니다 (image/jpeg 를 그대로 쓰면 entry.jpeg 가 됩니다).
    const jpg = new File([new Uint8Array(4)], 'a.jpg', { type: 'image/jpeg' });
    await call(post({ ...good(), image: jpg }));
    ok(sent.find(s => s.url.startsWith(WEBHOOK)).opts.body.get('files[0]').name === 'entry.jpg',
       'jpeg 확장자를 jpg 로 맞춘다');
  }
  // ── 그 밖 ─────────────────────────────────────────────────────────
  {
    const r = await handle(new Request('http://fn.test/', { method: 'OPTIONS' }));
    ok(r.headers.get('Access-Control-Allow-Origin') === '*', 'OPTIONS 프리플라이트를 받는다');
  }
  {
    const r = await handle(new Request('http://fn.test/', { method: 'GET' }));
    ok(r.status === 405, 'GET 은 거부한다');
  }
  {
    /* 되돌아온 요청은 세지 않습니다 — 선착순이 열리기 직전에 «시작 전» 을 여러 번 받은
       사람이 정작 열리는 순간 잠기면 안 됩니다. 여기서 30번을 튕겨도 그 뒤 응모는
       멀쩡히 되어야 합니다. */
    claim = { ok: false, reason: 'NOT_STARTED' };
    for (let i = 0; i < 30; i++) await call(post(good()));
    claim = OPEN;
    const { r } = await call(post(good()));
    ok(r.ok, '튕긴 요청은 횟수에 안 쌓인다 (시작 직전에 여러 번 눌러도 안 잠긴다)');

    // 반대로 «실제로 나간» 것은 셉니다.
    let blocked = false;
    for (let i = 0; i < 12 && !blocked; i++) {
      const { r: r2 } = await call(post(good()));
      if (r2.status === 429) blocked = true;
    }
    ok(blocked, '같은 IP 가 너무 자주 «보내면» 막는다');
  }

  console.log(fail ? `\n${fail}건 실패` : '\n모두 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
