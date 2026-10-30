// PriceScope 프론트엔드 — 서버의 /api/* 가 daiso-mcp 도구를 호출합니다.
const SERVICES = [
  { id: 'daiso', name: '다이소' },
  { id: 'gs25', name: 'GS25' },
  { id: 'seveneleven', name: '세븐일레븐' },
  { id: 'emart24', name: '이마트24' },
];
const SVC = Object.fromEntries(SERVICES.map(s => [s.id, s]));
const DEFAULT_SUGGEST = ['콜라', '삼각김밥', '컵라면', '생수', '초콜릿', '커피', '물티슈', '도시락'];

const $ = s => document.querySelector(s);
const won = n => (n == null ? '—' : n.toLocaleString('ko-KR'));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const color = id => `var(--s-${id})`;

const state = {
  selected: new Set(SERVICES.map(s => s.id)),
  data: null,
  sort: { key: 'price', dir: 1 },
  view: 'table',
  filter: '',
  pricedOnly: false,
};

/* ---------- 테마 ---------- */
const themeKey = 'ps-theme';
function applyTheme(t) { if (t) document.documentElement.dataset.theme = t; }
applyTheme(localStorage.getItem(themeKey));
$('#themeBtn').onclick = () => {
  const cur = document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next); localStorage.setItem(themeKey, next);
};

/* ---------- 서비스 토글 ---------- */
function renderToggles() {
  $('#serviceToggles').innerHTML = SERVICES.map(s => `
    <button type="button" class="svc-tg ${state.selected.has(s.id) ? 'on' : ''}" data-id="${s.id}" style="--c:${color(s.id)}" aria-pressed="${state.selected.has(s.id)}">
      <i class="sw"></i>${s.name}
    </button>`).join('');
}
$('#serviceToggles').onclick = e => {
  const b = e.target.closest('.svc-tg'); if (!b) return;
  const id = b.dataset.id;
  if (state.selected.has(id)) { if (state.selected.size > 1) state.selected.delete(id); }
  else state.selected.add(id);
  renderToggles();
};
$('#legend').innerHTML = SERVICES.map(s => `<span style="--c:${color(s.id)}"><i></i>${s.name}</span>`).join('');

/* ---------- 칩 (추천 / 최근) ---------- */
const recentKey = 'ps-recent';
const getRecent = () => JSON.parse(localStorage.getItem(recentKey) || '[]');
function pushRecent(k) {
  const r = [k, ...getRecent().filter(x => x !== k)].slice(0, 6);
  localStorage.setItem(recentKey, JSON.stringify(r)); renderRecent();
}
function chipsHtml(list) { return list.map(w => `<button type="button" class="chip" data-k="${esc(w)}">${esc(w)}</button>`).join(''); }
function renderRecent() { const r = getRecent(); $('#recentChips').innerHTML = r.length ? chipsHtml(r) : '<span class="muted small">없음</span>'; }
function renderSuggest(list) { $('#suggestChips').innerHTML = chipsHtml(list); }
document.addEventListener('click', e => {
  const c = e.target.closest('#view-compare .chip[data-k]'); if (!c) return;
  $('#keyword').value = c.dataset.k; search();
});

/* ---------- MCP 로그 ---------- */
function log(call, extra = '') {
  if (!call) return;
  const li = document.createElement('li');
  const t = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  li.innerHTML = `
    <div class="lh"><span><span class="muted">${t}</span> <span class="tool">tools/call → ${esc(call.tool)}</span></span>
    <span class="ms">${call.cached ? '<span class="c">cache</span>' : call.ms + 'ms'}</span></div>
    <div class="args">${esc(JSON.stringify(call.arguments))}</div>
    ${extra}`;
  $('#log').prepend(li);
}
$('#clearLog').onclick = () => { $('#log').innerHTML = ''; };

