/* 408 学习站 Service Worker：首访后静态资源与真题数据本地缓存，二次打开更快 */
const CACHE = 'ducky408-v4';
const CORE = ['./', './index.html'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function put(req, res) {
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 页面：缓存优先并后台更新，二次打开立即可见
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      const net = fetch(req).then(r => put(req, r)).catch(() => null);
      return hit || (await net) || (await caches.match('./index.html'));
    })());
    return;
  }

  // 图片、真题/考点数据：缓存优先，命中后不再重复下载
  if (url.pathname.indexOf('/assets/') >= 0 || url.pathname.indexOf('/data/') >= 0) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      try {
        return put(req, await fetch(req));
      } catch (err) {
        return Response.error();
      }
    })());
  }
});
