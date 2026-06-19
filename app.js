/* =========================================================
   ETER — лек статичен IPTV плейър
   - Парсва M3U/M3U8 плейлисти (#EXTINF + URL)
   - Групира канали по group-title
   - Възпроизвежда HLS (.m3u8) през hls.js, друго през <video> нативно
   - Списъкът с плейлисти се чете от playlists.json
   ========================================================= */

const els = {
  rail: document.getElementById('channelRail'),
  tabs: document.getElementById('categoryTabs'),
  railStatus: document.getElementById('railStatus'),
  playlistSelect: document.getElementById('playlistSelect'),
  search: document.getElementById('searchInput'),
  video: document.getElementById('video'),
  noSignal: document.getElementById('noSignal'),
  liveTag: document.getElementById('liveTag'),
  playerError: document.getElementById('playerError'),
  nowPlaying: document.getElementById('nowPlaying'),
  loadUrlBtn: document.getElementById('loadUrlBtn'),
  loadFileBtn: document.getElementById('loadFileBtn'),
  filePicker: document.getElementById('filePicker'),
};

let hls = null;
let mpegtsPlayer = null;
let allChannels = [];   // currently loaded playlist, parsed
let currentUrl = null;  // currently playing stream url
let activeGroup = 'All';

const AUTHORIZED_HLS_URL = "http://bde.online24.pm/play/6832/16419D145D0E706/video.m3u8";

/* ---------------- M3U parsing ---------------- */

function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  let pending = null;

  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF')) {
      const attrs = {};
      const attrRe = /([a-zA-Z0-9-]+)="([^"]*)"/g;
      let m;
      while ((m = attrRe.exec(line))) attrs[m[1].toLowerCase()] = m[2];

      const name = line.split(',').pop().trim() || 'Без име';
      pending = {
        name,
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || 'Other',
        url: '',
      };
      continue;
    }

    if (line.startsWith('#EXTGRP')) {
      if (pending) {
        const group = line.split(':').slice(1).join(':').trim();
        if (group) pending.group = group;
      }
      continue;
    }

    if (line.startsWith('#')) continue; // other tags (#EXTM3U, etc.) ignored

    if (pending) {
      pending.url = line;
      channels.push(pending);
      pending = null;
    }
  }
  return channels;
}

/* ---------------- Loading playlists ---------------- */

async function loadPlaylistsConfig() {
  let cfg;
  try {
    const res = await fetch('playlists.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('no playlists.json');
    cfg = await res.json();
  } catch (e) {
    cfg = [{ name: 'Моят плейлист', file: 'playlist.m3u' }];
  }

  els.playlistSelect.innerHTML = '';
  cfg.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = p.file;
    opt.textContent = p.name;
    els.playlistSelect.appendChild(opt);
  });

  const lastFile = localStorage.getItem('eter:lastPlaylistFile');
  const startFile = (lastFile && cfg.some(p => p.file === lastFile))
    ? lastFile
    : cfg[0].file;

  els.playlistSelect.value = startFile;
  loadPlaylistFromFile(startFile);
}

async function loadPlaylistFromFile(file) {
  setRailStatus('Зареждане на ' + file + ' …');
  try {
    const res = await fetch(file, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    applyPlaylistText(text);
    localStorage.setItem('eter:lastPlaylistFile', file);
  } catch (e) {
    setRailStatus('Грешка при зареждане на "' + file + '": ' + e.message);
  }
}

async function loadPlaylistFromUrl(url) {
  setRailStatus('Зареждане от линк…');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    applyPlaylistText(text);
  } catch (e) {
    setRailStatus('Не успях да зареди линка (възможно е CORS да блокира): ' + e.message);
  }
}

function loadPlaylistFromFileObject(fileObj) {
  const reader = new FileReader();
  reader.onload = () => applyPlaylistText(reader.result);
  reader.onerror = () => setRailStatus('Грешка при четене на файла.');
  reader.readAsText(fileObj);
}

