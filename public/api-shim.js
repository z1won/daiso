// 화면 코드의 fetch('/api/...') 요청을 브라우저 안에서 처리합니다 (정적 호스팅용).
// 서버 모드(window.PRICE_SERVER === true)에서는 그대로 서버로 보냅니다.
(() => {
  if (window.PRICE_SERVER) return;
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const u = new URL(typeof input === 'string' ? input : input.url, location.href);
    const m = u.origin === location.origin && u.pathname.match(/\/api\/.+$/);
    if (!m) return realFetch(input, init);

    let status = 200, body;
    try { body = await PriceCore.handle(m[0], u.searchParams); }
    catch (e) { status = e.status || 500; body = { error: e.message || 'MCP 호출 실패', call: e.call }; }
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
})();