/* ---------- 상태 확인 ---------- */
async function health() {
  const pill = $('#mcpStatus');
  try {
    const r = await fetch('/api/health').then(r => r.json());
    if (!r.ok) throw new Error(r.error);
    pill.className = 'status-pill ok';
    pill.querySelector('span').textContent = `daiso-mcp 연결됨 · ${r.via === 'browser' ? '브라우저 직접' : '서버 경유'} · 도구 ${r.toolCount}개 · ${r.ms}ms`;
    pill.title = `${r.endpoint}\n${r.tools.join(', ')}`;
    log({ tool: '(tools/list)', arguments: { endpoint: r.endpoint }, ms: r.ms }, `<div class="c">도구 ${r.toolCount}개 확인</div>`);
  } catch (e) {
    pill.className = 'status-pill err';
    pill.querySelector('span').textContent = 'MCP 연결 실패';
  }
}

async function loadPopwords() {
  renderSuggest(DEFAULT_SUGGEST);
  try {
    const r = await fetch('/api/popwords').then(r => r.json());
    const words = extractWords(r.data);
    log(r.call, r.ok && words.length ? `<div class="c">인기 검색어 ${words.length}개</div>` : `<div class="e">인기 검색어 조회 실패 → 기본 추천어 사용</div>`);
    if (r.ok && words.length) { renderSuggest(words.slice(0, 10)); $('#chipsLabel').textContent = '세븐일레븐 인기'; }
  } catch { /* 기본 추천어 유지 */ }
}
function extractWords(d) {
  if (!d || d.error) return [];
  const arr = d.popwords || d.words || d.keywords || d.items || (Array.isArray(d) ? d : []);
  return arr.map(x => (typeof x === 'string' ? x : x.keyword || x.word || x.name || x.text)).filter(Boolean);
}

/* ---------- 검색 ---------- */
$('#searchForm').onsubmit = e => { e.preventDefault(); search(); };
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); document.querySelector('.view:not([hidden]) input[type=search]')?.focus(); }
  if (e.key === 'Escape') closeDrawer();
});

async function search() {
  const keyword = $('#keyword').value.trim();
  if (!keyword) return $('#keyword').focus();
  const services = SERVICES.map(s => s.id).filter(id => state.selected.has(id));
  const btn = $('#goBtn'); btn.disabled = true; btn.textContent = '조회 중…';
  showLoading(services);
  try {
    const qs = new URLSearchParams({ keyword, services: services.join(','), limit: $('#limit').value });
    const res = await fetch('/api/compare?' + qs);
    const r = await res.json();
    if (!res.ok) { log(r.call, `<div class="e">${esc(r.error)}</div>`); throw new Error(r.error); }
    log({ ...r.call, cached: r.cached },
      `<div class="c">결과 ${r.resultCount}건</div>` + (r.errors || []).map(e => `<div class="e">${esc(SVC[e.service]?.name || e.service)}: ${esc(e.message)}</div>`).join(''));
    state.data = normalize(r);
    pushRecent(keyword);
    render();
  } catch (e) {
    state.data = null;
    $('#svcSummary').innerHTML = `<div class="empty">조회에 실패했습니다: ${esc(e.message)}</div>`;
    $('#rows').innerHTML = `<tr><td colspan="6" class="empty">조회에 실패했습니다. 잠시 후 다시 시도해 주세요.</td></tr>`;
  } finally { btn.disabled = false; btn.textContent = '비교하기'; }
}

function normalize(r) {
  const items = (r.results || []).map((x, i) => ({
    idx: i, service: x.service, name: x.name, code: x.code,
    price: typeof x.price === 'number' ? x.price : null,
    originalPrice: typeof x.originalPrice === 'number' ? x.originalPrice : null,
    imageUrl: x.imageUrl || null, raw: x.raw || x,
    soldOut: x.raw?.soldOut, isNew: x.raw?.isNew, rating: x.raw?.rating,
  }));
  const priced = items.filter(x => x.price != null);
  const min = priced.length ? Math.min(...priced.map(x => x.price)) : null;
  items.forEach(x => { x.diff = x.price != null && min != null ? x.price - min : null; });
  const errs = Object.fromEntries((r.errors || []).map(e => [e.service, e.message]));
  return { keyword: r.keyword, requested: r.requested || r.services, items, priced, min, errs, best: r.bestPrice, note: r.note, ms: r.call?.ms, cached: r.cached };
}

