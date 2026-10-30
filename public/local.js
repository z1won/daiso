// 다이소 전용 / 편의점 전용 탭 — 지역 선택 후 매장별 재고 조회
// app.js의 $, esc, won, log 를 함께 사용합니다.

const BRANDS = [
  { id: 'gs25', name: 'GS25' },
  { id: 'cu', name: 'CU' },
  { id: 'seveneleven', name: '세븐일레븐' },
  { id: 'emart24', name: '이마트24' },
];
const BRAND = Object.fromEntries(BRANDS.map(b => [b.id, b]));
const DAISO_CHIPS = ['수납함', '리필용기', '포장지', '지퍼백', '네임스티커', '화분', '멀티탭', '욕실화', '퍼프', '데코 스티커'];
const CVS_CHIPS = [
  ['주류', ['참이슬', '처음처럼', '카스캔', '테라', '하이볼', '와인', '막걸리']],
  ['간편식', ['도시락', '삼각김밥', '샌드위치']],
  ['상비약', ['타이레놀', '판피린']],
];
const api = async (path, params) => {
  const res = await fetch(path + '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')));
  const body = await res.json();
  if (!res.ok) { if (body.call) log(body.call, `<div class="e">${esc(body.error)}</div>`); throw new Error(body.error || '요청 실패'); }
  return body;
};

/* =========================================================
   탭 전환
   ========================================================= */
const TAB_KEY = 'ps-tab';
function showTab(id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === id));
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + id; });
  localStorage.setItem(TAB_KEY, id);
  document.dispatchEvent(new CustomEvent('tabshown', { detail: id }));
}
document.querySelector('.tabs').onclick = e => { const t = e.target.closest('.tab'); if (t) showTab(t.dataset.tab); };

// 상단 "MCP 로그" 버튼 — 어느 탭에서든 호출 로그 확인
const logBtn = document.createElement('button');
logBtn.className = 'icon-btn wide'; logBtn.id = 'logBtn'; logBtn.textContent = 'MCP 로그'; logBtn.title = 'MCP 호출 로그 보기';
document.querySelector('.top-right').prepend(logBtn);
logBtn.onclick = () => {
  $('#dTitle').textContent = 'MCP 호출 로그';
  $('#dBody').innerHTML = `<ol class="log full">${$('#log').innerHTML || '<li class="muted">아직 호출 기록이 없습니다.</li>'}</ol>`;
  $('#drawer').classList.add('open');
};

/* =========================================================
   지역 선택 (두 탭이 같은 지역을 공유)
   ========================================================= */
const REGION_KEY = 'ps-region';
const region = Object.assign({ sido: '서울', gugun: '강남구', dong: '', gps: null }, JSON.parse(localStorage.getItem(REGION_KEY) || '{}'));
const sidoOf = short => REGIONS.find(r => r.short === short) || REGIONS[0];
const geoCacheC = new Map();

// 아래 지역 함수들은 즐겨찾기에 저장된 지역(rg)으로도 호출됩니다
function regionText(rg = region) { return [rg.sido, rg.gugun, rg.dong].filter(Boolean).join(' '); }
function regionLabel(rg = region) { return rg.gps ? '현재 위치' : regionText(rg); }
// 세븐일레븐·GS25 키워드용 (시/도 약칭 없이도 잘 인식됨)
function regionKeyword(rg = region) { return [rg.gugun === '세종시' ? '세종' : rg.gugun, rg.dong].filter(Boolean).join(' '); }

