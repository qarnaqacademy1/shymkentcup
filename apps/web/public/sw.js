// Only public resources enter this cache. API, reports, downloads and account HTML never do.
const CACHE='nazar-public-v3.1';
const PUBLIC=['/offline.html','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/icons/maskable-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(PUBLIC)));self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('nazar-public-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin)return;
 if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/downloads/'))return;
 if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/offline.html')));return;}
 if(PUBLIC.includes(u.pathname)||/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css|woff2)$/.test(u.pathname)){
  e.respondWith(caches.open(CACHE).then(async cache=>{const hit=await cache.match(e.request);if(hit)return hit;const response=await fetch(e.request);if(response.ok&&!response.headers.has('set-cookie'))await cache.put(e.request,response.clone());return response;}));
 }
});