function showLoading(services) {
  $('#svcSummary').innerHTML = services.map(id => `
    <div class="svc-row"><div class="svc-name" style="--c:${color(id)}"><i class="sw"></i>${SVC[id].name}</div><div class="svc-stat muted">조회 중</div>
    <div class="strip"><div class="skel" style="margin-top:3px"></div></div></div>`).join('');
  $('#rows').innerHTML = Array.from({ length: 8 }, () => `<tr><td><div class="thumb"></div></td><td><div class="skel" style="width:70%"></div></td><td><div class="skel" style="width:60px"></div></td><td><div class="skel" style="width:50px;margin-left:auto"></div></td><td></td><td></td></tr>`).join('');
}

/* ---------- 렌더 ---------- */
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

function render() {
  const d = state.data; if (!d) return;
  renderKpis(d); renderSummary(d); renderResults();
  $('#notes').className = d.note ? 'notes show' : 'notes';
  $('#notes').textContent = d.note ? 'ⓘ ' + d.note : '';
}

function renderKpis(d) {
  const svcWithResults = new Set(d.items.map(x => x.service)).size;
  $('#kCount').innerHTML = `${d.items.length}<span class="unit">건</span>`;
  $('#kCountSub').textContent = `"${d.keyword}" · ${svcWithResults}/${d.requested.length}개 서비스 응답`;
  const best = d.priced.find(x => x.price === d.min);
  if (best) {
    $('#kBest').innerHTML = `${won(best.price)}<span class="unit">원</span>`;
    $('#kBestSub').innerHTML = `<span class="svc-tag" style="--c:${color(best.service)}"><i class="sw"></i>${SVC[best.service]?.name}</span><span>${esc(best.name)}</span>`;
  } else { $('#kBest').textContent = '—'; $('#kBestSub').textContent = '가격 정보 없음'; }
  const pct = d.items.length ? Math.round(d.priced.length / d.items.length * 100) : 0;
  $('#kPriced').innerHTML = `${pct}<span class="unit">%</span>`;
  $('#kPricedSub').textContent = `${d.priced.length}/${d.items.length}개 상품 가격 공개`;
  $('#kMs').innerHTML = d.cached ? `캐시` : `${(d.ms / 1000).toFixed(2)}<span class="unit">초</span>`;
  $('#kMsSub').textContent = `compare_products${d.cached ? ' · 2분 캐시 사용' : ''}`;
}

function renderSummary(d) {
  const all = d.priced.map(x => x.price);
  const lo = all.length ? Math.min(...all) : 0, hi = all.length ? Math.max(...all) : 1;
  const span = Math.max(hi - lo, 1);
  const pos = p => ((p - lo) / span) * 100;
  $('#axisNote').textContent = all.length ? '모든 행이 같은 가격 축 사용' : '';

  const rows = d.requested.map(id => {
    const its = d.items.filter(x => x.service === id);
    const pr = its.filter(x => x.price != null).map(x => x.price);
    const name = `<div class="svc-name" style="--c:${color(id)}"><i class="sw"></i>${SVC[id]?.name || id}</div>`;
    if (d.errs[id]) return `<div class="svc-row">${name}<div><span class="badge err">● 조회 실패</span></div><div class="svc-msg">${esc(d.errs[id])}</div></div>`;
    if (!its.length) return `<div class="svc-row">${name}<div><span class="badge off">결과 없음</span></div></div>`;
    if (!pr.length) return `<div class="svc-row">${name}<div class="svc-stat"><b>${its.length}</b>개 · <span class="badge warn">가격 미제공</span></div><div class="svc-msg">상품은 검색되지만 이 서비스는 가격을 공개하지 않습니다.</div></div>`;
    const mn = Math.min(...pr), mx = Math.max(...pr), md = median(pr);
    const dots = its.filter(x => x.price != null).map(x =>
      `<span class="dot" data-idx="${x.idx}" style="left:${pos(x.price)}%;--c:${color(id)}"></span>`).join('');
    return `<div class="svc-row">${name}
      <div class="svc-stat"><b>${its.length}</b>개 · 최저 <b>${won(mn)}</b> · 중앙 ${won(md)} · 최고 ${won(mx)}</div>
      <div class="strip" style="--c:${color(id)}"><div class="track"></div>
        <div class="range" style="left:${pos(mn)}%;width:${Math.max(pos(mx) - pos(mn), 0.5)}%"></div>${dots}</div></div>`;
  }).join('');
  $('#svcSummary').innerHTML = rows + (all.length ? `<div class="axis"><span>${won(lo)}원</span><span>${won(Math.round((lo + hi) / 2))}원</span><span>${won(hi)}원</span></div>` : '');
}

