/**
 * ETER IPTV proxy — Cloudflare Worker
 * ------------------------------------------------------------------
 * Препредава (proxy) стриймове от HTTP източник през HTTPS, за да
 * избегнем Mixed Content блокирането на браузъра, когато сайтът е
 * хостван на HTTPS (напр. GitHub Pages), а IPTV gateway-я е по HTTP.
 *
 * Употреба от плейлиста:
 *   https://<твой-worker>.workers.dev/?url=http://45.84.187.172:3001/udp/239.x.x.x:5000
 *
 * ВАЖНО: ALLOWED_HOSTS е whitelist — само хостове в този списък могат
 * да се проксират. Без него всеки би можел да ползва Worker-а ти като
 * отворен анонимен проксисървър за произволни сайтове (зло-употреба,
 * чужд трафик за твоя сметка). Винаги дръж whitelist стеснен само до
 * това, което реално ползваш.
 */

const ALLOWED_HOSTS = [
  '45.84.187.172:3001',
  // добави още "ip:port" записи тук, ако имаш повече източници
];

export default {
  async fetch(request) {
    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');

    if (!target) {
      return new Response('Missing ?url= parameter', { status: 400 });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch (e) {
      return new Response('Invalid url parameter', { status: 400 });
    }

    if (targetUrl.protocol !== 'http:') {
      return new Response(
        'Само http:// цели се проксират (worker-ът ги "качва" до https за браузъра)',
        { status: 400 }
      );
    }

    const hostPort = targetUrl.port
      ? targetUrl.hostname + ':' + targetUrl.port
      : targetUrl.hostname;

    if (!ALLOWED_HOSTS.includes(hostPort)) {
      return new Response('Host not allowed: ' + hostPort, { status: 403 });
    }

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (ETER-IPTV-Proxy)' },
      });
    } catch (e) {
      return new Response('Upstream fetch failed: ' + e.message, { status: 502 });
    }

    const headers = new Headers(upstreamResponse.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.delete('content-security-policy');

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: headers,
    });
  },
};
