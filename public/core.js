// PriceScope 공용 로직 — 브라우저(GitHub Pages)와 Node 서버(server.js)가 함께 사용합니다.
// - MCP Streamable HTTP 클라이언트 (fetch만 사용, 의존성 없음)
// - /api/* 경로별 처리 함수 (MCP 도구 호출 + 응답 정리)
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PriceCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* ================= MCP 클라이언트 ================= */
const MCP_URL = (typeof process !== 'undefined' && process.env && process.env.MCP_URL) || 'https://mcp.aka.page';
let sessionId = null;
let initPromise = null;
let nextId = 1;

async function rpc(method, params, isNotification = false) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const body = { jsonrpc: '2.0', method, params };
  if (!isNotification) body.id = nextId++;
  const res = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  if (isNotification) return null;
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  let msg;
  if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
    // SSE: 마지막 data 라인 중 id가 일치하는 응답을 사용
    const datas = text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim());
    for (const d of datas) { try { const m = JSON.parse(d); if (m.id === body.id) msg = m; } catch {} }
  } else msg = JSON.parse(text);
  if (!msg) throw new Error('MCP 응답을 해석할 수 없습니다');
  if (msg.error) throw new Error(msg.error.message || 'MCP error');
  return msg.result;
}

async function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await rpc('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'price-compare-web', version: '1.0.0' },
      });
      await rpc('notifications/initialized', {}, true);
    })().catch(e => { initPromise = null; throw e; });
  }
  return initPromise;
}

