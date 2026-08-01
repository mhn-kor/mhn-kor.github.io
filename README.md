# 몬스터헌터 나우 한국지부

공지사항 + 친구 코드 QR 게시판. 빌드 없는 정적 사이트라 GitHub Pages에 그대로 올라갑니다.

```
index.html   공지 / 친구 코드 두 탭
style.css
app.js       ← Supabase URL + publishable 키, 이 파일 맨 위 2줄
material.js       재료 탭 계산·화면
material-data.js  재료 탭 데이터 (몬스터 · 레시피 · 한국어 이름)
favicon.svg  로고 겸 파비콘
vendor/      qrcode-generator (MIT)
assets/      공지용 인증 예시 이미지
tools/       QR 스캔 회귀 테스트 (선택)
dev/         로컬 미리보기용 초기화·시드·nginx 설정
docker-compose.yml   Postgres + PostgREST + nginx
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

## 캐시 — style.css / app.js 를 고치면 버전을 올리세요

GitHub Pages 는 파일마다 `Cache-Control: max-age=600` 을 붙여 **각각 따로** 캐시합니다.
그래서 새 `index.html` 과 옛 `style.css` 가 10분 동안 섞일 수 있습니다.

`index.html` 의 두 곳을 같이 올려주세요.

```html
<link rel="stylesheet" href="style.css?v=20260729">
<script src="app.js?v=20260729"></script>
```

### 터치 기기 입력칸은 16px 이상이어야 합니다

iOS 는 글자 16px **미만**인 입력칸에 포커스하면 페이지를 자동 확대하고, 그 결과 가로 스크롤이
생깁니다. `@media (pointer: coarse)` 로 입력칸·셀렉트를 16px 로 올려 막았습니다.
데스크톱은 그대로 작은 글자를 씁니다. 폭이 아니라 **터치 여부**로 걸어야 아이패드도 잡힙니다.

`viewport` 에 `user-scalable=no` 를 넣어도 막히지만, 손가락 확대까지 막혀 접근성을 해칩니다.

### 인라인 SVG 에는 width/height 를 꼭 붙이세요

`viewBox` 만 있는 SVG 는 고유 크기가 없어서, CSS 가 늦거나 캐시로 어긋나면 기본 크기(최대
300×150)로 부풀어 오릅니다. 실제로 검색 돋보기가 **183×183px** 로 나온 적이 있습니다.

`width`/`height` 속성은 CSS 보다 우선순위가 낮으므로, 붙여도 컨테이너 쿼리로 줄이는 동작은
그대로입니다 — CSS 가 없을 때만 안전망으로 작동합니다.

## 로컬 미리보기 (docker compose)

Supabase 대신 **Postgres + PostgREST** 를 띄웁니다. Supabase 의 `/rest/v1` 도 같은 PostgREST 라
스키마·권한·RLS·`Content-Range` 까지 그대로 검증됩니다. 프로덕션에 SQL 을 직접 돌리기 전에
여기서 먼저 확인하세요.

```bash
docker compose up -d      # → http://localhost:8080
docker compose down -v    # DB 까지 삭제
```

`supabase/schema.sql` 이나 `dev/03-seed.sql` 을 고쳤으면 **`down -v` 후 다시 `up`** 해야
초기화 스크립트가 다시 돕니다 (Postgres 는 데이터가 있으면 건너뜁니다).

| 포트 | 용도 |
|---|---|
| 8080 | 사이트. `/rest/v1/` 은 PostgREST 로 프록시됩니다 |
| 54321 | PostgREST 직접 (`curl http://localhost:54321/friend_codes`) |
| 54322 | Postgres (`psql -h localhost -p 54322 -U postgres`, 비번 `postgres`) |

### 시드 데이터

`dev/03-seed.sql` — 등록 비밀번호는 전부 **`test1234`**, 로컬 마스터 비밀번호는 **`devmaster`**
입니다. 실제 운영 비밀번호는 저장소에 넣지 마세요.

- 앞 3건은 4일 전으로 만들어 **끌어올리기를 바로 시험**할 수 있습니다.
- `555566667777` 은 `pw_hash` 가 없는 예전 행 재현 — 마스터키로만 지워집니다.

