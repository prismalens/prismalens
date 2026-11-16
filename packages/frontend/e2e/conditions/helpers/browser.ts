// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Browser, BrowserContextOptions } from "@playwright/test";

/** A browser context already paired with the server at `url`, as the host's own browser is. */
export async function pairedContext(
	browser: Browser,
	url: string,
	cookie: string,
	options: BrowserContextOptions = {},
) {
	const context = await browser.newContext({ baseURL: url, ...options });
	const [name, ...value] = cookie.split("=");
	await context.addCookies([
		{ name: name as string, value: value.join("="), url },
	]);
	return context;
}

/** The phone the two-devices condition steers from. */
export const PHONE: BrowserContextOptions = {
	viewport: { width: 390, height: 844 },
	deviceScaleFactor: 3,
	isMobile: true,
	hasTouch: true,
};

/** The desk the operator left the thread open on. */
export const DESK: BrowserContextOptions = {
	viewport: { width: 1600, height: 900 },
};

/** A zone far from UTC with a half-hour offset, and its locale. */
export const ZONE: BrowserContextOptions = {
	timezoneId: "Asia/Kolkata",
	locale: "en-IN",
};

/** `--name value` from argv. */
export function cliArg(name: string): string | undefined {
	const i = process.argv.indexOf(name);
	return i > -1 ? process.argv[i + 1] : undefined;
}
