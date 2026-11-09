/* 408 学习站 Service Worker
 * v6：页面和题目/考点数据改为「网络优先 + 缓存兜底」。
 *     - 在线时每次都向服务器确认（内容没变只传 304，很快），打开即最新；
 *     - 断网或网络过慢时自动回退到本地缓存，离线也能看；
 *     - 图片等静态资源仍缓存优先，后台静默更新，不重复下载。
 * 日常更新题目/考点/页面无需改这里；只有改 SW 本身逻辑时才需要改 VERSION。
 */
const PREFIX = 'ducky408-';
const VERSION = 'v6';
const CACHE = PREFIX + VERSION;
const CORE = ['./', './index.html'];

const NAV_TIMEOUT = 8000;   // 页面：超过 8 秒还没拿到网络响应就用缓存
const DATA_TIMEOUT = 8000;  // 数据：超过 8 秒还没拿到网络响应就用缓存

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))
    );
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

// 绕过 HTTP 缓存的强制过期时间，直接向服务器确认（未变化时返回 304，很省流量）
function fresh(req) {
  try {
    return fetch(req, { cache: 'no-cache' });
  } catch (err) {
    return fetch(req);
  }
}

function cached(req) {
  return caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : null));
}

// 网络优先：拿到网络响应就返回并写回缓存；超时或失败时回退缓存。
// 超时回退时后台请求仍会继续，成功后写回缓存，下次打开就是新的。
function networkFirst(req, timeout) {
  const net = fresh(req).then(res => put(req, res)).catch(() => null);
  const race = timeout > 0
    ? Promise.race([net, new Promise(resolve => setTimeout(() => resolve(null), timeout))])
    : net;
  return race.then(first => {
    if (first) return first;
    return cached(req).then(hit => hit || net).then(res => res || Response.error());
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const path = url.pathname;

  // 页面：先联网拿最新 HTML，失败/太慢才用缓存
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, NAV_TIMEOUT));
    return;
  }

  // 题目、考点数据：同样网络优先，在线打开一定是新内容
  if (path.indexOf('/data/') >= 0) {
    e.respondWith(networkFirst(req, DATA_TIMEOUT));
    return;
  }

  // 图片等静态资源：缓存优先、后台悄悄更新，省流量也避免过期
  if (path.indexOf('/assets/') >= 0) {
    const net = fetch(req).then(res => put(req, res)).catch(() => null);
    e.waitUntil(net);
    e.respondWith(cached(req).then(hit => hit || net).then(res => res || Response.error()));
  }
});