async function callTool(name, args) {
  await init();
  let result;
  try { result = await rpc('tools/call', { name, arguments: args }); }
  catch (e) { // 세션 만료 시 재연결 1회
    sessionId = null; initPromise = null; await init();
    result = await rpc('tools/call', { name, arguments: args });
  }
  const text = (result.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  let data = result.structuredContent;
  if (!data) { try { data = JSON.parse(text); } catch { data = null; } }
  return { isError: !!result.isError, data, text };
}

async function listTools() { await init(); return (await rpc("tools/list", {})).tools || []; }

/* ================= API 처리 ================= */
const ALL_SERVICES = ['daiso', 'gs25', 'seveneleven', 'emart24'];
const cache = new Map(); // 같은 검색은 2분간 재사용
const CACHE_MS = 2 * 60 * 1000;

async function timed(name, args) {
  const t = Date.now();
  const r = await callTool(name, args);
  return { ...r, call: { tool: name, arguments: args, ms: Date.now() - t, isError: r.isError } };
}

const routes = {
  async '/api/health'() {
    const t = Date.now();
    const tools = await listTools();
    return { ok: true, via: typeof window !== 'undefined' ? 'browser' : 'server', endpoint: MCP_URL, toolCount: tools.length, tools: tools.map(t => t.name), ms: Date.now() - t };
  },

  async '/api/compare'(q) {
    const keyword = (q.get('keyword') || '').trim().slice(0, 50);
    if (!keyword) throw Object.assign(new Error('검색어를 입력하세요'), { status: 400 });
    const services = (q.get('services') || ALL_SERVICES.join(','))
      .split(',').filter(s => ALL_SERVICES.includes(s));
    if (!services.length) throw Object.assign(new Error('서비스를 하나 이상 선택하세요'), { status: 400 });
    const limit = Math.min(Math.max(Number(q.get('limit')) || 10, 1), 30);
    const args = { keyword, services: services.join(','), limit };

    const key = JSON.stringify(args);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit.body, cached: true };

    const r = await timed('compare_products', args);
    if (r.isError || !r.data) throw Object.assign(new Error(r.data?.error?.message || r.text || 'MCP 오류'), { status: 502, call: r.call });
    const body = { ...r.data, requested: services, call: r.call, cached: false };
    cache.set(key, { at: Date.now(), body });
    return body;
  },

  async '/api/popwords'() {
    const r = await timed('get_catalog', { operation: 'popwords', timeoutMs: 8000 });
    return { ok: !r.isError && !r.data?.error, data: r.data, call: r.call };
  },

  /* ---------- 지역 → 좌표 (GS25 매장 검색의 지오코딩 활용) ---------- */
  async '/api/geocode'(q) {
    const query = need(q, 'q');
    if (geoCache.has(query)) return { ...geoCache.get(query), cached: true };
    const r = await timed('find_stores', { service: 'gs25', keyword: query, limit: 1 });
    const loc = r.data?.location;
    if (!loc?.latitude) throw httpErr(404, `"${query}" 위치를 찾지 못했습니다`, r.call);
    const body = { query, lat: loc.latitude, lng: loc.longitude, call: r.call };
    geoCache.set(query, body);
    return body;
  },

  /* ---------- 다이소 전용 ---------- */
  async '/api/daiso/search'(q) {
    const query = need(q, 'q');
    const page = Number(q.get('page')) || 1;
    const r = await timed('search_products', { service: 'daiso', query, page, pageSize: 24 });
    if (r.isError || r.data?.error) throw httpErr(502, errMsg(r), r.call);
    return { query, page, totalCount: r.data.totalCount, products: r.data.products || [], call: r.call };
  },

  async '/api/daiso/stock'(q) {
    // 다이소 재고 도구는 storeQuery(매장명·주소 텍스트)로 매장을 찾고, 좌표는 거리 계산에 사용
    const args = { service: 'daiso', operation: 'by_id', productId: need(q, 'productId'), pageSize: 40, ...coords(q) };
    if (q.get('storeQuery')) args.storeQuery = q.get('storeQuery').slice(0, 30);
    const r = await timed('check_inventory', args);
    if (r.isError || r.data?.error) throw httpErr(502, errMsg(r), r.call);
    const d = r.data;
    return {
      product: d.product, onlineStock: d.onlineStock, location: d.location,
      summary: d.storeInventory && {
        total: d.storeInventory.totalStores, inStock: d.storeInventory.inStockCount,
        outOfStock: d.storeInventory.outOfStockCount, unknown: d.storeInventory.unknownStockCount,
      },
      stores: (d.storeInventory?.stores || []).map(s => ({
        code: s.storeCode, name: s.storeName, address: s.address, phone: s.phone, lat: s.lat, lng: s.lng,
        open: s.openTime, close: s.closeTime, distanceKm: s.distance != null ? Number(s.distance) : null,
        qty: s.quantity, options: s.options || {},
      })).filter(s => s.distanceKm == null || s.distanceKm < (args.latitude ? 40 : 300)) // 같은 이름의 다른 지역 구(중구 등)·좌표 오류 매장 제외
        .sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9)),
      call: r.call,
    };
  },

  async '/api/daiso/display'(q) {
    const args = { service: 'daiso', operation: 'display_location', productId: need(q, 'productId'), storeCode: need(q, 'storeCode') };
    const r = await timed('get_product_details', args);
    if (r.isError || r.data?.error) throw httpErr(502, errMsg(r), r.call);
    return { hasLocation: r.data.hasLocation, locations: r.data.locations || [], call: r.call };
  },

  /* ---------- 편의점 전용 (브랜드별 1회 호출) ---------- */
  async '/api/cvs/stock'(q) {
    const brand = q.get('brand');
    if (!CVS[brand]) throw httpErr(400, '지원하지 않는 편의점입니다');
    return CVS[brand](q, need(q, 'q'));
  },
};

