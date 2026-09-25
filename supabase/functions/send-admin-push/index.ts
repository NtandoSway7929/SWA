import webpush from "npm:web-push@3.6.7";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:info@swayphics.co.za";

if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    throw new Error("Required push notification secrets are not configured.");
}

webpush.setVapidDetails(
    vapidSubject,
    vapidPublicKey,
    vapidPrivateKey
);

const jsonHeaders = {
    "Content-Type": "application/json"
};

Deno.serve(async request => {
    if (request.method !== "POST") {
        return new Response(
            JSON.stringify({ error: "Method not allowed." }),
            { status: 405, headers: jsonHeaders }
        );
    }

    const authorization =
        request.headers.get("authorization") || "";

    const expected =
        "Bearer " + serviceRoleKey;

    if (authorization !== expected) {
        return new Response(
            JSON.stringify({ error: "Unauthorized." }),
            { status: 401, headers: jsonHeaders }
        );
    }

    try {
        const body = await request.json();

        const notificationId =
            body?.record?.id ||
            body?.notification?.id ||
            body?.id;

        if (!notificationId) {
            return new Response(
                JSON.stringify({
                    error: "A notification id is required."
                }),
                { status: 400, headers: jsonHeaders }
            );
        }

        const notificationResponse =
            await fetch(
                supabaseUrl +
                    "/rest/v1/admin_notifications?id=eq." +
                    encodeURIComponent(notificationId) +
                    "&select=id,recipient_id,title,message,type,view,entity_type,entity_id",
                {
                    headers: {
                        apikey: serviceRoleKey,
                        Authorization: "Bearer " + serviceRoleKey
                    }
                }
            );

        if (!notificationResponse.ok) {
            throw new Error(
                "Unable to load notification: " +
                notificationResponse.status
            );
        }

        const notifications = await notificationResponse.json();
        const notification = notifications[0];

        if (!notification) {
            return new Response(
                JSON.stringify({
                    ok: true,
                    sent: 0,
                    reason: "Notification not found."
                }),
                { status: 200, headers: jsonHeaders }
            );
        }

        const subscriptionsResponse =
            await fetch(
                supabaseUrl +
                    "/rest/v1/admin_push_subscriptions?user_id=eq." +
                    encodeURIComponent(notification.recipient_id) +
                    "&select=id,endpoint,p256dh,auth",
                {
                    headers: {
                        apikey: serviceRoleKey,
                        Authorization: "Bearer " + serviceRoleKey
                    }
                }
            );

        if (!subscriptionsResponse.ok) {
            throw new Error(
                "Unable to load push subscriptions: " +
                subscriptionsResponse.status
            );
        }

        const subscriptions =
            await subscriptionsResponse.json();

        const baseUrl =
            "https://swayphics.co.za/admin-dashboard/";

        const payload = JSON.stringify({
            title: notification.title || "Swayphics Admin",
            body: notification.message || "You have a new notification.",
            tag: notification.id,
            renotify: true,
            url: baseUrl
        });

        let sent = 0;
        let removed = 0;

        for (const subscription of subscriptions) {
            try {
                await webpush.sendNotification(
                    {
                        endpoint: subscription.endpoint,
                        keys: {
                            p256dh: subscription.p256dh,
                            auth: subscription.auth
                        }
                    },
                    payload
                );

                sent += 1;
            } catch (error) {
                const statusCode =
                    error?.statusCode ||
                    error?.status ||
                    null;

                if (statusCode === 404 || statusCode === 410) {
                    await fetch(
                        supabaseUrl +
                            "/rest/v1/admin_push_subscriptions?id=eq." +
                            encodeURIComponent(subscription.id),
                        {
                            method: "DELETE",
                            headers: {
                                apikey: serviceRoleKey,
                                Authorization: "Bearer " + serviceRoleKey
                            }
                        }
                    );

                    removed += 1;
                } else {
                    console.error(
                        "Push delivery failed:",
                        error
                    );
                }
            }
        }

        return new Response(
            JSON.stringify({
                ok: true,
                sent,
                removed,
                subscriptions: subscriptions.length
            }),
            { status: 200, headers: jsonHeaders }
        );
    } catch (error) {
        console.error("Admin push dispatcher failed:", error);

        return new Response(
            JSON.stringify({
                error: error?.message || "Push delivery failed."
            }),
            { status: 500, headers: jsonHeaders }
        );
    }
});
