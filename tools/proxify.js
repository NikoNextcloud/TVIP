#!/usr/bin/env node
/**
 * Преобразува всички линкове в M3U файл да минават през HTTPS прокси
 * (виж proxy/worker.js), за да избегнем Mixed Content блокиране на
 * GitHub Pages.
 *
 * Употреба:
 *   node tools/proxify.js <input.m3u> <output.m3u> <proxyBaseUrl>
 *
 * Пример:
 *   node tools/proxify.js playlist.m3u playlist.m3u https://iptv-proxy.YOU.workers.dev/
 *
 * Бележки:
 * - input и output могат да са същия файл (ще го презапише).
 * - Линкове, които вече минават през прокси-то, се пропускат (не се
 *   проксират двойно).
 * - HTTPS линкове (които вече нямат Mixed Content проблем) също се
 *   пропускат — проксира се само http://.
 */

const fs = require('fs');

const [, , inputPath, outputPath, proxyBaseArg] = process.argv;

if (!inputPath || !outputPath || !proxyBaseArg) {
  console.error('Употреба: node tools/proxify.js <input.m3u> <output.m3u> <proxyBaseUrl>');
  process.exit(1);
}

const proxyBase = proxyBaseArg.endsWith('/') ? proxyBaseArg : proxyBaseArg + '/';

const text = fs.readFileSync(inputPath, 'utf8');
const lines = text.split(/\r?\n/);

let changed = 0;
let skippedHttps = 0;
let skippedAlready = 0;

const output = lines.map((line) => {
  const trimmed = line.trim();

  // Пропускаме празни редове и коментари/тагове (#EXTM3U, #EXTINF, ...)
  if (!trimmed || trimmed.startsWith('#')) return line;

  // Пропускаме редове, които не са линкове
  if (!/^https?:\/\//i.test(trimmed)) return line;

  // Вече проксиран?
  if (trimmed.startsWith(proxyBase)) {
    skippedAlready++;
    return line;
  }

  // Вече HTTPS — няма Mixed Content проблем, не пипаме
  if (/^https:\/\//i.test(trimmed)) {
    skippedHttps++;
    return line;
  }

  changed++;
  return proxyBase + '?url=' + encodeURIComponent(trimmed);
});

fs.writeFileSync(outputPath, output.join('\n'));

console.log('Готово:', outputPath);
console.log('  Проксирани нови линкове: ' + changed);
console.log('  Пропуснати (вече HTTPS): ' + skippedHttps);
console.log('  Пропуснати (вече проксирани): ' + skippedAlready);
