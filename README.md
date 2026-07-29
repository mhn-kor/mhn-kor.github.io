# 몬스터헌터 나우 한국지부

공지사항 + 친구 코드 QR 게시판. 빌드 없는 정적 사이트라 GitHub Pages에 그대로 올라갑니다.

```
index.html   공지 / 친구 코드 두 탭
style.css
app.js       ← Supabase URL + publishable 키, 이 파일 맨 위 2줄
favicon.svg  로고 겸 파비콘
vendor/      qrcode-generator (MIT)
assets/      공지용 인증 예시 이미지
tools/       QR 스캔 회귀 테스트 (선택)
```

친구 코드 12자리를 넣어 아래 딥링크를 만들고, 그 URL을 QR로 그립니다.

```
mhnow:///ADDFRIEND?FRIEND_ID=<숫자 12자리>
```

앱이 직접 가로채는 커스텀 스킴이라 앱이 설치돼 있어야 열립니다.
QR 모듈 수가 URL 길이에 따라 달라지므로, `qrURL()` 이 표시 크기보다 원본이 항상 크도록
셀 크기를 역산합니다. **URL 형식을 또 바꾸면 `tools/qr-scan-test.js` 를 꼭 돌려보세요.**

## 1. Supabase (무료 플랜)

[`supabase/schema.sql`](supabase/schema.sql) 을 열어 통째로 복사한 뒤,
대시보드 → **SQL Editor** 에 붙여넣고 **Run**. 여러 번 실행해도 안전하고,
이미 데이터가 있는 테이블에 다시 실행해도 됩니다. **스키마를 고칠 때마다 다시 실행하세요.**

테이블 + 인덱스 + RLS + 컬럼 권한 + 등록/삭제 함수가 한 덩어리로 들어 있습니다.

검증은 DB의 `check` 제약이 최종 방어선입니다. 브라우저 검사는 우회할 수 있으니 위 제약을 지우지 마세요.

그다음 **Project Settings → API Keys** 에서 **Publishable key** (`sb_publishable_...`)를 복사해 `app.js` 맨 위를 채웁니다.

```js
const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_...';
```

### publishable 키 vs 레거시 anon 키

새 프로젝트라면 **publishable 키를 쓰세요.** 레거시 `anon` 키(`eyJ...` JWT)도 아직 동작하지만 **2026년 말 지원 종료** 예정입니다. 둘은 동시에 사용 가능해서 나중에 갈아끼워도 됩니다.

호출 방식이 다르다는 점이 중요합니다. `app.js`의 `rest()`가 이걸 자동으로 처리합니다.

| 키 | 보내는 헤더 |
|---|---|
| `sb_publishable_...` | `apikey` **만** |
| 레거시 `anon` (`eyJ...`) | `apikey` + `Authorization: Bearer` |

publishable 키를 `Authorization: Bearer` 로 보내면 JWT로 파싱하려다 실패해 요청이 거부됩니다. 그래서 키가 `eyJ`로 시작할 때만 `Authorization`을 붙입니다 — 어느 쪽을 넣어도 그대로 동작합니다.

### 이 키를 공개 저장소에 커밋해도 되나요? — 네

publishable(구 `anon`) 키는 **공개를 전제로 설계된 키**입니다. Supabase 문서 표현으로는 "비밀을 지킬 수 없는 환경에서 동작하는 공개 구성요소를 식별하는 값"입니다.
이 키는 *어떤 앱이* 접속하는지만 알려주고, *어떤 데이터를 만질 수 있는지*는 전적으로 **RLS 정책**이 결정합니다. 위에서 RLS를 켜고 정책을 select/insert로만 제한한 게 진짜 방어선입니다.

**GitHub Actions로 빌드해서 주입해도 보안은 나아지지 않습니다.** 어떤 방식으로 넣든 그 키는 브라우저가 내려받는 JS에 그대로 들어가고, 개발자도구에서 바로 보입니다. Actions는 "커밋 없이 키를 교체하고 싶다"는 운영 편의 용도일 뿐 보안 조치가 아닙니다.

> **절대 넣지 말아야 할 것: `sb_secret_...` (= 구 `service_role`) 키.**
> 이건 RLS를 통째로 우회합니다. 브라우저·저장소·Actions 산출물 어디에도 들어가면 안 됩니다.
> Supabase 데이터 유출의 대부분은 키 노출이 아니라 RLS 미설정/오설정에서 나옵니다.

> 설정 전에는 **체험 모드**로 동작합니다 — 등록한 코드가 그 브라우저에만 저장되어 UI를 바로 확인할 수 있습니다.

## 2. GitHub Pages

저장소에 push → **Settings → Pages → Source: Deploy from a branch → main / (root)**.
빌드 단계가 없으니 몇 초 뒤 바로 열립니다.

## 알아두면 좋은 것

- **체크 상태는 서버에 없습니다.** 방문자 기기의 `localStorage`에만 남습니다. 내가 이미 추가한 사람을 가리는 용도라 사람마다 달라야 맞습니다.
- 목록은 최신 300개만 불러옵니다 (`app.js`의 `LIMIT`).
- QR은 화면에 들어올 때 만듭니다. 한 장에 ~9ms라 전부 미리 만들면 3초가 멈춥니다.
- 공지의 인증 예시 이미지는 440px로 줄여 넣었습니다 (4.5MB → 353KB).

