// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { test } from "../steps/fixtures";
import { fireIncident, LIVE, visit, waitForRun } from "../steps/product";

/**
 * The overview redesign's screenshots (#811), compared by hand against the
 * mockup artboards. Run on purpose: `DESIGN_SHOTS=1 playwright test overview-shots`.
 * The fixes, the deploy and the git problem are written into the responses:
 * the fake agent's report predates typed fixes.
 */
const OUT = resolve(
	process.env.DESIGN_SHOTS_DIR ??
		join(dirname(fileURLToPath(import.meta.url)), "../../design-shots"),
);
const SIZES = [
	{ width: 1280, height: 800 },
	{ width: 1440, height: 900 },
	{ width: 1920, height: 1080 },
] as const;
const THEMES = ["dark", "light"] as const;

test.skip(!process.env.DESIGN_SHOTS, "design shots run on purpose only");
test.setTimeout(15 * 60_000);

async function theme(page: Page, value: string) {
	await page
		.context()
		.addCookies([
			{ name: "prismalens-theme", value, domain: "localhost", path: "/" },
		]);
}

async function shot(page: Page, name: string) {
	await page.waitForTimeout(600);
	await page.screenshot({
		path: join(OUT, `${name}.png`),
		animations: "disabled",
	});
	const scroll = await page.evaluate(() => ({
		h: document.documentElement.scrollHeight - innerHeight,
		w: document.documentElement.scrollWidth - innerWidth,
	}));
	expect(scroll, `${name}: the window never scrolls`).toEqual({ h: 0, w: 0 });
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000;

/** The report as a run with typed fixes writes it; ids bind to real recommendation rows where there are any. */
function richReport(
	report: Record<string, unknown>,
	rowIds: string[],
): Record<string, unknown> {
	return {
		...report,
		summary:
			"Book pages with many notes are slow on booklogr-api. The slowest 1% of requests take 2.4s instead of 0.5s, and it is getting worse. It began 18 minutes after deploy v1.42.",
		rootCause:
			"The notes endpoint loads every note for a book and sorts them in Python, not in the database. Response time grows with the number of notes, so books with many notes are slow.",
		rootCauseCategory: "code",
		culprit: {
			service: "booklogr-api",
			changeRef: "v1.42",
			mechanism: "in-memory sort",
		},
		hypotheses: [
			{
				statement: "v1.42 moved the notes sort into Python",
				status: "supported",
				evidence: [
					{
						observation:
							"Notes are loaded in full, then sorted in Python on every request",
						source: "read api/routes/books.py",
						direction: "supports",
						status: "verified",
						toolCallId: "toolu_01",
					},
					{
						observation:
							"Request time rises with notes per book; books under 20 notes are fine",
						source: "p99 by notes_count",
						direction: "supports",
						status: "verified",
						toolCallId: "toolu_01",
					},
					{
						observation:
							"91% of the time is inside get_notes_for_book, not the database call",
						source: "trace 7f3a..c21",
						direction: "supports",
						status: "inferred",
					},
				],
			},
		],
		ruledOut: [
			{ statement: "Database load", why: "CPU at 12%", evidence: [] },
			{ statement: "Cache misses", why: "Hit rate steady", evidence: [] },
		],
		coverage: {
			queried: ["git log", "code"],
			notQueried: ["prometheus", "logs", "traces"],
		},
		nextSteps: [
			{
				id: rowIds[0] ?? "00000000-0000-4000-8000-000000000001",
				kind: "stop-impact",
				title: "Roll back booklogr-api to v1.41",
				detail: "Undo deploy v1.42.",
				command:
					"kubectl rollout undo deployment/booklogr-api --to-revision=41",
				facts: [
					"Undoes deploy v1.42, 2 files, including books.py.",
					"v1.41 ran for 6 days with the slowest 1% at 0.5s.",
					"Revision 41 is v1.41: kubectl rollout history lists it with image booklogr-api:1.41.",
				],
				priority: "high",
			},
			{
				id: "00000000-0000-4000-8000-000000000002",
				kind: "stop-impact",
				title: "Cap notes per page at 50",
				detail: "Limits the in-memory sort without a deploy.",
				command: "kubectl set env deployment/booklogr-api NOTES_PAGE_LIMIT=50",
				facts: ["No deploy needed. Clients see the first 50 notes only."],
				priority: "medium",
			},
			{
				id: "00000000-0000-4000-8000-000000000003",
				kind: "lasting",
				title: "Sort notes in SQL again",
				detail:
					"Order and page notes in the SQL query again, then add an index on notes(book_id, created_at).",
				priority: "medium",
			},
		],
	};
}

const changes = (incidentId: string, problem: boolean) => ({
	incidentId,
	startedAt: iso(13 * 60 * MIN),
	window: { start: iso(48 * 60 * MIN), end: iso(0) },
	deploy: problem
		? null
		: {
				id: "00000000-0000-4000-8000-0000000000c1",
				kind: "deployment",
				at: iso(13 * 60 * MIN + 18 * MIN),
				title: "Sort notes in Python",
				sha: "3f9a2c1d0e",
				tag: "v1.42",
				pr: null,
				author: "dev",
				files: { count: 2, paths: ["api/routes/books.py", "api/db.py"] },
				url: null,
				repo: "booklogr/api",
				service: null,
				source: "git",
			},
	timeline: problem
		? []
		: [
				{
					id: "00000000-0000-4000-8000-0000000000c2",
					kind: "merge",
					at: iso(13 * 60 * MIN + 30 * MIN),
					title: "Move the notes sort into the service layer",
					sha: "aa11bb22cc",
					tag: null,
					pr: 88,
					author: "dev",
					files: null,
					url: null,
					repo: "booklogr/api",
					service: null,
					source: "git",
				},
			],
	total: problem ? 0 : 1,
	state: problem ? "failed" : "ok",
	refreshing: false,
	sources: problem
		? [
				{
					repositoryId: "00000000-0000-4000-8000-0000000000d1",
					repo: "booklogr/api",
					serviceId: "s",
					serviceName: "booklogr-api",
					status: "failed",
					credential: null,
					problem: {
						code: "no-credential",
						message: "No credential can read booklogr/api",
						action: "add-credential",
					},
					checkedAt: iso(0),
				},
			]
		: [],
});

type ImpactMode = "chart" | "none" | "slow" | "service";

/** A p99 that sat at 0.5 s, then climbed after the deploy 13 hours ago. */
function impact(incidentId: string, mode: ImpactMode) {
	const end = Math.floor(Date.now() / 1000);
	const points: [number, number][] = Array.from({ length: 97 }, (_, i) => {
		const t = end - (96 - i) * 900;
		const after = i - 44;
		const v = 0.48 + Math.sin(i * 1.7) * 0.04;
		return [t, after <= 0 ? v : Math.min(2.4, v + (after / 52) ** 1.15 * 1.95)];
	});
	const deploy = changes(incidentId, false).deploy;
	return {
		incidentId,
		alertId: null,
		state:
			mode === "none"
				? "not_configured"
				: mode === "service"
					? "expression_unknown"
					: "ok",
		expression: {
			state:
				mode === "none"
					? "not_configured"
					: mode === "service"
						? "expression_unknown"
						: "recovered",
			reason: mode === "service" ? "the rule is no longer loaded" : null,
		},
		metric:
			mode === "none"
				? null
				: {
						source: mode === "service" ? "service" : "alert",
						query:
							"histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])) > 1",
						threshold: mode === "service" ? null : { op: ">", value: 1 },
					},
		scope: { state: "scoped", matched: 1 },
		series: mode === "none" ? [] : [{ labels: {}, points }],
		window: { start: iso(24 * 60 * MIN), end: iso(0) },
		stepSeconds: 900,
		now: mode === "none" ? null : 2.4,
		usual: mode === "none" ? null : 0.5,
		deploys: mode === "chart" && deploy ? [deploy] : [],
		history: {
			firingSince: iso(13 * 60 * MIN),
			resolvedAt: null,
			alertCount: 1,
			refiresThisWeek: 2,
			strip: [
				{
					start: iso(5 * 24 * 60 * MIN),
					end: iso(5 * 24 * 60 * MIN - 9 * 60 * MIN),
				},
				{
					start: iso(2 * 24 * 60 * MIN),
					end: iso(2 * 24 * 60 * MIN - 4 * 60 * MIN),
				},
				{ start: iso(13 * 60 * MIN), end: null },
			],
		},
		linkOut: null,
		connection: mode === "none" ? null : { id: "p", label: "Prometheus" },
		error: null,
		capturedAt: iso(0),
	};
}

/**
 * The fake agent's report predates typed fixes, so the report, its fixes
 * (applied state kept here), the impact query and the git history are
 * written into the responses.
 */
async function rewrite(
	page: Page,
	runId: string,
	o: { problem?: boolean; impact?: ImpactMode },
) {
	const applied = new Map<string, string>();
	const report = richReport({}, []) as { nextSteps: Record<string, unknown>[] };
	await page.route(
		new RegExp(`/api/investigations/${runId}(\\?.*)?$`),
		async (route) => {
			const res = await route.fetch();
			const body = await res.json();
			if (body.report) body.report = richReport(body.report, []);
			await route.fulfill({ response: res, json: body });
		},
	);
	await page.route(new RegExp(`/api/investigations/${runId}/fixes`), (route) =>
		route.fulfill({
			json: {
				investigationId: runId,
				flagged: false,
				options: report.nextSteps.map((n, index) => ({
					id: n.id,
					index,
					kind: n.kind,
					title: n.title,
					detail: n.detail,
					command: n.command ?? null,
					facts: n.facts ?? [],
					priority: n.priority ?? null,
					readOnly: false,
					appliedAt: applied.get(n.id as string) ?? null,
					lastCheck: null,
					canUndo: applied.has(n.id as string),
				})),
			},
		}),
	);
	await page.route(/\/api\/fixes\/[^/]+\/applied/, async (route) => {
		const id = /fixes\/([^/]+)\//.exec(route.request().url())?.[1] ?? "";
		if (route.request().method() === "DELETE") applied.delete(id);
		else applied.set(id, new Date().toISOString());
		await route.fulfill({ json: {} });
	});
	await page.route(/\/api\/fixes\/[^/]+\/check/, (route) =>
		route.fulfill({
			json: {
				stepId: "00000000-0000-4000-8000-000000000001",
				verdict: "not_yet",
				checkedAt: iso(0),
				value: 2.1,
				threshold: { op: ">", value: 1 },
				reason: null,
				message:
					"Not yet: the slowest 1% are at 2.1s, 3 minutes after you applied it. A rollback can take a few minutes to settle.",
				retryable: true,
			},
		}),
	);
	await page.route(/\/api\/incidents\/[^/]+\/changes/, async (route) => {
		const id = /incidents\/([^/]+)\/changes/.exec(route.request().url())?.[1];
		await route.fulfill({ json: changes(id ?? "", !!o.problem) });
	});
	if (o.impact)
		await page.route(/\/api\/incidents\/[^/]+\/impact/, async (route) => {
			const id =
				/incidents\/([^/]+)\/impact/.exec(route.request().url())?.[1] ?? "";
			if (o.impact === "slow") return; // never answers
			await route.fulfill({ json: impact(id, o.impact ?? "none") });
		});
}

test("overview shots", async ({
	page,
	agents,
	alertmanager,
	deliverWebhook,
}) => {
	mkdirSync(OUT, { recursive: true });
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.request.post("/api/settings/danger/reset-data", {
		data: { confirmation: "RESET" },
	});
	await page.request.put("/api/settings/telemetry", {
		data: { noticed: true, dismissed: true },
	});
	agents.install(["claude-agent-acp"], "claude");
	await page.request.post("/api/settings/harness/check", {
		data: { id: "claude-code" },
	});
	await page.request.patch("/api/settings/harness", {
		data: { harness: "claude-code" },
	});

	const ready = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "WalkGrouped",
		service: LIVE,
		severity: "high",
		session: "success",
	});
	const failed = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "CodexProbe",
		service: LIVE,
		severity: "high",
		session: "failure",
	});
	const live = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "BookMetadataTrafficStallOnSearchIndexRebuildAfterNightlyReindexJob",
		service: LIVE,
		severity: "medium",
		session: "live",
	});
	const run = await waitForRun(
		page,
		ready.id,
		(r) => r.status === "completed",
		"ready",
	);
	await waitForRun(page, failed.id, (r) => r.status === "failed", "failed");
	await waitForRun(page, live.id, (r) => r.status === "running", "live");

	await rewrite(page, run.id, { impact: "chart" });
	for (const size of SIZES) {
		await page.setViewportSize(size);
		for (const t of THEMES) {
			await theme(page, t);
			await visit(page, `/incidents/${ready.id}`);
			await expect(page.getByTestId("impact-chart")).toBeVisible();
			await shot(page, `overview-${size.width}-${t}`);
		}
	}
	await theme(page, "dark");
	for (const size of [
		{ width: 1100, height: 760 },
		{ width: 1280, height: 800 },
	]) {
		await page.setViewportSize(size);
		await visit(page, `/incidents/${ready.id}`);
		await expect(page.getByTestId("fix-command")).toBeInViewport({ ratio: 1 });
		await expect(page.getByTestId("fix-copy")).toBeInViewport({ ratio: 1 });
		await expect(page.getByTestId("next-strip")).toBeInViewport({ ratio: 1 });
		await shot(page, `overview-${size.width}x${size.height}-dark`);
	}

	// The fix walk: copy, I applied it (Undo stands), Check now.
	await page.setViewportSize({ width: 1440, height: 900 });
	await visit(page, `/incidents/${ready.id}`);
	await page.getByTestId("next-copy").click();
	await expect(page.getByTestId("next-applied")).toBeVisible();
	await shot(page, "overview-copied-1440-dark");
	await page.getByTestId("next-applied").click();
	await expect(page.getByTestId("fix-undo")).toBeVisible();
	await shot(page, "overview-applied-1440-dark");
	await page.getByTestId("next-check").click();
	await expect(page.getByTestId("fix-state")).toHaveText("Not working yet");
	await shot(page, "overview-not-yet-1440-dark");
	await page.getByTestId("why-lasting-toggle").click();
	await shot(page, "overview-lasting-1440-dark");

	// No metrics source and no git credential (Incident-blind).
	await page.unrouteAll({ behavior: "ignoreErrors" });
	await rewrite(page, run.id, { problem: true });
	await visit(page, `/incidents/${ready.id}`);
	await expect(page.getByTestId("impact-no-source")).toBeVisible();
	await expect(page.getByTestId("changes-problem")).toBeVisible();
	await shot(page, "overview-blind-1440-dark");
	await theme(page, "light");
	await visit(page, `/incidents/${ready.id}`);
	await expect(page.getByTestId("impact-no-source")).toBeVisible();
	await shot(page, "overview-blind-1440-light");
	await theme(page, "dark");

	// The service's own metric when the alert's query is unknown.
	await page.unrouteAll({ behavior: "ignoreErrors" });
	await rewrite(page, run.id, { impact: "service" });
	await visit(page, `/incidents/${ready.id}`);
	await expect(page.getByTestId("impact-chart")).toBeVisible();
	await shot(page, "overview-service-metric-1440-dark");

	// Slow source: the skeleton, then after 10 s the words and Try again (Incident-slow).
	await page.unrouteAll({ behavior: "ignoreErrors" });
	await rewrite(page, run.id, { impact: "slow" });
	await visit(page, `/incidents/${ready.id}`);
	await expect(page.getByTestId("impact-pending")).toBeVisible();
	await shot(page, "overview-slow-pending-1440-dark");
	await expect(page.getByTestId("impact-slow")).toBeVisible({
		timeout: 15_000,
	});
	await shot(page, "overview-slow-1440-dark");
	await page.unrouteAll({ behavior: "ignoreErrors" });

	for (const t of THEMES) {
		await theme(page, t);
		await visit(page, `/incidents/${failed.id}`);
		await expect(page.getByTestId("why-failed")).toBeVisible();
		await shot(page, `overview-failed-1440-${t}`);
		await visit(page, `/incidents/${live.id}`);
		await expect(page.getByTestId("why-live")).toBeVisible();
		await shot(page, `overview-live-1440-${t}`);
	}
	await theme(page, "dark");

	// The old tab URLs land on the overview.
	for (const tab of ["report", "timeline", "alerts"]) {
		await visit(page, `/incidents/${ready.id}/${tab}`);
		await expect(page).toHaveURL(new RegExp(`/incidents/${ready.id}$`));
	}

	await rewrite(page, run.id, { impact: "chart" });
	for (const platform of ["win32", "darwin"] as const) {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.addInitScript((p) => {
			(window as unknown as { prismalensDesktop: object }).prismalensDesktop = {
				platform: p,
				setTheme: () => {},
			};
		}, platform);
		await visit(page, `/incidents/${ready.id}`);
		await shot(page, `overview-desktop-${platform}-1440-dark`);
	}
});
