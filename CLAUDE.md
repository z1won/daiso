# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개요

PriceScope — 공개 MCP 서버 `daiso-mcp`(`https://mcp.aka.page`)를 호출해 다이소·GS25·CU·세븐일레븐·이마트24의 가격 비교와 매장 재고를 조회하는 웹앱. 빌드 단계·번들러·npm 의존성이 없는 바닐라 JS이며, UI 문자열과 주석은 한국어로 작성한다.

## 명령어

```bash
npm start        # 로컬 서버 모드 (server.js, http://localhost:3000, PORT 환경변수로 변경 가능)
npm run static   # 정적 모드 확인 (public/ 만 서빙, http://localhost:4000) — GitHub Pages와 동일한 동작
```

- Node 18+ 필요 (전역 `fetch` 사용).
- `MCP_URL` 환경변수로 MCP 엔드포인트를 바꿀 수 있음 (서버 모드에서만 적용).
- 테스트·린트·빌드 설정은 없음. 변경 확인은 두 모드 모두에서 브라우저로 직접 한다.
- 배포: `main` 브랜치 push 시 `.github/workflows/deploy-pages.yml` 이 `public/` 을 GitHub Pages로 배포.

## 아키텍처: 하나의 API 로직, 두 가지 실행 모드

핵심은 `public/core.js` 가 **브라우저와 Node 양쪽에서 그대로 실행되는** UMD 모듈이라는 점이다 (Node에서는 `module.exports`, 브라우저에서는 `window.PriceCore`).

- `core.js` = 의존성 없는 MCP Streamable HTTP 클라이언트(`initialize` → `notifications/initialized` → `tools/call`, `Mcp-Session-Id` 유지, SSE/JSON 응답 모두 처리, 실패 시 세션 재연결 1회) + `routes` 객체(`/api/*` 경로별 핸들러) + `handle(pathname, params)`.
- 화면 코드(`app.js`, `local.js`)는 항상 `fetch('/api/...')` 만 호출한다. 이 요청이 어디서 처리되는지는 모드에 따라 다르다:
  - **정적 모드 (GitHub Pages)**: `config.js` 가 `window.PRICE_SERVER = false` → `api-shim.js` 가 `window.fetch` 를 가로채 경로가 `/api/...` 로 끝나는 같은 출처 요청을 `PriceCore.handle` 로 브라우저 안에서 처리하고 `Response` 로 감싸 돌려준다. 브라우저가 MCP를 직접 호출하므로 MCP 서버의 CORS 허용에 의존한다. Pages 하위 경로(`/<repo>/`)에서도 정규식 매칭으로 동작한다.
  - **서버 모드 (`npm start`)**: `server.js` 가 `/config.js` 요청에 `window.PRICE_SERVER = true;` 를 동적으로 내려줘 shim을 비활성화하고, `/api/*` 를 `require('./public/core.js').handle` 로 처리한다.
- 따라서 **API 로직 변경은 `core.js` 한 곳에서만** 한다. `core.js` 에는 Node 전용 모듈이나 DOM API를 쓰면 안 된다 (`process`/`window` 접근은 `typeof` 가드 필요).
- 에러 규약: 핸들러는 `status`(HTTP 코드)와 `call`(MCP 호출 정보)이 붙은 `Error` 를 던지고, server.js와 api-shim.js가 둘 다 `{ error, call }` JSON으로 변환한다. 성공 응답에도 `call`/`calls`(도구명·인자·소요 ms)를 포함해 화면의 호출 로그에 표시한다.

### 편의점 어댑터 (`core.js` 의 `CVS`)

`/api/cvs/stock?brand=...` 는 브랜드별 어댑터로 분기하며, 각 MCP 도구의 서로 다른 응답 형태를 공통 형태(`{ brand, product, candidates, codeSelectable, totals, stores[], calls[], note?, error? }`)로 정규화한다. 브랜드별로 MCP 도구가 받는 인자가 다르다 (예: 세븐일레븐은 좌표 대신 지역명 `storeKeyword`, 이마트24는 `area1`/`area2`, GS25는 상품 후보를 먼저 검색 후 `pickBest` 로 선택). 새 브랜드나 필드를 추가할 때는 이 공통 형태를 유지해야 `local.js` 렌더링이 그대로 동작한다.