function visibleItems() {
  const d = state.data; if (!d) return [];
  const f = state.filter.toLowerCase();
  let list = d.items.filter(x => (!f || x.name.toLowerCase().includes(f)) && (!state.pricedOnly || x.price != null));
  const { key, dir } = state.sort;
  const val = x => key === 'service' ? (SVC[x.service]?.name || '') : key === 'name' ? x.name : x[key];
  return list.sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1; if (vb == null) return -1; // 가격 없는 상품은 항상 뒤로
    return (typeof va === 'string' ? va.localeCompare(vb, 'ko') : va - vb) * dir;
  });
}

function priceCell(x) {
  if (x.price == null) return `<span class="price na">가격 미제공</span>`;
  const orig = x.originalPrice && x.originalPrice > x.price ? `<span class="orig">${won(x.originalPrice)}</span>` : '';
  return `${orig}<span class="price">${won(x.price)}</span><span class="muted">원</span>`;
}
function diffCell(x) {
  if (x.diff == null) return `<span class="diff">—</span>`;
  if (x.diff === 0) return `<span class="diff zero">최저가</span>`;
  const pct = Math.round(x.diff / state.data.min * 100);
  return `<span class="diff">+${won(x.diff)}원 <span class="muted">(${pct}%)</span></span>`;
}
function tags(x) {
  const t = [];
  if (x.soldOut) t.push('<span class="badge err">품절</span>');
  if (x.isNew) t.push('<span class="badge ok">NEW</span>');
  if (x.rating) t.push(`<span class="badge off">★ ${x.rating}</span>`);
  return t.length ? `<div class="ptags">${t.join('')}</div>` : '';
}

function renderResults() {
  const list = visibleItems();
  const d = state.data;
  $('#resultMeta').textContent = d ? `${list.length} / ${d.items.length}` : '';
  const sortOpt = `${state.sort.key}:${state.sort.dir}`; // 모바일 정렬 선택과 표 머리글 정렬을 같은 상태로
  if ([...$('#mSort').options].some(o => o.value === sortOpt)) $('#mSort').value = sortOpt;
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.classList.toggle('sorted', th.dataset.sort === state.sort.key);
    th.classList.toggle('desc', th.dataset.sort === state.sort.key && state.sort.dir < 0);
  });
  if (!list.length) {
    $('#rows').innerHTML = `<tr><td colspan="6" class="empty">조건에 맞는 상품이 없습니다.</td></tr>`;
    $('#cards').innerHTML = `<div class="empty">조건에 맞는 상품이 없습니다.</div>`;
    return;
  }
  $('#rows').innerHTML = list.map(x => `
    <tr data-idx="${x.idx}" class="${x.diff === 0 ? 'best' : ''}">
      <td>${x.imageUrl ? `<span class="thumb zoomable" style="background-image:url('${esc(x.imageUrl)}')"${zoomAttr(x.imageUrl, x.name, `${x.price != null ? won(x.price) + '원' : '가격 미제공'} · ${SVC[x.service]?.name || x.service}`, 'compare')}></span>` : `<span class="thumb ph">—</span>`}</td>
      <td><div class="pname" title="${esc(x.name)}">${esc(x.name)}</div>${tags(x)}</td>
      <td><span class="svc-tag" style="--c:${color(x.service)}"><i class="sw"></i>${SVC[x.service]?.name || x.service}</span></td>
      <td class="num">${priceCell(x)}</td>
      <td class="num">${diffCell(x)}</td>
      <td><span class="code">${esc(x.code)}</span></td>
    </tr>`).join('');
  $('#cards').innerHTML = list.map(x => `
    <div class="card ${x.diff === 0 ? 'best' : ''}" data-idx="${x.idx}">
      <div class="img ${x.imageUrl ? 'zoomable' : ''}" style="${x.imageUrl ? `background-image:url('${esc(x.imageUrl)}')` : ''}"${zoomAttr(x.imageUrl, x.name, `${x.price != null ? won(x.price) + '원' : '가격 미제공'} · ${SVC[x.service]?.name || x.service}`, 'compare')}>${x.imageUrl ? '' : '이미지 없음'}</div>
      <div class="t">${esc(x.name)}</div>
      <div class="b"><span class="svc-tag" style="--c:${color(x.service)}"><i class="sw"></i>${SVC[x.service]?.name}</span><span>${priceCell(x)}</span></div>
    </div>`).join('');
}

