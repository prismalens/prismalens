// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { test } from "../steps/fixtures";
import {
	ensureService,
	fireIncident,
	LIVE,
	sidewaysFaults,
	visit,
	waitForRun,
} from "../steps/product";
import { hideQueryDevtools } from "./live-stream-fixtures";
import { liveStreamOnce, seedLongThread } from "./long-thread-fixtures";

/**
 * The look pass's coverage matrix (#1020): every state in both themes at three
 * widths, interaction states, a keyboard walk, live-run frames, and measured
 * contrast, tap targets, clipping and console errors in matrix.json.
 * Run on purpose: `DESIGN_SHOTS=1 DESIGN_SHOTS_DIR=<dir> playwright test design-matrix`.
 */
const OUT = resolve(process.env.DESIGN_SHOTS_DIR ?? "design-shots/matrix");
const WIDTHS = [
	{ w: 1280, h: 800 },
	{ w: 768, h: 1024 },
	{ w: 390, h: 844 },
] as const;
const THEMES = ["dark", "light"] as const;
type Theme = (typeof THEMES)[number];

test.skip(!process.env.DESIGN_SHOTS, "design shots run on purpose only");
test.setTimeout(45 * 60_000);

interface Measure {
	contrast: { ratio: string; text: string; target: string }[];
	smallTargets: { name: string; w: number; h: number }[];
	clipped: string[];
	sideways: string[];
	consoleErrors: string[];
	axeOther: string[];
	/** Visible controls in the page's main area, for the budget's control ceiling. */
	controls: number;
}

async function theme(page: Page, value: Theme) {
	await page
		.context()
		.addCookies([
			{ name: "prismalens-theme", value, domain: "localhost", path: "/" },
		]);
}

async function measure(page: Page, errors: string[]): Promise<Measure> {
	const axe = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
		.exclude(".tsqd-parent-container")
		.analyze();
	const contrast = axe.violations
		.filter((v) => v.id === "color-contrast")
		.flatMap((v) =>
			v.nodes.map((n) => ({
				ratio: /contrast of ([\d.]+)/.exec(n.failureSummary ?? "")?.[1] ?? "?",
				text: n.html.replace(/\s+/g, " ").slice(0, 90),
				target: n.target.join(" "),
			})),
		);
	const axeOther = axe.violations
		.filter((v) => v.id !== "color-contrast")
		.map(
			(v) =>
				`${v.id} (${v.nodes.length}): ${v.nodes[0]?.html.replace(/\s+/g, " ").slice(0, 80) ?? ""}`,
		);
	const { smallTargets, clipped, controls } = await page.evaluate(() => {
		const sel =
			"button, a[href], input:not([type=hidden]), textarea, [role=button], [role=tab], [role=combobox], [role=switch], [role=menuitem]";
		const shown = (el: HTMLElement) => {
			const r = el.getBoundingClientRect();
			return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
		};
		const main = document.querySelector<HTMLElement>("main");
		const controls = main
			? Array.from(main.querySelectorAll<HTMLElement>(sel)).filter(shown).length
			: 0;
		const small: { name: string; w: number; h: number }[] = [];
		for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
			const r = el.getBoundingClientRect();
			if (
				r.width === 0 ||
				r.height === 0 ||
				r.bottom < 0 ||
				r.top > innerHeight
			)
				continue;
			if (el.closest(".tsqd-parent-container")) continue;
			// A link stretched over its row by an absolute ::after is hit by the whole row.
			const after = getComputedStyle(el, "::after");
			if (after.position === "absolute" && after.content !== "none") continue;
			if (r.width < 24 || r.height < 24)
				small.push({
					name: (el.getAttribute("aria-label") ?? el.textContent ?? el.tagName)
						.trim()
						.slice(0, 40),
					w: Math.round(r.width),
					h: Math.round(r.height),
				});
		}
		const clip: string[] = [];
		for (const el of Array.from(
			document.querySelectorAll<HTMLElement>("body *"),
		)) {
			if (el.children.length > 0 || !el.textContent?.trim()) continue;
			const s = getComputedStyle(el);
			const hides = s.overflowX !== "visible" || s.overflowY !== "visible";
			if (!hides) continue;
			const cut =
				el.scrollWidth > el.clientWidth + 1 && s.textOverflow !== "ellipsis";
			const cutV =
				el.scrollHeight > el.clientHeight + 2 &&
				s.overflowY === "hidden" &&
				!s.webkitLineClamp?.match(/\d/);
			// Screen-reader-only text is clipped to 1 px on purpose.
			if ((cut || cutV) && el.getBoundingClientRect().width > 1)
				clip.push(el.textContent.trim().slice(0, 60));
		}
		return { smallTargets: small, clipped: clip.slice(0, 20), controls };
	});
	return {
		contrast,
		smallTargets,
		clipped,
		sideways: await sidewaysFaults(page),
		consoleErrors: errors.splice(0),
		axeOther,
		controls,
	};
}

