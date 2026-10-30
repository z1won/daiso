// 빠른 검색 창 (Ctrl+K / ⌘K) — 어느 탭에서든 검색 실행, 즐겨찾기·최근 검색어·탭 이동·명령을 한곳에서
// 한글 초성 검색 지원 (예: "ㅊㅇㅅ" → 참이슬)

(() => {
  const root = document.querySelector('.viz-root');
  const box = document.createElement('div');
  box.className = 'palette'; box.hidden = true;
  box.innerHTML = `
    <div class="pal-backdrop"></div>
    <div class="pal-panel" role="dialog" aria-modal="true" aria-label="빠른 검색">
      <div class="pal-input"><span aria-hidden="true">⌕</span>
        <input type="text" placeholder="상품명 검색, 즐겨찾기·탭 이동…  (초성 검색 가능)" role="combobox" aria-expanded="true" aria-controls="palList" aria-autocomplete="list" maxlength="40" spellcheck="false">
        <kbd>Esc</kbd></div>
      <div class="pal-list" id="palList" role="listbox"></div>
      <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> 이동</span><span><kbd>Enter</kbd> 실행</span><span><kbd>Esc</kbd> 닫기</span></div>
    </div>`;
  root.append(box);
  const input = box.querySelector('input'), list = box.querySelector('.pal-list');
  let items = [], active = 0, lastFocus = null;

  /* ---------- 검색어 매칭 (초성 지원) ---------- */
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const norm = s => String(s || '').toLowerCase().replace(/\s/g, '');
  const chosung = s => [...s].map(ch => { const c = ch.charCodeAt(0) - 0xAC00; return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch; }).join('');
  function matches(text, q) {
    const t = norm(text), k = norm(q);
    if (!k) return true;
    if (t.includes(k)) return true;
    return /^[ㄱ-ㅎ]+$/.test(k) && chosung(t).includes(k);
  }

  /* ---------- 실행 동작 ---------- */
  const runCompare = kw => { showTab('compare'); $('#keyword').value = kw; search(); };
  const runDaiso = kw => { showTab('daiso'); $('#dKeyword').value = kw; searchDaiso(); };
  const runCvsSearch = kw => { showTab('cvs'); $('#cKeyword').value = kw; runCvs(kw); };

  function buildItems(q) {
    const kw = q.trim(), out = [];
    const onlyCho = /^[ㄱ-ㅎ\s]+$/.test(kw); // 초성만 입력하면 검색 실행 대신 추천 품목에서 찾음
    if (kw && !onlyCho) out.push(
      { group: '검색', icon: '⇄', label: `가격 비교 · ${kw}`, sub: '다이소·편의점 가격을 한 번에 비교', run: () => runCompare(kw), always: true },
      { group: '검색', icon: '▦', label: `다이소 재고 · ${kw}`, sub: `${regionLabel()} 매장 재고와 진열 위치`, run: () => runDaiso(kw), always: true },
      { group: '검색', icon: '◫', label: `편의점 재고 · ${kw}`, sub: `${regionLabel()} 주변 GS25·CU·세븐일레븐·이마트24`, run: () => runCvsSearch(kw), always: true },
    );
    favs.forEach(f => out.push({ group: '즐겨찾기', icon: '★', label: f.name || f.keyword, sub: `${brandName(f.brand)} · ${favLabel(f)}`, run: () => openFav(f) }));
    getRecent().forEach(w => out.push({ group: '최근 검색', icon: '↺', label: w, sub: '가격 비교', run: () => runCompare(w) }));
    if (kw) {
      CVS_CHIPS.forEach(([g, ws]) => ws.forEach(w => out.push({ group: '추천 품목', icon: '◫', label: w, sub: `편의점 재고 · ${g}`, run: () => runCvsSearch(w) })));
      DAISO_CHIPS.forEach(w => out.push({ group: '추천 품목', icon: '▦', label: w, sub: '다이소 재고', run: () => runDaiso(w) }));
      DEFAULT_SUGGEST.forEach(w => out.push({ group: '추천 품목', icon: '⇄', label: w, sub: '가격 비교', run: () => runCompare(w) }));
    }
    out.push(
      { group: '이동', icon: '→', label: '가격 비교 탭', run: () => showTab('compare') },
      { group: '이동', icon: '→', label: '다이소 전용 탭', run: () => showTab('daiso') },
      { group: '이동', icon: '→', label: '편의점 전용 탭', sub: '주류·간편식', run: () => showTab('cvs') },
      { group: '이동', icon: '→', label: '즐겨찾기 탭', sub: favs.length ? `${favs.length}개` : '', run: () => showTab('fav') },
      { group: '명령', icon: '⤴', label: '공유 링크 복사', sub: '지금 보는 화면', run: shareCurrent },
      { group: '명령', icon: '↻', label: '즐겨찾기 재고 모두 새로고침', run: () => { showTab('fav'); refreshFavs(true); } },
      { group: '명령', icon: '◐', label: '테마 전환', sub: '라이트 / 다크', run: () => $('#themeBtn').click() },
      { group: '명령', icon: '≡', label: 'MCP 호출 로그 보기', run: () => logBtn.click() },
    );
    // 검색어가 없을 때는 각 묶음을 짧게, 있을 때는 맞는 항목만
    const limit = { '즐겨찾기': kw ? 8 : 5, '최근 검색': kw ? 5 : 4, '추천 품목': 6 };
    const count = {};
    return out.filter(it => it.always || matches(it.group === '추천 품목' ? it.label : `${it.label} ${it.sub || ''}`, kw))
      .filter(it => { count[it.group] = (count[it.group] || 0) + 1; return !limit[it.group] || count[it.group] <= limit[it.group]; });
  }

  /* ---------- 화면 ---------- */
  function render() {
    items = buildItems(input.value);
    active = Math.min(active, Math.max(items.length - 1, 0));
    let group = '';
    list.innerHTML = items.length ? items.map((it, i) => {
      const head = it.group !== group ? `<div class="pal-group">${esc((group = it.group))}</div>` : '';
      return `${head}<div class="pal-item ${i === active ? 'on' : ''}" role="option" id="pal-${i}" data-i="${i}" aria-selected="${i === active}">
        <span class="pal-icon" aria-hidden="true">${it.icon}</span>
        <span class="pal-text"><span class="pal-label">${esc(it.label)}</span>${it.sub ? `<span class="pal-sub">${esc(it.sub)}</span>` : ''}</span>
        ${i === active ? '<kbd class="pal-enter">Enter</kbd>' : ''}</div>`;
    }).join('') : '<div class="empty">일치하는 항목이 없습니다.</div>';
    input.setAttribute('aria-activedescendant', items.length ? `pal-${active}` : '');
    list.querySelector('.pal-item.on')?.scrollIntoView({ block: 'nearest' });
  }
  function setActive(i) {
    if (!items.length) return;
    active = (i + items.length) % items.length;
    render();
  }

  function open() {
    if (!box.hidden) return;
    lastFocus = document.activeElement;
    box.hidden = false; input.value = ''; active = 0; render();
    requestAnimationFrame(() => { box.classList.add('show'); input.focus(); });
  }
  function close() {
    box.classList.remove('show'); box.hidden = true;
    if (lastFocus?.isConnected) lastFocus.focus();
  }
  function runActive(i = active) {
    const it = items[i]; if (!it) return;
    close(); it.run();
  }

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); runActive(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  list.addEventListener('mousemove', e => { const el = e.target.closest('.pal-item'); if (el && +el.dataset.i !== active) setActive(+el.dataset.i); });
  list.addEventListener('click', e => { const el = e.target.closest('.pal-item'); if (el) runActive(+el.dataset.i); });
  box.querySelector('.pal-backdrop').addEventListener('click', close);

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyK' || e.key.toLowerCase() === 'k')) { e.preventDefault(); box.hidden ? open() : close(); }
  });
  $('#paletteBtn').onclick = open;
  // 맥에서는 ⌘K로 표시
  if (/Mac|iPhone|iPad/.test(navigator.platform)) $('#paletteBtn kbd').textContent = '⌘K';
})();
