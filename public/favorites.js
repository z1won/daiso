// 즐겨찾기 탭 — 다이소·편의점 재고 화면에서 ★로 저장한 상품을 저장 당시 지역 기준으로 한 번에 다시 조회
// app.js의 $, esc, won, log 와 local.js의 api, region, resolveLocation 등을 함께 사용합니다.

const FAV_KEY = 'ps-favorites';
const FAV_MAX = 20;
const FAV_STALE_MS = 2 * 60 * 1000; // 2분 안에 조회한 결과는 탭을 다시 열어도 재사용
const FAV_CONCURRENCY = 3;          // MCP 서버 부담을 줄이려고 동시에 3개씩만 조회

const loadFavs = () => { try { const a = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
let favs = loadFavs();
const favResults = new Map(); // key → { status: 'loading'|'ok'|'error', at, ... } (메모리에만 보관)
const favCandidates = new Map(); // ★ 버튼이 그려질 때 저장할 내용을 미리 담아 둠

/* ---------- 즐겨찾기 항목 만들기 ---------- */
const regionSnap = () => ({ sido: region.sido, gugun: region.gugun, dong: region.dong, gps: region.gps ? { ...region.gps } : null });
const regionSig = rg => rg.gps ? `gps:${rg.gps.lat.toFixed(3)},${rg.gps.lng.toFixed(3)}` : regionText(rg);
const favLabel = f => f.region.gps ? '저장한 현재 위치' : regionText(f.region);
const brandName = id => id === 'daiso' ? '다이소' : BRAND[id]?.name || id;

function withKey(f) {
  // 상품 코드로 다시 조회할 수 없는 브랜드(CU·세븐일레븐)는 검색어로 구분
  const ident = f.kind === 'daiso' || f.codeSelectable ? f.code : f.keyword;
  return { ...f, key: [f.brand, ident, regionSig(f.region)].join('|') };
}
function favFromDaiso(p) {
  return withKey({ kind: 'daiso', brand: 'daiso', code: p.id, name: p.name, price: p.price ?? null, imageUrl: p.imageUrl || null, region: regionSnap() });
}
function favFromCvs(id, r) {
  const p = r.product || {};
  return withKey({ kind: 'cvs', brand: id, code: p.code || null, keyword: cvs.keyword, codeSelectable: !!r.codeSelectable, name: p.name, price: p.price ?? null, imageUrl: p.imageUrl || null, region: regionSnap() });
}

/* ---------- ★ 버튼 ---------- */
const isFav = key => favs.some(f => f.key === key);
function favStar(f) {
  favCandidates.set(f.key, f);
  const on = isFav(f.key);
  return `<button type="button" class="fav-btn ${on ? 'on' : ''}" data-fav-key="${esc(f.key)}" aria-pressed="${on}" title="${on ? '즐겨찾기 해제' : `즐겨찾기에 추가 (${esc(regionLabel())} 기준)`}">${on ? '★' : '☆'}</button>`;
}
function syncStars() {
  document.querySelectorAll('.fav-btn').forEach(b => {
    const on = isFav(b.dataset.favKey);
    b.classList.toggle('on', on); b.textContent = on ? '★' : '☆'; b.setAttribute('aria-pressed', on);
    b.title = on ? '즐겨찾기 해제' : '즐겨찾기에 추가';
  });
}
function saveFavs() {
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  syncStars(); renderFavs();
}
document.addEventListener('click', e => {
  const b = e.target.closest('.fav-btn'); if (!b) return;
  const key = b.dataset.favKey;
  if (isFav(key)) favs = favs.filter(f => f.key !== key);
  else {
    const f = favCandidates.get(key); if (!f) return;
    if (favs.length >= FAV_MAX) { b.title = `즐겨찾기는 최대 ${FAV_MAX}개까지 저장할 수 있습니다`; b.classList.add('shake'); setTimeout(() => b.classList.remove('shake'), 400); return; }
    favs = [{ ...f, addedAt: Date.now() }, ...favs];
  }
  saveFavs();
});

/* ---------- 재고 다시 조회 ---------- */
async function checkFav(f) {
  const center = await resolveLocation(f.region);
  let stores, note = null, name = f.name, price = f.price;
  if (f.kind === 'daiso') {
    const storeQuery = f.region.gps ? '' : (f.region.gugun === '세종시' ? '세종' : f.region.gugun);
    const r = await api('/api/daiso/stock', { productId: f.code, lat: center.lat, lng: center.lng, storeQuery });
    log(r.call, `<div class="c">즐겨찾기 · 다이소 ${esc(f.name)}: 재고 보유 ${r.stores.filter(s => s.qty > 0).length}곳</div>`);
    stores = r.stores.map(s => ({ ...s, km: distKm(center, s) ?? s.distanceKm }));
  } else {
    const sd = sidoOf(f.region.sido), gps = !!f.region.gps;
    const r = await api('/api/cvs/stock', {
      brand: f.brand, q: f.keyword, lat: center.lat, lng: center.lng, region: gps ? '' : regionKeyword(f.region),
      sido: gps ? '' : sd.full, gugun: gps ? '' : f.region.gugun, code: f.codeSelectable ? f.code : undefined,
    });
    (r.calls || []).forEach(call => log(call, `<div class="${r.error ? 'e' : 'c'}">즐겨찾기 · ${brandName(f.brand)} ${esc(f.keyword)}${r.error ? ': ' + esc(r.error) : ''}</div>`));
    if (r.error) throw new Error(r.error);
    stores = r.stores.map(s => ({ ...s, km: distKm(center, s) ?? (s.distanceM != null ? s.distanceM / 1000 : null) }));
    note = r.note || null;
    if (r.product?.name) name = r.product.name; // CU·세븐일레븐은 검색어로 다시 고르므로 상품이 바뀔 수 있음
    if (r.product?.price != null) price = r.product.price;
  }
  const inStock = stores.filter(s => s.qty > 0).sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
  const known = stores.some(s => s.qty != null);
  return {
    stores: stores.length, inStock: inStock.length, nearest: inStock[0] || null, note, name, price,
    qty: known ? inStock.reduce((a, s) => a + s.qty, 0) : null,
  };
}

let favRunning = false;
async function refreshFavs(force = false) {
  const todo = favs.filter(f => {
    const r = favResults.get(f.key);
    return force || !r || (r.status !== 'loading' && Date.now() - r.at > FAV_STALE_MS);
  });
  if (!todo.length || favRunning) return;
  favRunning = true; $('#favRefresh').disabled = true;
  todo.forEach(f => favResults.set(f.key, { status: 'loading', at: Date.now() }));
  renderFavs();
  const queue = [...todo];
  const worker = async () => {
    for (let f; (f = queue.shift());) {
      try { favResults.set(f.key, { status: 'ok', at: Date.now(), ...(await checkFav(f)) }); }
      catch (e) { favResults.set(f.key, { status: 'error', at: Date.now(), error: e.message }); }
      renderFavs();
    }
  };
  await Promise.all(Array.from({ length: FAV_CONCURRENCY }, worker));
  favRunning = false; $('#favRefresh').disabled = false;
}

/* ---------- 화면 ---------- */
function fmtAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? '방금' : s < 3600 ? `${Math.floor(s / 60)}분 전` : `${Math.floor(s / 3600)}시간 전`;
}
function favStatus(r) {
  if (!r || r.status === 'loading') return '<span class="badge off">조회 중…</span>';
  if (r.status === 'error') return `<span class="badge err" title="${esc(r.error)}">● 조회 실패</span>`;
  if (r.inStock) return `<span class="badge ok">재고 매장 ${r.inStock}<small>/${r.stores}</small></span>`;
  if (!r.stores) return '<span class="badge off">주변 매장 없음</span>';
  return r.qty == null && !r.inStock ? '<span class="badge off">확인 불가</span>' : '<span class="badge warn">주변 재고 없음</span>';
}
function favDetail(r) {
  if (!r || r.status === 'loading') return '<div class="skel" style="width:60%"></div>';
  if (r.status === 'error') return `<span class="muted small ell" title="${esc(r.error)}">${esc(r.error)}</span>`;
  const near = r.nearest ? `가장 가까운 재고 <b>${esc(r.nearest.name)}</b> ${fmtDist(r.nearest.km)} · ${qtyBadge(r.nearest.qty)}` : '<span class="muted">재고가 확인된 매장이 없습니다</span>';
  return `<div class="small ell">${near}</div>${r.note ? `<div class="muted small ell" title="${esc(r.note)}">ⓘ ${esc(r.note)}</div>` : ''}`;
}

function renderFavs() {
  const cnt = $('#favCount');
  cnt.hidden = !favs.length; cnt.textContent = favs.length;
  $('#favMeta').textContent = favs.length ? `${favs.length}개` : '';
  $('#favRefresh').hidden = !favs.length;
  if (!favs.length) {
    $('#favList').innerHTML = '<div class="empty">저장한 상품이 없습니다.<br><span class="small">다이소 전용·편의점 전용 탭에서 재고를 조회한 뒤 ☆ 버튼을 누르면<br>그 상품과 지역이 여기에 저장되고, 이 탭을 열 때마다 재고를 다시 확인합니다.</span></div>';
    return;
  }
  $('#favList').innerHTML = favs.map(f => {
    const r = favResults.get(f.key), ok = r?.status === 'ok';
    const name = ok ? r.name : f.name, price = ok ? r.price : f.price;
    return `<div class="frow" data-key="${esc(f.key)}">
      ${f.imageUrl ? `<span class="thumb zoomable" style="background-image:url('${esc(f.imageUrl)}')"${zoomAttr(f.imageUrl, name, `${price != null ? won(price) + '원' : '가격 미제공'} · ${brandName(f.brand)}`, 'fav')}></span>` : '<span class="thumb ph">—</span>'}
      <div class="pmain">
        <div class="pname" title="${esc(name)}">${esc(name || f.keyword || '—')}</div>
        <div class="muted small ell">${swatch(f.brand, brandName(f.brand))} · ${esc(favLabel(f))}${price != null ? ` · ${won(price)}원` : ''}${f.kind === 'cvs' && !f.codeSelectable ? ` · 검색어 "${esc(f.keyword)}"` : ''}</div>
      </div>
      <div class="fstat">${favStatus(r)}${ok && r.qty != null ? `<span class="muted small">수량 ${r.qty.toLocaleString()}</span>` : ''}</div>
      <div class="fdetail">${favDetail(r)}</div>
      <div class="factions">
        ${r && r.status !== 'loading' ? `<span class="muted small" title="${new Date(r.at).toLocaleString('ko-KR')}">${fmtAgo(r.at)}</span>` : ''}
        <button type="button" class="ghost small fav-open" title="해당 탭에서 저장한 지역으로 열기">열기</button>
        <button type="button" class="ghost small fav-del" title="즐겨찾기 삭제" aria-label="삭제">✕</button>
      </div>
    </div>`;
  }).join('');
}

// 저장한 지역으로 바꾼 뒤 원래 탭에서 다시 조회
function openFav(f) {
  Object.assign(region, { sido: f.region.sido, gugun: f.region.gugun, dong: f.region.dong, gps: f.region.gps ? { ...f.region.gps } : null });
  saveRegion(false);
  if (f.kind === 'daiso') {
    showTab('daiso');
    const p = { id: f.code, name: f.name, price: f.price, imageUrl: f.imageUrl };
    daiso.selected = p;
    document.querySelectorAll('#dProducts .prow').forEach(r => r.classList.toggle('picked', daiso.products[r.dataset.i]?.id === p.id));
    loadDaisoStock(p);
  } else {
    showTab('cvs');
    $('#cKeyword').value = f.keyword;
    if (cvs.keyword !== f.keyword) { cvs.keyword = f.keyword; cvs.codes = {}; }
    if (f.codeSelectable && f.code) cvs.codes[f.brand] = f.code;
    cvs.selected.add(f.brand); renderBrandToggles();
    runCvs(f.keyword);
  }
}

$('#favList').onclick = e => {
  const row = e.target.closest('.frow'); if (!row) return;
  const f = favs.find(x => x.key === row.dataset.key); if (!f) return;
  if (e.target.closest('.fav-del')) { favs = favs.filter(x => x.key !== f.key); favResults.delete(f.key); saveFavs(); }
  else if (e.target.closest('.fav-open')) openFav(f);
};
$('#favRefresh').onclick = () => refreshFavs(true);
document.addEventListener('tabshown', e => { if (e.detail === 'fav') refreshFavs(); });
// 다른 브라우저 탭에서 즐겨찾기를 바꾼 경우 반영
window.addEventListener('storage', e => { if (e.key === FAV_KEY) { favs = loadFavs(); syncStars(); renderFavs(); } });

/* ---------- 시작 ---------- */
renderFavs();
if (!$('#view-fav').hidden) refreshFavs();
