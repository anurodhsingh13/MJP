<<<<<<< HEAD
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
=======
// Public application shell only. Never cache authenticated API responses or farmer data.
const CACHE='terrascope-shell-v2';
const SHELL=['/favicon.svg','/manifest.webmanifest','/offline.html'];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));
 self.skipWaiting();
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('terrascope-shell-')&&key!==CACHE).map(key=>caches.delete(key)))));
 self.clients.claim();
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 const url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 if(request.mode==='navigate'){
  // Network-first. Never cache HTML routes containing account or field information.
  event.respondWith(fetch(request).catch(()=>caches.match('/offline.html').then(response=>response||Response.error())));
  return;
 }
 if(!/^\/(assets\/|favicon\.svg$|manifest\.webmanifest$|offline\.html$)/.test(url.pathname))return;
 event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
  if(response.ok&&response.type==='basic'){
   const copy=response.clone();
   void caches.open(CACHE).then(cache=>cache.put(request,copy));
  }
  return response;
 })));
});
>>>>>>> origin/main
