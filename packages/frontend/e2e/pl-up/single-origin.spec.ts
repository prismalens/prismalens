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
 *
 * The first-run journey also carries the setup-wizard coverage for #332 — the
 * wizard's later steps only exist on an instance that has just been created,
 * and this is the only harness in the repo that starts genuinely empty.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const OWNER = {
	email: "owner@prismalens.test",
	password: "pl-up-e2e-password",
	name: "PL Up Owner",
};

// A real git checkout on this machine for the code-location step to accept.
// The repo the tests live in is one, so nothing has to be fabricated.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

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
	// Unconditionally /setup — the workspace is created empty by the harness, so
	// landing on login instead means the artifact carried state it should not.
	await page.waitForURL(/\/setup/, { timeout: 30_000 });

	// Four steps now, not one (#332).
	await expect(page.getByText("AI Provider")).toBeVisible();
	await expect(page.getByText("Code Location")).toBeVisible();

	await page.locator("#name").fill(OWNER.name);
	await page.locator("#email").fill(OWNER.email);
	await page.locator("#password").fill(OWNER.password);
	await page.locator("#confirmPassword").fill(OWNER.password);
	await page
		.getByRole("button", { name: /create|continue|finish|sign up/i })
		.click();

	// Creating the owner writes NO session cookie (#358, fixed separately), and
	// every remaining wizard step calls an authenticated endpoint. So the wizard
	// says so rather than firing requests that 401 and look like broken steps.
	await expect(
		page.getByRole("heading", { name: "Sign in to continue setup" }),
	).toBeVisible({ timeout: 30_000 });

	// Sign in through the form. The cookie round trip is the thing worth
	// asserting here, and `?redirect=/setup` is what carries the operator back
	// into the wizard rather than dumping them on the dashboard mid-flow.
	await page.goto("/auth/login?redirect=/setup");
	await page.locator("#email").fill(OWNER.email);
	await page.locator("#password").fill(OWNER.password);
	await page.getByRole("button", { name: "Sign in" }).click();

	// RESUME: the server derives the step from durable state, so a signed-in
	// return lands on the AI provider step — not back at "create account", and
	// not skipped past to the dashboard (which is what the old binary
	// account→complete state machine did).
	await page.waitForURL(/\/setup/, { timeout: 30_000 });
	await expect(
		page.getByRole("heading", { name: "Connect an AI provider" }),
	).toBeVisible({ timeout: 30_000 });
	await expect(
		page
			.getByLabel("Search models")
			.or(page.getByLabel("Model name", { exact: true })),
	).toBeVisible({ timeout: 30_000 });
	await page.screenshot({
		path: "e2e/pl-up/screenshots/setup-ai-provider.png",
		fullPage: true,
	});

	// RESUME AFTER RELOAD: a hard reload mid-wizard must not restart the flow
	// and must not fall through to the dashboard.
	await page.reload();
	await expect(
		page.getByRole("heading", { name: "Connect an AI provider" }),
	).toBeVisible({ timeout: 30_000 });

	// No provider key in CI, so skip: the step is an on-ramp, never a gate.
	await page.getByRole("button", { name: "Skip for now" }).click();

	await expect(
		page.getByRole("heading", { name: "Point PrismaLens at your code" }),
	).toBeVisible();

	// ERROR STATE: the server's own sentence, surfaced before anything is saved.
	await page.locator("#setup-checkout-path").fill("/definitely/not/a/checkout");
	await page.getByRole("button", { name: "Check" }).click();
	await expect(page.getByRole("alert")).toContainText(/does not exist/i, {
		timeout: 15_000,
	});
	await page.screenshot({
		path: "e2e/pl-up/screenshots/setup-code-location-error.png",
		fullPage: true,
	});

	// A fresh artifact has no service catalog, so the step has to be able to
	// create one — otherwise it would tell the operator to go build a catalog
	// first and come back.
	await page.locator("#setup-service-name").fill("e2e-service");
	await page.locator("#setup-checkout-path").fill(REPO_ROOT);
	await page.getByRole("button", { name: "Check" }).click();
	await expect(page.getByText(/Valid git checkout/i)).toBeVisible({
		timeout: 15_000,
	});
	await page.screenshot({
		path: "e2e/pl-up/screenshots/setup-code-location.png",
		fullPage: true,
	});

	await page.getByRole("button", { name: "Save & continue" }).click();
	await expect(
		page.getByRole("heading", { name: "Run your first investigation" }),
	).toBeVisible({ timeout: 30_000 });
	await page.screenshot({
		path: "e2e/pl-up/screenshots/setup-first-incident.png",
		fullPage: true,
	});

	// Leaving the wizard is always possible — the later steps are on-ramp, not a
	// gate, and the dashboard must be reachable without them.
	await page.getByRole("button", { name: "Skip setup" }).click();
	await expect(page).toHaveURL(/:\d+\/$/, { timeout: 30_000 });
	await expect(page.getByRole("navigation").first()).toBeVisible();

	// A HARD navigation: the guard re-runs from scratch and has to satisfy
	// itself from the session cookie alone. This is what caught `Secure` cookies
	// being set on a plain-http `pl up`.
	await page.goto("/incidents");
	await expect(
		page.getByRole("heading", { name: /incident/i }).first(),
	).toBeVisible({ timeout: 30_000 });
	await page.screenshot({
		path: "e2e/pl-up/screenshots/dashboard-default.png",
		fullPage: true,
	});
});

