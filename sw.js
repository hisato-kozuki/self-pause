// 通知表示のためだけのService Worker（キャッシュやPush受信は行わない）。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

// 通知をタップしたら、開いているSelf Pauseを前面に出す（なければ開く）。
self.addEventListener("notificationclick", event => {
    event.notification.close();
    event.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for(const client of all){
            if("focus" in client) return client.focus();
        }
        return self.clients.openWindow("./");
    })());
});
