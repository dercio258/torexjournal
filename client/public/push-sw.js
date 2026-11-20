/* Torex Journal — Service Worker Web Push Listener */

self.addEventListener('push', (event) => {
    if (!event) return;

    let data = {
        title: 'Torex Journal',
        body: 'Há uma nova atualização importante no seu terminal.',
        url: '/dashboard',
        tag: 'torex-general',
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
    };

    try {
        if (event.data) {
            const parsed = event.data.json();
            if (parsed && typeof parsed === 'object') {
                data = {
                    ...data,
                    ...parsed,
                };
            }
        }
    } catch {
        try {
            const txt = event.data ? event.data.text() : '';
            if (txt) data.body = txt;
        } catch {
            // keep default copy
        }
    }

    const notificationOptions = {
        body: data.body,
        icon: data.icon || '/pwa-192x192.png',
        badge: data.badge || '/pwa-192x192.png',
        tag: data.tag || 'torex-general',
        renotify: false,
        data: {
            url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/dashboard',
            clickToken: typeof data.clickToken === 'string' ? data.clickToken : null,
        },
    };

    event.waitUntil(self.registration.showNotification(data.title || 'Torex Journal', notificationOptions));
});

function reportPushInteraction(clickToken, interactionEvent) {
    if (!clickToken) return Promise.resolve();
    return fetch('/api/notifications/push/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clickToken: clickToken, event: interactionEvent }),
        keepalive: true,
    }).catch(() => undefined);
}

self.addEventListener('notificationclick', (event) => {
    if (!event || !event.notification) return;
    event.notification.close();

    const notifData = event.notification.data || {};
    const targetUrl = (typeof notifData.url === 'string' && notifData.url) || '/dashboard';
    const clickToken = typeof notifData.clickToken === 'string' ? notifData.clickToken : null;

    event.waitUntil(
        Promise.all([
            reportPushInteraction(clickToken, 'CLICKED'),
            self.clients
                .matchAll({ type: 'window', includeUncontrolled: true })
                .then((windowClients) => {
                    for (let i = 0; i < windowClients.length; i++) {
                        const client = windowClients[i];
                        if (client && 'focus' in client) {
                            client.postMessage({ type: 'TOREX_PUSH_NAVIGATE', url: targetUrl });
                            return client.focus();
                        }
                    }
                    if (self.clients.openWindow) {
                        return self.clients.openWindow(targetUrl);
                    }
                    return undefined;
                }),
        ]),
    );
});

self.addEventListener('notificationclose', (event) => {
    if (!event || !event.notification) return;
    const notifData = event.notification.data || {};
    const clickToken = typeof notifData.clickToken === 'string' ? notifData.clickToken : null;
    if (!clickToken) return;
    event.waitUntil(reportPushInteraction(clickToken, 'DISMISSED'));
});