function renderRegions() {
  document.querySelectorAll('[data-region]').forEach(el => {
    const sd = sidoOf(region.sido);
    el.innerHTML = `
      <span class="r-icon" aria-hidden="true">⌂</span>
      <select class="r-sido" aria-label="시/도">${REGIONS.map(r => `<option ${r.short === region.sido ? 'selected' : ''}>${r.short}</option>`).join('')}</select>
      <select class="r-gugun" aria-label="시/군/구">${sd.list.map(g => `<option ${g === region.gugun ? 'selected' : ''}>${g}</option>`).join('')}</select>
      <input class="r-dong" placeholder="동·역 (선택)" value="${esc(region.dong)}" maxlength="15" aria-label="동 또는 역">
      <button type="button" class="r-gps ${region.gps ? 'on' : ''}" title="현재 위치 사용">⌖</button>`;
    el.classList.toggle('gps', !!region.gps);
  });
  $('#dRegionLabel').textContent = '· ' + regionLabel();
}
function saveRegion(changed) {
  localStorage.setItem(REGION_KEY, JSON.stringify(region));
  renderRegions();
  if (changed) onRegionChange();
}
document.addEventListener('change', e => {
  const el = e.target;
  if (el.matches('.r-sido')) { region.sido = el.value; region.gugun = sidoOf(el.value).list[0]; region.dong = ''; region.gps = null; saveRegion(true); }
  else if (el.matches('.r-gugun')) { region.gugun = el.value; region.dong = ''; region.gps = null; saveRegion(true); }
  else if (el.matches('.r-dong')) { region.dong = el.value.trim(); region.gps = null; saveRegion(true); }
});
document.addEventListener('click', e => {
  const b = e.target.closest('.r-gps'); if (!b) return;
  if (region.gps) { region.gps = null; return saveRegion(true); }
  if (!navigator.geolocation) return alertInline('이 브라우저는 위치 정보를 지원하지 않습니다.');
  b.textContent = '…';
  navigator.geolocation.getCurrentPosition(
    p => { region.gps = { lat: p.coords.latitude, lng: p.coords.longitude }; saveRegion(true); },
    () => { b.textContent = '⌖'; alertInline('위치 권한이 거부되었습니다. 시/도·구를 직접 선택하세요.'); },
    { timeout: 8000 });
});
function alertInline(msg) { $('#cK4s').textContent = msg; $('#dRegionLabel').textContent = '· ' + msg; }

// 지역 → 좌표 (서버가 MCP의 GS25 매장 검색 지오코딩을 사용)
async function resolveLocation(rg = region) {
  if (rg.gps) return { ...rg.gps, label: '현재 위치' };
  const q = regionText(rg);
  if (geoCacheC.has(q)) return geoCacheC.get(q);
  const r = await api('/api/geocode', { q });
  if (r.call) log(r.call, `<div class="c">${esc(q)} → ${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}</div>`);
  const loc = { lat: r.lat, lng: r.lng, label: q };
  geoCacheC.set(q, loc);
  return loc;
}
function onRegionChange() {
  if (daiso.selected) loadDaisoStock(daiso.selected);
  if (cvs.keyword) runCvs(cvs.keyword);
}

