// 렛츠콕 서비스워커 — 앱 셸(HTML·JS·CSS·폰트)만 캐싱한다
// 보드 데이터(스냅샷 API·소켓)는 절대 캐싱하지 않는다: 낡은 대기 순서를 실시간으로
// 오해하는 게 화면이 잠깐 안 뜨는 것보다 훨씬 나쁘다
// API는 다른 오리진(별도 NestJS 서버)이라 아래 same-origin 검사에서 자동으로 걸러진다

const CACHE = 'letscok-shell-v1';

self.addEventListener('install', () => {
  // 새 워커를 즉시 대기 없이 활성화 — 배포 후 다음 실행에서 바로 최신 셸을 쓴다
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 외부 오리진(API 등)은 건드리지 않는다

  // Next 정적 자산 — 파일명에 해시가 박혀 있어 내용이 바뀌면 경로도 바뀐다.
  // 낡은 걸 줄 위험이 없으므로 cache-first
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // 화면(HTML) — network-first. 오프라인일 때만 캐시된 셸로 대체해 흰 화면을 막는다
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit ?? caches.match('/m'))),
    );
  }
});
