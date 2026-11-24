// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, mkdirSync } from "node:fs";
import type { BrowserContext } from "playwright-core";

/** The CSS-pixel size every tab renders at; the pane scales the frame to fit. */
export const VIEWPORT = { width: 1280, height: 800 } as const;

export interface Engine {
	context: BrowserContext;
	name: string;
}

type Launch = { name: string; options: Record<string, unknown> };

/**
 * How long a browser gets to start. A cold start on a loaded host (CI under a shifted clock takes
 * over 20 s) that times out reads as "no browser engine", and the agent is told it has none.
 */
export const LAUNCH_TIMEOUT_MS = 60_000;

/**
 * Starts the host browser on the persistent profile (#1061): Playwright's own Chromium if
 * installed, else Chrome, else Edge. Nothing is downloaded; null when none starts.
 */
export async function launchEngine(profileDir: string): Promise<Engine | null> {
	let pw: typeof import("playwright-core");
	try {
		pw = await import("playwright-core");
	} catch {
		return null;
	}
	mkdirSync(profileDir, { recursive: true, mode: 0o700 });
	const own = (() => {
		try {
			const path = pw.chromium.executablePath();
			return path && existsSync(path) ? path : null;
		} catch {
			return null;
		}
	})();
	const tries: Launch[] = [
		...(own ? [{ name: "Chromium", options: { executablePath: own } }] : []),
		{ name: "Google Chrome", options: { channel: "chrome" } },
		{ name: "Microsoft Edge", options: { channel: "msedge" } },
	];
	for (const t of tries) {
		try {
			const context = await pw.chromium.launchPersistentContext(profileDir, {
				...t.options,
				headless: true,
				viewport: VIEWPORT,
				acceptDownloads: false,
				permissions: [],
				args: [
					"--disable-features=PasswordManagerOnboarding,AutofillServerCommunication",
				],
				timeout: LAUNCH_TIMEOUT_MS,
			});
			return { context, name: t.name };
		} catch {}
	}
	return null;
}
