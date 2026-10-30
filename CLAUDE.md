# CLAUDE.md

## WHY
- 다이소·GS25·CU·세븐일레븐·이마트24의 가격과 지역 매장 재고를 한 화면에서 비교하는 웹앱 PriceScope를 GitHub Pages로 서비스한다.

## WHAT
- 입력자료: 공개 MCP 서버 `daiso-mcp`(https://mcp.aka.page) 실시간 응답, 지역 목록 `public/regions.js`, 배경 지도 OpenStreetMap.
- Sub Agent: `ui-verifier`(`.claude/agents/`) — 휴대폰·태블릿·PC 화면 검증 후 보고만 함 (코드 수정 없음). 그 외 작업은 메인 에이전트가 직접 한다.
- `.claude/skills/daangn-used-goods-search` 는 이 앱과 무관.
- 결과물: `public/` → https://z1won.github.io/daiso/ (로컬 확인용 서버는 `server.js`, `npm start`).

## HOW
- Workflow: 메인이 수정 → `npm start` 로 서버를 띄우고 URL과 바뀐 기능을 `ui-verifier` 에 위임 → 보고된 문제 수정 → 사용자 승인 후 커밋 → `main` push 시 Actions가 Pages 배포 → 실제 사이트 확인.
- API 로직은 `public/core.js` 한 곳에서만 고친다 (브라우저·Node 공용이므로 Node 전용 모듈·DOM 사용 금지).
- 빌드 없는 바닐라 JS: `index.html` 의 스크립트 로드 순서를 지키고, 외부 데이터는 `esc()` 로 이스케이프, UI 문구는 한국어.
- 표 열 순서를 바꾸면 `style.css` 모바일 구역의 `nth-child` 규칙도 함께 고친다.
- `public/vendor/` 는 원본 그대로 둔다 (`.gitattributes` `-text`, `map.js`·`map3d.js` 의 SRI 해시와 일치해야 함).
- 공유 링크에 GPS 좌표를 넣지 않고, 재고 `null`(확인 불가)과 `0`(품절)을 구분한다.
