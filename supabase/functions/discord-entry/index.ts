/* 이벤트 응모 → 디스코드 채팅방
 *
 * 브라우저가 직접 웹훅을 부르면 안 됩니다. app.js 가 그렇듯 이 사이트의 스크립트는
 * 전부 공개라, 웹훅 주소를 넣는 순간 누구나 그 주소로 채팅방에 아무거나 쏠 수 있고
 * 막을 방법이 웹훅 삭제밖에 없습니다. 그래서 주소를 아는 곳은 여기 하나뿐입니다.
 *
 * 이미지도 여기서 그대로 흘려보냅니다 — Supabase Storage 에 두지 않습니다.
 * 응모 내용은 서버 어디에도 남지 않고 디스코드 채팅방에만 남습니다.
 *
 * 배포:
 *   supabase secrets set DISCORD_WEBHOOK='https://discord.com/api/webhooks/…'
 *   supabase functions deploy discord-entry --no-verify-jwt
 *
 * --no-verify-jwt 가 필요한 이유: 이 프로젝트의 공개 키는 sb_publishable_… 이라
 * JWT 가 아닙니다. 검증을 켜 두면 anon 키를 보내도 파싱에 실패해 전부 거부됩니다.
 */

const WEBHOOK = Deno.env.get('DISCORD_WEBHOOK') ?? '';
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
/* 선착순 자리를 잡는 함수(claim_event_slot)는 service_role 만 부를 수 있습니다.
   anon 에게 열어 두면 응모하지도 않고 claim 만 반복해 정원을 채워 버릴 수 있어서입니다.
   이름이 두 가지인 이유: 새 API 키 체계의 프로젝트는 SUPABASE_SECRET_KEY 로 들어옵니다.
   이 키는 «절대» 응답에 실어 보내지 않습니다 — 여기서만 씁니다. */
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';

const TITLE_MAX = 60;
const NICK_MAX = 20;
const BODY_MAX = 1000;
const IMG_MAX = 8 * 1024 * 1024;             // 디스코드 무료 웹훅의 첨부 상한
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/* CORS 는 브라우저에게만 거는 규칙이라 curl 은 그냥 통과합니다. 막는 일은 아래
   RATE 가 합니다. 여기서 출처를 좁혀 봐야 얻는 것이 없어 열어 둡니다. */
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

/* ponytail: 인스턴스 메모리에만 있는 창(window). 리전이 여러 개로 늘거나 아이솔레이트가
   재활용되면 그만큼 새어 나갑니다. 스크립트로 수백 건 쏘는 것을 막는 것이 목적이고,
   제대로 세려면 DB 표(ip_hash, created_at)가 필요합니다 — 응모를 서버에 안 남기기로
   했으므로 두지 않았습니다. 실제로 새는 것이 보이면 그때 표를 만드세요. */
const RATE_MAX = 5;                          // 한 IP 가 10분에 «보낼» 수 있는 응모 수
const RATE_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();
const recent = (ip: string) => (hits.get(ip) ?? []).filter((t) => Date.now() - t < RATE_MS);

/* 보기(peek)와 세기(record)를 나눈 이유가 있습니다. 되돌아온 요청까지 세면, 선착순이
   열리기 직전에 몇 번 눌러 본 사람이 «정작 열리는 순간» 잠깁니다. 선착순에서 가장
   적극적인 사람이 가장 먼저 막히는 셈이라, 기능이 있으나 마나가 됩니다.
   그래서 채팅방에 «실제로 나간» 것만 셉니다. */
const overLimit = (ip: string) => recent(ip).length >= RATE_MAX;
function recordSend(ip: string) {
  const seen = recent(ip);
  seen.push(Date.now());
  hits.set(ip, seen);
  if (hits.size > 5000) hits.clear();        // 메모리가 무한히 늘지 않게
}

/* Authorization 은 레거시 키(JWT)일 때만 붙입니다 — app.js 의 rest() 와 같은 이유로,
   새 형식 키를 Bearer 로 보내면 JWT 파싱에 실패해 요청이 통째로 거부됩니다. */