### app.js 를 건드리지 않는 방법

`dev/nginx.conf` 가 `index.html` 에 `window.MHNKR_API="http://localhost:8080"` 를 끼워 넣고,
`app.js` 는 그 값이 있으면 그쪽을 씁니다. 배포본에는 없으므로 그대로 Supabase 로 갑니다.
`/rest/v1/` 을 nginx 가 프록시하므로 같은 출처가 되어 CORS 설정도 필요 없습니다.

## 2. GitHub Pages

저장소에 push → **Settings → Pages → Source: Deploy from a branch → main / (root)**.
빌드 단계가 없으니 몇 초 뒤 바로 열립니다.

## 리더보드 탭

몬스터별 최속 토벌 기록입니다. 누구나 등록하고, 등록할 때 정한 비밀번호로 지웁니다
(친구 코드와 완전히 같은 방식 — 비밀번호는 DB 안에서 bcrypt 로 해싱되고 `pw_hash` 는 권한으로 막혀 있습니다).

```
supabase/schema.sql   public.records + add_record / delete_record
record.js             영상 URL 해석 · 필터 · 목록 · 등록/삭제
tools/record-test.js  URL·시간 변환 테스트 (node tools/record-test.js)
```

분류는 **난이도(★8·★9·★10) · 종류(일반 · 차원변이) · 몬스터 · 무기(스타일)** 네 가지입니다.
몬스터를 고르면 그때만 순위 번호가 붙습니다. 여러 몬스터가 섞인 목록에서 1위·2위는 뜻이 없기 때문입니다.

### 몬스터·무기는 빌드 탭 모달을 같이 씁니다

아이콘 격자(`#bd-modal` · `.bd-grid` · `.bd-gi`)는 `build.js` 것을 그대로 빌려 씁니다.
같은 격자를 한 벌 더 만들면 한쪽만 손보는 날이 옵니다. 대신 **누가 연 모달인지**를
`#bd-modal` 의 `dataset.owner` 에 적어 두고, `build.js` 와 `record.js` 의 클릭·검색 처리기가
각자 남의 차례에는 손을 뗍니다 (`bdOpen()` 이 `'build'` 로 적고, `record.js` 가 뒤에 `'record'` 로 덮어씁니다).
모달을 또 빌려 쓸 일이 생기면 owner 이름만 하나 늘리면 됩니다.

토벌 시간은 **초 단위 정수**(`records.time_sec`)로만 적습니다. 분:초도, 소수점도 받지 않습니다 —
어떤 사람은 `45`, 어떤 사람은 `45.32` 로 올리면 목록이 들쭉날쭉해집니다.

> 처음 판은 1/100초(`time_cs`)였습니다. `schema.sql` 안의 `do $$` 블록이 이미 만든 테이블을
> 초 단위로 옮겨 줍니다(값은 반올림). 여러 번 실행해도 안전하고, 새로 만드는 DB 에서는 그냥 넘어갑니다.
> `add_record` 는 인자 «이름»이 바뀌어 `create or replace` 가 거부하므로 앞에서 한 번 `drop` 합니다.

닉네임칸은 **추천빌드 등록창과 똑같은 자동완성**을 씁니다 — `app.js` 의 `nickAuto(입력칸, 목록, 힌트)`.
두 글자쯤 치면 친구 코드에서 `ilike` 로 찾아 최대 8개를 띄우고, 고르면 "친구 코드에 등록된 닉네임입니다"
힌트가 붙습니다. 마지막에 쓴 이름은 `mhnkr.nick` 에 남아 다음 등록창에 미리 채워집니다(두 탭 공용).

`<datalist>` 를 쓰지 않은 이유: 위치도 너비도 브라우저가 정해 버려 입력칸과 어긋나 보이고,
포커스만 해도 목록 전체를 쏟아냅니다. 대신 직접 그리므로 키보드 조작(↑↓ Enter Esc)도 직접 답니다.
같은 위젯이 두 곳에서 도니 **고칠 일이 생기면 `nickAuto` 한 곳만** 보면 됩니다.

### 영상은 주소만 넣으면 됩니다