/* ---------- 편의점 브랜드별 어댑터: 응답 형태를 하나로 맞춤 ---------- */
// 결과 형태: { brand, product{name,price,imageUrl,code}, candidates[{code,name,price}], codeSelectable,
//            totals{stores,inStock,qty}, stores[{name,address,distanceM,qty,soldOut,tags}], calls[] }
const STORE_LIMIT = 20;
const CVS = {
  async gs25(q, keyword) {
    const calls = [];
    let code = q.get('code');
    // GS25는 키워드만 주면 엉뚱한 상품을 고르는 경우가 있어 후보를 먼저 받아 가장 알맞은 상품을 선택
    const s = await timed('search_products', { service: 'gs25', keyword, limit: 12 });
    calls.push(s.call);
    const cands = (s.data?.products || []).map(p => ({ code: p.itemCode, name: p.itemName, price: null, imageUrl: p.imageUrl }));
    if (!cands.length) return emptyBrand('gs25', calls, '검색된 상품이 없습니다');
    if (!code) code = pickBest(cands, keyword).code;
    const r = await timed('check_inventory', { service: 'gs25', itemCode: code, keyword, storeLimit: STORE_LIMIT, ...coords(q), ...(q.get('lat') ? {} : { storeKeyword: q.get('region') || undefined }) });
    calls.push(r.call);
    if (r.isError || r.data?.error) return errBrand('gs25', calls, errMsg(r), cands, code);
    const d = r.data, inv = d.inventory || {};
    const chosen = cands.find(c => c.code === code) || {};
    return {
      brand: 'gs25', codeSelectable: true, candidates: cands,
      product: { code, name: d.product?.name || chosen.name, price: d.product?.sellPrice ?? null, imageUrl: d.product?.imageUrl || chosen.imageUrl },
      totals: { stores: inv.matchedStoreCount ?? inv.totalStoreCount, inStock: inv.inStockStoreCount, qty: inv.totalStockQuantity },
      stores: (inv.stores || []).map(s => ({ name: s.storeName, address: s.address, phone: s.phone, lat: s.latitude, lng: s.longitude, distanceM: s.distanceM, qty: s.realStockQuantity, soldOut: s.isSoldOut, tags: (s.propertyNames || []).slice(0, 4) })),
      calls,
    };
  },

  async cu(q, keyword) {
    const r = await timed('check_inventory', { service: 'cu', keyword, storeLimit: STORE_LIMIT, size: 10, ...coords(q), ...(q.get('lat') ? {} : { storeKeyword: q.get('region') || undefined }) });
    if (r.isError || r.data?.error) return errBrand('cu', [r.call], errMsg(r));
    const d = r.data, ns = d.nearbyStores || {}, items = d.inventory?.items || [];
    const cands = items.map(i => ({ code: i.itemCode, name: i.itemName, price: i.price }));
    const chosen = cands.find(c => c.code === ns.stockItemCode) || { code: ns.stockItemCode, name: ns.stockItemName };
    const stores = (ns.stores || []).map(s => ({ name: s.storeName, address: s.address, phone: s.phone, lat: s.latitude, lng: s.longitude, distanceM: s.distanceM, qty: s.stock, soldOut: s.stock === 0, tags: [s.deliveryYn && '배달', s.pickupYn && '픽업'].filter(Boolean) }));
    return {
      brand: 'cu', codeSelectable: false, candidates: cands, product: { ...chosen, imageUrl: null },
      note: ns.available === false ? ns.unavailableReason : null,
      totals: { stores: ns.totalCount, inStock: stores.filter(s => s.qty > 0).length, qty: sum(stores.map(s => s.qty)) },
      stores, calls: [r.call],
    };
  },

  async seveneleven(q, keyword) {
    // 세븐일레븐 재고 도구는 좌표를 받지 않으므로 지역명을 키워드로 전달
    const r = await timed('check_inventory', { service: 'seveneleven', keyword, storeLimit: STORE_LIMIT, storeKeyword: q.get('region') || undefined });
    if (r.isError || r.data?.error) return errBrand('seveneleven', [r.call], errMsg(r));
    const d = r.data, inv = d.inventory || {};
    const stores = (inv.stores || []).map(s => ({ name: s.storeName, address: s.address, lat: s.latitude, lng: s.longitude, distanceM: s.distanceM, qty: s.stockQuantity, soldOut: s.isSoldOut, tags: [] }));
    return {
      brand: 'seveneleven', codeSelectable: false, candidates: [],
      product: { code: d.product?.itemCode, name: d.product?.itemName, price: d.product?.salePrice ?? null, imageUrl: d.product?.imageUrl || null },
      note: d.stockAvailable === false ? (d.stockError || '실시간 재고 미제공') : null,
      totals: { stores: inv.totalStoreCount, inStock: inv.inStockStoreCount, qty: sum(stores.map(s => s.qty)) },
      stores, calls: [r.call],
    };
  },

  async emart24(q, keyword) {
    const calls = [];
    const base = { service: 'emart24', keyword, storeLimit: STORE_LIMIT, productPageSize: 12, ...coords(q) };
    if (q.get('sido')) base.area1 = q.get('sido');
    if (q.get('gugun')) base.area2 = q.get('gugun');
    let code = q.get('code');
    let r = await timed('check_inventory', code ? { ...base, pluCd: code } : base);
    calls.push(r.call);
    if (r.isError || r.data?.error) return errBrand('emart24', calls, errMsg(r));
    const cands = (r.data.productCandidates || []).map(p => ({ code: p.pluCd, name: p.goodsName, price: p.viewPrice }));
    // 자동 선택된 상품이 검색어와 맞지 않으면 더 알맞은 후보로 다시 조회
    if (!code && cands.length) {
      const best = pickBest(cands, keyword);
      if (best.code !== r.data.pluCd) { r = await timed('check_inventory', { ...base, pluCd: best.code }); calls.push(r.call); }
    }
    const d = r.data || {}, gi = d.inventory?.goodsInfo || {};
    const qtyBy = new Map((d.inventory?.stores || []).map(s => [s.bizNo, s.bizQty]));
    const stores = (d.nearbyStores?.stores || []).map(s => {
      const qty = qtyBy.has(s.storeCode) ? qtyBy.get(s.storeCode) : null;
      return { name: s.storeName, address: s.address, phone: s.phone, lat: s.latitude, lng: s.longitude, distanceM: s.distanceM, qty, soldOut: qty === 0, tags: [(s.service24h || s.openTime === s.closeTime) ? '24시간' : s.openTime && `${fmtHm(s.openTime)}~${fmtHm(s.closeTime)}`].filter(Boolean) };
    });
    return {
      brand: 'emart24', codeSelectable: true, candidates: cands,
      product: { code: d.pluCd, name: gi.goodsNm || cands.find(c => c.code === d.pluCd)?.name, price: gi.salePrice ?? gi.viewPrice ?? null, imageUrl: null },
      totals: { stores: d.nearbyStores?.totalCount, inStock: stores.filter(s => s.qty > 0).length, qty: sum(stores.map(s => s.qty)) },
      stores, calls,
    };
  },
};