### 프론트엔드

- 전역 스크립트를 `index.html` 에서 순서대로 로드한다: `config.js` → `core.js` → `api-shim.js` → `lightbox.js` → `regions.js` → `app.js` → `local.js` → `favorites.js` → `map.js` → `share.js` → `palette.js`. 모듈 시스템이 없으므로 로드 순서와 전역 이름 충돌에 주의 (`$`, `esc` 등은 `app.js` 에, `api`·`region`·`resolveLocation` 등은 `local.js` 에 정의되어 뒤 파일들이 공유).
- `app.js` = 가격 비교 탭 (`/api/compare`, `/api/popwords`, `/api/health`), `local.js` = 다이소 전용·편의점 전용 탭과 지역 선택 (`/api/geocode` 는 GS25 `find_stores` 를 지오코딩 용도로 활용).
- `favorites.js` = 즐겨찾기 탭. ★ 버튼으로 상품과 **저장 당시 지역**을 `ps-favorites` 에 보관하고, 탭을 열 때 기존 `/api/daiso/stock`·`/api/cvs/stock` 을 다시 호출한다 (메모리 결과 2분 재사용, 동시 3개). 지역 함수(`regionText`, `resolveLocation` 등)는 이 때문에 지역 객체를 인자로 받는다.
- `map.js` = 목록/지도 전환. Leaflet 1.9.4를 unpkg에서 SRI 해시와 함께 **처음 지도를 열 때만** 불러온다. 숨겨진 탭에서 그린 지도는 크기가 0이라 `tabshown` 이벤트에서 다시 그린다.
- `share.js` = 현재 탭 상태를 쿼리스트링(`t`, `q`, `r1~r3`, `p`, `b`, `c` 등)으로 만들고, 로드 시 복원한 뒤 `history.replaceState` 로 주소를 정리한다. GPS 좌표는 링크에 넣지 않는다. 전역 `toast()` 도 여기 있다.
- `palette.js` = Ctrl+K 빠른 검색 창 (IME 대비 `e.code === 'KeyK'`). 초성만 입력하면 검색 실행 대신 추천 품목(`CVS_CHIPS`, `DAISO_CHIPS`, `DEFAULT_SUGGEST`)에서 찾는다.
- 탭 전환 시 `showTab` 이 `tabshown` CustomEvent를 보내므로, 뒤 파일들은 이 이벤트로 탭 진입에 반응한다.
- 반응형은 `style.css` 끝의 "모바일 최적화" 구역에 모여 있다. **960px 이하**: 상단 바를 간결하게 하고 탭을 화면 아래 고정 탭 바로 옮긴다(태블릿 포함). **700px 이하**: `.m-list` 가 붙은 표(`#tableWrap`, `#dDetail`, `#cListWrap`)를 `nth-child` + `grid-template-areas` 로 두 줄 목록으로 바꾸고, 편의점 브랜드 카드는 옆으로 넘기는 형태(scroll-snap)가 된다. 이 표들의 **열 순서를 바꾸면 모바일 CSS의 `nth-child` 도 같이 고쳐야 한다**.
- 입력창은 모바일에서 16px (iOS 자동 확대 방지). 좁은 화면 판단은 `local.js` 의 `isNarrow()` (960px).
- HTML은 템플릿 문자열로 생성하므로 외부 데이터는 반드시 `esc()` 로 이스케이프한다.
- 설정·최근 검색어는 `localStorage` (`ps-` 접두사 키)에 저장.

## 참고

- 캐시(`/api/compare` 2분, geocode 무기한)는 모듈 메모리에 있으므로 정적 모드에서는 사용자 브라우저별, 서버 모드에서는 서버 프로세스 전체 공유.
- 재고 "확인 불가"(수량 `null`)는 품절이 아니라 매장이 수량을 공개하지 않는 경우다 — `0` 과 구분해서 다룬다.
- `.claude/skills/daangn-used-goods-search` 는 이 앱과 무관한 별도 스킬이다.