test("design coverage matrix", async ({
	page,
	agents,
	alertmanager,
	deliverWebhook,
}) => {
	mkdirSync(OUT, { recursive: true });
	await hideQueryDevtools(page);
	const errors: string[] = [];
	page.on("console", (m) => {
		if (m.type() === "error") errors.push(m.text().slice(0, 160));
	});
	page.on("pageerror", (e) =>
		errors.push(`pageerror: ${e.message.slice(0, 160)}`),
	);
	const report: Record<string, Measure> = {};

	const shoot = async (
		name: string,
		path: string,
		ready: (p: Page) => Promise<unknown>,
		opts: {
			widths?: readonly (typeof WIDTHS)[number][];
			themes?: readonly Theme[];
			measureIt?: boolean;
		} = {},
	) => {
		for (const t of opts.themes ?? THEMES) {
			await theme(page, t);
			for (const size of opts.widths ?? WIDTHS) {
				await page.setViewportSize({ width: size.w, height: size.h });
				const frame =
					path === "/new"
						? "home"
						: path === "/_design"
							? "design-gallery"
							: path.startsWith("/schedules/")
								? "trigger-card"
								: undefined;
				// The dev server now and then fails the client entry under load; a second load settles it.
				await visit(page, path, frame).catch(() => visit(page, path, frame));
				await ready(page);
				await page.waitForTimeout(400);
				const key = `${name}-${size.w}-${t}`;
				await page.screenshot({
					path: join(OUT, `${key}.png`),
					animations: "disabled",
				});
				if (opts.measureIt !== false) report[key] = await measure(page, errors);
			}
		}
	};
	const shotHere = async (key: string, doMeasure = true) => {
		await page.waitForTimeout(300);
		await page.screenshot({
			path: join(OUT, `${key}.png`),
			animations: "disabled",
		});
		if (doMeasure) report[key] = await measure(page, errors);
	};

	// Empty: a new install with an agent.
	await page.request.post("/api/settings/danger/reset-data", {
		data: { confirmation: "RESET" },
	});
	const seeded = (await (
		await page.request.get("/api/services?limit=100")
	).json()) as { data: { id: string }[] };
	for (const s of seeded.data)
		await page.request.delete(`/api/services/${s.id}`);
	agents.install(["claude-agent-acp"], "claude");
	await page.request.post("/api/settings/harness/check", {
		data: { id: "claude-code" },
	});
	await page.request.patch("/api/settings/harness", {
		data: { harness: "claude-code" },
	});
	await page.request.put("/api/settings/telemetry", {
		data: { noticed: true, dismissed: true },
	});

	const home = (p: Page) => expect(p.getByTestId("home")).toBeVisible();
	await shoot("empty-home", "/new", home);
	await shoot("empty-alerts", "/alerts", (p) =>
		expect(p.getByTestId("alerts-none")).toBeVisible(),
	);
	await shoot("empty-services", "/services", (p) =>
		expect(p.getByTestId("services-empty")).toBeVisible(),
	);
	await shoot("settings", "/settings", (p) =>
		expect(p.getByTestId("settings-frame")).toBeVisible(),
	);

	// Interaction states at 1280, both themes.
	for (const t of THEMES) {
		await theme(page, t);
		await page.setViewportSize({ width: 1280, height: 800 });
		await visit(page, "/services");
		await page.getByTestId("add-service").first().click();
		await expect(page.getByRole("dialog")).toBeVisible();
		await shotHere(`dialog-add-service-1280-${t}`);
		await page.getByTestId("service-more").click();
		await shotHere(`dialog-add-service-more-1280-${t}`);
		await page.keyboard.press("Escape");
		await visit(page, "/new");
		await page.keyboard.press("Control+k");
		await expect(page.getByTestId("thread-search")).toBeVisible();
		await shotHere(`palette-1280-${t}`);
		await page.keyboard.press("Escape");
		await page.getByTestId("nav-new").hover();
		await shotHere(`hover-nav-1280-${t}`, false);
		await page.getByTestId("home").getByTestId("composer-input").fill("x");
		await page.getByTestId("composer-send").hover();
		await shotHere(`hover-send-1280-${t}`, false);
	}

	// Keyboard-only walk: Tab stops on Home and in Add service.
	await theme(page, "dark");
	const walk: Record<string, string[]> = {};
	for (const [name, path, open] of [
		["home", "/new", null],
		["add-service", "/services", "add-service"],
	] as const) {
		await visit(page, path);
		if (open) {
			await page.getByTestId(open).first().click();
			await expect(page.getByRole("dialog")).toBeVisible();
		} else await page.locator("body").click({ position: { x: 700, y: 760 } });
		walk[name] = [];
		for (let i = 0; i < 14; i++) {
			await page.keyboard.press("Tab");
			const stop = await page.evaluate(() => {
				const el = document.activeElement as HTMLElement | null;
				if (!el) return "none";
				const ring = getComputedStyle(el);
				// A field's ring may sit on its wrapper through :focus-within.
				let wrap = el.parentElement;
				let wrapRing = false;
				for (let up = 0; wrap && up < 4 && !wrapRing; up++) {
					wrapRing = /0px 0px 0px [1-9]px/.test(
						getComputedStyle(wrap).boxShadow,
					);
					wrap = wrap.parentElement;
				}
				const visible =
					ring.outlineStyle !== "none" || ring.boxShadow !== "none" || wrapRing;
				if (el === document.body) return "(page end, wraps)";
				const label =
					el.getAttribute("aria-label") ??
					(el as HTMLInputElement).labels?.[0]?.textContent ??
					el.getAttribute("placeholder") ??
					el.textContent?.trim().slice(0, 30) ??
					el.tagName;
				return `${label}${visible ? "" : " [no focus ring]"}`;
			});
			walk[name].push(stop);
			if (i < 6)
				await page.screenshot({
					path: join(OUT, `tab-${name}-${String(i + 1).padStart(2, "0")}.png`),
				});
		}
		await page.keyboard.press("Escape");
	}

	// One service, then many incidents with long names, a failed and a live run.
	await ensureService(page, {
		name: "checkout-api-eu-west-payments-gateway-v2",
		displayName: "Checkout API EU West Payments Gateway v2",
	});
	await shoot("one-service-home", "/new", home, { widths: [WIDTHS[0]] });

	// Plain chats are the default case (harness first): one, many, running, finished.
	const chat = async (text: string, accessLevel?: "supervised") => {
		const made = await page.request.post("/api/incidents", {
			data: { title: text, tags: ["chat"] },
		});
		const { id } = (await made.json()) as { id: string };
		const started = await page.request.post(`/api/incidents/${id}/chat`, {
			data: { text, ...(accessLevel ? { accessLevel } : {}) },
		});
		expect(started.ok(), await started.text()).toBe(true);
		return id;
	};
	const firstChat = await chat(
		"Why does the cart page reload twice on submit?",
	);
	await waitForRun(page, firstChat, (r) => r.status === "completed", "chat");
	await shoot("chat-finished", `/incidents/${firstChat}/conversation`, (p) =>
		expect(p.getByTestId("transcript")).toBeVisible(),
	);
	for (const q of [
		"Explain the retry logic in the payments client",
		"Where do we set the session timeout?",
		"Add a test for the discount rounding bug",
		"Summarise what changed in the checkout module this week",
		"Is the cache key for product pages too broad?",
	])
		await chat(q);
	const runningChat = await chat(
		"Trace why login is slow on staging fake-session:live",
	);
	await waitForRun(
		page,
		runningChat,
		(r) => r.status === "running",
		"chat run",
	);
	await shoot("chat-running", `/incidents/${runningChat}/conversation`, (p) =>
		expect(p.getByTestId("transcript")).toBeVisible(),
	);
	await shoot("chats-home", "/new", home);
	for (let i = 0; i < 42; i++)
		await page.request.post("/api/incidents", {
			data: {
				title:
					i % 3 === 0
						? `Checkout latency p99 above 2s for EU customers on the payments gateway after deploy ${i}`
						: `Incident ${i} queue lag`,
			},
		});
	const failed = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "BooklogrWorkerCrashLoopWithAVeryLongAlertNameForTruncation",
		service: LIVE,
		severity: "high",
		session: "failure",
	});
	await waitForRun(page, failed.id, (r) => r.status === "failed", "failed");
	const done = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "BooklogrApiLatencyP99High",
		service: LIVE,
		severity: "critical",
		session: "success",
	});
	await waitForRun(page, done.id, (r) => r.status === "completed", "done");
	const live = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "BooklogrCacheMissSpike",
		service: LIVE,
		severity: "warning",
		session: "live",
	});
	await waitForRun(page, live.id, (r) => r.status === "running", "live");

	await shoot("many-board", "/incidents", (p) =>
		expect(p.getByTestId("inbox")).toBeVisible(),
	);
	await shoot("new", "/new", home);

	// Trigger variants in the same slots: a generic webhook, an ask, a schedule.
	const { token } = (await (
		await page.request.get("/api/webhooks/token")
	).json()) as { token: string };
	const hook = await page.request.post("/api/webhooks/generic", {
		headers: { authorization: `Bearer ${token}` },
		data: {
			title: "CI failed on main",
			source: "ci",
			serviceName: LIVE.name,
			severity: "medium",
			labels: { branch: "main", job: "build" },
		},
	});
	expect(hook.ok(), await hook.text()).toBe(true);
	const { incidentId: hookId } = (await hook.json()) as { incidentId: string };
	// The event names its service, so a run starts and the thread may open on its transcript (#1008).
	await shoot("webhook-thread", `/incidents/${hookId}`, (p) =>
		expect(
			p.getByTestId("incident-overview").or(p.getByTestId("situation")),
		).toBeVisible(),
	);
	const asking = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "PaymentsQueueBacklog",
		service: LIVE,
		severity: "high",
		session: "ask",
	});
	await waitForRun(
		page,
		asking.id,
		// An alert-started run refuses the ask, so it may already have ended.
		(r) => !["pending", "queued", "starting"].includes(r.status),
		"asking",
	);
	await shoot("ask-thread", `/incidents/${asking.id}/conversation`, (p) =>
		expect(p.getByTestId("transcript")).toBeVisible(),
	);
	await shoot("sidebar-sections", "/new", home, { widths: [WIDTHS[0]] });
	// The generic-first pages (#1020): every thread, and what starts threads without you.
	await shoot("threads-page", "/threads", (p) =>
		expect(p.getByTestId("threads-page")).toBeVisible(),
	);
	await shoot("automation-page", "/automation", (p) =>
		expect(p.getByTestId("automation-page")).toBeVisible(),
	);

	// A schedule's run, and Home after time away (both in the same slots as any thread).
	const svc = await ensureService(page, LIVE);
	const sched = await page.request.post("/api/schedules", {
		data: {
			name: "Nightly checkout check",
			serviceId: svc,
			runbook: null,
			brief: "Check error rates and slow queries from the last day.",
			recurrence: { type: "cron", expr: "0 2 * * *", timezone: "UTC" },
			harness: "claude-code",
			model: null,
			effort: null,
			missedPolicy: "skip",
			catchUpMinutes: 60,
		},
	});
	expect(sched.ok(), await sched.text()).toBe(true);
	const { id: schedId } = (await sched.json()) as { id: string };
	expect(
		(
			await page.request.post(`/api/schedules/${schedId}/run`, { data: {} })
		).ok(),
	).toBe(true);
	let schedRun: string | null = null;
	await expect
		.poll(
			async () => {
				const d = (await (
					await page.request.get(`/api/schedules/${schedId}`)
				).json()) as {
					ticks: { run: { id: string; status: string } | null }[];
				};
				const run = d.ticks.find((t) => t.run?.status === "completed")?.run;
				schedRun = run?.id ?? null;
				return !!run;
			},
			{ timeout: 60_000 },
		)
		.toBe(true);
	await shoot(
		"schedule-run",
		`/schedules/${schedId}/runs/${schedRun}`,
		(p) => expect(p.getByTestId("trigger-card")).toBeVisible(),
		{ widths: [WIDTHS[0]] },
	);
	await page.addInitScript(() =>
		localStorage.setItem("pl.home.seenAt", String(Date.now() - 3_600_000)),
	);
	await shoot(
		"away-board",
		"/incidents",
		(p) => expect(p.getByTestId("away-strip")).toBeVisible(),
		{ widths: [WIDTHS[0]] },
	);
	await shoot("live-run", `/incidents/${live.id}/conversation`, (p) =>
		expect(p.getByTestId("transcript")).toBeVisible(),
	);
	// A thread with a run opens on its transcript, the summary above it (#1020).
	await shoot("finished", `/incidents/${done.id}`, (p) =>
		expect(p.getByTestId("situation")).toBeVisible(),
	);
	await shoot("incident-panel", `/incidents/${done.id}`, async (p) => {
		await p.getByTestId("transcript-report-overview").click();
		await expect(p.getByTestId("run-details-incident")).toBeVisible();
	});
	// With the panel closed, as the acceptance test asks: the panel shot above leaves it open.
	await shoot("failed", `/incidents/${failed.id}/conversation`, async (p) => {
		await expect(p.getByTestId("run-page")).toBeVisible();
		const close = p.getByTestId("run-details-close");
		if (await close.isVisible()) await close.click();
	});
	// A provider stop on a real run (#1101): the dock above the box, Limited or Blocked.
	for (const [session, state, name] of [
		["limit-mid-turn", "resuming", "PaymentsLimitMidTurn"],
		["api-rate-limit", "retrying", "PaymentsRateLimited"],
		["api-key-rejected", "blocked", "PaymentsKeyRejected"],
		["api-overloaded-gave-up", "gaveUp", "PaymentsProviderBusy"],
	] as const) {
		const stopped = await fireIncident(page, alertmanager, deliverWebhook, {
			name,
			service: LIVE,
			severity: "high",
			session,
		});
		await waitForRun(
			page,
			stopped.id,
			(r) => r.status === "failed",
			`the ${session} run to stop`,
		);
		await shoot(
			`stop-${session}`,
			`/incidents/${stopped.id}/conversation`,
			(p) =>
				expect(p.getByTestId("limit-dock")).toHaveAttribute(
					"data-state",
					state,
				),
		);
	}
	// The state gallery: shared components from fixtures, no data behind them.
	await shoot("design-gallery", "/_design", (p) =>
		expect(p.getByTestId("design-gallery")).toBeVisible(),
	);
	await shoot("many-services", "/services", (p) =>
		expect(p.getByTestId("services-page")).toBeVisible(),
	);

	// An open menu and the sidebar row's hover and focus, at 1280.
	for (const t of THEMES) {
		await theme(page, t);
		await page.setViewportSize({ width: 1280, height: 800 });
		await visit(page, `/incidents/${done.id}`);
		await page.getByTestId("header-more").click();
		await shotHere(`menu-action-1280-${t}`);
		await page.keyboard.press("Escape");
		const row = page.getByTestId("thread-row").first();
		await row.hover();
		await shotHere(`hover-row-1280-${t}`, false);
		await row.focus();
		await shotHere(`focus-row-1280-${t}`, false);
	}

	// Loading and API failure on the board.
	await theme(page, "dark");
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.route("**/api/incidents?*", async (r) => {
		await new Promise((f) => setTimeout(f, 4000));
		await r.fallback();
	});
	await page.goto("/incidents");
	await page.waitForTimeout(800);
	await shotHere("loading-board-1280-dark", false);
	await page.unrouteAll({ behavior: "ignoreErrors" });
	await page.route("**/api/incidents**", (r) => r.abort());
	await page.goto("/incidents");
	await page.waitForTimeout(3000);
	await shotHere("error-board-1280-dark");
	await page.unrouteAll({ behavior: "ignoreErrors" });

	// The live run as frames, then with reduced motion.
	const again = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "BooklogrFramesSpike",
		service: LIVE,
		severity: "warning",
		session: "live",
	});
	await visit(page, `/incidents/${again.id}/conversation`);
	for (let i = 0; i < 5; i++) {
		await page.screenshot({ path: join(OUT, `frames-live-${i + 1}.png`) });
		await page.waitForTimeout(300);
	}
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.reload();
	await expect(page.getByTestId("run-page")).toBeVisible();
	await page.waitForTimeout(500);
	await page.screenshot({ path: join(OUT, "frames-live-reduced.png") });

	// A chat that waits on an approval: the sidebar's Waiting for you, at every width (#1020).
	await chat("Rotate the staging API key fake-session:ask", "supervised");
	try {
		await page.goto("/new");
		await expect(page.getByTestId("thread-section-waiting")).toBeVisible({
			timeout: 20_000,
		});
		await shoot("sidebar-waiting", "/new", (p) =>
			expect(p.getByTestId("thread-section-waiting")).toBeVisible(),
		);
	} catch {
		console.log(
			"matrix: no waiting thread appeared; sidebar-waiting shows none",
		);
	}

	// A long thread (#1101 categories 12-14): the rail and its marks, find in each
	// state, a failed page, the N new pill and the reconnect line.
	const long = seedLongThread(1500);
	const longPath = `/threads/${long.id}`;
	await shoot("thread-long", longPath, (p) =>
		expect(p.getByTestId("transcript")).toBeVisible(),
	);
	for (const t of THEMES) {
		await theme(page, t);
		await page.setViewportSize({ width: 1280, height: 800 });
		await visit(page, longPath, "thread-page");
		await page.getByTestId("rail-mark-usage_limit").first().hover();
		await expect(page.getByTestId("rail-preview")).toBeVisible();
		await shotHere(`thread-rail-hover-1280-${t}`);
		await page.mouse.move(0, 0);

		await page.keyboard.press("Control+f");
		const count = page.getByTestId("find-count");
		await page.getByTestId("find-input").fill("pool");
		await expect(count).toHaveText(/^\d+\/\d+$/, { timeout: 20_000 });
		await shotHere(`thread-find-hits-1280-${t}`);
		await page.getByTestId("find-input").fill("zzz-nothing");
		await expect(count).toHaveText("0/0", { timeout: 20_000 });
		await shotHere(`thread-find-none-1280-${t}`);
		await page.route("**/search?**", async (r) => {
			await new Promise((ok) => setTimeout(ok, 4000));
			await r.fallback().catch(() => {});
		});
		await page.getByTestId("find-input").fill("checkout");
		await expect(count).toHaveAttribute("data-state", "counting");
		await shotHere(`thread-find-counting-1280-${t}`);
		await page.unroute("**/search?**");
		await page.route("**/search?**", (r) => r.abort());
		await page.getByTestId("find-input").fill("rollback");
		await expect(page.getByTestId("find-retry")).toBeVisible({
			timeout: 20_000,
		});
		await shotHere(`thread-find-retry-1280-${t}`);
		await page.unroute("**/search?**");
		await page.keyboard.press("Escape");

		await page.route("**/window/page?**", (r) => r.abort());
		const edge = page.getByTestId("transcript-edge-before");
		for (let i = 0; i < 10; i++) {
			await page
				.getByTestId("transcript-scroller")
				.evaluate((el) => el.scrollTo(0, 0));
			if ((await edge.getAttribute("data-state")) === "error") break;
			await page.waitForTimeout(400);
		}
		await expect(edge).toHaveAttribute("data-state", "error");
		await shotHere(`thread-page-retry-1280-${t}`);
		await page.unroute("**/window/page?**");

		const live = await liveStreamOnce(page, long.id, "New answer below.");
		await visit(page, longPath, "thread-page");
		await page
			.getByTestId("transcript-scroller")
			.evaluate((el) => el.scrollBy(0, -1200));
		live.release();
		await expect(page.getByTestId("transcript-new")).toBeVisible({
			timeout: 20_000,
		});
		await expect(page.getByTestId("transcript-reconnecting")).toBeVisible({
			timeout: 20_000,
		});
		await shotHere(`thread-new-reconnecting-1280-${t}`);
		await page.unrouteAll({ behavior: "ignoreErrors" });
	}

	writeFileSync(
		join(OUT, "matrix.json"),
		`${JSON.stringify({ walk, report }, null, 2)}\n`,
	);
});
