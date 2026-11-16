// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect, useState } from "react";

/** The browser's answer for this page, or why it cannot show one. */
export type PermissionState =
	| NotificationPermission
	| "unsupported"
	| "insecure";

export function readPermission(): PermissionState {
	if (typeof window === "undefined") return "unsupported";
	if (!window.isSecureContext) return "insecure";
	if (typeof Notification === "undefined") return "unsupported";
	return Notification.permission;
}

/** Follows the permission as the user changes it in the browser's site settings. */
export function useNotificationPermission(): [
	PermissionState,
	() => Promise<void>,
] {
	const [state, setState] = useState<PermissionState>(readPermission);
	useEffect(() => {
		let status: PermissionStatus | null = null;
		const update = () => setState(readPermission());
		void navigator.permissions
			?.query({ name: "notifications" as PermissionName })
			.then((s) => {
				status = s;
				s.addEventListener("change", update);
			})
			.catch(() => {});
		window.addEventListener("focus", update);
		return () => {
			status?.removeEventListener("change", update);
			window.removeEventListener("focus", update);
		};
	}, []);
	const request = async () => {
		if (typeof Notification === "undefined") return;
		await Notification.requestPermission();
		setState(readPermission());
	};
	return [state, request];
}

/** The permission row's word and its fix (#1101 category 4 item 1). */
export function permissionWords(p: PermissionState): {
	word: string;
	tone: "ok" | "warn" | "danger" | "quiet";
	hint: string;
} {
	switch (p) {
		case "granted":
			return {
				word: "Allowed",
				tone: "ok",
				hint: "This browser shows PrismaLens notifications.",
			};
		case "default":
			return {
				word: "Not asked yet",
				tone: "warn",
				hint: "Allow them to hear about threads while this tab is in the background.",
			};
		case "denied":
			return {
				word: "Blocked",
				tone: "danger",
				hint: "Blocked for this site. Open the site settings beside the address bar, allow notifications, then reload.",
			};
		case "insecure":
			return {
				word: "Needs HTTPS",
				tone: "danger",
				hint: "Browsers show notifications only on HTTPS or localhost. Open PrismaLens through localhost or an HTTPS address.",
			};
		case "unsupported":
			return {
				word: "Not supported",
				tone: "quiet",
				hint: "This browser has no notifications here. On an iPhone or iPad, add PrismaLens to the Home Screen first.",
			};
	}
}