유튜브(숏츠 · 일반 · youtu.be)와 X(트위터) 주소를 받아 **아래 두 형태 중 하나로 정규화해서 저장**합니다.

```
https://www.youtube.com/watch?v=<11자>
https://x.com/i/status/<숫자>
```

이래야 같은 영상을 숏츠 주소와 단축 주소로 각각 올리는 것을 `unique` 하나로 막을 수 있고,
스키마의 `CHECK` 가 곧 화이트리스트가 됩니다.

목록은 **세로(9:16) 썸네일 갤러리**이고, 카드를 누르면 **크게 보기 창**에서 재생합니다
(창 안에서 `← 이전 / 다음 →` 과 좌우 화살표키로 지금 걸린 필터 안을 넘길 수 있습니다).
iframe 은 창을 열 때만 만들고 닫을 때 걷어냅니다 — 목록에 플레이어를 여러 개 깔면 스크롤이 버벅이고,
닫은 뒤에도 남겨두면 뒤에서 소리가 계속 납니다.

유튜브 썸네일(`hqdefault.jpg`)은 4:3 안에 세로 영상이 좌우 검은 띠와 함께 들어 있는데,
9:16 칸에 `object-fit: cover` 로 넣으면 그 띠가 **정확히** 잘려 원본 화면만 남습니다
(4:3 을 9:16 으로 채우면 배율이 딱 맞아떨어집니다). X 임베드는 제 높이를 알려주지 않아 CSS 로 고정해 두었습니다.

`rkVid` / `rkCanon` / `rkParse` 를 고쳤다면 `node tools/record-test.js` 를 꼭 돌려보세요.
여기서 통과하면 DB 의 `CHECK` 도 통과합니다(같은 정규식을 테스트가 그대로 갖고 있습니다).

### 기록 하나를 가리키는 링크 — `?rec=<id>#record`

크게 보기 창의 **카카오톡 · 링크 복사** 가 이 주소를 만듭니다. 그 주소로 들어오면
`rkOpenFromUrl()` 이 목록을 받아온 직후 해당 기록의 크게 보기를 바로 엽니다(한 번만).

카카오 SDK 준비(`bdKakaoReady`)와 링크 복사(`bdCopyLink`), 배포 절대 주소(`BD_BASE`)는
**빌드 탭 것을 그대로 빌려 씁니다** — 같은 일을 두 벌 두면 키를 바꿀 때 한쪽만 낡습니다.
카드 그림은 유튜브 썸네일을 그대로 쓰고, X 기록처럼 썸네일이 없으면 사이트 og 이미지로 갑니다.
빌드용 리스트 템플릿(`KAKAO_TEMPLATE_ID`)은 방어구 5줄짜리라 영상에는 안 맞아 `feed` 를 씁니다.
카카오 키도 공유 시트도 없는 PC 에서는 링크 복사로 떨어집니다(붙여넣으면 카톡이 og 로 카드를 만듭니다).

### 추천 빌드로 이어지는 자리

`records.build` 에 **빌드 탭 공유 링크의 `?build=` 뒤쪽**을 그대로 담습니다(`build.js` 의 `bdShareParam`).
값이 있으면 카드에 `빌드 보기` 버튼이 붙어 그 빌드가 열립니다.
나중에 추천 빌드를 만들 때는 이 컬럼(또는 `records.id`)으로 영상과 빌드를 이으면 됩니다.

## 랭킹 탭

리더보드에 올라온 기록을 몬스터별로 접어 **1 · 2 · 3위에 금 · 은 · 동 왕관**을 답니다.
한 줄이 몬스터 하나이고, 왼쪽에 몬스터, 오른쪽에 **일반 · 차원변이가 나란히** 섭니다.

```
index.html   #panel-rank (칩·목록은 JS 가 그립니다)
record.js    rkOrder / rkKey / rkGroup / rkTopMap · rnUI / rnRender / rnRow / rnCol / drawRank
```

**파일을 따로 두지 않았습니다.** 랭킹은 리더보드와 *같은 목록을 다르게 접은 것*뿐이라
영상 해석·시간 표기·크게 보기·몬스터 이름을 전부 record.js 에서 그대로 씁니다.
새 파일로 떼면 그 여섯 가지가 두 벌이 됩니다.

