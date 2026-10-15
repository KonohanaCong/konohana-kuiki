/* 此花区域：オフライン対応（Service Worker）
   ・アプリ本体：通信できるときは最新を取り、できないときは端末に保存したものを使う
   ・外部の部品（地図の部品・文字・アイコン）：保存したものをすぐ使い、裏で更新する
   ・地図の画像：一度見た場所は、保存したものを使う
   ・Apps Script との通信（マンションのデータ）は、ここでは扱いません（アプリ側が端末に保存しています） */
const VER = 'kk-v1';
const SHELL = 'kk-shell-' + VER;
const TILES = 'kk-tiles-v1';
const TILE_MAX = 800;
const TILE_HOSTS = ['basemaps.cartocdn.com', 'tile.openstreetmap.org', 'cyberjapandata.gsi.go.jp', 'api.maptiler.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => c.delete(k)));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'script.google.com' || url.hostname.endsWith('googleusercontent.com')) return;

  // 地図の画像：保存があればそれを使い、なければ取りに行って保存する
  if (TILE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) {
    e.respondWith(
      caches.open(TILES).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res && (res.ok || res.type === 'opaque')) { c.put(req, res.clone()); trim(TILES, TILE_MAX); }
          return res;
        } catch (err) {
          return new Response('', { status: 504 });
        }
      })
    );
    return;
  }

  // このサイト自身のファイル：通信できれば最新、だめなら保存したもの
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
    );
    return;
  }

  // 外部の部品：保存したものをすぐ使い、裏で更新する
  e.respondWith(
    caches.open(SHELL).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })
  );
});