function applyPlaylistText(text) {
  const channels = parseM3U(text);
  allChannels = channels;
  activeGroup = 'All';
  if (!channels.length) {
    setRailStatus('Плейлистът е празен или невалиден M3U.');
    return;
  }
  renderTabs(channels);
  renderChannels(channels, els.search.value || '');
}

function setRailStatus(msg) {
  clearChannelList();
  const div = document.createElement('div');
  div.className = 'rail-status';
  div.textContent = msg;
  els.rail.appendChild(div);
}

/* ---------------- Rendering channel list ---------------- */

function clearChannelList() {
  Array.from(els.rail.children).forEach(child => {
    if (child !== els.tabs) child.remove();
  });
}

function renderTabs(channels) {
  const groups = ['All', ...new Set(channels.map(c => c.group).filter(Boolean))];
  els.tabs.innerHTML = '';

  groups.forEach(group => {
    const btn = document.createElement('button');
    btn.className = 'category-tab';
    if (group === activeGroup) btn.classList.add('active');
    btn.type = 'button';
    btn.textContent = group;
    btn.addEventListener('click', () => {
      activeGroup = group;
      renderTabs(allChannels);
      renderChannels(allChannels, els.search.value || '');
    });
    els.tabs.appendChild(btn);
  });
}

function renderChannels(channels, filterText) {
  const q = (filterText || '').trim().toLowerCase();
  const byGroup = activeGroup === 'All'
    ? channels
    : channels.filter(c => c.group === activeGroup);
  const filtered = q
    ? byGroup.filter(c => c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q))
    : byGroup;

  clearChannelList();

  if (!filtered.length) {
    const div = document.createElement('div');
    div.className = 'rail-empty';
    div.textContent = 'Няма канали, отговарящи на търсенето.';
    els.rail.appendChild(div);
    return;
  }

  const groups = new Map();
  filtered.forEach(c => {
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group).push(c);
  });

  for (const [groupName, list] of groups) {
    const block = document.createElement('div');
    block.className = 'group-block';

    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = groupName;
    block.appendChild(title);

    list.forEach(channel => {
      const btn = document.createElement('button');
      btn.className = 'channel-item';
      if (channel.url === currentUrl) btn.classList.add('active');

      if (channel.logo) {
        const img = document.createElement('img');
        img.className = 'channel-logo';
        img.src = channel.logo;
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = () => { img.replaceWith(makeFallbackLogo(channel.name)); };
        btn.appendChild(img);
      } else {
        btn.appendChild(makeFallbackLogo(channel.name));
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'channel-name';
      nameSpan.textContent = channel.name;
      btn.appendChild(nameSpan);

      btn.addEventListener('click', () => playChannel(channel));
      block.appendChild(btn);
    });

    els.rail.appendChild(block);
  }
}

function makeFallbackLogo(name) {
  const div = document.createElement('div');
  div.className = 'channel-logo fallback';
  div.textContent = (name || '?').trim().slice(0, 2).toUpperCase();
  return div;
}

/* ---------------- Player ---------------- */

let playToken = 0; // guards against stale error events from a previous teardown

const VIDEO_ERROR_CODES = {
  1: 'зареждането е прекъснато (MEDIA_ERR_ABORTED)',
  2: 'мрежова грешка при зареждане (MEDIA_ERR_NETWORK) — възможен CORS/firewall проблем',
  3: 'грешка при декодиране (MEDIA_ERR_DECODE)',
  4: 'форматът или линкът не се поддържа (MEDIA_ERR_SRC_NOT_SUPPORTED) — чест признак на CORS блокиране или невалиден линк',
};

