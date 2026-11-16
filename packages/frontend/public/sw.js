// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Phone push (#859): a push carries ids only; the words come from this instance.
self.addEventListener("push", (event) => {
	let payload = {};
	try {
		payload = event.data ? event.data.json() : {};
	} catch {}
	event.waitUntil(show(payload));
});

async function show(p) {
	if (p.kind === "test")
		return self.registration.showNotification("PrismaLens", {
			body: "Test push: this device gets notifications.",
			tag: "pl-test",
			data: { url: "/settings?tab=devices" },
		});
	try {
		const res = await fetch(
			`/api/push/notifications/${encodeURIComponent(p.id)}`,
		);
		if (!res.ok) throw new Error(String(res.status));
		const n = await res.json();
		return self.registration.showNotification(n.title, {
			body: n.body,
			tag: p.investigationId || p.id,
			data: { url: n.url },
		});
	} catch {
		return self.registration.showNotification("PrismaLens", {
			body: "Something changed. Open PrismaLens to see it.",
			tag: p.investigationId || p.id,
			data: { url: "/" },
		});
	}
}

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const url = new URL(event.notification.data?.url || "/", self.location.origin)
		.href;
	event.waitUntil(
		self.clients
			.matchAll({ type: "window", includeUncontrolled: true })
			.then((all) => {
				const open = all.find((c) => c.url.startsWith(self.location.origin));
				if (open) return open.navigate(url).then((c) => (c || open).focus());
				return self.clients.openWindow(url);
			}),
	);
});
