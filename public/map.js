// 매장 지도 보기 — 재고 조회 결과를 지도에 핀으로 표시 (Leaflet + OpenStreetMap, API 키 불필요)
// Leaflet 1.9.4는 vendor/leaflet/ 에 함께 보관 (외부 CDN 불필요). 배경 지도(타일)는 OpenStreetMap에서 실시간으로 받습니다.
// Leaflet을 바꿀 때는 vendor/leaflet/ 파일을 교체하고 아래 integrity 해시도 새 파일 기준으로 갱신하세요.
// Leaflet은 처음 "지도"를 누를 때만 불러옵니다. local.js의 renderDaisoStock / renderCvsSummary 가 이 파일의 함수를 호출합니다.

const VIEW_KEY = 'ps-storeview';
const storeView = Object.assign({ daiso: 'list', cvs: 'list' }, (() => { try { return JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'); } catch { return {}; } })());

/* ---------- Leaflet 지연 로드 ---------- */
const LEAFLET = {
  css: { href: 'vendor/leaflet/leaflet.css', integrity: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=' },
  js: { src: 'vendor/leaflet/leaflet.js', integrity: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=' },
};
let leafletPromise = null;
function ensureLeaflet() {
  if (window.L) return Promise.resolve();
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', crossOrigin: '', ...LEAFLET.css });
      const js = Object.assign(document.createElement('script'), { crossOrigin: '', ...LEAFLET.js, onload: resolve, onerror: reject });
      document.head.append(css, js);
    }).catch(e => { leafletPromise = null; throw e; });
  }
  return leafletPromise;
}

/* ---------- 지도 그리기 ---------- */
const maps = {}; // 요소 id → Leaflet 지도
const cssVar = name => getComputedStyle(document.querySelector('.viz-root')).getPropertyValue(name).trim();
const brandLabel = id => id === 'daiso' ? '다이소' : BRAND[id]?.name || id;

function dropMap(id) {
  const m = maps[id]; if (!m) return;
  const el = m.getContainer(); m.remove(); delete maps[id];
  el.classList.remove(...[...el.classList].filter(c => c.startsWith('leaflet-'))); // Leaflet이 남기는 class 정리
}
// 2D 지도와 3D 보기(map3d.js)는 같은 영역을 번갈아 쓰므로 둘 다 정리
const dropAnyMap = id => { dropMap(id); if (typeof drop3d === 'function') drop3d(id); };
function mapMessage(id, html) { dropAnyMap(id); const el = document.getElementById(id); if (el) el.innerHTML = `<div class="empty map-msg">${html}</div>`; }

// 매장 팝업 내용 (2D 지도·3D 보기 공용)
function storePopupHtml(s) {
  return `<div class="map-pop">
    <div class="mp-head">${swatch(s.brand, brandLabel(s.brand))}<span class="muted">${fmtDist(s.km)}</span></div>
    <div class="mp-name">${esc(s.name)}</div>
    <div>${qtyBadge(s.qty)}</div>
    ${s.sub ? `<div class="muted small">${esc(s.sub)}</div>` : ''}
    ${s.phone ? `<a class="small" href="tel:${esc(s.phone)}">☎ ${esc(s.phone)}</a>` : ''}
  </div>`;
}

function createMap(el) {
  const m = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.5 });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(m);
  // 페이지 스크롤을 방해하지 않도록 지도를 클릭한 뒤에만 휠 확대
  m.on('click focus', () => m.scrollWheelZoom.enable());
  el.addEventListener('mouseleave', () => m.scrollWheelZoom.disable());
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = () => Object.assign(document.createElement('div'), {
    className: 'map-legend',
    innerHTML: '<span><i class="lg-dot big"></i>크기 = 재고 수량</span><span><i class="lg-dot off"></i>재고 없음</span><span><i class="lg-dot unk"></i>확인 불가</span><span><i class="lg-dot center"></i>기준 위치</span>',
  });
  legend.addTo(m);
  m._pins = L.layerGroup().addTo(m);
  return m;
}

async function drawStoreMap(id, center, stores) {
  const el = document.getElementById(id); if (!el) return;
  const token = (el._drawToken = (el._drawToken || 0) + 1);
  if (typeof drop3d === 'function') drop3d(id);
  if (!window.L) el.innerHTML = '<div class="empty map-msg">지도를 불러오는 중…</div>';
  try { await ensureLeaflet(); }
  catch { mapMessage(id, '지도를 불러오지 못했습니다. 네트워크를 확인하거나 목록 보기를 이용하세요.'); return; }
  if (el._drawToken !== token || !el.isConnected) return; // 그사이 다시 그려졌거나 화면에서 사라짐

  const pts = stores.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  if (!pts.length) { mapMessage(id, '좌표 정보가 있는 매장이 없습니다.'); return; }

  let m = maps[id];
  if (m && m.getContainer() !== el) { dropMap(id); m = null; }
  if (!m) { el.innerHTML = ''; m = maps[id] = createMap(el); }
  m.invalidateSize();
  m._pins.clearLayers();

  const muted = cssVar('--text-muted'), ink = cssVar('--text-primary'), surface = cssVar('--surface-1');
  // 재고 있는 매장이 위에 오도록 마지막에 그림
  const order = s => (s.qty > 0 ? 2 : s.qty === 0 ? 0 : 1);
  [...pts].sort((a, b) => order(a) - order(b) || (b.qty || 0) - (a.qty || 0)).forEach(s => {
    const c = cssVar(`--s-${s.brand}`) || ink;
    const has = s.qty > 0, unknown = s.qty == null;
    const marker = L.circleMarker([s.lat, s.lng], {
      // 재고가 많을수록 크게 (겹쳐도 구분되도록 흰 테두리)
      radius: has ? 5 + Math.min(Math.sqrt(s.qty) * 1.2, 7) : 4,
      color: has ? surface : unknown ? c : muted, weight: has ? 1.5 : 1.2,
      fillColor: has ? c : unknown ? c : muted, fillOpacity: has ? 0.9 : unknown ? 0.15 : 0.35,
      dashArray: unknown ? '3 3' : null,
    });
    marker.bindTooltip(`${esc(s.name)} · ${s.qty == null ? '확인 불가' : s.qty === 0 ? '품절' : `재고 ${s.qty}`}`, { direction: 'top', offset: [0, -6] });
    marker.bindPopup(storePopupHtml(s));
    m._pins.addLayer(marker);
  });

  if (center?.lat) {
    L.circleMarker([center.lat, center.lng], { radius: 6, color: ink, weight: 3, fillColor: cssVar('--surface-1'), fillOpacity: 1 })
      .bindTooltip(esc(center.label || '기준 위치'), { direction: 'top', offset: [0, -6] }).addTo(m._pins);
  }

  // 재고 있는 매장 + 기준 위치가 모두 보이게 맞춤 (없으면 전체 매장 기준)
  const inStock = pts.filter(s => s.qty > 0);
  const focus = (inStock.length ? inStock : pts).map(s => [s.lat, s.lng]);
  if (center?.lat) focus.push([center.lat, center.lng]);
  // 아래쪽은 범례(휴대폰에서는 두 줄 + 저작권 표시 위)에 가리지 않도록 더 비움
  const bottom = matchMedia('(max-width: 700px)').matches ? 96 : 48;
  m.fitBounds(L.latLngBounds(focus), { paddingTopLeft: [28, 28], paddingBottomRight: [28, bottom], maxZoom: 16 });
}

/* ---------- 편의점 통합 지도 ---------- */
function syncCvsMap() {
  const on = storeView.cvs !== 'list'; // 'map'(2D) 또는 '3d'
  $('#cMap').hidden = !on; $('#cListWrap').hidden = on;
  if (!on) return;
  const rs = Object.values(cvs.results).filter(r => !r.error);
  const stores = rs.flatMap(r => r.stores.map(s => ({ ...s, brand: r.brand, sub: [r.product?.name, s.address].filter(Boolean).join(' · ') })));
  if (!stores.length) return mapMessage('cMap', cvs.keyword ? '매장 정보를 불러오는 중…' : '상품을 조회하면 브랜드별 매장이 지도에 표시됩니다.');
  (storeView.cvs === '3d' ? drawStore3D : drawStoreMap)('cMap', cvs.center, stores);
}

/* ---------- 목록 / 지도 / 3D 전환 ---------- */
function syncViewSegs() {
  document.querySelectorAll('.view-seg').forEach(seg => seg.querySelectorAll('button').forEach(b => {
    const on = b.dataset.v === storeView[seg.dataset.scope];
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  }));
}
document.addEventListener('click', e => {
  const b = e.target.closest('.view-seg button'); if (!b) return;
  const scope = b.closest('.view-seg').dataset.scope;
  if (storeView[scope] === b.dataset.v) return;
  storeView[scope] = b.dataset.v;
  localStorage.setItem(VIEW_KEY, JSON.stringify(storeView));
  syncViewSegs();
  if (scope === 'daiso') { if (daiso.stock) renderDaisoStock(); }
  else syncCvsMap();
});
// 숨겨진 탭에서 그려진 지도는 크기가 0이라 위치 맞춤이 틀어지므로, 탭을 열 때 다시 그림
document.addEventListener('tabshown', e => requestAnimationFrame(() => {
  if (e.detail === 'cvs') syncCvsMap();
  else if (e.detail === 'daiso' && storeView.daiso !== 'list' && daiso.stock) renderDaisoStock();
}));

syncViewSegs();
syncCvsMap();
