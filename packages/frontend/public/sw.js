// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Phone push (#859). A push carries ids only; the words are fetched from this
// instance, so the browser vendor's push service never sees them.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
	event.waitUntil(self.clients.claim()),
);

async function words(payload) {
	if (payload.kind === "test")
		return {
			title: "PrismaLens test push",
			body: "Push works on this device.",
			url: "/",
		};
	const fallback = {
		title: "PrismaLens",
		body: "Something changed on a run. Open PrismaLens to see it.",
		url: payload.investigationId
			? `/investigations/${payload.investigationId}`
			: "/",
	};
	if (!payload.id) return fallback;
	try {
		const res = await fetch(
			`/api/push/notifications/${encodeURIComponent(payload.id)}`,
			{
				credentials: "same-origin",
			},
		);
		return res.ok ? await res.json() : fallback;
	} catch {
		return fallback;
	}
}

self.addEventListener("push", (event) => {
	let payload = {};
	try {
		payload = event.data ? event.data.json() : {};
	} catch {}
	event.waitUntil(
		words(payload).then((n) =>
			self.registration.showNotification(n.title, {
				body: n.body,
				tag: payload.id,
				icon: "/icon-192.png",
				data: { url: n.url },
			}),
		),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const url = new URL(event.notification.data?.url || "/", self.location.origin)
		.href;
	event.waitUntil(
		(async () => {
			const open = await self.clients.matchAll({
				type: "window",
				includeUncontrolled: true,
			});
			for (const client of open) {
				if ("navigate" in client) {
					await client.focus();
					return client.navigate(url);
				}
			}
			return self.clients.openWindow(url);
		})(),
	);
});
