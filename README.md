# 몬스터헌터 나우 한국지부

공지사항 + 친구 코드 QR 게시판. 빌드 없는 정적 사이트라 GitHub Pages에 그대로 올라갑니다.

```
index.html   공지 / 친구 코드 두 탭
style.css
app.js       ← Supabase 설정은 이 파일 맨 위 2줄
favicon.svg  로고 겸 파비콘
vendor/      qrcode-generator (MIT)
assets/      공지용 인증 예시 이미지
tools/       QR 스캔 회귀 테스트 (선택)
```

친구 코드 12자리를 넣어 아래 딥링크를 만들고, 그 URL을 QR로 그립니다.

```
https://monsterhunternow.com/?dl=mhnow:///ADDFRIEND?FRIEND_ID=<12자리>&c=Magellan%20Start&pid=QR_code&af_xp=qr&shortlink=9p8v9m93&source_caller=ui
```

## 1. Supabase (무료 플랜)

SQL Editor에 그대로 붙여넣으세요.

```sql
create table public.friend_codes (
  id         bigint generated always as identity primary key,
  nickname   text        not null check (char_length(btrim(nickname)) between 1 and 20),
  code       text        not null unique check (code ~ '^[0-9]{12}$'),
  created_at timestamptz not null default now()
);

create index on public.friend_codes (created_at desc);

alter table public.friend_codes enable row level security;

-- 누구나 읽고 추가할 수 있게. 수정/삭제는 대시보드에서만 (정책 없음 = 거부).
create policy "public read"   on public.friend_codes for select to anon using (true);
create policy "public insert" on public.friend_codes for insert to anon with check (true);

grant select, insert on public.friend_codes to anon;
```

검증은 DB의 `check` 제약이 최종 방어선입니다. 브라우저 검사는 우회할 수 있으니 위 제약을 지우지 마세요.

그다음 **Project Settings → API** 에서 값을 복사해 `app.js` 맨 위를 채웁니다.

```js
const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

`anon` 키는 공개용이라 커밋해도 됩니다. 실제 보호는 위 RLS 정책이 합니다.

> 설정 전에는 **체험 모드**로 동작합니다 — 등록한 코드가 그 브라우저에만 저장되어 UI를 바로 확인할 수 있습니다.

## 2. GitHub Pages

저장소에 push → **Settings → Pages → Source: Deploy from a branch → main / (root)**.
빌드 단계가 없으니 몇 초 뒤 바로 열립니다.

## 알아두면 좋은 것

- **체크 상태는 서버에 없습니다.** 방문자 기기의 `localStorage`에만 남습니다. 내가 이미 추가한 사람을 가리는 용도라 사람마다 달라야 맞습니다.
- 목록은 최신 300개만 불러옵니다 (`app.js`의 `LIMIT`).
- QR은 화면에 들어올 때 만듭니다. 한 장에 ~9ms라 전부 미리 만들면 3초가 멈춥니다.
- 도배가 생기면: 대시보드에서 행을 지우고, 그래도 계속되면 insert 정책을 끄고 Edge Function + Turnstile을 앞에 두세요.
- 공지의 인증 예시 이미지는 440px로 줄여 넣었습니다 (4.5MB → 353KB).

### 레이아웃을 건드렸다면 QR 스캔 테스트를 돌려보세요

카드가 QR 원본보다 작아지면 축소 과정에서 모듈이 뭉개져 **눈에는 멀쩡한데 스캔이 안 됩니다.**
실제로 모바일 2열 배치가 이 문제로 디코딩 0/6이 나와 1열로 바꿨습니다.

```bash
python3 -m http.server 8899          # 다른 터미널에서
npm i -D playwright jsqr && npx playwright install chromium
node tools/qr-scan-test.js
```

데스크톱·태블릿·폰 5개 화면에서 렌더된 픽셀을 직접 디코딩해 딥링크와 일치하는지 확인합니다.
