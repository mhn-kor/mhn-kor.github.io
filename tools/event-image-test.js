/* 이벤트 그림 올리기 Edge Function(event-image)의 검사가 실제로 도는지 봅니다.
 *
 *   node tools/event-image-test.js
 *
 * 로컬에는 Deno 도 Edge Runtime 도 없습니다. Deno 전역과 fetch 만 가짜로 세우고
 * handle() 을 직접 부릅니다 — Storage 로는 아무것도 나가지 않습니다.
 * discord-entry-test.js 와 같은 방식입니다.
 */
let fail = 0;
const ok = (cond, what) => {
  console.log(`${cond ? '  ok  ' : '  FAIL'}  ${what}`);
  if (!cond) fail++;
};

globalThis.Deno = {
  env: {
    get: k => ({
      SUPABASE_URL: 'http://sb.test',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
    }[k]),
  },
  // serve 를 두지 않으면 모듈이 서버를 띄우려 하지 않습니다.
};

/* 나간 요청을 쌓아 두고 봅니다. 마스터 판정은 실제로는 DB(check_master)가 합니다 —
   여기서는 «함수가 그 답을 어떻게 다루는가» 만 봅니다. */
let sent = [];
let masterOk = true;
let storageStatus = 200;
globalThis.fetch = async (url, opts) => {
  sent.push({ url: String(url), opts });
  if (String(url).includes('check_master')) return new Response(JSON.stringify(masterOk), { status: 200 });
  if (String(url).includes('/storage/v1/object/')) return new Response('{}', { status: storageStatus });
  return new Response('{}', { status: 404 });
};
const uploaded = () => sent.filter(s => s.url.includes('/storage/v1/object/'));

const post = (fields, ip) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, v);
  return new Request('http://fn.test/', {
    method: 'POST', body: fd,
    headers: ip ? { 'x-forwarded-for': ip } : undefined,
  });
};
const png = () => new File([new Uint8Array(10)], '포스터.png', { type: 'image/png' });

(async () => {
  const { handle } = await import('../supabase/functions/event-image/index.ts');
  const call = async (req) => { sent = []; const r = await handle(req); return { r, body: await r.json() }; };

  for (const [what, fields, code, status] of [
    ['마스터가 비면',    { image: png() },                 'BAD_MASTER', 403],
    ['그림이 없으면',    { master: 'pw' },                 'NO_IMAGE', 400],
    ['그림이 아니면',    { master: 'pw', image: new File(['x'], 'x.txt', { type: 'text/plain' }) }, 'IMG_TYPE', 400],
    ['3MB 를 넘으면',   { master: 'pw', image: new File([new Uint8Array(3 * 1024 * 1024 + 1)], 'b.png', { type: 'image/png' }) }, 'IMG_TOO_BIG', 400],
  ]) {
    const { r, body } = await call(post(fields));
    ok(r.status === status && body.error === code, `${what} 막는다 (${body.error})`);
    ok(uploaded().length === 0, `${what} Storage 로 아무것도 안 나간다`);
  }

  {
    masterOk = false;
    const { r, body } = await call(post({ master: '틀린값', image: png() }));
    ok(r.status === 403 && body.error === 'BAD_MASTER', '마스터가 틀리면 403');
    ok(uploaded().length === 0, '마스터가 틀리면 Storage 로 안 나간다');
    masterOk = true;
  }
  {
    const { r, body } = await call(post({ master: 'pw', image: png() }));
    ok(r.status === 200 && body.ok === true, '올리기 성공');
    ok(/^http:\/\/sb\.test\/storage\/v1\/object\/public\/event-img\/[0-9a-f-]+\.png$/.test(body.url),
      `공개 주소를 무작위 이름으로 돌려준다 (${body.url})`);
    const up = uploaded()[0];
    ok(up && up.opts.headers['Content-Type'] === 'image/png', '올릴 때 파일의 MIME 을 그대로 쓴다');
  }
  {
    storageStatus = 500;
    const { r, body } = await call(post({ master: 'pw', image: png() }));
    ok(r.status === 502 && body.error === 'STORAGE', 'Storage 실패는 502 로 알린다');
    storageStatus = 200;
  }
  {
    // 같은 IP 로 두들기면 잠깁니다. 마스터 확인(bcrypt) 이 비싸므로 그 앞에서 막습니다.
    let last = null;
    for (let i = 0; i < 12; i++) last = await call(post({ master: 'pw', image: png() }, '1.2.3.4'));
    ok(last.r.status === 429 && last.body.error === 'TOO_MANY', '한 IP 의 반복 시도를 막는다');
    ok(uploaded().length === 0, '잠긴 뒤에는 Storage 로 안 나간다');
  }

  console.log(fail ? `\n실패 ${fail}건` : '\n모두 통과');
  process.exit(fail ? 1 : 0);
})();
