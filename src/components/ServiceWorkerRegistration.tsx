'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      // Register service worker
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('Service Worker registered successfully:', registration);
          
          // Check for updates
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  // New content is available, show update notification
                  console.log('New content is available, please refresh.');
                  // You could show a toast notification here
                }
              });
            }
          });
        })
        .catch((error) => {
          console.error('Service Worker registration failed:', error);
        });

      // Handle service worker updates
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Service worker has been updated, reload the page
        window.location.reload();
      });

      // Handle offline/online status
      const handleOnline = () => {
        console.log('App is online');
        // You could show a toast notification here
      };

      const handleOffline = () => {
        console.log('App is offline');
        // You could show a toast notification here
      };

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      // Cleanup
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
  }, []);

  return null; // This component doesn't render anything
}
