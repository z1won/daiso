// 공유 링크 — 지금 보는 탭·검색어·지역·선택 상품을 URL에 담고, 그 링크로 열면 같은 화면을 다시 조회
// 현재 위치(GPS) 좌표는 개인정보라서 링크에 넣지 않습니다.

/* ---------- 알림 (토스트) ---------- */
const toastBox = Object.assign(document.createElement('div'), { className: 'toast-box' });
toastBox.setAttribute('aria-live', 'polite');
document.querySelector('.viz-root').append(toastBox);
function toast(html, ms = 2800) {
  const t = Object.assign(document.createElement('div'), { className: 'toast', innerHTML: html });
  toastBox.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, ms);
}

/* ---------- 링크 만들기 ---------- */
const currentTab = () => document.querySelector('.tab.on')?.dataset.tab || 'compare';
const TAB_NAMES = { compare: '가격 비교', daiso: '다이소', cvs: '편의점', fav: '즐겨찾기' };

function buildShareUrl() {
  const tab = currentTab(), p = new URLSearchParams();
  const base = location.origin + location.pathname;
  let note = '', title = 'PriceScope';
  if (tab === 'fav') return { url: base, title, note: '즐겨찾기는 이 브라우저에만 저장되어 앱 주소만 공유됩니다' };
  p.set('t', tab);

  if (tab === 'compare') {
    const kw = state.data?.keyword || $('#keyword').value.trim();
    if (kw) p.set('q', kw);
    if (state.selected.size < SERVICES.length) p.set('s', [...state.selected].join(','));
    if ($('#limit').value !== '10') p.set('n', $('#limit').value);
    title += kw ? ` · '${kw}' 가격 비교` : '';
  } else {
    if (region.gps) note = '현재 위치는 공유되지 않아 받는 사람의 지역 설정으로 조회됩니다';
    else { p.set('r1', region.sido); p.set('r2', region.gugun); if (region.dong) p.set('r3', region.dong); }
    const where = region.gps ? '' : ` (${regionText()})`;
    if (tab === 'daiso') {
      if (daiso.query) p.set('q', daiso.query);
      if (daiso.selected) { p.set('p', daiso.selected.id); p.set('pn', daiso.selected.name || ''); }
      title += daiso.selected ? ` · 다이소 '${daiso.selected.name}' 재고${where}` : daiso.query ? ` · 다이소 '${daiso.query}'` : '';
    } else {
      if (cvs.keyword) p.set('q', cvs.keyword);
      if (cvs.selected.size < BRANDS.length) p.set('b', [...cvs.selected].join(','));
      // 상품을 코드로 고를 수 있는 브랜드는 지금 보이는 상품 그대로 열리도록 코드도 담음
      const codes = Object.values(cvs.results).filter(r => r.codeSelectable && r.product?.code).map(r => `${r.brand}:${r.product.code}`);
      if (codes.length) p.set('c', codes.join(','));
      title += cvs.keyword ? ` · 편의점 '${cvs.keyword}' 재고${where}` : '';
    }
  }
  return { url: `${base}?${p}`, title, note };
}

async function shareCurrent() {
  const { url, title, note } = buildShareUrl();
  // 휴대폰에서는 시스템 공유 시트 (카카오톡 등으로 바로 전송)
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title, url }); if (note) toast(esc(note)); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(`<b>링크를 복사했습니다</b><div class="small">${esc(TAB_NAMES[currentTab()])} 화면${note ? ` · ${esc(note)}` : ''}</div>`);
  } catch {
    // 클립보드 권한이 없을 때: 직접 복사할 수 있게 표시
    toast(`<b>아래 링크를 복사하세요</b><input class="toast-url" readonly value="${esc(url)}" onclick="this.select()">`, 8000);
  }
}
$('#shareBtn').onclick = shareCurrent;

/* ---------- 링크로 열었을 때 화면 복원 ---------- */
async function applySharedUrl() {
  const q = new URLSearchParams(location.search);
  const tab = q.get('t');
  if (!['compare', 'daiso', 'cvs'].includes(tab)) return;
  history.replaceState(null, '', location.pathname + location.hash); // 새로고침 때 다시 적용되지 않도록 주소 정리
  const kw = (q.get('q') || '').trim().slice(0, 40);

  if (tab !== 'compare') {
    const sd = REGIONS.find(r => r.short === q.get('r1'));
    if (sd) {
      Object.assign(region, { sido: sd.short, gugun: sd.list.includes(q.get('r2')) ? q.get('r2') : sd.list[0], dong: (q.get('r3') || '').trim().slice(0, 15), gps: null });
      saveRegion(false);
    }
  }
  showTab(tab);
  if (!kw) return;

  if (tab === 'compare') {
    const s = (q.get('s') || '').split(',').filter(id => SVC[id]);
    if (s.length) { state.selected = new Set(s); renderToggles(); }
    if (['5', '10', '20'].includes(q.get('n'))) $('#limit').value = q.get('n');
    $('#keyword').value = kw; search();
  } else if (tab === 'daiso') {
    $('#dKeyword').value = kw;
    await searchDaiso();
    const pid = (q.get('p') || '').slice(0, 30);
    if (pid) selectDaiso(daiso.products.find(x => String(x.id) === pid) || { id: pid, name: (q.get('pn') || '').slice(0, 80) || `상품번호 ${pid}`, price: null, imageUrl: null });
  } else {
    const b = (q.get('b') || '').split(',').filter(id => BRAND[id]);
    if (b.length) { cvs.selected = new Set(b); renderBrandToggles(); }
    cvs.keyword = kw; cvs.codes = {};
    (q.get('c') || '').split(',').forEach(x => { const [brand, code] = x.split(':'); if (BRAND[brand] && code) cvs.codes[brand] = code.slice(0, 30); });
    $('#cKeyword').value = kw; runCvs(kw);
  }
  toast('<b>공유받은 화면을 열었습니다</b>');
}
applySharedUrl();
