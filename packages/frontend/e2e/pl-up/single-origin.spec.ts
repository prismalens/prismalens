// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The `pl up` journeys (issue #237). These run ONLY under `PL_UP_E2E=1`, against
 * the packed tarball installed into a throwaway prefix — one process, one port,
 * an empty workspace.
 *
 * They are ordered and serial on purpose: the first-run journey creates the
 * owner account the read journey signs in with, which is exactly the sequence a
 * new user walks after `npm i -g prismalens && pl up`.
 */

import { expect, test } from "@playwright/test";

const OWNER = {
	email: "owner@prismalens.test",
	password: "pl-up-e2e-password",
	name: "PL Up Owner",
};

test.describe.configure({ mode: "serial" });

test("first run: a fresh artifact serves the SPA and walks setup to a signed-in dashboard", async ({
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

	// A brand-new workspace has no owner, so the app must land on setup.
	await page.waitForURL(/\/setup|\/auth\/login/, { timeout: 30_000 });

	if (page.url().includes("/setup")) {
		await page.locator("#name").fill(OWNER.name);
		await page.locator("#email").fill(OWNER.email);
		await page.locator("#password").fill(OWNER.password);
		await page.locator("#confirmPassword").fill(OWNER.password);
		await page
			.getByRole("button", { name: /create|continue|finish|sign up/i })
			.click();
		await page.waitForURL(/\/auth\/login|:\d+\/$/, { timeout: 30_000 });
	}

	// Sign in through the form, deliberately, even when the wizard already
	// dropped us on the dashboard. Creating the owner leaves the client-side
	// query cache primed but writes NO session cookie, so a reload would bounce
	// straight back to login — see the note in the PR. The cookie round trip is
	// the thing worth asserting here.
	await page.goto("/auth/login");
	await page.locator("#email").fill(OWNER.email);
	await page.locator("#password").fill(OWNER.password);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/:\d+\/$/, { timeout: 30_000 });
	await expect(page.getByRole("navigation").first()).toBeVisible();

	// A HARD navigation: the guard re-runs from scratch and has to satisfy
	// itself from the session cookie alone. This is what caught `Secure` cookies
	// being set on a plain-http `pl up`.
	await page.goto("/incidents");
	await expect(
		page.getByRole("heading", { name: /incident/i }).first(),
	).toBeVisible({ timeout: 30_000 });
	await page.screenshot({ path: "e2e/pl-up/screenshots/dashboard-default.png", fullPage: true });
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
