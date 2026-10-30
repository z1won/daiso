// 매장 재고 3D 보기 — 실제 지도(OpenStreetMap) 위에 매장마다 재고 수량만큼 기둥을 세움 (MapLibre GL v5)
// MapLibre는 vendor/maplibre/ 에 원본 그대로 보관하고, 처음 "3D"를 누를 때만 불러옵니다 (약 270KB, gzip).
// MapLibre를 바꿀 때는 vendor/maplibre/ 파일을 교체하고 아래 integrity 해시도 새 파일 기준으로 갱신하세요.
// map.js의 storeView·cssVar·brandLabel·storePopupHtml·mapMessage·dropMap 을 함께 사용합니다.

const MAPLIBRE = {
  css: { href: 'vendor/maplibre/maplibre-gl.css', integrity: 'sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK' },
  js: { src: 'vendor/maplibre/maplibre-gl.js', integrity: 'sha384-5+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp' },
};
let maplibrePromise = null;
function ensureMaplibre() {
  if (window.maplibregl) return Promise.resolve();
  if (!maplibrePromise) {
    maplibrePromise = new Promise((resolve, reject) => {
      const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', crossOrigin: '', ...MAPLIBRE.css });
      const js = Object.assign(document.createElement('script'), { crossOrigin: '', ...MAPLIBRE.js, onload: resolve, onerror: reject });
      document.head.append(css, js);
    }).catch(e => { maplibrePromise = null; throw e; });
  }
  return maplibrePromise;
}

const maps3d = {}; // 요소 id → MapLibre 지도
function drop3d(id) { const m = maps3d[id]; if (m) { cancelAnimationFrame(m._anim); m.remove(); delete maps3d[id]; } }

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const isDarkTheme = () => { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
function webglSupported() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

/* ---------- 매장 → 기둥 (GeoJSON) ---------- */
const M_PER_DEG = 111320;
// 기둥 바닥: 매장 위치를 중심으로 한 팔각형 (3D 기둥은 면(polygon)으로만 세울 수 있음)
function octagon(lng, lat, r) {
  const dLat = r / M_PER_DEG, dLng = r / (M_PER_DEG * Math.cos(lat * Math.PI / 180));
  const ring = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * 2 * Math.PI + Math.PI / 8;
    return [lng + Math.cos(a) * dLng, lat + Math.sin(a) * dLat];
  });
  ring.push(ring[0]);
  return [ring];
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// focus: 카메라가 화면에 맞추는 지점들 (재고 있는 매장 + 기준 위치)
function buildBars(pts, focus) {
  const lats = focus.map(p => p.lat), lngs = focus.map(p => p.lng);
  // 기둥 굵기·높이는 화면에 맞추는 범위에 비례 (멀리 있는 재고 없는 매장 때문에 기둥이 화면 밖으로 솟지 않도록)
  const span = Math.max(1000 * distKm({ lat: Math.min(...lats), lng: Math.min(...lngs) }, { lat: Math.max(...lats), lng: Math.max(...lngs) }), 500);
  const r = clamp(span * 0.018, 14, 90);
  const maxH = clamp(span * 0.22, 120, 2500);
  const maxQty = Math.max(0, ...pts.map(s => (s.qty > 0 ? s.qty : 0)));
  const muted = cssVar('--text-muted');
  const features = pts.map((s, i) => {
    const has = s.qty > 0;
    return {
      type: 'Feature', id: i,
      geometry: { type: 'Polygon', coordinates: octagon(s.lng, s.lat, has ? r : r * 0.7) },
      properties: {
        i, has: has ? 1 : 0,
        // 높이는 재고 수량에 정비례 (가장 많은 매장 = maxH). 재고 없음·확인 불가는 얇은 원판
        h: has ? Math.max(maxH * s.qty / maxQty, maxH * 0.06) : 4, // 재고가 아주 적어도 '재고 없음' 원판과 구분되게 최소 6%
        color: s.qty === 0 ? muted : (cssVar(`--s-${s.brand}`) || muted),
      },
    };
  });
  return { type: 'FeatureCollection', features, maxQty };
}

