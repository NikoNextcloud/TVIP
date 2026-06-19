const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m3u': 'application/vnd.apple.mpegurl; charset=utf-8',
  '.m3u8': 'application/vnd.apple.mpegurl; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    ...headers,
  });
  res.end(body);
}

function proxyUrl(rawUrl, baseUrl) {
  const absolute = new URL(rawUrl, baseUrl).toString();
  return `/proxy?url=${encodeURIComponent(absolute)}`;
}

function rewritePlaylist(text, sourceUrl) {
  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    return proxyUrl(trimmed, sourceUrl);
  }).join('\n');
}

function handleProxy(req, res, requestUrl) {
  const target = requestUrl.searchParams.get('url');
  if (!target) return send(res, 400, 'Missing url');

  let parsed;
  try {
    parsed = new URL(target);
  } catch (error) {
    return send(res, 400, 'Invalid url');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return send(res, 400, 'Only http and https are allowed');
  }

  const client = parsed.protocol === 'https:' ? https : http;
  const upstream = client.get(parsed, {
    headers: {
      'User-Agent': 'Mozilla/5.0 ETER-IPTV',
      'Accept': '*/*',
    },
  }, (upstreamRes) => {
    const contentType = upstreamRes.headers['content-type'] || '';
    const looksLikePlaylist = /\.m3u8?($|\?)/i.test(parsed.pathname) || contentType.includes('mpegurl');

    if (!looksLikePlaylist) {
      res.writeHead(upstreamRes.statusCode || 200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': contentType || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      upstreamRes.pipe(res);
      return;
    }

    const chunks = [];
    upstreamRes.on('data', (chunk) => chunks.push(chunk));
    upstreamRes.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      send(res, upstreamRes.statusCode || 200, rewritePlaylist(text, parsed.toString()), {
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Cache-Control': 'no-store',
      });
    });
  });

  upstream.on('error', (error) => {
    send(res, 502, `Proxy error: ${error.message}`);
  });

  upstream.setTimeout(30000, () => {
    upstream.destroy(new Error('Upstream timeout'));
  });
}

function handleStatic(req, res, requestUrl) {
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'Forbidden');

  fs.readFile(filePath, (error, data) => {
    if (error) return send(res, 404, 'Not found');
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
  });
}

http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === '/proxy') {
    handleProxy(req, res, requestUrl);
    return;
  }

  handleStatic(req, res, requestUrl);
}).listen(PORT, () => {
  console.log(`ETER IPTV running on port ${PORT}`);
});
