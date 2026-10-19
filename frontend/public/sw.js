/* Public resources only. Never store API, authenticated records, map tiles or remote responses. */
const CACHE='terrascope-public-v1';
const PUBLIC=['/offline.html','/offline.css','/favicon.svg','/pwa-192.png','/pwa-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PUBLIC))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('terrascope-public-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const request=event.request;const url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.searchParams.has('demo'))return;
 if(request.mode==='navigate'){event.respondWith(fetch(request).catch(()=>caches.match('/offline.html')));return;}
 if(PUBLIC.includes(url.pathname)||url.pathname.startsWith('/assets/')||url.pathname.startsWith('/fonts/')||url.pathname.startsWith('/images/')){
  event.respondWith((async()=>{const cached=await caches.match(request);if(cached)return cached;const response=await fetch(new Request(request,{credentials:'omit'}));if(response.ok&&response.type==='basic'){const cache=await caches.open(CACHE);const keys=await cache.keys();if(keys.length>100)await cache.delete(keys[0]);await cache.put(request,response.clone());}return response;})());
 }
});
self.addEventListener('notificationclick',event=>{event.notification.close();const path=event.notification.data?.path;if(typeof path==='string'&&path.startsWith('/')&&!path.startsWith('//'))event.waitUntil(self.clients.openWindow(path));});
