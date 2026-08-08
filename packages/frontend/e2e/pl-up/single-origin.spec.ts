// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The `pl up` journeys (issue #237). These run ONLY under `PL_UP_E2E=1`, against
 * the packed tarball installed into a throwaway prefix — one process, one port,
 * an empty workspace.
 *
 * They are serial, and they assert nothing about whether an owner exists: the
 * first-run journey — walking the wizard to a signed-in dashboard — lives in
 * `setup-first-run.spec.ts` (#358), which is the only file here that creates an
 * account. That keeps the two files order-independent.
 */

import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("first run: a fresh artifact serves the SPA from the same origin as its API", async ({
	page,
}) => {
	// Single-origin: the SPA and the API answer on the SAME port. In the dev
	// stack these are 3000 and 3001 with a Vite proxy between them, so this
	// assertion is the whole point of the harness.
	const health = await page.request.get("/health");
	expect(health.status()).toBe(200);

	await page.goto("/");
	// A prerendered shell hydrating into the router — no SSR, no server functions.
	await expect(page.locator("html")).toHaveAttribute("class", /dark|light/);

	// The root is guarded, so the artifact must resolve that guard in the browser
	// and land on a public entry point — the wizard while the instance is empty,
	// the login form once an owner exists. Either proves the bundle loaded and
	// reached the API on this same origin; a blank page proves it did not.
	await page.waitForURL(/\/setup|\/auth\/login/, { timeout: 30_000 });
	await expect(page.locator("body")).not.toBeEmpty();
});

test("read journey: a deep client route is served by the SPA fallback, and its data comes from the same origin", async ({
	page,
}) => {
	// A deep link the API has no controller for. It must return the SPA shell —
	// this is the assertion that a wrong `exclude` list or a missing index.html
	// breaks, and it cannot be made against the dev stack at all.
	const deep = await page.request.get("/incidents");
	expect(deep.status()).toBe(200);
	expect(deep.headers()["content-type"]).toContain("text/html");

	// The API's own 404 must NOT be swallowed by that fallback.
	const missing = await page.request.get("/api/nonexistent");
	expect(missing.status()).toBe(404);
	expect(missing.headers()["content-type"]).toContain("application/json");

	// And the client router takes over from that shell: a deep link to a guarded
	// route resolves its guard in the browser and redirects, which it can only do
	// after the SPA bundle loaded and reached the API on this same origin.
	await page.goto("/incidents");
	await page.waitForURL(/\/auth\/login|\/incidents/, { timeout: 30_000 });
	await expect(page.locator("body")).not.toBeEmpty();
});

test("theme survives a reload with no server function behind it", async ({ page }) => {
	// The FOUC job used to belong to `getThemeServerFn`. There is no TanStack
	// Start server in the artifact, so the inline pre-paint script owns it now.
	await page.goto("/");
	await page.evaluate(() => {
		document.cookie = "prismalens-theme=light; path=/; max-age=31536000";
	});
	await page.reload();
	await expect(page.locator("html")).toHaveClass(/light/);
	// And it is stamped BEFORE React runs: no dark class at any point after load.
	await expect(page.locator("html")).not.toHaveClass(/dark/);
	await page.waitForLoadState("networkidle");
	await page.screenshot({ path: "e2e/pl-up/screenshots/light.png", fullPage: true });

	await page.evaluate(() => {
		document.cookie = "prismalens-theme=dark; path=/; max-age=31536000";
	});
	await page.reload();
	await expect(page.locator("html")).toHaveClass(/dark/);
	await page.waitForLoadState("networkidle");
	await page.screenshot({ path: "e2e/pl-up/screenshots/dark.png", fullPage: true });
});

test("error state: a route the API answers with a 404 does not become the SPA shell", async ({
	page,
}) => {
	// The empty/error surface of the artifact: an unknown CLIENT route renders the
	// app's own not-found component, while an unknown API route stays JSON.
	await page.goto("/this-route-does-not-exist");
	await expect(page.locator("body")).not.toBeEmpty();
	await page.waitForLoadState("networkidle");
	await page.screenshot({ path: "e2e/pl-up/screenshots/not-found.png", fullPage: true });

	const api = await page.request.get("/api/also-not-a-route");
	expect(api.status()).toBe(404);
});