test("the wizard remembers what was already done, and empty screens point at what is missing", async ({
	page,
}) => {
	// A NEW browser context, so nothing about the previous test's progress can
	// come from client state — which is the point. Sign in first; the pl-up
	// project deliberately carries no storageState.
	await page.goto("/auth/login?redirect=/setup");
	await page.locator("#email").fill(OWNER.email);
	await page.locator("#password").fill(OWNER.password);
	await page.getByRole("button", { name: "Sign in" }).click();

	// The previous test mapped a checkout but skipped the provider. Setup status
	// is DERIVED, so /setup resumes on the provider step — the genuinely missing
	// piece — while the code-location step it already satisfied shows as done.
	await page.waitForURL(/\/setup/, { timeout: 30_000 });
	await expect(
		page.getByRole("heading", { name: "Connect an AI provider" }),
	).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('[aria-current="step"]')).toHaveText("2");
	await expect(page.locator('[data-step="code_location"]')).toHaveAttribute(
		"data-complete",
		"true",
	);
	await expect(page.locator('[data-step="ai_provider"]')).toHaveAttribute(
		"data-complete",
		"false",
	);

	// No dead ends: the empty screens on a fresh instance name the missing step
	// and link to it, instead of describing a source of data that does not exist
	// yet and offering nowhere to go (#332).
	await page.goto("/alerts");
	await expect(
		page.getByText(/No AI provider is configured/i).first(),
	).toBeVisible({ timeout: 30_000 });
	await page.screenshot({
		path: "e2e/pl-up/screenshots/alerts-empty-onramp.png",
		fullPage: true,
	});

	await page.goto("/");
	await expect(
		page.getByText(/No AI provider is configured/i).first(),
	).toBeVisible({ timeout: 30_000 });
	await page.screenshot({
		path: "e2e/pl-up/screenshots/dashboard-empty-onramp.png",
		fullPage: true,
	});

	await page.goto("/incidents");
	await expect(
		page.getByText(/No AI provider is configured/i).first(),
	).toBeVisible({ timeout: 30_000 });
	await page.screenshot({
		path: "e2e/pl-up/screenshots/incidents-empty-onramp.png",
		fullPage: true,
	});
	await page.getByRole("link", { name: "Finish setup" }).first().click();
	await page.waitForURL(/\/setup/, { timeout: 30_000 });

	// The design gate wants BOTH themes of every new surface, captured from this
	// running stack. Done here rather than in the theme test because the wizard's
	// later steps are only reachable with a session.
	for (const theme of ["light", "dark"] as const) {
		await page.evaluate((t) => {
			document.cookie = `prismalens-theme=${t}; path=/; max-age=31536000`;
		}, theme);
		await page.goto("/setup");
		await expect(page.locator("html")).toHaveClass(new RegExp(theme));

		await expect(
			page.getByRole("heading", { name: "Connect an AI provider" }),
		).toBeVisible({ timeout: 30_000 });
		// The model catalog comes from models.dev; wait it out so the capture
		// shows the real control rather than its loading box. Either shape is
		// fine — a searchable card list, or the manual model-name field the
		// selector falls back to when the registry is unreachable.
		await expect(
			page
				.getByLabel("Search models")
				.or(page.getByLabel("Model name", { exact: true })),
		).toBeVisible({ timeout: 30_000 });
		await page.screenshot({
			path: `e2e/pl-up/screenshots/setup-ai-provider-${theme}.png`,
			fullPage: true,
		});

		await page.getByRole("button", { name: "Skip for now" }).click();
		await expect(
			page.getByRole("heading", { name: "Point PrismaLens at your code" }),
		).toBeVisible();
		await page.screenshot({
			path: `e2e/pl-up/screenshots/setup-code-location-${theme}.png`,
			fullPage: true,
		});

		await page.getByRole("button", { name: "Skip for now" }).click();
		await expect(
			page.getByRole("heading", { name: "Run your first investigation" }),
		).toBeVisible();
		await page.screenshot({
			path: `e2e/pl-up/screenshots/setup-first-incident-${theme}.png`,
			fullPage: true,
		});
	}
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

test("theme survives a reload with no server function behind it", async ({
	page,
}) => {
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
	await page.screenshot({
		path: "e2e/pl-up/screenshots/light.png",
		fullPage: true,
	});

	// The wizard's own steps in dark, from the same running stack — the design
	// gate needs both themes of the surfaces this PR adds, not only the shell.
	await page.evaluate(() => {
		document.cookie = "prismalens-theme=dark; path=/; max-age=31536000";
	});
	await page.reload();
	await expect(page.locator("html")).toHaveClass(/dark/);
	await page.waitForLoadState("networkidle");
	await page.screenshot({
		path: "e2e/pl-up/screenshots/dark.png",
		fullPage: true,
	});
});

test("error state: a route the API answers with a 404 does not become the SPA shell", async ({
	page,
}) => {
	// The empty/error surface of the artifact: an unknown CLIENT route renders the
	// app's own not-found component, while an unknown API route stays JSON.
	await page.goto("/this-route-does-not-exist");
	await expect(page.locator("body")).not.toBeEmpty();
	await page.waitForLoadState("networkidle");
	await page.screenshot({
		path: "e2e/pl-up/screenshots/not-found.png",
		fullPage: true,
	});

	const api = await page.request.get("/api/also-not-a-route");
	expect(api.status()).toBe(404);
});
