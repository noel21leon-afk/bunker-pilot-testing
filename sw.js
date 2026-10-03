const CACHE='bunker-pwa-v122';
const ASSETS=['./','./index.html','./styles.css','./app.js','./core.js','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable-512.png','./apple-touch-icon.png','./intro-bg.jpg'];
const NETWORK_FIRST=['./index.html','./app.js','./core.js','./styles.css','./'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  const path='./'+url.pathname.replace(/^\/+/,'');
  const isAppShell=NETWORK_FIRST.some(a=>path.endsWith(a.replace('./',''))||url.pathname.endsWith('/'));
  if(isAppShell){
    // Network-first for the app shell so a new deployment (bug fixes, UI changes)
    // reaches users immediately; falls back to cache only when offline.
    e.respondWith(
      fetch(e.request).then(resp=>{
        const copy=resp.clone();
        caches.open(CACHE).then(c=>c.put(e.request,copy));
        return resp;
      }).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html')))
    );
    return;
  }
  // Cache-first for static assets (icons, manifest) that rarely change.
  e.respondWith(
    caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{
      const copy=resp.clone();
      caches.open(CACHE).then(c=>c.put(e.request,copy));
      return resp;
    }))
  );
});
