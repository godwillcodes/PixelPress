// Exact80 Service Worker
const CACHE_NAME = 'exact80-v1.0.0';
const STATIC_CACHE = 'exact80-static-v1.0.0';

// Files to cache for offline functionality
const STATIC_FILES = [
  '/',
  '/manifest.json',
  '/_next/static/css/',
  '/_next/static/js/',
  '/_next/static/media/',
  // Add other static assets as needed
];

// Install event - cache static files
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('Service Worker: Caching static files');
        return cache.addAll(STATIC_FILES);
      })
      .then(() => {
        console.log('Service Worker: Installation complete');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('Service Worker: Installation failed', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== STATIC_CACHE && cacheName !== CACHE_NAME) {
              console.log('Service Worker: Deleting old cache', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('Service Worker: Activation complete');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip API requests (let them go to network)
  if (event.request.url.includes('/api/')) {
    return;
  }

  // Skip external requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        // Return cached version if available
        if (cachedResponse) {
          console.log('Service Worker: Serving from cache', event.request.url);
          return cachedResponse;
        }

        // Otherwise fetch from network
        return fetch(event.request)
          .then((response) => {
            // Don't cache non-successful responses
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clone the response for caching
            const responseToCache = response.clone();

            // Cache the response for future use
            caches.open(STATIC_CACHE)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          })
          .catch((error) => {
            console.log('Service Worker: Network request failed', error);
            
            // Return offline page for navigation requests
            if (event.request.destination === 'document') {
              return caches.match('/');
            }
            
            throw error;
          });
      })
  );
});

// Handle background sync for compression requests
self.addEventListener('sync', (event) => {
  if (event.tag === 'compression-sync') {
    console.log('Service Worker: Background sync triggered');
    // Handle offline compression requests when back online
    event.waitUntil(handleCompressionSync());
  }
});

// Handle push notifications (for future features)
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    console.log('Service Worker: Push notification received', data);
    
    const options = {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: data.primaryKey
      },
      actions: [
        {
          action: 'explore',
          title: 'Open Exact80',
          icon: '/icon-192.png'
        },
        {
          action: 'close',
          title: 'Close',
          icon: '/icon-192.png'
        }
      ]
    };

    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('Service Worker: Notification clicked', event);
  
  event.notification.close();

  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Helper function for compression sync
async function handleCompressionSync() {
  try {
    // Get pending compression requests from IndexedDB
    const pendingRequests = await getPendingCompressionRequests();
    
    for (const request of pendingRequests) {
      try {
        // Retry the compression request
        const response = await fetch('/api/compress', {
          method: 'POST',
          body: request.formData
        });
        
        if (response.ok) {
          // Remove from pending requests
          await removePendingCompressionRequest(request.id);
          console.log('Service Worker: Successfully synced compression request', request.id);
        }
      } catch (error) {
        console.error('Service Worker: Failed to sync compression request', request.id, error);
      }
    }
  } catch (error) {
    console.error('Service Worker: Compression sync failed', error);
  }
}

// IndexedDB helpers for offline compression requests
async function getPendingCompressionRequests() {
  // Implementation would depend on your IndexedDB setup
  // For now, return empty array
  return [];
}

async function removePendingCompressionRequest(id) {
  // Implementation would depend on your IndexedDB setup
  console.log('Service Worker: Removing pending request', id);
}