/* ---------- 지도 만들기 ---------- */
const KO_LOCALE = {
  'NavigationControl.ZoomIn': '확대', 'NavigationControl.ZoomOut': '축소',
  'NavigationControl.ResetBearing': '북쪽 위로 · 기울기 초기화 (끌어서 회전)',
  'AttributionControl.ToggleAttribution': '지도 저작권 정보', 'Popup.Close': '닫기',
};
// 배경 지도는 채도를 낮춰 브랜드 색 기둥이 잘 보이게 (다크 테마는 어둡게)
const rasterPaint = () => isDarkTheme()
  ? { 'raster-brightness-max': 0.42, 'raster-saturation': -0.75, 'raster-contrast': 0.1 }
  : { 'raster-brightness-max': 1, 'raster-saturation': -0.45, 'raster-contrast': 0 };

function create3d(el) {
  const m = new maplibregl.Map({
    container: el,
    style: {
      version: 8,
      sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' } },
      layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: rasterPaint() }],
    },
    center: [126.978, 37.5665], zoom: 12, pitch: 55, bearing: -20, maxPitch: 70,
    attributionControl: { compact: true }, locale: KO_LOCALE,
  });
  m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
  // 페이지 스크롤을 방해하지 않도록 지도를 클릭한 뒤에만 휠 확대 (2D 지도와 같은 방식)
  m.scrollZoom.disable();
  m.on('click', () => m.scrollZoom.enable());
  el.addEventListener('mouseleave', () => m.scrollZoom.disable());

  const legend = Object.assign(document.createElement('div'), { className: 'map-legend m3d-legend' });
  el.append(legend);
  m._legend = legend;

  m._ready = new Promise(resolve => m.once('load', () => {
    m.addSource('stores', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // 재고 없음·확인 불가는 흐리게, 재고 있는 매장은 진하게 (투명도는 레이어 단위라 두 층으로 나눔)
    m.addLayer({ id: 'bars-off', type: 'fill-extrusion', source: 'stores', filter: ['==', ['get', 'has'], 0],
      paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.45 } });
    m.addLayer({ id: 'bars', type: 'fill-extrusion', source: 'stores', filter: ['==', ['get', 'has'], 1],
      paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.92, 'fill-extrusion-vertical-gradient': true } });
    for (const layer of ['bars', 'bars-off']) {
      m.on('click', layer, e => {
        const s = m._stores?.[e.features[0].properties.i]; if (!s) return;
        new maplibregl.Popup({ offset: 8, maxWidth: '260px' }).setLngLat([s.lng, s.lat]).setHTML(storePopupHtml(s)).addTo(m);
      });
      m.on('mouseenter', layer, () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', layer, () => { m.getCanvas().style.cursor = ''; });
    }
    resolve();
  }));
  return m;
}

function applyTheme3d(m) {
  const p = rasterPaint();
  for (const [k, v] of Object.entries(p)) m.setPaintProperty('osm', k, v);
}
// 테마 버튼·시스템 설정이 바뀌면 열려 있는 3D 지도의 배경도 바로 바꿈
new MutationObserver(() => Object.values(maps3d).forEach(m => m._ready.then(() => applyTheme3d(m))))
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => Object.values(maps3d).forEach(m => m._ready.then(() => applyTheme3d(m))));

// 기둥이 아래에서 자라나는 애니메이션 (애니메이션 줄이기 설정이면 바로 표시)
function growBars(m) {
  cancelAnimationFrame(m._anim);
  const set = t => { for (const l of ['bars', 'bars-off']) m.setPaintProperty(l, 'fill-extrusion-height', ['*', ['get', 'h'], t]); };
  if (reducedMotion()) return set(1);
  const start = performance.now(), dur = 900;
  const step = now => {
    const p = Math.min((now - start) / dur, 1);
    set(1 - Math.pow(1 - p, 3)); // ease-out
    if (p < 1) m._anim = requestAnimationFrame(step);
  };
  set(0);
  m._anim = requestAnimationFrame(step);
}