const rpc = (name: string, args: unknown) =>
  fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      ...(SB_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SB_KEY}` } : null),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });

/* Deno.serve 와 따로 두는 이유: 이 안에 검사가 전부 들어 있는데, 로컬에는 Deno 도
   Edge Runtime 도 없어 눌러 볼 방법이 없습니다. 함수로 빼 두면 node 로 부를 수
   있습니다 — tools/discord-entry-test.js 를 보세요. */
export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHOD' }, 405);
  if (!WEBHOOK) return json({ error: 'NO_WEBHOOK' }, 500);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'BAD_FORM' }, 400);
  }

  const eventId = Number(form.get('event_id'));
  const title = String(form.get('title') ?? '').trim();
  const nickname = String(form.get('nickname') ?? '').trim().replace(/\s+/g, ' ');
  const body = String(form.get('body') ?? '').trim();
  const image = form.get('image');

  if (!Number.isInteger(eventId) || eventId <= 0) return json({ error: 'BAD_EVENT' }, 400);
  if (!title || title.length > TITLE_MAX) return json({ error: 'BAD_TITLE' }, 400);
  if (!nickname || nickname.length > NICK_MAX) return json({ error: 'BAD_NICK' }, 400);
  if (!body || body.length > BODY_MAX) return json({ error: 'BAD_BODY' }, 400);

  let file: File | null = null;
  if (image instanceof File && image.size > 0) {
    if (image.size > IMG_MAX) return json({ error: 'IMG_TOO_BIG' }, 400);
    if (!IMG_TYPES.includes(image.type)) return json({ error: 'IMG_TYPE' }, 400);
    file = image;
  }

  /* 보기만 합니다. 자리를 잡기 «전» 이어야 잡아 놓고 되돌리는 일이 없습니다.
     실제로 세는 것은 전송이 끝난 뒤입니다(recordSend). */
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',').pop()?.trim() || 'unknown';
  if (overLimit(ip)) return json({ error: 'TOO_MANY' }, 429);

  /* 선착순 자리를 먼저 잡습니다. 기간·정원 판정과 «한 자리 늘리기» 가 DB 안에서 한
     문장으로 일어나므로, 두 사람이 동시에 마지막 자리를 눌러도 한 명만 통과합니다.
     반대 순서(먼저 보내고 나중에 세기)로는 정원을 넘기는 것을 막을 수 없습니다.

     이벤트 이름도 여기서 받습니다. 클라이언트가 보낸 이름을 쓰면 채팅방에 아무 이름이나
     찍힐 수 있습니다. */
  const cr = await rpc('claim_event_slot', { p_id: eventId, p_who: nickname });
  if (!cr.ok) {
    console.error('claim', cr.status, await cr.text());
    return json({ error: 'LOOKUP' }, 502);
  }
  const claim = await cr.json();
  if (!claim.ok) {
    return json({ error: claim.reason }, claim.reason === 'NO_EVENT' ? 404 : 409);
  }
  const eventTitle: string = claim.title;

  // attachment:// 는 파일 이름으로 첨부를 가리킵니다. 올린 이름을 그대로 쓰면
  // 한글·공백·따옴표가 섞여 참조가 깨지므로 확장자만 남기고 새로 짓습니다.
  const ext = file ? (file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1]) : '';
  const name = `entry.${ext}`;

  const payload = {
    embeds: [{
      title,
      description: body,
      color: 0xE9A13B,
      author: { name: `🎁 ${eventTitle}` },
      footer: { text: `응모자 ${nickname}` },
      timestamp: new Date().toISOString(),
      ...(file ? { image: { url: `attachment://${name}` } } : null),
    }],
    // 응모 내용에 @everyone 이 섞여 있어도 채팅방 전체를 울리지 않게 합니다.
    allowed_mentions: { parse: [] },
  };

  const out = new FormData();
  out.append('payload_json', JSON.stringify(payload));
  if (file) out.append('files[0]', file, name);

  const sent = await fetch(WEBHOOK + '?wait=true', { method: 'POST', body: out });
  if (!sent.ok) {
    console.error('discord', sent.status, await sent.text());
    /* 잡아 둔 자리를 돌려놓습니다. 안 돌려놓으면 아무도 응모하지 않은 자리가
       영영 잠깁니다. ponytail: 이 되돌리기 자체가 실패하면(전송 직후 함수가 죽는
       경우 포함) 한 자리가 샙니다. 정확히 하려면 응모를 표로 남기고 «보냈음» 을
       기록해야 하는데, 응모를 서버에 안 남기기로 한 설계와 맞바꾼 값입니다.
       실제로 어긋나면 대시보드에서 entries 를 손으로 고치세요. */
    await rpc('release_event_slot', { p_id: eventId, p_who: nickname }).catch(() => {});
    return json({ error: 'DISCORD', status: sent.status }, 502);
  }
  recordSend(ip);
  // 남은 자리를 돌려줍니다. 화면이 다시 받아오지 않고 그 자리에서 숫자를 고칩니다.
  return json({ ok: true, entries: claim.entries, capacity: claim.capacity });
}

// 시험할 때는 handle 만 부릅니다. 서버는 여기서만 뜹니다.
if (typeof Deno.serve === 'function') Deno.serve(handle);