### 한 «판» 은 몬스터 · 난이도 · 종류입니다 — `rkKey`

★8 일반과 ★10 차원변이는 같은 사냥이 아니라 한 줄에 세울 수 없습니다.
DB 인덱스(`records_board_idx`)도 같은 조합입니다.

그래서 랭킹 탭은 **난이도만 고르고**(«전체»가 없습니다 — 기본 ★10, `rnF` 한 줄이라 바꾸기 쉽습니다),
**일반과 차원변이는 한 줄 안에 두 칸으로 같이 폅니다**(`rnCol`). 나란히 두는 건 보기 편해서일 뿐,
두 칸은 서로 다른 판이라 왕관도 각자 1 · 2 · 3위를 셉니다.

남는 축이 몬스터뿐이라 **모든 몬스터를 한 줄씩** 세울 수 있습니다 — 기록이 없는 몬스터도
흐리게 자리를 지키고, 고룡은 재료 탭처럼 아래에 따로 섭니다(`MATERIAL.monsters[].group === 'elder'`).

### 고룡은 ★8 · 일반뿐입니다

고룡은 **차원변이가 없고, ★6 과 ★8 만 있으며 ★8 이 가장 높습니다.** 최속 기록은 최고 난이도에서만
뜻이 있으므로 ★6 은 아예 받지 않습니다(`RK_ELDER_STAR`).

* **등록창**은 고룡을 고르는 순간 난이도를 ★8 하나로, 종류를 «일반» 하나로 줄입니다(`rkFormLabels`).
  화면에서 감추기만 하면 잘못 고른 기록이 그대로 올라갑니다 — 목록에서 빼야 막힙니다.
* **랭킹**의 고룡 줄은 **난이도 칩을 타지 않습니다**(`rnStar`). ★10 을 보고 있다고 고룡이 통째로
  비면 «아직 기록이 없다»로 잘못 읽힙니다. 그래서 판을 묶을 때 `rkRows` 전체를 묶어 두고
  줄마다 제 난이도로 꺼내 씁니다(건수도 화면에 깔린 것만 셉니다).
* 차원변이 칸은 고룡 줄에 세우지 않습니다. 단, **옛 기록이 남아 있으면 그 줄에서만 다시 나옵니다** —
  있는 데이터를 조용히 숨기지는 않습니다.
기록이 있는 몬스터가 위로 올라오고, 그 안에서는 게임 순서 그대로입니다.
줄 세우기는 **«있다/없다»로만** 가릅니다 — 건수로 세우면 3건짜리가 1위 기록이 더 빠른 줄보다 위로 갑니다.

### 같은 시간이면 먼저 올린 쪽이 위입니다 — `rkOrder`

정렬 규칙은 `rkOrder` **한 곳**에만 있습니다(시간 → 등록 시각 → id).
서버 요청의 `order=time_sec.asc,created_at.asc` 도 같은 규칙입니다 —
`limit` 이 걸려 있어 **자르는 기준을 서버도 알아야** 하기 때문입니다.
시간도 시각도 같으면 `id` 로 갈라 순서를 못 박습니다. 안 그러면 그릴 때마다 1위가 바뀝니다.

### 왕관은 필터를 타지 않습니다

`rkTopMap` 이 «기록 id → 그 판에서의 순위»를 데이터가 바뀔 때만 한 번 셉니다.
그래서 **리더보드 카드 왼쪽 위의 왕관**은 무엇을 걸러 보든 같은 카드에 같은 색으로 붙습니다.
(카드의 숫자 뱃지는 지금 보고 있는 판 안에서의 번호라 뜻이 다릅니다 — 왕관이 있으면 왕관이 이깁니다.)

카드 위에서는 **숫자를 CSS 로 감춥니다**(`.rk-play .rk-crown b`) — 금·은·동 색이 곧 등수라
숫자가 겹칩니다. 마크업은 한 벌이라 `title="1위"` 는 그대로 남아 읽어주는 기기에는 들립니다.
랭킹 탭은 줄이 촘촘해 숫자를 남깁니다.