/* ---------- 도우미 ---------- */
const geoCache = new Map();
function httpErr(status, message, call) { return Object.assign(new Error(message), { status, call }); }
function need(q, k) { const v = (q.get(k) || '').trim().slice(0, 60); if (!v) throw httpErr(400, `${k} 값이 필요합니다`); return v; }
function coords(q) { const lat = Number(q.get('lat')), lng = Number(q.get('lng')); return lat && lng ? { latitude: lat, longitude: lng } : {}; }
function errMsg(r) { return r.data?.error?.message || r.data?.diagnostics?.hint || r.text?.slice(0, 200) || 'MCP 오류'; }
function sum(a) { const n = a.filter(x => typeof x === 'number'); return n.length ? n.reduce((s, x) => s + x, 0) : null; }
function fmtHm(s) { return s && s.length === 4 ? `${s.slice(0, 2)}:${s.slice(2)}` : s; }
// "브랜드)상품명" 형태에서 상품명 부분에 검색어가 들어간 후보를 우선 선택
function pickBest(cands, kw) {
  const k = kw.replace(/\s/g, '');
  const body = n => (n || '').replace(/^[^)]*\)/, '').replace(/\s/g, '');
  return cands.find(c => body(c.name).startsWith(k)) || cands.find(c => body(c.name).includes(k))
    || cands.find(c => (c.name || '').includes(k)) || cands[0];
}
function emptyBrand(brand, calls, msg) { return { brand, product: null, candidates: [], stores: [], totals: {}, note: msg, calls }; }
function errBrand(brand, calls, msg, candidates = [], code) { return { brand, error: msg, product: code ? { code } : null, candidates, codeSelectable: !!candidates.length, stores: [], totals: {}, calls }; }

/* 경로와 쿼리를 받아 결과 객체를 돌려줌 (실패 시 status·call이 붙은 Error를 던짐) */
async function handle(pathname, params) {
  const handler = routes[pathname];
  if (!handler) throw httpErr(404, `알 수 없는 API: ${pathname}`);
  return handler(params instanceof URLSearchParams ? params : new URLSearchParams(params || ''));
}

return { handle, routes, callTool, listTools, MCP_URL };
});
