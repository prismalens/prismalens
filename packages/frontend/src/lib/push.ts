// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * This browser's half of phone push (#859): the service worker, and the
 * subscription it hands the instance. Push needs HTTPS (tailscale serve) or
 * localhost; iOS offers it only to an app added to the home screen.
 */

export type PushSupport = "ok" | "insecure" | "ios-install" | "unsupported";

export function pushSupport(): PushSupport {
	if (typeof window === "undefined") return "unsupported";
	if (!window.isSecureContext) return "insecure";
	if ("serviceWorker" in navigator && "PushManager" in window) return "ok";
	return /iPhone|iPad|iPod/.test(navigator.userAgent)
		? "ios-install"
		: "unsupported";
}

export const PUSH_SUPPORT_TEXT: Record<Exclude<PushSupport, "ok">, string> = {
	insecure:
		"Push needs HTTPS. Open PrismaLens at its tailnet address from pl up --tailscale-serve.",
	"ios-install":
		"On iPhone and iPad, push works once PrismaLens is on the home screen: Share, then Add to Home Screen, then open it from there.",
	unsupported: "This browser cannot receive push.",
};

export function registerServiceWorker(): void {
	if (pushSupport() !== "ok") return;
	navigator.serviceWorker.register("/sw.js").catch(() => {});
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
	const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
	const raw = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
	return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
	if (pushSupport() !== "ok") return null;
	const registration = await navigator.serviceWorker.getRegistration();
	return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Ask for permission and subscribe; resolves to what the instance stores. */
export async function subscribeThisBrowser(publicKey: string) {
	if ((await Notification.requestPermission()) !== "granted")
		throw new Error(
			"Notifications are blocked for this site. Allow them in the browser's site settings, then try again.",
		);
	await navigator.serviceWorker.register("/sw.js");
	const registration = await navigator.serviceWorker.ready;
	const subscription = await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: keyBytes(publicKey),
	});
	const json = subscription.toJSON();
	if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth)
		throw new Error("The browser returned an incomplete push subscription.");
	return {
		endpoint: json.endpoint,
		keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
	};
}
