// 로컬 실행용 서버 (npm start)
// - public/ 정적 파일 제공
// - /api/* 요청을 public/core.js로 처리 → 서버가 MCP를 호출 (브라우저 CORS 정책과 무관하게 동작)
// GitHub Pages에서는 이 파일 없이 public/ 폴더만으로 동작합니다 (브라우저가 MCP를 직접 호출).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handle, MCP_URL } = require('./public/core.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    try { sendJson(res, 200, await handle(url.pathname, url.searchParams)); }
    catch (e) { sendJson(res, e.status || 500, { error: e.message, call: e.call }); }
    return;
  }
  // 서버 모드 표시: 화면이 /api/* 를 이 서버로 보내도록 함
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    return res.end('window.PRICE_SERVER = true;');
  }

  const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': `${TYPES[path.extname(file)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`PriceScope 실행 중 → http://localhost:${PORT}  (서버 모드, MCP: ${MCP_URL})`));