/* ---------- 공통 표시 도우미 ---------- */
function distKm(a, b) {
  if (!a || b?.lat == null || b?.lng == null) return null;
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = km => km == null ? '—' : km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
function qtyBadge(q) {
  if (q == null) return '<span class="badge off">확인 불가</span>';
  if (q === 0) return '<span class="badge err">품절</span>';
  if (q < 5) return `<span class="badge warn">${q}개 남음</span>`;
  return `<span class="badge ok">재고 ${q}</span>`;
}
const swatch = (id, name) => `<span class="svc-tag" style="--c:var(--s-${id})"><i class="sw"></i>${esc(name)}</span>`;
const skelRows = (n, cols) => Array.from({ length: n }, () => `<tr>${Array.from({ length: cols }, (_, i) => `<td><div class="skel" style="width:${i ? 50 : 80}%"></div></td>`).join('')}</tr>`).join('');

/* =========================================================
   다이소 전용
   ========================================================= */
const daiso = { query: '', page: 1, products: [], total: 0, selected: null, stock: null, center: null };

$('#dChips').innerHTML = DAISO_CHIPS.map(w => `<button type="button" class="chip" data-q="${esc(w)}">${esc(w)}</button>`).join('');
$('#dChips').onclick = e => { const c = e.target.closest('.chip'); if (c) { $('#dKeyword').value = c.dataset.q; searchDaiso(); } };
$('#dForm').onsubmit = e => { e.preventDefault(); searchDaiso(); };
$('#dMore').onclick = () => searchDaiso(daiso.page + 1);
$('#dInStockOnly').onchange = () => daiso.stock && renderDaisoStock();

async function searchDaiso(page = 1) {
  const q = $('#dKeyword').value.trim(); if (!q) return;
  if (page === 1) { daiso.products = []; $('#dProducts').innerHTML = Array.from({ length: 8 }, () => '<div class="prow"><div class="thumb"></div><div style="flex:1"><div class="skel" style="width:70%"></div></div></div>').join(''); }
  try {
    const r = await api('/api/daiso/search', { q, page });
    log(r.call, `<div class="c">다이소 상품 ${r.products.length}건 (전체 ${r.totalCount})</div>`);
    Object.assign(daiso, { query: q, page, total: r.totalCount });
    daiso.products.push(...r.products);
    renderDaisoProducts();
  } catch (e) { $('#dProducts').innerHTML = `<div class="empty">검색 실패: ${esc(e.message)}</div>`; }
}

function renderDaisoProducts() {
  $('#dMeta').textContent = daiso.products.length ? `${daiso.products.length} / ${daiso.total.toLocaleString()}` : '';
  $('#dMore').hidden = daiso.products.length >= daiso.total || !daiso.products.length;
  if (!daiso.products.length) { $('#dProducts').innerHTML = '<div class="empty">검색 결과가 없습니다.</div>'; return; }
  $('#dProducts').innerHTML = daiso.products.map((p, i) => `
    <div class="prow ${daiso.selected?.id === p.id ? 'picked' : ''}" data-i="${i}" tabindex="0">
      ${p.imageUrl ? `<span class="thumb zoomable" style="background-image:url('${esc(p.imageUrl)}')"${zoomAttr(p.imageUrl, p.name, `${won(p.price)}원 · 다이소 · 상품번호 ${p.id}`, 'daiso')}></span>` : '<span class="thumb ph">—</span>'}
      <div class="pmain">
        <div class="pname" title="${esc(p.name)}">${esc(p.name)}</div>
        <div class="ptags">${p.soldOut ? '<span class="badge err">온라인 품절</span>' : ''}${p.isNew ? '<span class="badge ok">NEW</span>' : ''}${p.pickupAvailable ? '<span class="badge off">매장픽업</span>' : ''}<span class="code">${esc(p.id)}</span></div>
      </div>
      <div class="price">${won(p.price)}<span class="muted">원</span></div>
    </div>`).join('');
}
$('#dProducts').onclick = e => { const r = e.target.closest('.prow[data-i]'); if (r) selectDaiso(daiso.products[r.dataset.i]); };
$('#dProducts').onkeydown = e => { if (e.key === 'Enter') e.target.closest('.prow')?.click(); };

const isNarrow = () => matchMedia('(max-width: 960px)').matches;
function selectDaiso(p) {
  daiso.selected = p;
  document.querySelectorAll('#dProducts .prow').forEach(r => r.classList.toggle('picked', daiso.products[r.dataset.i]?.id === p.id));
  loadDaisoStock(p);
  // 좁은 화면에서는 재고 결과가 목록 아래에 있으므로 그쪽으로 이동
  if (isNarrow()) $('#dDetail').closest('.panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadDaisoStock(p) {
  $('#dDetail').innerHTML = daisoHeader(p) + `<div class="table-wrap short"><table class="results"><tbody>${skelRows(6, 5)}</tbody></table></div>`;
  try {
    const center = await resolveLocation();
    // 다이소 재고 도구는 주소 텍스트로 매장을 찾으므로 시/군/구 이름을 함께 전달
    const storeQuery = region.gps ? '' : (region.gugun === '세종시' ? '세종' : region.gugun);
    const r = await api('/api/daiso/stock', { productId: p.id, lat: center.lat, lng: center.lng, storeQuery });
    log(r.call, `<div class="c">매장 ${r.stores.length}곳 · 재고 보유 ${r.stores.filter(s => s.qty > 0).length}곳</div>`);
    daiso.stock = r; daiso.center = center;
    renderDaisoStock();
  } catch (e) {
    $('#dDetail').innerHTML = daisoHeader(p) + `<div class="empty">재고 조회 실패: ${esc(e.message)} <button class="ghost" onclick="loadDaisoStock(daiso.selected)">다시 시도</button></div>`;
  }
}

function daisoHeader(p, stats = '') {
  return `<div class="dhead">
    ${p.imageUrl ? `<span class="thumb lg zoomable" style="background-image:url('${esc(p.imageUrl)}')"${zoomAttr(p.imageUrl, p.name, `${won(p.price)}원 · 다이소 · 상품번호 ${p.id}`)}></span>` : ''}
    <div class="pmain"><div class="dname">${esc(p.name)}</div>
      <div class="muted small">${won(p.price)}원 · 상품번호 ${esc(p.id)}</div></div>
    ${favStar(favFromDaiso(p))}
  </div>${stats}`;
}

function renderDaisoStock() {
  const p = daiso.selected, r = daiso.stock, c = daiso.center;
  const stores = r.stores.map(s => ({ ...s, km: distKm(c, s) ?? s.distanceKm })).sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
  const inStock = stores.filter(s => s.qty > 0);
  const nearest = inStock[0];
  const totalQty = inStock.reduce((a, s) => a + s.qty, 0);
  const stats = `<div class="mini-kpis">
    <div><span>재고 보유 매장</span><b>${inStock.length}<small>/${stores.length}곳</small></b></div>
    <div><span>가장 가까운 재고</span><b class="ell">${nearest ? `${esc(nearest.name)} <small>${fmtDist(nearest.km)}</small>` : '—'}</b></div>
    <div><span>매장 재고 합계</span><b>${totalQty.toLocaleString()}<small>개</small></b></div>
    <div><span>온라인 재고</span><b>${r.onlineStock ?? '—'}<small>${r.onlineStock != null ? '개' : ''}</small></b></div>
  </div>`;
  const list = $('#dInStockOnly').checked ? inStock : stores;
  if (storeView.daiso === 'map' && list.length) {
    $('#dDetail').innerHTML = daisoHeader(p, stats) + '<div class="store-map" id="dMap"></div>';
    drawStoreMap('dMap', c, list.map(s => ({ ...s, brand: 'daiso', sub: [s.open && `${s.open}–${s.close || ''}`, s.address].filter(Boolean).join(' · ') })));
    return;
  }
  const opt = o => [o.parking && '주차', o.pickup && '픽업', o.taxFree && '택스리펀', o.elevator && '엘리베이터'].filter(Boolean).map(t => `<span class="tag">${t}</span>`).join('');
  $('#dDetail').innerHTML = daisoHeader(p, stats) + (list.length ? `
    <div class="table-wrap short"><table class="results fixed">
      <colgroup><col><col style="width:84px"><col style="width:96px"><col style="width:120px"><col style="width:22%"><col style="width:150px"></colgroup>
      <thead><tr><th>매장</th><th class="num">거리</th><th class="num">재고</th><th>영업시간</th><th>편의시설</th><th>진열 위치</th></tr></thead>
      <tbody>${list.map(s => `
        <tr class="${s === nearest ? 'best' : ''}">
          <td><div class="pname">${esc(s.name)}</div><div class="muted small ell" title="${esc(s.address)}">${esc(s.address)}</div></td>
          <td class="num tnum">${fmtDist(s.km)}</td>
          <td class="num">${qtyBadge(s.qty)}</td>
          <td class="tnum small">${esc(s.open || '')}${s.close ? '–' + esc(s.close) : ''}</td>
          <td><div class="tags">${opt(s.options)}</div></td>
          <td>${s.qty > 0 ? `<button class="ghost small loc-btn" data-store="${esc(s.code)}">위치 보기</button>` : '<span class="muted small">—</span>'}</td>
        </tr>`).join('')}</tbody></table></div>`
    : `<div class="empty">${stores.length ? '재고가 있는 매장이 없습니다.' : `${esc(regionLabel())} 주변에서 다이소 매장을 찾지 못했습니다.<br><span class="small">다른 시/군/구를 선택해 보세요.</span>`}</div>`);
}

// 매장 내 진열 위치 (층·구역)
document.addEventListener('click', async e => {
  const b = e.target.closest('.loc-btn'); if (!b) return;
  b.disabled = true; b.textContent = '조회 중…';
  try {
    const r = await api('/api/daiso/display', { productId: daiso.selected.id, storeCode: b.dataset.store });
    log(r.call, `<div class="c">진열 위치 ${r.locations.length}곳</div>`);
    const floor = n => { const v = Number(n); return isNaN(v) ? n : v < 0 ? `B${-v}층` : `${v}층`; };
    b.outerHTML = r.hasLocation && r.locations.length
      ? `<span class="loc">${r.locations.map(l => `<b>${floor(l.stairNo)}</b> ${esc(l.zoneNo)}번 구역`).join('<br>')}</span>`
      : '<span class="muted small">위치 정보 없음</span>';
  } catch (err) { b.disabled = false; b.textContent = '다시 시도'; }
});

/* =========================================================
   편의점 전용
   ========================================================= */
const cvs = { keyword: '', selected: new Set(BRANDS.map(b => b.id)), results: {}, center: null, codes: {} };

function renderBrandToggles() {
  $('#cBrandToggles').innerHTML = BRANDS.map(b => `
    <button type="button" class="svc-tg ${cvs.selected.has(b.id) ? 'on' : ''}" data-id="${b.id}" style="--c:var(--s-${b.id})" aria-pressed="${cvs.selected.has(b.id)}"><i class="sw"></i>${b.name}</button>`).join('');
}
$('#cBrandToggles').onclick = e => {
  const b = e.target.closest('.svc-tg'); if (!b) return;
  const id = b.dataset.id;
  if (cvs.selected.has(id)) { if (cvs.selected.size > 1) cvs.selected.delete(id); } else cvs.selected.add(id);
  renderBrandToggles();
};
$('#cChips').innerHTML = CVS_CHIPS.map(([g, ws], i) => `${i ? '<span class="chips-sep"></span>' : ''}<span class="chips-label">${g}</span><div class="chips">${ws.map(w => `<button type="button" class="chip" data-q="${w}">${w}</button>`).join('')}</div>`).join('');
$('#cChips').onclick = e => { const c = e.target.closest('.chip'); if (c) { $('#cKeyword').value = c.dataset.q; runCvs(c.dataset.q); } };
$('#cForm').onsubmit = e => { e.preventDefault(); const q = $('#cKeyword').value.trim(); if (q) runCvs(q); };

$('#cNearMore').onclick = () => { cvs.nearAll = true; renderCvsSummary(); };

async function runCvs(keyword) {
  if (keyword !== cvs.keyword) cvs.codes = {};
  cvs.nearAll = false;
  cvs.keyword = keyword; cvs.results = {};
  const brands = BRANDS.filter(b => cvs.selected.has(b.id));
  $('#cBrands').style.setProperty('--n', brands.length);
  $('#cBrands').innerHTML = brands.map(b => `<div class="panel bcard" id="bc-${b.id}">${brandHead(b.id, '<span class="badge off">조회 중…</span>')}<div class="skel" style="margin:10px 0"></div><table class="results"><tbody>${skelRows(5, 3)}</tbody></table></div>`).join('');
  renderCvsSummary();
  let center;
  try { center = await resolveLocation(); }
  catch (e) { $('#cBrands').innerHTML = `<div class="panel empty">지역 위치를 찾지 못했습니다: ${esc(e.message)}</div>`; return; }
  cvs.center = center;
  $('#cK4').textContent = center.label; $('#cK4s').textContent = `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;
  await Promise.all(brands.map(b => loadBrand(b.id)));
}

async function loadBrand(id) {
  const card = $('#bc-' + id);
  if (card && cvs.results[id]) card.querySelector('.bhead .badge')?.replaceWith(Object.assign(document.createElement('span'), { className: 'badge off', textContent: '조회 중…' }));
  const sd = sidoOf(region.sido), c = cvs.center;
  try {
    const r = await api('/api/cvs/stock', {
      brand: id, q: cvs.keyword, lat: c.lat, lng: c.lng, region: region.gps ? '' : regionKeyword(),
      sido: region.gps ? '' : sd.full, gugun: region.gps ? '' : region.gugun, code: cvs.codes[id],
    });
    (r.calls || []).forEach(call => log(call, r.error ? `<div class="e">${BRAND[id].name}: ${esc(r.error)}</div>` : `<div class="c">${BRAND[id].name} 매장 ${r.stores.length}곳</div>`));
    r.stores.forEach(s => { s.km = distKm(c, s) ?? (s.distanceM != null ? s.distanceM / 1000 : null); });
    r.stores.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
    cvs.results[id] = r;
  } catch (e) { cvs.results[id] = { brand: id, error: e.message, stores: [], candidates: [], totals: {} }; }
  renderBrand(id); renderCvsSummary();
}

// "브랜드)상품명"에서 상품명 부분이 검색어로 시작하는지
function nameMatches(name, kw) {
  const body = name.replace(/^[^)]*\)/, '').replace(/\s/g, '');
  return body.startsWith(kw.replace(/\s/g, '').slice(0, 2));
}
function brandHead(id, badge, star = '') {
  return `<div class="bhead"><div class="svc-name" style="--c:var(--s-${id})"><i class="sw"></i>${BRAND[id].name}</div><span class="bhead-r">${badge}${star}</span></div>`;
}

function renderBrand(id) {
  const r = cvs.results[id], card = $('#bc-' + id); if (!card) return;
  const inStock = r.stores.filter(s => s.qty > 0);
  const badge = r.error ? '<span class="badge err">● 조회 실패</span>'
    : !r.product ? '<span class="badge off">상품 없음</span>'
    : inStock.length ? `<span class="badge ok">재고 매장 ${inStock.length}</span>` : '<span class="badge warn">주변 재고 없음</span>';
  const p = r.product || {};
  const candSelect = r.codeSelectable && r.candidates.length > 1
    ? `<select class="cand" data-brand="${id}" aria-label="${BRAND[id].name} 상품 선택">${r.candidates.map(c => `<option value="${esc(c.code)}" ${c.code === p.code ? 'selected' : ''}>${esc(c.name)}${c.price ? ` · ${won(c.price)}원` : ''}</option>`).join('')}</select>`
    : r.candidates.length > 1 ? `<details class="cands"><summary>검색된 후보 ${r.candidates.length}개 <span class="muted">(정확한 상품명으로 다시 검색하면 바뀝니다)</span></summary><ul>${r.candidates.map(c => `<li><span>${esc(c.name)}</span><span class="tnum">${c.price ? won(c.price) + '원' : ''}</span></li>`).join('')}</ul></details>` : '';
  card.innerHTML = brandHead(id, badge, r.error || !r.product?.name ? '' : favStar(favFromCvs(id, r))) + (r.error ? `
      <div class="empty">${esc(r.error)}<br><button class="ghost retry" data-brand="${id}" style="margin-top:6px">다시 시도</button></div>`
    : `<div class="bprod">
        ${p.imageUrl ? `<span class="thumb zoomable" style="background-image:url('${esc(p.imageUrl)}')"${zoomAttr(p.imageUrl, p.name, `${p.price != null ? won(p.price) + '원' : '가격 미제공'} · ${BRAND[id].name}`, 'cvs')}></span>` : '<span class="thumb ph">—</span>'}
        <div class="pmain"><div class="pname" title="${esc(p.name)}">${esc(p.name || '—')}</div>
          <div class="muted small">${p.price != null ? `<b class="price">${won(p.price)}</b>원` : '가격 미제공'} · <span class="code">${esc(p.code || '')}</span></div></div>
      </div>
      ${candSelect}
      <div class="bstats"><span>조회 매장 <b>${r.stores.length}</b>${r.totals.stores ? `<span class="muted">/${r.totals.stores}</span>` : ''}</span><span>재고 보유 <b>${inStock.length}</b></span><span>수량 합계 <b>${r.totals.qty ?? '—'}</b></span></div>
      ${r.note ? `<div class="svc-msg">ⓘ ${esc(r.note)}</div>` : ''}
      ${!r.codeSelectable && p.name && !nameMatches(p.name, cvs.keyword) ? `<div class="svc-msg warn-msg">⚠ 검색어와 다른 상품이 선택됐을 수 있습니다. 더 구체적인 이름으로 검색해 보세요 (예: "${esc(cvs.keyword)} 캔", "${esc(cvs.keyword)}500ml").</div>` : ''}
      <div class="bstores">${r.stores.length ? `<table class="results compact fixed"><colgroup><col><col style="width:64px"><col style="width:84px"></colgroup><tbody>${r.stores.map(s => `
        <tr><td><div class="pname" title="${esc(s.address || '')}">${esc(s.name)}</div>${s.tags?.length ? `<div class="tags">${s.tags.slice(0, 2).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}</td>
          <td class="num tnum muted">${fmtDist(s.km)}</td><td class="num">${qtyBadge(s.qty)}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">주변 매장 정보가 없습니다.</div>'}</div>`);
}

document.addEventListener('change', e => {
  const s = e.target.closest('select.cand'); if (!s) return;
  cvs.codes[s.dataset.brand] = s.value; loadBrand(s.dataset.brand);
});
document.addEventListener('click', e => { const b = e.target.closest('.retry'); if (b) loadBrand(b.dataset.brand); });

function renderCvsSummary() {
  const rs = Object.values(cvs.results).filter(r => !r.error);
  const all = rs.flatMap(r => r.stores.filter(s => s.qty > 0).map(s => ({ ...s, brand: r.brand, product: r.product?.name })))
    .sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
  const scanned = rs.reduce((a, r) => a + r.stores.length, 0);
  $('#cK1').innerHTML = rs.length ? `${all.length}<span class="unit">곳</span>` : '—';
  $('#cK1s').textContent = rs.length ? `조회 매장 ${scanned}곳 · ${rs.length}개 브랜드` : (cvs.keyword ? '조회 중…' : '지역과 상품을 선택하세요');
  const n = all[0];
  $('#cK2').innerHTML = n ? `${esc(n.name)} <span class="unit">${fmtDist(n.km)}</span>` : '—';
  $('#cK2s').innerHTML = n ? `${swatch(n.brand, BRAND[n.brand].name)} <span>재고 ${n.qty}개 · ${esc(n.product || '')}</span>` : '&nbsp;';
  const q = all.reduce((a, s) => a + s.qty, 0);
  $('#cK3').innerHTML = rs.length ? `${q.toLocaleString()}<span class="unit">개</span>` : '—';
  $('#cNearMeta').textContent = all.length ? `${all.length}곳` : '';
  // 좁은 화면에서는 처음 10곳만 보여주고 "더 보기"로 펼침
  const limit = isNarrow() && !cvs.nearAll ? 10 : 40;
  $('#cNear').innerHTML = all.length ? all.slice(0, limit).map(s => `
    <tr><td>${swatch(s.brand, BRAND[s.brand].name)}</td><td class="pname">${esc(s.name)}</td>
      <td class="num tnum">${fmtDist(s.km)}</td><td class="num">${qtyBadge(s.qty)}</td>
      <td class="ell small" title="${esc(s.product || '')}">${esc(s.product || '')}</td><td class="muted small ell" title="${esc(s.address || '')}">${esc(s.address || '')}</td></tr>`).join('')
    : `<tr><td colspan="6" class="empty">${rs.length ? '주변에 재고가 확인된 매장이 없습니다.' : '조회 결과가 여기에 모입니다.'}</td></tr>`;
  const more = Math.min(all.length, 40) - limit;
  $('#cNearMore').hidden = more <= 0;
  $('#cNearMore').textContent = `${more}곳 더 보기`;
  syncCvsMap();
}

/* ---------- 시작 ---------- */
renderRegions();
renderBrandToggles();
showTab(localStorage.getItem(TAB_KEY) || 'compare');
