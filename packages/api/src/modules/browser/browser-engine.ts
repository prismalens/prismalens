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

/** Why one browser did not start; `timedOut` means it is installed but slow (#1238). */
export interface LaunchFailure {
	name: string;
	message: string;
	timedOut: boolean;
}

export const LAUNCH_MS = 20_000;

/**
 * Starts the host browser on the persistent profile (#1061): Playwright's own Chromium if
 * installed, else Chrome, else Edge. Nothing is downloaded; null when none starts, with each
 * try's reason pushed to `failures`.
 */
export async function launchEngine(
	profileDir: string,
	failures: LaunchFailure[] = [],
	timeout = LAUNCH_MS,
): Promise<Engine | null> {
	let pw: typeof import("playwright-core");
	try {
		pw = await import("playwright-core");
	} catch (e) {
		failures.push(launchFailure("playwright-core", e));
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
				timeout,
			});
			return { context, name: t.name };
		} catch (e) {
			failures.push(launchFailure(t.name, e));
		}
	}
	return null;
}

/** One try's reason: its first error line, and whether Playwright's launch timeout hit. */
export function launchFailure(name: string, e: unknown): LaunchFailure {
	const message = String(e instanceof Error ? e.message : e)
		.split("\n")[0]
		.slice(0, 300);
	return { name, message, timedOut: /Timeout \d+ms exceeded/.test(message) };
}
