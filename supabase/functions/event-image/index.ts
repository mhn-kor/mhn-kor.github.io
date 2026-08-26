/* 이벤트 이미지 올리기 → Supabase Storage (event-img 버킷)
 *
 * 브라우저가 Storage 에 직접 올리게 두면 안 됩니다. 쓰기를 anon 에게 여는 순간
 * 누구나 스크립트로 1GB(무료 플랜 전체)를 채울 수 있고, 막을 방법이 버킷 비우기밖에
 * 없습니다. 그래서 올리기 전에 여기서 마스터 비밀번호를 확인합니다 — 이벤트를 여는
 * 사람(운영자)만 그림을 올릴 수 있습니다.
 *
 * 성공하면 공개 주소를 돌려주고, event.js 가 그 주소를 add_event 의 p_image_url 로
 * 넘깁니다. 이벤트를 지워도 그림은 남습니다 — 무료 1GB 에 3MB 씩 300장이 들어가므로
 * 몇 년 치입니다. 차면 대시보드 → Storage → event-img 에서 옛것을 지우세요.
 *
 * 배포:
 *   supabase functions deploy event-image --no-verify-jwt
 *
 * --no-verify-jwt 가 필요한 이유는 discord-entry 와 같습니다 — 이 프로젝트의 공개 키는
 * sb_publishable_… 이라 JWT 가 아니고, 검증을 켜 두면 전부 거부됩니다.
 */

const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
/* 이 키는 «절대» 응답에 실어 보내지 않습니다 — 여기서만 씁니다. */
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';

const BUCKET = 'event-img';
const IMG_MAX = 3 * 1024 * 1024;             // storage.buckets 의 file_size_limit 와 같아야 합니다
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

/* 마스터 확인은 bcrypt(cost 12)라 한 번에 ~0.1초의 DB 시간을 씁니다. 스크립트로
   두들기며 비밀번호를 맞춰 보는 것을 여기서 늦춥니다. discord-entry 와 같은
   인스턴스 메모리 창이라 아이솔레이트가 재활용되면 그만큼 샙니다 — 그 정도면 됩니다. */
const RATE_MAX = 10;                         // 한 IP 가 10분에 시도할 수 있는 횟수
const RATE_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();
function overLimit(ip: string): boolean {
  const seen = (hits.get(ip) ?? []).filter((t) => Date.now() - t < RATE_MS);
  seen.push(Date.now());
  hits.set(ip, seen);
  if (hits.size > 5000) hits.clear();
  return seen.length > RATE_MAX;
}

/* Authorization 은 레거시 키(JWT)일 때만 붙입니다 — discord-entry 의 rpc() 와 같은 이유. */
const sbHeaders = () => ({
  apikey: SB_KEY,
  ...(SB_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SB_KEY}` } : null),
});

/* 검사가 전부 이 안에 있고 로컬에는 Edge Runtime 이 없어, 함수로 빼 두면 node 로
   부를 수 있습니다 — tools/event-image-test.js 를 보세요. */
export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHOD' }, 405);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'BAD_FORM' }, 400);
  }

  const master = String(form.get('master') ?? '');
  const image = form.get('image');
  if (!master) return json({ error: 'BAD_MASTER' }, 403);
  if (!(image instanceof File) || image.size === 0) return json({ error: 'NO_IMAGE' }, 400);
  if (image.size > IMG_MAX) return json({ error: 'IMG_TOO_BIG' }, 400);
  if (!IMG_TYPES.includes(image.type)) return json({ error: 'IMG_TYPE' }, 400);

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',').pop()?.trim() || 'unknown';
  if (overLimit(ip)) return json({ error: 'TOO_MANY' }, 429);

  const cr = await fetch(`${SB_URL}/rest/v1/rpc/check_master`, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_master: master }),
  });
  if (!cr.ok) {
    console.error('check_master', cr.status, await cr.text());
    return json({ error: 'LOOKUP' }, 502);
  }
  if ((await cr.json()) !== true) return json({ error: 'BAD_MASTER' }, 403);

  /* 올린 이름은 버립니다 — 한글·공백이 섞이면 주소가 지저분해지고, 겹치면 덮어씁니다. */
  const ext = image.type === 'image/jpeg' ? 'jpg' : image.type.split('/')[1];
  const name = `${crypto.randomUUID()}.${ext}`;
  const up = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${name}`, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Content-Type': image.type },
    body: await image.arrayBuffer(),
  });
  if (!up.ok) {
    console.error('storage', up.status, await up.text());
    return json({ error: 'STORAGE', status: up.status }, 502);
  }

  return json({ ok: true, url: `${SB_URL}/storage/v1/object/public/${BUCKET}/${name}` });
}

// 시험할 때는 handle 만 부릅니다. 서버는 여기서만 뜹니다.
if (typeof Deno.serve === 'function') Deno.serve(handle);
