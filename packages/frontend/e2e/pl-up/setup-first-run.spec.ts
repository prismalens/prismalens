// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * J1, first-run setup (#268) — the regression guard for #358.
 *
 * The rest of the suite signs in through the LOGIN FORM, which is exactly why
 * #358 survived a green e2e run: the form path always set a cookie, so nothing
 * ever exercised the path where the wizard itself has to establish the session.
 * This spec covers only that: complete the wizard, then reload, and still be
 * the owner. A test that signs in through the form would pass against the bug.
 *
 * It runs ONLY under `PL_UP_E2E=1`, because it needs a genuinely empty database
 * — the default dev-stack harness seeds an owner up front, so `/setup` there
 * redirects away before the wizard is ever reachable.
 *
 * Nothing else in the `pl-up` project creates an owner, so this file may run in
 * any order relative to `single-origin.spec.ts`.
 */

import { expect, test } from "@playwright/test";

const OWNER = {
	email: "owner@prismalens.test",
	password: "pl-up-e2e-password",
	name: "PL Up Owner",
};

const SHOTS = "e2e/pl-up/screenshots";

/**
 * The dashboard's own heading. Deliberately NOT the navbar: that lives in the
 * root route and renders on the login screen too, so it cannot tell "signed in"
 * from "bounced".
 */
function dashboard(page: import("@playwright/test").Page) {
	return page.getByRole("heading", { name: /command center/i }).first();
}

async function setTheme(
	page: import("@playwright/test").Page,
	theme: "light" | "dark",
) {
	await page.evaluate((value) => {
		document.cookie = `prismalens-theme=${value}; path=/; max-age=31536000`;
	}, theme);
	await page.reload();
	await page.waitForLoadState("networkidle");
}

/**
 * Back to the DEFAULT presentation — no `prismalens-theme` override at all, so
 * the pre-paint script decides the way it does for someone who has never
 * touched the theme toggle. The `*-default.png` captures have to come from
 * this state: pinning the cookie to `light` would photograph the light theme
 * and label it the default, which is a different claim.
 */
async function clearTheme(page: import("@playwright/test").Page) {
	await page.context().clearCookies({ name: "prismalens-theme" });
	await page.reload();
	await page.waitForLoadState("networkidle");
}

test.describe.configure({ mode: "serial" });

test("completing the setup wizard leaves a session that survives a reload", async ({
	page,
}) => {
	// An empty workspace has no owner, so the artifact must land on the wizard.
	await page.goto("/");
	await page.waitForURL(/\/setup/, { timeout: 30_000 });
	await expect(page.getByLabel("Email address")).toBeVisible();

	// The changed surface, every theme, before it is consumed.
	//
	// `default` is the app with no `prismalens-theme` cookie at all, which
	// resolves to DARK — so the default and dark captures look alike, and the
	// explicit light one is the only evidence the other theme still renders.
	// Dropping either would leave a theme uncovered.
	await clearTheme(page);
	await page.screenshot({ path: `${SHOTS}/setup-wizard-default.png`, fullPage: true });
	await setTheme(page, "light");
	await page.screenshot({ path: `${SHOTS}/setup-wizard-light.png`, fullPage: true });
	await setTheme(page, "dark");
	await page.screenshot({ path: `${SHOTS}/setup-wizard-dark.png`, fullPage: true });
	await clearTheme(page);

	// The error state, captured from the real surface rather than mocked: a
	// confirmation that does not match is the one rejection a first-run user can
	// reach without a server, and it is the only path that renders the wizard's
	// destructive Alert. Nothing is created here — validation fails before the
	// mutation fires, so the wizard is still first-run afterwards.
	await page.locator("#name").fill(OWNER.name);
	await page.locator("#email").fill(OWNER.email);
	await page.locator("#password").fill(OWNER.password);
	await page.locator("#confirmPassword").fill(`${OWNER.password}-typo`);
	await page.getByRole("button", { name: /create account/i }).click();
	await expect(page.getByText(/passwords do not match/i)).toBeVisible();
	await expect(page).toHaveURL(/\/setup/);
	await page.screenshot({
		path: `${SHOTS}/setup-wizard-error.png`,
		fullPage: true,
	});

	await page.locator("#confirmPassword").fill(OWNER.password);
	await page.getByRole("button", { name: /create account/i }).click();

	// The wizard shows its "Setup Complete!" card and then hard-navigates to the
	// dashboard. Landing on /auth/login here already means the session is gone.
	await expect(page.getByText(/setup complete/i)).toBeVisible({
		timeout: 30_000,
	});
	await page.waitForURL(/:\d+\/$/, { timeout: 30_000 });
	await expect(dashboard(page)).toBeVisible({ timeout: 30_000 });

	// THE FALSIFIER. Before the fix the client was authenticated in memory only:
	// POST /api/setup created the owner but its Set-Cookie never left the server,
	// so this reload dropped a brand-new owner on the login screen.
	//
	// The guard runs in the BROWSER after the bundle loads, so the bounce is a
	// client-side redirect a beat later — settle the page first, or the URL
	// assertion passes against the pre-redirect `/` and proves nothing. The
	// navbar is no good as a signal either: it is rendered by the root route, so
	// it is just as visible on the login screen.
	await page.reload();
	await page.waitForLoadState("networkidle");
	await expect(page).not.toHaveURL(/\/auth\/login/);
	await expect(page).toHaveURL(/:\d+\/$/);
	await expect(dashboard(page)).toBeVisible({ timeout: 30_000 });

	// And the server agrees it is a session, not just a rendered shell.
	const session = await page.request.get("/api/auth/get-session");
	expect(session.status()).toBe(200);
	const body = (await session.json()) as {
		user?: { email?: string; role?: string };
	};
	expect(body?.user?.email).toBe(OWNER.email);
	// The wizard promotes the account to owner AFTER Better Auth creates it, and
	// Better Auth caches the session's user in a signed cookie for five minutes.
	// A session minted before the promotion would report the sign-up default here
	// and silently 403 the new owner out of their own settings.
	expect(body?.user?.role).toBe("owner");

	const cookies = await page.context().cookies();
	const token = cookies.find((c) => c.name.endsWith("session_token"));
	expect(token, "wizard completion must leave a session cookie").toBeTruthy();
	expect(token?.httpOnly).toBe(true);
	// `pl up` serves plain http, so the resolved origin's scheme — not NODE_ENV —
	// decides `Secure` (#357). A `Secure` cookie here is one the browser would
	// refuse to send back, which is the same signed-out symptom by another route.
	expect(token?.secure).toBe(false);

	await page.screenshot({ path: `${SHOTS}/setup-complete-default.png`, fullPage: true });
	await setTheme(page, "light");
	await page.screenshot({ path: `${SHOTS}/setup-complete-light.png`, fullPage: true });
	await setTheme(page, "dark");
	await page.screenshot({ path: `${SHOTS}/setup-complete-dark.png`, fullPage: true });
	await clearTheme(page);
});
