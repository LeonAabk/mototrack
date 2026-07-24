const http = require('http');
const fs = require('fs');
const path = require('path');

let entries = [];

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/leaderboard' && req.method === 'GET') {
    sendJson(res, 200, { entries: entries.slice(0, 10) });
    return;
  }

  if (req.url === '/api/leaderboard' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data || !data.name || !data.speed) {
          sendJson(res, 400, { error: 'Ugyldig payload' });
          return;
        }

        entries.push({
          name: data.name.slice(0, 20),
          speed: Number(data.speed),
          distance: data.distance || '',
          duration: data.duration || '',
          timestamp: data.timestamp || new Date().toISOString()
        });

        entries.sort((a, b) => b.speed - a.speed);
        entries = entries.slice(0, 10);

        sendJson(res, 200, { entries: entries.slice(0, 10) });
      } catch (error) {
        sendJson(res, 400, { error: 'Kunne ikke lese payload' });
      }
    });
    return;
  }

  if (req.url === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  const filePath = req.url === '/' ? '/index.html' : req.url;
  const absolutePath = path.join(__dirname, filePath);

  fs.readFile(absolutePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    const ext = path.extname(absolutePath);
    const contentType = ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'text/html';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(3000, () => {
  console.log('Leaderboard server running on http://localhost:3000');
});
