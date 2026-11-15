// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Turning phone push on for this browser (#859): register the worker, subscribe with
 * the instance's key, hand the subscription to the server. The words never ride the push.
 */
import { orpc } from "@/lib/api/orpc-client";

export type PushSupport = "ok" | "insecure" | "unsupported";

export function pushSupport(): PushSupport {
	if (typeof window === "undefined") return "unsupported";
	if (!window.isSecureContext) return "insecure";
	return "serviceWorker" in navigator && "PushManager" in window
		? "ok"
		: "unsupported";
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
	const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
		.replace(/-/g, "+")
		.replace(/_/g, "/");
	const raw = atob(b64);
	const out = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

export async function turnPushOn(): Promise<void> {
	if ((await Notification.requestPermission()) !== "granted")
		throw new Error(
			"The browser blocked notifications for this site. Allow them in its site settings.",
		);
	const reg = await navigator.serviceWorker.register("/sw.js");
	await navigator.serviceWorker.ready;
	const { publicKey } = await orpc.push.publicKey.call({});
	const sub =
		(await reg.pushManager.getSubscription()) ??
		(await reg.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: keyBytes(publicKey),
		}));
	const json = sub.toJSON();
	await orpc.push.subscribe.call({
		endpoint: sub.endpoint,
		keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
	});
}

export async function turnPushOff(): Promise<void> {
	const reg = await navigator.serviceWorker?.getRegistration("/sw.js");
	await (await reg?.pushManager.getSubscription())?.unsubscribe();
	await orpc.push.unsubscribe.call({});
}
