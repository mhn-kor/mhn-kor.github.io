# 작업 절차

새 세션에서 이어 작업할 때 확인하는 절차. 작업 기준(설계 먼저·확인 후 반영)은 [AGENTS.md](../AGENTS.md), 자동빌드 기준은 [AUTO_BUILD.md](AUTO_BUILD.md).

## 브랜치·배포

- 작업은 세션에 지정된 작업 브랜치에서 한다. 새 브랜치는 최신 `main`에서 시작한다 (`git fetch origin main && git checkout -B <브랜치> origin/main`).
- 커밋·푸시는 사용자가 요청했을 때 작업 브랜치로만 한다.
- **배포:** 사용자가 "메인에 반영해줘"라고 할 때만 `main`을 작업 브랜치로 fast-forward 한다 (`git push origin HEAD:main`). GitHub Pages가 1~2분 뒤 배포한다.
- `main`에 다른 커밋이 먼저 있으면 작업 브랜치에 `origin/main`을 merge한 뒤 테스트하고 올린다 (rebase·force push 금지).
- 바뀐 js·css는 `index.html`의 `?v=` 를 올린다 (README '캐시'). `index.html` 자체는 브라우저가 최대 10분 캐시한다.

## 테스트

전체 (배포 전 필수):

```sh
for t in auto-build-rules-test auto-build-test auto-build-guidelines-test auto-build-investment-test \
  auto-build-opportunity-test auto-build-armor-test auto-build-bowgun-test build-test; do
  node tools/$t.js >/dev/null 2>&1 && echo "PASS $t" || echo "FAIL $t"; done
for t in auto-build-ui-test auto-build-meta-ui-test; do
  PLAYWRIGHT_MODULE=/opt/node22/lib/node_modules/playwright node tools/$t.js >/dev/null 2>&1 && echo "PASS $t" || echo "FAIL $t"; done
```

- `auto-build-rules-test`: 운용 가이드 규칙 표(`docs/weapons/*.md`) ↔ `AB_RULES`, 무기 특성 표(`WEAPONS.md`) ↔ `AB_TRAITS`, 스킬 사전 기본 가정 칸(`SKILLS.md`) ↔ `AB_ASSUME`. 지침을 고치면 문서와 코드를 함께 고친다.
- `auto-build-guidelines-test`는 수 분 걸린다. 출력 끝이 예시 기록이어도 종료 코드 0이면 통과.
- UI 테스트: 클라우드 컨테이너는 Edge가 없어 내장 Chromium으로 실행한다 (`PLAYWRIGHT_MODULE` 경로는 환경에 맞게). `build-bow-test`는 Edge가 필요하다.
- UI 테스트 2종: 메타 화면(`#auto-build`) = `auto-build-meta-ui-test`, 이전 화면(`#auto-build-legacy`) = `auto-build-ui-test`.

## 공식 데이터 갱신

- `node tools/fetch-official.js` → `node tools/build-builddata.js`. 공식 값이 mhn.quest 번들보다 우선한다.
- 프록시 환경(Node 22)은 `NODE_USE_ENV_PROXY=1` 을 붙인다. monsterhunternow.com·mhn.quest 접근이 허용돼 있어야 한다.

## 지침 반영 흐름

1. 사용자 서술형 지침을 요약해 칸별로 나눈 설계안 제시 (운용 가이드·무기 특성·스킬 사전·컨셉).
2. 해석이 갈리는 부분 확인 → 반영.
3. 실제 결과 확인 (예: 해당 무기 메타 후보와 1위 빌드) → 테스트 → 커밋·푸시 → 보고.