function playChannel(channel) {
  const token = ++playToken;
  currentUrl = channel.url;
  els.nowPlaying.innerHTML =
    '<span class="np-name">' + escapeHtml(channel.name) + '</span>' +
    '<span class="np-group">' + escapeHtml(channel.group) + '</span>';

  renderChannels(allChannels, els.search.value || '');

  els.noSignal.hidden = true;
  els.playerError.hidden = true;
  els.liveTag.hidden = false;

  destroyPlayer();

  const url = channel.url || AUTHORIZED_HLS_URL;
  const isHls = /\.m3u8($|\?)/i.test(url);
  const isProgressiveFile = /\.(mp4|webm|ogv|mov|mkv)($|\?)/i.test(url);

  if (isHls && window.Hls && Hls.isSupported()) {
    hls = new Hls({ enableWorker: true });
    hls.loadSource(url);
    hls.attachMedia(els.video);
    hls.on(Hls.Events.ERROR, (event, data) => {
      if (token !== playToken) return; // event belongs to a channel we've since left
      if (data && data.fatal) {
        console.error('HLS fatal error:', data);
        showPlayerError(
          'HLS грешка (' + data.type + ', ' + (data.details || 'няма детайли') + '). ' +
          'Виж конзолата (F12 → Console) за пълни детайли — често е CORS или линкът вече не е валиден.'
        );
      }
    });
    els.video.play().catch(() => {});

  } else if (!isProgressiveFile && window.mpegts && mpegts.isSupported()) {
    // Raw MPEG-TS over HTTP — typical for udpxy-style IPTV proxy links
    // (e.g. http://IP:PORT/udp/239.x.x.x:5000), not standard HLS.
    mpegtsPlayer = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: url });
    mpegtsPlayer.attachMediaElement(els.video);
    mpegtsPlayer.on(mpegts.Events.ERROR, (errType, errDetail) => {
      if (token !== playToken) return;
      console.error('mpegts.js error:', errType, errDetail);
      showPlayerError(
        'Грешка при зареждане на потока (' + errType + '). ' +
        'Възможно е сървърът да е недостъпен от твоята мрежа (тествай линка директно във VLC), ' +
        'или той вече да не предава.'
      );
    });
    try {
      mpegtsPlayer.load();
      mpegtsPlayer.play().catch(() => {});
    } catch (e) {
      console.error('mpegts.js load error:', e);
      showPlayerError('Не успях да заредя потока: ' + e.message);
    }

  } else {
    // Native playback path: Safari's built-in HLS, or direct mp4/other files
    els.video.onerror = () => {
      if (token !== playToken) return;
      const code = els.video.error ? els.video.error.code : 0;
      console.error('Video element error:', els.video.error);
      showPlayerError(
        'Видео грешка: ' + (VIDEO_ERROR_CODES[code] || 'неизвестна (код ' + code + ')') +
        '. Виж конзолата (F12 → Console) за пълно съобщение.'
      );
    };
    els.video.src = url;
    els.video.play().catch(() => {});
  }
}

function destroyPlayer() {
  els.video.onerror = null; // detach old handler BEFORE tearing down, prevents stale error events
  if (hls) {
    hls.destroy();
    hls = null;
  }
  if (mpegtsPlayer) {
    try { mpegtsPlayer.destroy(); } catch (e) { /* ignore */ }
    mpegtsPlayer = null;
  }
  if (els.video.hasAttribute('src')) {
    els.video.removeAttribute('src');
    els.video.load();
  }
}

function showPlayerError(msg) {
  els.playerError.hidden = false;
  els.playerError.textContent = msg;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ---------------- Events ---------------- */

els.search.addEventListener('input', () => {
  renderChannels(allChannels, els.search.value);
});

els.playlistSelect.addEventListener('change', () => {
  loadPlaylistFromFile(els.playlistSelect.value);
});

els.loadUrlBtn.addEventListener('click', () => {
  const url = prompt('Линк към M3U плейлист:');
  if (url) loadPlaylistFromUrl(url.trim());
});

els.loadFileBtn.addEventListener('click', () => els.filePicker.click());

els.filePicker.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadPlaylistFromFileObject(file);
});

/* ---------------- Init ---------------- */

loadPlaylistsConfig();
