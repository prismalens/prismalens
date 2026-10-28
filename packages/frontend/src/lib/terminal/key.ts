// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { desktopBridge } from "@/lib/desktop";

/**
 * The terminal's second credential (#931). It lives in this origin's storage,
 * which a service on another localhost port cannot read even though it can
 * receive the cookie. The desktop app keeps it in its main process instead.
 */
const STORAGE_KEY = "prismalens.terminal.key";

export function terminalKey(): string | undefined {
	const fromDesktop = desktopBridge()?.terminalKey?.();
	if (fromDesktop) return fromDesktop;
	try {
		return localStorage.getItem(STORAGE_KEY) ?? undefined;
	} catch {
		return undefined;
	}
}

export function storeTerminalKey(key: string): void {
	try {
		localStorage.setItem(STORAGE_KEY, key);
	} catch {
		// Storage off: the panel says this browser has no key.
	}
}
