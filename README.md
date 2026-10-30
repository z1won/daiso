# PriceScope — 다이소·편의점 가격 비교 / 재고 조회

[daiso-mcp](https://mcp.aka.page) MCP 서버를 이용해 다이소·GS25·CU·세븐일레븐·이마트24의
상품 가격과 지역 매장 재고를 조회하는 웹앱입니다.

| 탭 | 기능 | 사용하는 MCP 도구 |
|---|---|---|
| 가격 비교 | 상품 키워드로 4개 서비스 가격 비교 | `compare_products`, `get_catalog` |
| 다이소 전용 | 상품 검색 → 지역 매장 재고 → 매장 내 진열 위치 | `search_products`, `check_inventory`, `get_product_details` |
| 편의점 전용 | 주류·간편식 등 4사 주변 매장 재고 동시 조회 | `search_products`, `check_inventory`, `find_stores`(지역→좌표) |

## 실행 방식은 두 가지입니다

### 1) GitHub Pages (정적 호스팅) — 서버 불필요
`public/` 폴더만 올리면 됩니다. 브라우저가 MCP 서버를 **직접** 호출합니다.
(MCP 서버가 CORS `Access-Control-Allow-Origin: *` 를 허용하기 때문에 가능)

**방법 A — 이 폴더를 새 저장소로 (권장, 자동 배포)**
1. GitHub에서 새 저장소를 만듭니다. (무료 계정은 공개 저장소여야 Pages 사용 가능)
2. 이 `price-compare` 폴더의 내용을 저장소 최상위로 push 합니다.
   ```bash
   cd price-compare
   git init -b main
   git add .
   git commit -m "PriceScope"
   git remote add origin https://github.com/<아이디>/<저장소>.git
   git push -u origin main
   ```
3. 저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 선택합니다.
4. `.github/workflows/deploy-pages.yml` 이 실행되어 `public/` 이 배포됩니다.
   주소: `https://<아이디>.github.io/<저장소>/`

**방법 B — public 폴더만 업로드 (수동)**
1. 새 저장소에 `public/` 폴더 **안의 파일들**을 최상위로 올립니다 (`index.html` 이 최상위에 오도록).
2. **Settings → Pages → Source: Deploy from a branch**, Branch `main` / `/(root)` 선택.

### 2) 로컬 서버 (Node.js 18+)
```bash
npm start          # http://localhost:3000
```
이 경우 서버(`server.js`)가 MCP를 호출합니다. MCP 서버의 CORS 정책이 바뀌어도 동작합니다.

## 파일 구성
```
public/            ← GitHub Pages에 올라가는 폴더 (이것만으로 동작)
  index.html       화면
  core.js          MCP 클라이언트 + API 처리 로직 (브라우저·Node 공용)
  api-shim.js      화면의 /api/* 요청을 브라우저 안에서 처리 (정적 호스팅용)
  config.js        실행 모드 (정적: false / 로컬 서버가 true로 바꿔서 내려줌)
  app.js           가격 비교 탭
  local.js         다이소 전용 / 편의점 전용 탭, 지역 선택
  favorites.js     즐겨찾기 탭 (관심 상품 재고 다시 조회)
  map.js           매장 지도 보기 (Leaflet + OpenStreetMap, 처음 열 때 불러옴)
  vendor/leaflet/  지도 라이브러리 Leaflet 1.9.4 (BSD-2 라이선스, 원본 그대로)
  share.js         공유 링크 만들기 / 링크로 열면 같은 화면 복원
  palette.js       빠른 검색 창 (Ctrl+K, 초성 검색)
  lightbox.js      제품 사진 크게 보기
  regions.js       시/도·시/군/구 목록
  style.css        스타일
server.js          로컬 실행용 서버 (정적 파일 + /api/*)
```

## 주의
- 데이터는 제3자가 운영하는 공개 MCP 서버(`mcp.aka.page`)에서 실시간으로 가져옵니다.
  해당 서버가 멈추거나 정책(CORS 등)을 바꾸면 GitHub Pages 버전이 동작하지 않을 수 있습니다.
- 정적 호스팅에서는 "같은 검색 2분 캐시"가 사용자 브라우저별로 동작합니다.
- 재고 "확인 불가"는 품절이 아니라 해당 매장이 수량을 공개하지 않는 경우입니다.
