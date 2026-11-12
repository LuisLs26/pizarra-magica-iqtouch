const CACHE='pizarra-' + self.PIZARRA_VERSION;
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(self.PIZARRA_FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('pizarra-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/'))return;
  if(!self.PIZARRA_FILES.includes(url.pathname))return;
  event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(url.pathname))||fetch(event.request)));
});