/* 정렬 / 필터 / 보기 */
document.querySelectorAll('th[data-sort]').forEach(th => th.onclick = () => {
  const k = th.dataset.sort;
  state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : 1 };
  renderResults();
});
$('#filter').oninput = e => { state.filter = e.target.value; renderResults(); };
// 모바일: 표 머리글이 숨겨지므로 정렬을 선택 상자로
$('#mSort').onchange = e => { const [key, dir] = e.target.value.split(':'); state.sort = { key, dir: Number(dir) }; renderResults(); };
$('#pricedOnly').onchange = e => { state.pricedOnly = e.target.checked; renderResults(); };
// 가격 비교 탭의 표/카드 전환만 (다이소·편의점의 목록/지도 전환도 .seg 스타일을 쓰므로 범위를 좁힘)
document.querySelectorAll('#view-compare .seg button').forEach(b => b.onclick = () => {
  state.view = b.dataset.view;
  document.querySelectorAll('#view-compare .seg button').forEach(x => x.classList.toggle('on', x === b));
  $('#tableWrap').hidden = state.view !== 'table';
  $('#cards').hidden = state.view !== 'grid';
});

/* ---------- 툴팁 (가격 범위 점) ---------- */
const tip = $('#tooltip');
document.addEventListener('mouseover', e => {
  const dot = e.target.closest('.dot');
  if (!dot || !state.data) return;
  const x = state.data.items[dot.dataset.idx];
  tip.innerHTML = `${esc(x.name)}<br><b>${won(x.price)}원</b> · ${SVC[x.service].name}${x.diff ? ` · 최저가 +${won(x.diff)}원` : ' · 최저가'}`;
  tip.classList.add('show');
  const r = dot.getBoundingClientRect();
  tip.style.left = Math.min(r.left, innerWidth - 270) + 'px';
  tip.style.top = (r.top - tip.offsetHeight - 8) + 'px';
});
document.addEventListener('mouseout', e => { if (e.target.closest('.dot')) tip.classList.remove('show'); });

/* ---------- 상세 드로어 ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('#view-compare tr[data-idx], #view-compare .card[data-idx], #view-compare .dot[data-idx]');
  if (el && state.data) openDrawer(state.data.items[el.dataset.idx]);
});
function openDrawer(x) {
  $('#dTitle').textContent = x.name;
  $('#dBody').innerHTML = `
    ${x.imageUrl ? `<div class="d-img zoomable" style="background-image:url('${esc(x.imageUrl)}')"${zoomAttr(x.imageUrl, x.name, `${x.price != null ? won(x.price) + '원' : '가격 미제공'} · ${SVC[x.service]?.name || x.service}`)}></div>` : ''}
    <dl class="kv">
      <dt>매장</dt><dd><span class="svc-tag" style="--c:${color(x.service)}"><i class="sw"></i>${SVC[x.service]?.name}</span></dd>
      <dt>가격</dt><dd>${priceCell(x)}</dd>
      <dt>최저가 대비</dt><dd>${diffCell(x)}</dd>
      <dt>상품 코드</dt><dd class="code">${esc(x.code)}</dd>
    </dl>
    <h2 style="margin-bottom:6px">MCP 원본 데이터 (raw)</h2>
    <pre class="raw">${esc(JSON.stringify(x.raw, null, 2))}</pre>`;
  $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');
}
function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); }
$('#dClose').onclick = closeDrawer;

/* ---------- 시작 ---------- */
renderToggles(); renderRecent(); health(); loadPopwords();
