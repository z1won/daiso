// 제품 사진 크게 보기 (라이트박스)
// 사용법: 썸네일 요소에 zoomAttr(이미지URL, 상품명, 보조설명, 그룹) 결과를 속성으로 붙이면 클릭 시 크게 보입니다.
// 같은 그룹의 사진은 ← → 키나 화살표 버튼으로 넘겨볼 수 있습니다.

function zoomAttr(url, title = '', sub = '', group = '') {
  if (!url) return '';
  const q = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return ` data-zoom="${q(url)}" data-cap="${q(title)}" data-sub="${q(sub)}" data-group="${q(group)}" role="button" tabindex="0" title="클릭하면 사진을 크게 봅니다"`;
}

(() => {
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.hidden = true;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', '제품 사진 크게 보기');
  box.innerHTML = `
    <div class="lb-backdrop"></div>
    <button class="lb-btn lb-close" aria-label="닫기 (Esc)">✕</button>
    <button class="lb-btn lb-nav lb-prev" aria-label="이전 사진 (←)">‹</button>
    <button class="lb-btn lb-nav lb-next" aria-label="다음 사진 (→)">›</button>
    <figure class="lb-fig">
      <div class="lb-stage"><img class="lb-img" alt=""><div class="lb-msg"></div></div>
      <figcaption class="lb-cap">
        <div class="lb-text"><div class="lb-title"></div><div class="lb-sub"></div></div>
        <div class="lb-tools">
          <span class="lb-count"></span>
          <span class="lb-hint">사진 클릭: 확대 · ←→ 이동 · Esc 닫기</span>
          <a class="lb-open" target="_blank" rel="noopener">원본 열기 ↗</a>
        </div>
      </figcaption>
    </figure>
    <div class="lb-strip"></div>`;
  (document.querySelector('.app') || document.body).appendChild(box);

  const $b = s => box.querySelector(s);
  const img = $b('.lb-img'), stage = $b('.lb-stage');
  let items = [], idx = 0, zoomed = false, lastFocus = null;

  const visible = el => el.offsetParent !== null || el.closest('.drawer.open');
  function collect(target) {
    const g = target.dataset.group;
    if (!g) return [target];
    const seen = new Set();
    return [...document.querySelectorAll(`[data-zoom][data-group="${CSS.escape(g)}"]`)]
      .filter(visible)
      .filter(el => !seen.has(el.dataset.zoom + el.dataset.cap) && seen.add(el.dataset.zoom + el.dataset.cap));
  }

  function open(target) {
    items = collect(target);
    idx = Math.max(0, items.findIndex(el => el.dataset.zoom === target.dataset.zoom && el.dataset.cap === target.dataset.cap));
    lastFocus = document.activeElement;
    box.hidden = false;
    document.documentElement.classList.add('lb-lock');
    renderStrip();
    show();
    $b('.lb-close').focus();
  }
  function close() {
    box.hidden = true;
    document.documentElement.classList.remove('lb-lock');
    setZoom(false);
    lastFocus?.focus?.();
  }
  function show() {
    const el = items[idx]; if (!el) return;
    setZoom(false);
    box.classList.add('loading');
    $b('.lb-msg').textContent = '';
    img.alt = el.dataset.cap;
    img.src = el.dataset.zoom;
    $b('.lb-title').textContent = el.dataset.cap || '제품 사진';
    $b('.lb-sub').textContent = el.dataset.sub || '';
    $b('.lb-open').href = el.dataset.zoom;
    $b('.lb-count').textContent = items.length > 1 ? `${idx + 1} / ${items.length}` : '';
    box.classList.toggle('single', items.length < 2);
    box.querySelectorAll('.lb-th').forEach((t, i) => t.classList.toggle('on', i === idx));
    box.querySelector('.lb-th.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  function renderStrip() {
    $b('.lb-strip').innerHTML = items.length > 1
      ? items.map((el, i) => `<button class="lb-th" data-i="${i}" style="background-image:url('${el.dataset.zoom.replace(/'/g, '%27')}')" aria-label="${el.dataset.cap}"></button>`).join('')
      : '';
  }
  const go = d => { if (items.length > 1) { idx = (idx + d + items.length) % items.length; show(); } };

  // 확대: 사진 클릭 시 2.5배, 마우스 위치를 따라 이동
  function setZoom(on, e) {
    zoomed = on;
    stage.classList.toggle('zoomed', on);
    if (on && e) pan(e); else img.style.transformOrigin = '50% 50%';
  }
  function pan(e) {
    const r = img.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100, y = ((e.clientY - r.top) / r.height) * 100;
    img.style.transformOrigin = `${Math.min(100, Math.max(0, x))}% ${Math.min(100, Math.max(0, y))}%`;
  }

  img.onload = () => box.classList.remove('loading');
  img.onerror = () => { box.classList.remove('loading'); $b('.lb-msg').textContent = '사진을 불러오지 못했습니다.'; };
  img.onclick = e => setZoom(!zoomed, e);
  img.onmousemove = e => { if (zoomed) pan(e); };
  $b('.lb-backdrop').onclick = close;
  $b('.lb-close').onclick = close;
  $b('.lb-prev').onclick = () => go(-1);
  $b('.lb-next').onclick = () => go(1);
  $b('.lb-strip').onclick = e => { const t = e.target.closest('.lb-th'); if (t) { idx = +t.dataset.i; show(); } };
  stage.onclick = e => { if (e.target === stage) close(); };

  // 썸네일 클릭: 캡처 단계에서 가로채 행 클릭(상세 열기·상품 선택)과 겹치지 않게 함
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-zoom]');
    if (!t || box.contains(t)) return;
    e.preventDefault(); e.stopPropagation();
    open(t);
  }, true);
  document.addEventListener('keydown', e => {
    if (box.hidden) {
      const t = e.target.closest?.('[data-zoom]');
      if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); open(t); }
      return;
    }
    if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); }
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'Tab') { // 라이트박스 안에서만 포커스 이동
      const f = [...box.querySelectorAll('button, a')].filter(x => x.offsetParent !== null);
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  }, true);
})();
