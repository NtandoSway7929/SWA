self.addEventListener("push", event => {
    let data = {};

    try {
        data = event.data ? event.data.json() : {};
    } catch (error) {
        data = {
            title: "Swayphics Admin",
            body: event.data ? event.data.text() : "You have a new notification."
        };
    }

    const title = data.title || "Swayphics Admin";
    const options = {
        body: data.body || "You have a new notification.",
        icon: "/FIST.webp",
        badge: "/FIST.webp",
        tag: data.tag || "swayphics-admin-notification",
        renotify: Boolean(data.renotify),
        data: {
            url: data.url || "/admin-dashboard/"
        }
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener("notificationclick", event => {
    event.notification.close();

    const targetUrl =
        event.notification &&
        event.notification.data &&
        event.notification.data.url
            ? event.notification.data.url
            : "/admin-dashboard/";

    event.waitUntil(
        clients.matchAll({
            type: "window",
            includeUncontrolled: true
        }).then(clientList => {
            for (const client of clientList) {
                if ("focus" in client) {
                    client.navigate(targetUrl);
                    return client.focus();
                }
            }

            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }

            return undefined;
        })
    );
});