/* ---------- 그리기 (map.js·local.js에서 호출) ---------- */
async function drawStore3D(id, center, stores) {
  const el = document.getElementById(id); if (!el) return;
  const token = (el._drawToken = (el._drawToken || 0) + 1);
  dropMap(id); // 같은 영역에 있던 2D 지도 정리
  if (!webglSupported()) return mapMessage(id, '이 기기(브라우저)는 3D 지도를 지원하지 않습니다. 지도 보기를 이용하세요.');
  if (!window.maplibregl) el.innerHTML = '<div class="empty map-msg">3D 지도를 불러오는 중…</div>';
  try { await ensureMaplibre(); }
  catch { return mapMessage(id, '3D 지도를 불러오지 못했습니다. 네트워크를 확인하거나 지도 보기를 이용하세요.'); }
  if (el._drawToken !== token || !el.isConnected) return; // 그사이 다시 그려졌거나 화면에서 사라짐

  const pts = stores.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  if (!pts.length) return mapMessage(id, '좌표 정보가 있는 매장이 없습니다.');

  let m = maps3d[id];
  if (m && m.getContainer() !== el) { drop3d(id); m = null; }
  if (!m) {
    el.innerHTML = '';
    try { m = maps3d[id] = create3d(el); }
    catch { return mapMessage(id, '3D 지도를 시작하지 못했습니다. 지도 보기를 이용하세요.'); }
  }
  await m._ready;
  if (el._drawToken !== token || maps3d[id] !== m) return;
  m.resize();
  applyTheme3d(m);

  // 재고 있는 매장 + 기준 위치가 보이게 비스듬히 맞춤 (없으면 전체 매장 기준)
  const inStock = pts.filter(s => s.qty > 0);
  const focusPts = [...(inStock.length ? inStock : pts), ...(center?.lat ? [center] : [])];
  const data = buildBars(pts, focusPts);
  m._stores = pts;
  m.getSource('stores').setData(data);

  m._center?.remove();
  if (center?.lat) {
    m._center = new maplibregl.Marker({ element: Object.assign(document.createElement('div'), { className: 'm3d-center', title: center.label || '기준 위치' }) })
      .setLngLat([center.lng, center.lat]).addTo(m);
  }
  const touch = matchMedia('(pointer: coarse)').matches;
  m._legend.innerHTML = `<span><i class="lg-bar"></i>높이 = 재고 수량${data.maxQty ? ` (가장 높은 기둥 ${data.maxQty}개)` : ''}</span>
    <span><i class="lg-dot off"></i>낮은 원판 = 재고 없음·확인 불가</span><span><i class="lg-dot center"></i>기준 위치</span>
    <span class="lg-hint">${touch ? '두 손가락으로 기울이기·회전' : '오른쪽 버튼(또는 Ctrl)+끌기로 회전·기울이기'} · 기둥을 누르면 매장 정보</span>`;

  const focus = focusPts.map(p => [p.lng, p.lat]);
  const bounds = focus.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(focus[0], focus[0]));
  // 위쪽은 솟은 기둥이 들어갈 만큼만 비움 (기둥 높이를 이 영역 기준으로 계산하므로 큰 여백은 필요 없음.
  // 좁은 화면은 범례가 오른쪽 위에 있어 조금 더)
  const h = el.clientHeight, narrow = matchMedia('(max-width: 960px)').matches;
  const still = reducedMotion();
  m.fitBounds(bounds, { padding: { top: Math.round(h * (narrow ? 0.22 : 0.16)), left: 40, right: 40, bottom: 40 }, pitch: 55, bearing: -20, maxZoom: 15.5, duration: still ? 0 : 800 });
  growBars(m);
  // 다 자란 뒤 천천히 한 번 돌며 입체감을 보여줌 (사용자가 지도를 만지면 바로 멈춤)
  if (!still) m.once('moveend', () => { if (maps3d[id] === m) m.easeTo({ bearing: m.getBearing() + 25, duration: 6000, easing: t => t }); });
}