목록은 먼저 연 탭이 받아오고 다른 탭은 그 약속(`rkReady`)을 기다립니다. 두 번 받지 않습니다.
랭킹에서 이름을 누르면 리더보드의 크게 보기가 **그 판 전체**를 끼고 열려, 창 안의 이전/다음이 4위·5위로 이어집니다.

`rkOrder` / `rkKey` / `rkGroup` / `rkTopMap` 을 고쳤다면 `node tools/record-test.js` 를 꼭 돌려보세요.

## 추천 빌드 탭의 댓글

```
supabase/schema.sql   public.recommended_comments
                      + recommended_comments_public (pw_hash 뺀 읽기 전용 뷰)
                      + add_recommended_comment / delete_recommended_comment
recommend.js          rcCmOpen / rcCmDraw · 등록 · 삭제
```

댓글은 **미리보기 창 안**에 있습니다. 카드에는 `💬 N` 개수만 붙고, 누르면 그 창이 열립니다.
목록에서 여러 개를 펼치면 스크롤이 걷잡을 수 없이 길어지기 때문입니다.

개수(`comments`)는 `recommended_ranked` 뷰가 같이 세어 내려줍니다 — 따로 부르면 목록 요청이
두 번이 됩니다. `create or replace view` 는 **맨 뒤에 컬럼 추가만** 허용하므로 새 컬럼은 항상
`select` 목록 끝에 붙이세요.

답글(대댓글)은 없습니다. 한두 줄짜리 반응이 대부분이라 필요해지면 `parent_id` 한 컬럼을
얹으면 됩니다.

삭제 창은 **빌드 삭제 창(`#rc-del`)을 같이 씁니다.** 묻는 것도(비밀번호) 규칙도 같아서
창을 하나 더 두면 마크업만 두 벌이 됩니다 — `rcDelKind` 로 부를 함수만 갈립니다.

> 스키마를 고쳤으니 **Supabase SQL Editor 에 `supabase/schema.sql` 을 다시 실행하세요.**
> 안 하면 목록 조회가 `comments` 컬럼을 찾지 못해 추천빌드 탭이 통째로 비어 보입니다.

## 재료 탭