## 삭제 비밀번호

등록할 때 받은 비밀번호로 본인 코드를 지울 수 있습니다.
카드를 **길게 누르거나(550ms) 우클릭** → 삭제 버튼 → 비밀번호 입력.

검증은 전부 DB 안에서 일어납니다. 브라우저에서 비교하면 anon 키로 REST `DELETE` 를
직접 부르는 것만으로 뚫리기 때문입니다.

| 경로 | anon 권한 |
|---|---|
| `select nickname, code, created_at` | 허용 |
| `select pw_hash` 또는 `select *` | **거부** (컬럼 권한 없음) |
| 직접 `insert` / `update` / `delete` | **거부** (테이블 권한 없음) |
| `rpc/add_friend_code` | 허용 — 비밀번호는 DB 안에서 bcrypt 해싱 |
| `rpc/delete_friend_code` | 허용 — 비밀번호 일치 시에만 삭제 |

- 비밀번호는 **평문으로 저장되지 않습니다.** `crypt(pw, gen_salt('bf', 8))` — 행마다 salt 가 달라 같은 비밀번호도 해시가 다릅니다.
- 삭제 함수는 **참/거짓만** 돌려줍니다. 비밀번호가 틀렸는지 코드가 없는지 구분해 주지 않아 목록에 없는 코드를 캐낼 수 없습니다.
- `app.js` 의 목록 조회를 `select=*` 로 바꾸면 `pw_hash` 권한이 없어 **전체 조회가 통째로 거부됩니다.** 컬럼을 명시해야 합니다.
- 비밀번호 기능 도입 전에 등록된 행은 `pw_hash` 가 비어 있어 **사이트에서 지울 수 없습니다.** 대시보드에서 직접 지우세요.
- 무차별 대입은 bcrypt cost 8(시도당 수십 ms)이 늦춰줄 뿐입니다. 짧은 숫자 비밀번호는 결국 뚫립니다 — 최소 길이를 늘리려면 `schema.sql` 의 `char_length(p_password) < 4` 와 `app.js` 의 `PW_MIN` 을 함께 고치세요.

### 스키마 테스트

보안 경로라 실제 Postgres 로 검증했습니다. Docker 가 있으면 재현 가능합니다.

```bash
docker run -d --name mhnpg -e POSTGRES_PASSWORD=pw postgres:16-alpine
docker exec mhnpg psql -U postgres -c "create schema extensions; create role anon nologin;
  grant usage on schema public, extensions to anon;"
docker cp supabase/schema.sql mhnpg:/tmp/ && docker exec mhnpg psql -U postgres -f /tmp/schema.sql
```

## 실제로 신경 써야 할 것: 무제한 insert

키 노출보다 이쪽이 진짜 위험입니다. 정책이 `insert with check (true)` 라서 누구든 스크립트로 수만 건을 밀어 넣을 수 있고, 그러면 무료 플랜 용량이 날아갑니다.
`code` 유니크 제약이 같은 코드 반복은 막아주지만, 서로 다른 코드를 찍어내는 건 못 막습니다.

지금 당장은 필요 없지만, 도배가 시작되면 SQL Editor에 이걸 붙여넣으세요. 추가 인프라 없이 DB에서 바로 막습니다.

```sql
create or replace function public.friend_codes_guard()
returns trigger
language plpgsql
security definer                    -- 읽기 정책이 바뀌어도 카운트가 동작하도록
set search_path = public, pg_temp   -- security definer 함수의 search_path 주입 방지
as $$
begin
  -- 1분에 10건 초과면 거부. 전역 카운터라 거칠지만 도배 차단에는 충분합니다.
  -- IP별로 나누려면 Edge Function + Turnstile 로 올라가야 합니다.
  if (select count(*) from public.friend_codes
       where created_at > now() - interval '1 minute') >= 10 then
    raise exception '잠시 후 다시 시도해 주세요';
  end if;
  return new;
end $$;

create trigger friend_codes_guard
  before insert on public.friend_codes
  for each row execute function public.friend_codes_guard();
```

앱에서는 이미 실패를 잡아 "등록에 실패했습니다. 잠시 후 다시 시도해 주세요."로 보여줍니다.
이미 들어온 도배는 대시보드에서 행을 지우면 됩니다.

### 레이아웃을 건드렸다면 QR 스캔 테스트를 돌려보세요

카드가 QR 원본보다 작아지면 축소 과정에서 모듈이 뭉개져 **눈에는 멀쩡한데 스캔이 안 됩니다.**
실제로 모바일 2열 배치가 이 문제로 디코딩 0/6이 나와 1열로 바꿨습니다.

```bash
python3 -m http.server 8899          # 다른 터미널에서
npm i -D playwright jsqr && npx playwright install chromium
node tools/qr-scan-test.js
```

데스크톱·태블릿·폰 5개 화면에서 렌더된 픽셀을 직접 디코딩해 딥링크와 일치하는지 확인합니다.