몬스터 · 무기/방어구 · 현재 등급 → 목표 등급을 고르면 그 구간의 강화 재료와 제니를 합산합니다.
데이터는 [mhnow.me/material](https://mhnow.me/material?lang=ko) 의 공개 데이터에서 뽑아 `material-data.js` 에 넣었습니다.

```
material-data.js   monsters(67) · catalog · recipes · names(한국어) · parts · biomes
material.js        matTotals() 계산 + 화면 그리기
assets/material/   재료 아이콘 147개 (제니 동전 포함, 64px 로 줄였습니다. 원본은 200px·30KB → 4MB)
assets/monster/    고룡 8종 아이콘 추가 (표류연성 탭이 쓰던 59개는 그대로 재사용)
assets/biome/      출현 구역 아이콘 4개 (삼림 · 사막 · 늪지 · 설원)
tools/build-materialdata.js   위 셋을 다시 만드는 스크립트
tools/material-test.js        계산 회귀 테스트
```

출처가 둘입니다. **재료·레시피·이름은 mhnow.me**, **출현 구역은 [mhn.quest](https://mhn.quest)** 입니다
(mhnow.me 에는 구역 정보가 없습니다). mhn.quest 의 몬스터 키가 표류연성 탭 아이콘 키와 같아서 그대로 이어지고,
고룡만 `QUEST_KEY` 로 짝지어 줍니다. 같은 자리에 약점 속성(`weakness`)도 들어 있으니 필터를 늘릴 때 쓰면 됩니다.

### 계산 규칙 — 여기만 이해하면 됩니다

- 강화 단계는 `제작 전(0_0)` → `G1-1` … `G10-5` 로 51칸입니다. **현재 등급 다음 칸부터 목표 등급까지** 더합니다.
- 현재 등급이 그 몬스터의 **제작 등급보다 낮으면 제작 비용을 넣고**, 제작 등급 다음 칸부터 이어 더합니다.
  (안쟈나프는 G4 부터라 G1~G3 버튼이 잠깁니다.)
- 레시피의 칸 이름(`r1_1`, `r3_2` …)은 몬스터의 `commons` 로 실제 재료가 됩니다. 몬스터가 그 칸을 안 가지면
  `catalog` 의 `fb`(뾰족한 발톱 · 제련 소재 · 용옥 조각)로 대체됩니다.
- 몬스터 전용 소재는 `exclusive[i]` 의 순서가 곧 희귀도(R1~R6)입니다. R1 과 무기/방어구가 갈리는 칸만
  `_w` / `_a` 로 나뉩니다.
- 예외 규칙은 `craft` → 그룹(`rare` · `sub` · `elder`) → 몬스터 id 순으로 덮어씁니다.
  희소종과 고룡은 제니가 수십 배 비쌉니다.

### 게임이 패치돼서 몬스터가 늘었다면

`node tools/update.js` 하나로 빌드 탭까지 같이 맞춥니다 — 아래 **게임 패치로 몬스터·장비가
늘었다면** 절을 보세요. 재료만 다시 만들려면:

```bash
node tools/build-materialdata.js     # material-data.js + 새 아이콘만 받아옵니다
node tools/material-test.js          # 계산이 안 깨졌는지 확인 (필수)
```

빌드 스크립트는 mhnow.me 의 스크립트를 **브라우저 흉내를 낸 node 샌드박스에서 실행해** 데이터를 꺼냅니다.
난독화되어 있지만 데이터는 그냥 상수라 그대로 나옵니다. 이미 있는 아이콘 파일은 건너뛰니 여러 번 돌려도 안전합니다.
새 몬스터의 아이콘이 저장소에 없으면 `NAME_FIX` / `FETCH_MONSTER` 를 채우라고 알려줍니다.

테스트는 원본 사이트가 같은 조건에서 내놓은 표본 14건(제작부터 만렙 / 아종·희소종·고룡 / 한 단계만)과
대조하고, 재료 이름과 아이콘 파일이 빠지지 않았는지도 함께 봅니다. 의존성 없이 node 만으로 돕니다.

> 제니 값은 원본 사이트의 데이터를 그대로 씁니다. 일반 몬스터는 강등급이 올라가는 칸(G5-1, G6-1 …)에만
> 제니가 붙어 있고 소단계는 0 입니다. 희소종·고룡은 칸마다 붙어 있어 총액이 수십 배입니다.

## 게임 패치로 몬스터·장비가 늘었다면

```bash
node tools/update.js          # 이거 하나면 됩니다
```

빌드 탭·재료 탭·아이콘을 한 번에 맞춥니다. 끝나면 무엇이 몇 개 늘었는지 보여 주고,
바뀐 게 있으면 `index.html` 의 `?v=` 를 올리라고 알려 줍니다 (**안 올리면 방문자가
열 시간 동안 옛 파일을 봅니다** — 위의 캐시 절 참고).

돌린 뒤에는 브라우저에서 **빌드 탭에서 새 몬스터의 무기·방어구가 보이는지**,
**재료 탭에 새 몬스터가 있는지** 눈으로 확인하고 커밋하세요.

| 옵션 | 언제 |
|---|---|
| `--all` | 장비 이름이 바뀌었을 때 (평소엔 새 것만 받습니다) |
| `--skip-material` | 재료 탭은 그대로 두고 빌드만 고칠 때 |

### 무엇이 어디서 오는가

| 자료 | 출처 | 만드는 것 |
|---|---|---|
| 장비 스킬·표류석 칸·공격력 곡선 | mhn.quest 번들 | `build-data.js` |
| 장비 한국어 이름, 방어구 나열 순서 | monsterhunternow.com | `tools/data/official-names.json` |
| 스킬 레벨별 설명(=점수 계산의 근거) | monsterhunternow.com | `skill-desc.js` |
| 몬스터 아이콘 | mhnow.me | `assets/monster/*.png` |
| 재료·서식지 | mhnow.me + mhn.quest | `material-data.js`, `assets/material/*.png` |

두 사이트의 키가 달라 **영문 몬스터 이름을 다리로 이어 붙입니다.** 그래서
`tools/data/monster-en.json`(자동 생성)이 아이콘 주소를 만드는 데 쓰입니다.

`tools/data/wextra.json` 만 손으로 관리합니다 — 탄·병·포격 이름표라 게임 패치와
거의 무관합니다.

무기 스킬은 대개 소재 공통이라 세트의 `weaponSkills` 에 한 벌만 둡니다. 다만
바젤기우스·이블조처럼 **종류마다 스킬이 다른 소재**가 있어, 그런 무기는 자기 스킬을
`weapons[].sk` 로 따로 들고 옵니다(공통에 더하는 게 아니라 통째로 갈음합니다).
화면에서는 `build.js` 의 `bdWSkills()` 가 둘을 가려 씁니다.

### 단계별로 돌리고 싶다면

```bash
node tools/fetch-official.js                                   # 이름·순서
node tools/build-skilldesc.js tools/data/skill-urls.json > skill-desc.js
node tools/build-builddata.js > build-data.js                  # 인자 없음
node tools/fetch-icons.js                                      # 빠진 아이콘만
node tools/build-materialdata.js && node tools/material-test.js
node tools/build-test.js                                       # 무기 스킬 회귀 (필수)
```

순서에 이유가 있습니다. `build-builddata.js` 는 스킬 최대 레벨을 `skill-desc.js` 에서,
방어구 나열 순서를 `official-names.json` 의 키 순서에서 읽습니다. `fetch-icons.js` 는
`build-data.js` 를 보고 빠진 아이콘을 찾습니다.

### 잘 안 될 때

- **`mhn.quest 번들을 찾지 못했습니다`** — 그 사이트 구조가 바뀐 것입니다.
  `tools/build-builddata.js` 의 `fetchBundle()` 이 `B8={` 와 `K7={` 이 같이 든
  스크립트를 찾습니다. 번들을 손으로 받았다면 `MHNKR_BUNDLE=경로` 로 넘기세요.
- **아이콘을 못 받음** — 이벤트 장비는 참조 사이트에도 그림이 없습니다.
  그 키를 `build.js` 의 `BD_NOICON` 에 넣으면 이벤트 표류석 아이콘으로 대신 나옵니다.
- **새 이벤트 무기가 전 종류(14종)로 나옴** — 이벤트 무기는 제작비용 표에 종류가
  적혀 있을 때만 좁힐 수 있습니다. 표가 없으면(재료 미상) 게임에서 확인한 값을
  `tools/build-builddata.js` 의 `EVENT_WEAPONS` 에 직접 적으세요.
- **새 스킬이 점수에 안 들어감** — 설명 문장을 읽어 계산하므로, 문장 형태가 새로우면
  `build.js` 의 `bdEffects()` 에 규칙을 하나 더해야 합니다. 조건이 붙은 스킬은
  일부러 빼고 화면에서 켜고 끄게 되어 있습니다.

## 알아두면 좋은 것

- **체크 상태는 서버에 없습니다.** 방문자 기기의 `localStorage`에만 남습니다. 내가 이미 추가한 사람을 가리는 용도라 사람마다 달라야 맞습니다.
### 닉네임 검색

툴바 오른쪽 입력칸. **서버에서** `nickname=ilike.*검색어*` 로 겁니다 — 받아온 200개
안에서만 걸면 아직 안 받은 코드가 안 잡힙니다. 300ms 디바운스에 직렬화까지 걸어
입력이 겹쳐도 목록이 섞이지 않습니다.

- 한글 부분일치 · 영문 대소문자 무시 · 공백/쉼표/슬래시 포함 모두 실제 API 로 확인했습니다.
- `encodeURIComponent` 는 `*` 를 남겨두므로 PostgREST 와일드카드로 그대로 동작합니다.
  값을 큰따옴표로 감싸면 오히려 0건이 되니 감싸지 마세요.
- 검색 중에도 **선택한 필터가 그대로 적용됩니다.** 이미 체크한 사람을 찾으면 '미체크만'
  상태에서 0건이 되므로, 그때는 "N명이 있지만 '미체크만' 에 해당하지 않습니다" 로 이유를 알려줍니다.

### 무한스크롤: 서버 200개씩, 화면 20개씩

`FETCH = 200`(서버) / `PAGE = 20`(화면) / `MAX = 1000`(세션 상한).

- **키셋 커서**(`created_at=lt.…`)로 끊어 옵니다. `offset` 방식은 끌어올리기로 순서가 바뀌는
  순간 행이 중복되거나 통째로 건너뛰어집니다.
- **필터를 먼저 걸고 나서 자릅니다.** 체크 여부는 기기 localStorage 에만 있어 서버는 무엇이
  미체크인지 모릅니다. 그냥 200개를 받아 그리면, 최신 400건을 이미 체크한 사람은 화면이 비고
  스크롤할 내용이 없어 다음 요청이 **영영 걸리지 않습니다**. `ensure()` 가 그릴 게 생길 때까지
  (또는 서버가 바닥날 때까지) 이어서 받아 이 교착을 막습니다.
- 전체 개수는 `Prefer: count=exact` 응답의 `Content-Range` 에서 읽습니다. Supabase 가
  `Access-Control-Expose-Headers` 로 열어두기 때문에 브라우저에서 읽을 수 있습니다.

무료 플랜 여유: 200건 응답이 18KB 남짓이고 방문당 보통 1회입니다. 5GB egress 면 넉넉합니다.
- QR은 화면에 들어올 때 만듭니다. 한 장에 ~9ms라 전부 미리 만들면 3초가 멈춥니다.
- 공지의 인증 예시 이미지는 440px로 줄여 넣었습니다 (4.5MB → 353KB).

## 끌어올리기

카드의 **↑ 버튼** → 비밀번호 → `created_at` 이 지금으로 갱신되어 목록 맨 위로 갑니다.
`BUMP_DAYS = 3` (앱)과 `interval '3 days'` (SQL)이 짝입니다. **둘 다 고쳐야 합니다.**

- 3일이 안 지났으면 아이콘이 흐려지고, 눌러도 비밀번호를 묻지 않고 남은 시간만 알려줍니다.
  브라우저 시계는 속일 수 있으므로 최종 판정은 서버가 합니다.
- 비밀번호를 **먼저** 확인합니다. 모르는 사람에게는 `BAD_PASSWORD` 만 돌아가고 남은 시간
  (`next_at`)은 알려주지 않습니다.
- 끌어올리기 후에는 목록을 다시 받아 순서를 서버 기준으로 맞춥니다. `render()` 가 기존 카드의
  자리도 다시 잡습니다 — 안 그러면 순서만 바뀐 채 화면은 그대로입니다.

## 마스터 비밀번호 (관리자 강제 삭제)

아무 코드나 지울 수 있는 마스터 비밀번호를 둘 수 있습니다. 삭제 창에 그 값을 넣으면
본인 비밀번호와 무관하게 지워집니다. `pw_hash` 가 없는 예전 행도 이걸로 정리됩니다.

**이 저장소는 공개입니다. 실제 값을 절대 커밋하지 마세요.** 커밋하는 순간 마스터키가 아니라
누구나 누를 수 있는 삭제 버튼이 됩니다. 값은 대시보드에서만 넣습니다.

```sql
-- SQL Editor 에서 직접 실행. 이 문장은 저장소에 남기지 마세요.
insert into public.app_config (key, value)
values ('master_pw', extensions.crypt('여기에실제비밀번호', extensions.gen_salt('bf', 8)))
on conflict (key) do update set value = excluded.value;
```

- 평문이 아니라 **bcrypt 해시로만** 저장됩니다.
- `app_config` 는 RLS 를 켜고 정책을 하나도 만들지 않아 anon 이 **읽지도 쓰지도 못합니다.**
  `security definer` 함수만 소유자 권한으로 읽습니다.
- **삭제 전용입니다.** 끌어올리기(`bump_friend_code`)에는 통하지 않습니다.
- 바꾸려면 같은 문장을 다시, 없애려면 `delete from public.app_config where key='master_pw';`
- 유출됐다 싶으면 위 문장으로 즉시 교체하세요. 앱 배포는 건드릴 필요 없습니다.

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
