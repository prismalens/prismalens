// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page } from "@playwright/test";
import { test } from "../steps/fixtures";
import {
	detail,
	ensureService,
	fireIncident,
	LIVE,
	QUIET,
	visit,
	waitForRun,
} from "../steps/product";

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000;

function richReport(
	report: Record<string, unknown> = {},
	rowIds: string[] = [],
	opts: { readOnly?: boolean; zeroOptions?: boolean } = {},
): Record<string, unknown> {
	if (opts.zeroOptions) {
		return {
			...report,
			summary: "Book pages are slow on booklogr-api.",
			rootCause: "Database queries are unindexed.",
			rootCauseCategory: "database",
			culprit: {
				service: "booklogr-api",
				changeRef: "v1.42",
				mechanism: "full table scan",
			},
			hypotheses: [],
			ruledOut: [],
			coverage: { queried: ["db"], notQueried: [] },
			nextSteps: [],
		};
	}

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
				],
			},
		],
		ruledOut: [{ statement: "Database load", why: "CPU at 12%", evidence: [] }],
		coverage: {
			queried: ["git log", "code"],
			notQueried: ["prometheus"],
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
				],
				priority: "high",
				readOnly: !!opts.readOnly,
			},
			{
				id: "00000000-0000-4000-8000-000000000002",
				kind: "stop-impact",
				title: "Cap notes per page at 50",
				detail: "Limits the in-memory sort without a deploy.",
				command: "kubectl set env deployment/booklogr-api NOTES_PAGE_LIMIT=50",
				facts: ["No deploy needed."],
				priority: "medium",
				readOnly: !!opts.readOnly,
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

const changes = (
	incidentId: string,
	options: { problem?: boolean; noRepos?: boolean; extraRows?: boolean } = {},
) => ({
	incidentId,
	startedAt: iso(13 * 60 * MIN),
	window: { start: iso(48 * 60 * MIN), end: iso(0) },
	deploy:
		options.problem || options.noRepos
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
	timeline:
		options.problem || options.noRepos
			? []
			: options.extraRows
				? [
						{
							id: "c-row-1",
							kind: "merge",
							at: iso(10 * MIN),
							title: "Merge PR #88: Service sort fix",
							sha: "aa11bb22cc",
							pr: 88,
							author: "dev",
							source: "git",
						},
						{
							id: "c-row-2",
							kind: "deployment",
							at: iso(20 * MIN),
							title: "Deploy v1.42",
							sha: "3f9a2c1d0e",
							tag: "v1.42",
							author: "dev",
							source: "git",
						},
						{
							id: "c-row-3",
							kind: "merge",
							at: iso(30 * MIN),
							title: "Merge PR #87: Update config",
							sha: "cc33dd44ee",
							pr: 87,
							author: "dev",
							source: "git",
						},
						{
							id: "c-row-4",
							kind: "commit",
							at: iso(40 * MIN),
							title: "Bump version",
							sha: "1122334455",
							author: "dev",
							source: "git",
						},
						{
							id: "c-row-5",
							kind: "merge",
							at: iso(50 * MIN),
							title: "Merge PR #86: Doc update",
							sha: "5566778899",
							pr: 86,
							author: "dev",
							source: "git",
						},
						{
							id: "c-row-6",
							kind: "commit",
							at: iso(60 * MIN),
							title: "Refactor router",
							sha: "6677889900",
							author: "dev",
							source: "git",
						},
						{
							id: "c-row-7",
							kind: "merge",
							at: iso(70 * MIN),
							title: "Merge PR #85: Clean lint",
							sha: "7788990011",
							pr: 85,
							author: "dev",
							source: "git",
						},
						{
							id: "c-row-8",
							kind: "commit",
							at: iso(80 * MIN),
							title: "Initial feature scaffold",
							sha: "8899001122",
							author: "dev",
							source: "git",
						},
					]
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
	total: options.problem || options.noRepos ? 0 : options.extraRows ? 8 : 1,
	state: options.noRepos ? "no-repos" : options.problem ? "failed" : "ok",
	refreshing: false,
	sources: options.problem
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

type ImpactMode =
	| "chart"
	| "chart-no-unit"
	| "service"
	| "none"
	| "slow"
	| "expression_unknown_link";

function impact(incidentId: string, mode: ImpactMode) {
	const end = Math.floor(Date.now() / 1000);
	const points: [number, number][] = Array.from({ length: 97 }, (_, i) => {
		const t = end - (96 - i) * 900;
		const after = i - 44;
		const v = 0.48 + Math.sin(i * 1.7) * 0.04;
		return [t, after <= 0 ? v : Math.min(2.4, v + (after / 52) ** 1.15 * 1.95)];
	});

	if (mode === "none") {
		return {
			incidentId,
			alertId: null,
			state: "not_configured",
			expression: { state: "not_configured", reason: null },
			checkable: false,
			metric: null,
			scope: { state: "scoped", matched: 1 },
			series: [],
			window: { start: iso(24 * 60 * MIN), end: iso(0) },
			stepSeconds: 900,
			now: null,
			usual: null,
			deploys: [],
			history: {
				firingSince: iso(13 * 60 * MIN),
				resolvedAt: null,
				alertCount: 1,
				refiresThisWeek: 0,
				strip: [],
			},
			linkOut: null,
			connection: null,
			error: null,
			capturedAt: iso(0),
		};
	}

	if (mode === "expression_unknown_link") {
		return {
			incidentId,
			alertId: null,
			state: "expression_unknown",
			expression: {
				state: "expression_unknown",
				reason: "the rule is no longer loaded",
			},
			checkable: false,
			metric: null,
			scope: { state: "scoped", matched: 1 },
			series: [],
			window: { start: iso(24 * 60 * MIN), end: iso(0) },
			stepSeconds: 900,
			now: null,
			usual: null,
			deploys: [],
			history: {
				firingSince: iso(13 * 60 * MIN),
				resolvedAt: null,
				alertCount: 1,
				refiresThisWeek: 0,
				strip: [],
			},
			linkOut: "https://prometheus.example.com/graph?query=http_requests",
			connection: { id: "p", label: "Prometheus" },
			error: null,
			capturedAt: iso(0),
		};
	}

	const isService = mode === "service";
	return {
		incidentId,
		alertId: null,
		state: isService ? "expression_unknown" : "ok",
		expression: {
			state: isService ? "expression_unknown" : "recovered",
			reason: isService ? "the rule is no longer loaded" : null,
		},
		checkable: !isService,
		metric: {
			source: isService ? "service" : "alert",
			query:
				"histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])) > 1",
			threshold: isService ? null : { op: ">", value: 1 },
			unit: mode === "chart-no-unit" ? null : "s",
		},
		scope: { state: "scoped", matched: 1 },
		series: [{ labels: {}, points }],
		window: { start: iso(24 * 60 * MIN), end: iso(0) },
		stepSeconds: 900,
		now: 2.4,
		usual: 0.5,
		deploys: [],
		history: {
			firingSince: iso(13 * 60 * MIN),
			resolvedAt: null,
			alertCount: 1,
			refiresThisWeek: 2,
			strip: [{ start: iso(13 * 60 * MIN), end: null }],
		},
		linkOut: null,
		connection: { id: "p", label: "Prometheus" },
		error: null,
		capturedAt: iso(0),
	};
}

interface RewriteOptions {
	problem?: boolean;
	noRepos?: boolean;
	extraRows?: boolean;
	impact?: ImpactMode;
	readOnly?: boolean;
	zeroOptions?: boolean;
	checkVerdict?: "not_yet" | "it_worked";
	postAppliedCallback?: (id: string) => void;
	postCheckCallback?: (id: string) => void;
}

async function rewrite(page: Page, runId: string, o: RewriteOptions = {}) {
	const applied = new Map<string, string>();
	const rep = richReport({}, [], {
		readOnly: o.readOnly,
		zeroOptions: o.zeroOptions,
	}) as { nextSteps: Record<string, unknown>[] };

	await page.route(
		new RegExp(`/api/investigations/${runId}(\\?.*)?$`),
		async (route) => {
			const res = await route.fetch();
			const body = await res.json();
			if (body.report)
				body.report = richReport(body.report, [], {
					readOnly: o.readOnly,
					zeroOptions: o.zeroOptions,
				});
			await route.fulfill({ response: res, json: body });
		},
	);

	await page.route(new RegExp(`/api/investigations/${runId}/fixes`), (route) =>
		route.fulfill({
			json: {
				investigationId: runId,
				flagged: false,
				options: rep.nextSteps.map((n, index) => ({
					id: n.id,
					index,
					kind: n.kind,
					title: n.title,
					detail: n.detail,
					command: n.command ?? null,
					facts: n.facts ?? [],
					priority: n.priority ?? null,
					readOnly: !!n.readOnly,
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
		o.postAppliedCallback?.(id);
		await route.fulfill({ json: {} });
	});

	await page.route(/\/api\/fixes\/[^/]+\/check/, async (route) => {
		const id = /fixes\/([^/]+)\//.exec(route.request().url())?.[1] ?? "";
		o.postCheckCallback?.(id);
		const verdict = o.checkVerdict ?? "not_yet";
		await route.fulfill({
			json: {
				stepId: id || "00000000-0000-4000-8000-000000000001",
				verdict,
				checkedAt: iso(0),
				value: verdict === "it_worked" ? 0.4 : 2.1,
				threshold: { op: ">", value: 1 },
				reason: null,
				message:
					verdict === "it_worked"
						? null
						: "Not yet: the slowest 1% are at 2.1s, 3 minutes after you applied it. A rollback can take a few minutes to settle.",
				retryable: true,
			},
		});
	});

	await page.route(/\/api\/incidents\/[^/]+\/changes/, async (route) => {
		const id = /incidents\/([^/]+)\/changes/.exec(route.request().url())?.[1];
		await route.fulfill({
			json: changes(id ?? "", {
				problem: o.problem,
				noRepos: o.noRepos,
				extraRows: o.extraRows,
			}),
		});
	});

	if (o.impact) {
		await page.route(/\/api\/incidents\/[^/]+\/impact/, async (route) => {
			const id =
				/incidents\/([^/]+)\/impact/.exec(route.request().url())?.[1] ?? "";
			if (o.impact === "slow") return; // never answers
			await route.fulfill({ json: impact(id, o.impact ?? "none") });
		});
	}
}

test.describe("Incident Overview (#811, PR #815)", () => {
	test.beforeEach(async ({ page, agents }) => {
		await page
			.context()
			.grantPermissions(["clipboard-read", "clipboard-write"]);
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
	});

	test("overview page layout, boundaries at viewports, and tab redirects", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		test.setTimeout(90_000);
		const inc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("OverviewLayout"),
			service: LIVE,
			severity: "high",
			session: "success",
		});
		const run = await waitForRun(
			page,
			inc.id,
			(r) => r.status === "completed",
			"ready",
		);

		await rewrite(page, run.id, { impact: "chart" });
		await visit(page, `/incidents/${inc.id}`);

		// Shows incident-overview, no state-band or old record-tab
		await expect(page.getByTestId("incident-overview")).toBeVisible();
		await expect(page.getByTestId("incident-state-band")).toHaveCount(0);
		await expect(page.getByTestId("record-tab")).toHaveCount(0);

		// Window never scrolls at 1100x760, 1280x800, 1440x900
		for (const size of [
			{ width: 1100, height: 760 },
			{ width: 1280, height: 800 },
			{ width: 1440, height: 900 },
		]) {
			await page.setViewportSize(size);
			await page.waitForTimeout(200);
			const scroll = await page.evaluate(() => ({
				h: document.documentElement.scrollHeight - window.innerHeight,
				w: document.documentElement.scrollWidth - window.innerWidth,
			}));
			expect(scroll, `never scrolls at ${size.width}x${size.height}`).toEqual({
				h: 0,
				w: 0,
			});
		}

		// Old tab routes redirect to /incidents/:id
		for (const tab of ["report", "timeline", "alerts"]) {
			await visit(page, `/incidents/${inc.id}/${tab}`);
			await expect(page).toHaveURL(new RegExp(`/incidents/${inc.id}$`));
		}
	});

	test("fix walk: next-copy to applied, undo, check verdicts, read-only, empty, and none states", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		test.setTimeout(120_000);
		let appliedCalled = false;
		let checkCalled = false;
		let checkVerdict: "not_yet" | "it_worked" = "not_yet";

		const inc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("FixWalk"),
			service: LIVE,
			severity: "high",
			session: "success",
		});
		const run = await waitForRun(
			page,
			inc.id,
			(r) => r.status === "completed",
			"ready",
		);

		await rewrite(page, run.id, {
			impact: "chart",
			get checkVerdict() {
				return checkVerdict;
			},
			postAppliedCallback: () => {
				appliedCalled = true;
			},
			postCheckCallback: () => {
				checkCalled = true;
			},
		});

		await page.setViewportSize({ width: 1440, height: 900 });
		await visit(page, `/incidents/${inc.id}`);

		// 1. Initial state: next-copy visible
		const copyBtn = page.getByTestId("next-copy");
		await expect(copyBtn).toBeVisible();
		await copyBtn.click();

		// Clipboard filled and next-applied visible
		await expect(page.getByTestId("next-applied")).toBeVisible();
		expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
			"kubectl rollout undo",
		);

		// 2. Click next-applied -> calls POST /fixes/:id/applied
		await page.getByTestId("next-applied").click();
		await expect.poll(() => appliedCalled).toBe(true);
		await expect(page.getByTestId("fix-undo")).toBeVisible();
		await expect(page.getByTestId("fix-state")).toHaveText("You applied this");

		// 3. Click next-check -> calls POST /fixes/:id/check with verdict not_yet
		const checkBtn = page.getByTestId("next-check");
		await expect(checkBtn).toBeVisible();
		await checkBtn.click();
		await expect.poll(() => checkCalled).toBe(true);
		await expect(page.getByTestId("fix-state")).toHaveText("Not working yet");
		// The strip's own sentence, the one a reload shows, not the server's words.
		await expect(page.getByTestId("next-text")).toContainText(
			/^Not yet: .+ Some fixes take a few minutes to settle\.$/,
		);

		// 4. Check again with it_worked verdict -> shows next-resolve
		checkVerdict = "it_worked";
		await page.getByTestId("next-check").click();
		await expect(page.getByTestId("fix-state")).toHaveText("Worked");
		await expect(page.getByTestId("next-resolve")).toBeVisible();

		// 5. Read-only option: Copy only, never next-applied
		await page.unrouteAll({ behavior: "ignoreErrors" });
		await rewrite(page, run.id, { impact: "chart", readOnly: true });
		await visit(page, `/incidents/${inc.id}`);
		await expect(page.getByTestId("fix-copy")).toBeVisible();
		await page.getByTestId("next-copy").click();
		await expect(page.getByTestId("next-applied")).toHaveCount(0);

		// 6. Zero options: shows fix-empty
		await page.unrouteAll({ behavior: "ignoreErrors" });
		await rewrite(page, run.id, { impact: "chart", zeroOptions: true });
		await visit(page, `/incidents/${inc.id}`);
		await expect(page.getByTestId("fix-empty")).toBeVisible();

		// 7. No report yet: shows fix-none
		const noReportInc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("NoReportFix"),
			service: QUIET,
			quiet: true,
		});
		await visit(page, `/incidents/${noReportInc.id}`);
		await expect(page.getByTestId("fix-none")).toBeVisible();
	});

	test("impact states: chart, service fallback, no-source, slow pending timeout, query link, and units", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		test.setTimeout(120_000);
		const inc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("ImpactStates"),
			service: LIVE,
			severity: "high",
			session: "success",
		});
		const run = await waitForRun(
			page,
			inc.id,
			(r) => r.status === "completed",
			"ready",
		);

		await page.setViewportSize({ width: 1440, height: 900 });

		// 1. Chart ok with unit 's' -> impact-now says 2.4s
		await rewrite(page, run.id, { impact: "chart" });
		await visit(page, `/incidents/${inc.id}`);
		await expect(page.getByTestId("impact-chart")).toBeVisible();
		await expect(page.getByTestId("impact-now")).toHaveText("2.4s");

		// 2. Chart ok with unit null -> impact-now says plain 2.4
		await page.unrouteAll({ behavior: "ignoreErrors" });
		await rewrite(page, run.id, { impact: "chart-no-unit" });
		await visit(page, `/incidents/${inc.id}`);
		await expect(page.getByTestId("impact-now")).toHaveText("2.4");

		// 3. Service fallback -> subtitle says "The service's metric, not this alert's"
		await page.unrouteAll({ behavior: "ignoreErrors" });
		await rewrite(page, run.id, { impact: "service" });
		await visit(page, `/incidents/${inc.id}`);
		await expect(page.getByTestId("impact-chart")).toBeVisible();
		await expect(page.getByTestId("impact-card")).toContainText(
			"The service's metric, not this alert's",
		);

		// 4. No source -> impact-no-source and impact-connect
		await page.unrouteAll({ behavior: "ignoreErrors" });
		await rewrite(page, run.id, { impact: "none" });
		await visit(page, `/incidents/${inc.id}`);
		await expect(page.getByTestId("impact-no-source")).toBeVisible();
		await expect(page.getByTestId("impact-connect")).toBeVisible();
		// Prometheus is added under Sources (#848).
		await expect(page.getByTestId("impact-connect")).toHaveAttribute(
			"href",
			"/settings?tab=sources",
		);

		// 5. Expression-unknown reason + linkOut -> "Open the query"
		await page.unrouteAll({ behavior: "ignoreErrors" });
		await rewrite(page, run.id, { impact: "expression_unknown_link" });
		await visit(page, `/incidents/${inc.id}`);
		await expect(page.getByTestId("impact-no-source")).toBeVisible();
		await expect(page.getByTestId("impact-card")).toContainText(
			"No chart: the rule is no longer loaded.",
		);
		const openQuery = page.getByRole("link", { name: "Open the query" });
		await expect(openQuery).toBeVisible();
		await expect(openQuery).toHaveAttribute(
			"href",
			"https://prometheus.example.com/graph?query=http_requests",
		);

		// 6. Slow source: impact-pending -> after 10 s impact-slow + impact-retry
		await page.unrouteAll({ behavior: "ignoreErrors" });
		await rewrite(page, run.id, { impact: "slow" });
		await visit(page, `/incidents/${inc.id}`);
		await expect(page.getByTestId("impact-pending")).toBeVisible();
		await expect(page.getByTestId("impact-slow")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("impact-retry")).toBeVisible();
	});

	// Quarantined: #894 - the overview's 'what changed' test passes on its first attempt
	test("what changed: git credential problem, no repos, newest first rows, and all toggle", {
		tag: "@quarantine",
	}, async ({ page, alertmanager, deliverWebhook, unique }) => {
		test.setTimeout(90_000);
		const inc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("WhatChanged"),
			service: LIVE,
			severity: "high",
			session: "success",
		});
		const run = await waitForRun(
			page,
			inc.id,
			(r) => r.status === "completed",
			"ready",
		);

		await page.setViewportSize({ width: 1440, height: 900 });

		// 1. changes-problem with "Add a token" when action is add-credential
		await rewrite(page, run.id, { problem: true, impact: "chart" });
		await visit(page, `/incidents/${inc.id}`);
		const prob = page.getByTestId("changes-problem");
		await expect(prob).toBeVisible();
		await expect(prob.getByRole("link", { name: "Add a token" })).toBeVisible();

		// 2. Link a repository when state is no-repos
		await page.unrouteAll({ behavior: "ignoreErrors" });
		await rewrite(page, run.id, { noRepos: true, impact: "chart" });
		await visit(page, `/incidents/${inc.id}`);
		const noRepoProb = page.getByTestId("changes-problem");
		await expect(noRepoProb).toBeVisible();
		await expect(
			noRepoProb.getByRole("link", { name: "Link a repository" }),
		).toBeVisible();

		// 3. Newest first ordering and changes-all toggle
		await page.unrouteAll({ behavior: "ignoreErrors" });
		await rewrite(page, run.id, { extraRows: true, impact: "chart" });
		await visit(page, `/incidents/${inc.id}`);

		const rows = page.getByTestId("changes-row");
		const allTexts = await rows.allTextContents();
		const idx1 = allTexts.findIndex((t) => t.includes("Merge PR #88"));
		const idx2 = allTexts.findIndex((t) => t.includes("Deploy v1.42"));
		expect(idx1).toBeGreaterThanOrEqual(0);
		expect(idx2).toBeGreaterThanOrEqual(0);
		expect(idx1, "newer event appears before older event").toBeLessThan(idx2);

		// More than 6 rows: changes-all toggles between 6 and all 8
		const allBtn = page.getByTestId("changes-all");
		await expect(allBtn).toBeVisible();
		await expect(allBtn).toHaveText(/All \d+ events/);
		await expect(rows).toHaveCount(6);

		await allBtn.click();
		await expect(allBtn).toHaveText("Latest 6");
		expect(await rows.count()).toBeGreaterThanOrEqual(8);

		await allBtn.click();
		await expect(allBtn).toHaveText(/All \d+ events/);
		await expect(rows).toHaveCount(6);
	});

	test("why card: evidence deep link, lasting fix toggle, live and failed runs", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		test.setTimeout(90_000);
		const inc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("WhyCard"),
			service: LIVE,
			severity: "high",
			session: "success",
		});
		const failedInc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("WhyFailed"),
			service: LIVE,
			severity: "high",
			session: "failure",
		});
		const liveInc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("WhyLive"),
			service: LIVE,
			severity: "medium",
			session: "live",
		});

		const run = await waitForRun(
			page,
			inc.id,
			(r) => r.status === "completed",
			"ready",
		);
		await waitForRun(
			page,
			failedInc.id,
			(r) => r.status === "failed",
			"failed",
		);
		await waitForRun(page, liveInc.id, (r) => r.status === "running", "live");

		await rewrite(page, run.id, { impact: "chart" });
		await page.setViewportSize({ width: 1440, height: 900 });

		// 1. Evidence row deep link
		await visit(page, `/incidents/${inc.id}`);
		const evidenceRow = page.getByTestId("why-evidence-row").first();
		await expect(evidenceRow).toBeVisible();
		await evidenceRow.click();
		await expect(page).toHaveURL(
			new RegExp(
				`/incidents/${inc.id}/conversation\\?.*investigation=${run.id}.*call=toolu_01`,
			),
		);

		// 2. why-lasting-toggle expands why-lasting
		await visit(page, `/incidents/${inc.id}`);
		await expect(page.getByTestId("why-lasting")).toHaveCount(0);
		await page.getByTestId("why-lasting-toggle").click();
		await expect(page.getByTestId("why-lasting")).toBeVisible();

		// 3. Live run shows why-live
		await visit(page, `/incidents/${liveInc.id}`);
		await expect(page.getByTestId("why-live")).toBeVisible();

		// 4. Failed run shows why-failed and next-retry
		await visit(page, `/incidents/${failedInc.id}`);
		await expect(page.getByTestId("why-failed")).toBeVisible();
		await expect(page.getByTestId("next-retry")).toBeVisible();
	});

	test("composer actions: Ask fills you-asked, Investigate starts run, Note adds timeline row, and live actions", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
		release,
		hold,
	}) => {
		test.setTimeout(120_000);
		// Released, Run 1 and the Ask finish; held again, Run 2 stays live for step 3.
		const inc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("OverviewComposer"),
			service: LIVE,
			severity: "high",
			session: "live",
		});
		release(inc.title);
		await waitForRun(page, inc.id, (r) => r.status === "completed", "ready");

		await page.setViewportSize({ width: 1440, height: 900 });
		await visit(page, `/incidents/${inc.id}`);

		const composerInput = page.getByTestId("composer-input");
		const actionChip = page.getByTestId("action-chip");
		await expect(actionChip).toBeVisible();

		// 1. Ask action stays on the page and fills you-asked (Ask is default initial action)
		await composerInput.fill("What is the current sort mechanism?");
		await composerInput.press("Enter");

		await expect(page).toHaveURL(new RegExp(`/incidents/${inc.id}$`));
		const youAsked = page.getByTestId("you-asked");
		await expect(youAsked).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("you-asked-question")).toHaveText(
			"What is the current sort mechanism?",
		);
		await waitForRun(page, inc.id, (r) => r.status === "completed", "the Ask");
		hold(inc.title);

		// 2. Investigate again starts a live run, page stays
		await actionChip.click();
		await page.getByTestId("action-investigate").click();
		await composerInput.fill("Recheck latency with 100 notes");
		await composerInput.press("Enter");

		await expect(page).toHaveURL(new RegExp(`/incidents/${inc.id}$`));
		const stripStop = page.getByTestId("latest-run-stop");
		await expect(stripStop).toBeVisible({ timeout: 15_000 });

		// 3. Live run offers only Message and Note actions
		await actionChip.click();
		await expect(page.getByTestId("action-message")).toBeVisible();
		await expect(page.getByTestId("action-note")).toBeVisible();
		await expect(page.getByTestId("action-ask")).toHaveCount(0);
		await expect(page.getByTestId("action-investigate")).toHaveCount(0);

		// 4. Note action adds a timeline row
		await page.getByTestId("action-note").click();
		await composerInput.fill("Operator manually verified DB connections");
		await composerInput.press("Enter");

		const noteRow = page
			.getByTestId("changes-row")
			.filter({ hasText: "Note: Operator manually verified DB connections" });
		await expect(noteRow).toBeVisible({ timeout: 15_000 });
	});

	test("card-more cue placement at 1100x760 and situation dependencies", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		test.setTimeout(90_000);
		const inc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("CardLayout"),
			service: LIVE,
			severity: "high",
			session: "success",
		});
		const run = await waitForRun(
			page,
			inc.id,
			(r) => r.status === "completed",
			"ready",
		);

		// Add dependencies to booklogr-api
		const api = await ensureService(page, LIVE);
		for (const dep of [
			{ name: "booklogr-db", type: "database" },
			{ name: "redis", type: "cache" },
		]) {
			const id = await ensureService(page, dep);
			await page.request.post(`/api/services/${api}/dependencies`, {
				data: { dependencyId: id },
			});
		}

		await rewrite(page, run.id, { impact: "chart", extraRows: true });
		await page.setViewportSize({ width: 1100, height: 760 });
		await visit(page, `/incidents/${inc.id}`);

		// Dependencies listed
		const depends = page.getByTestId("situation-depends");
		await expect(depends).toBeVisible();
		await expect(depends).toContainText("booklogr-db");
		await expect(depends).toContainText("redis");

		// card-more sits at or below its card body at 1100x760
		const mores = await page.getByTestId("card-more").all();
		for (const more of mores) {
			const cue = await more.boundingBox();
			const body = await more
				.locator("xpath=ancestor::section[1]")
				.getByTestId("card-body")
				.boundingBox();
			expect(cue && body && cue.y >= body.y + body.height - 0.5).toBe(true);
		}

		// Hidden when service has no dependencies
		const quietInc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("QuietNoDeps"),
			service: QUIET,
			quiet: true,
		});
		await visit(page, `/incidents/${quietInc.id}`);
		await expect(page.getByTestId("situation-depends")).toHaveCount(0);
	});

	test("resolve with a live run cancels the run before close, ending in stopped and resolved", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		test.setTimeout(90_000);
		const inc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("ResolveLive"),
			service: LIVE,
			severity: "high",
			session: "live",
		});
		await waitForRun(page, inc.id, (r) => r.status === "running", "live");

		await page.setViewportSize({ width: 1440, height: 900 });
		await visit(page, `/incidents/${inc.id}`);

		// Resolve from header
		const resolveBtn = page.getByTestId("header-resolve");
		await expect(resolveBtn).toBeVisible();
		await resolveBtn.click();

		// If alert is firing, confirm dialog prompts
		const confirmAnyway = page.getByTestId("resolve-anyway");
		if (await confirmAnyway.isVisible({ timeout: 2000 }).catch(() => false)) {
			await confirmAnyway.click();
		}

		const resolveDialog = page.getByTestId("resolve-dialog");
		await expect(resolveDialog).toBeVisible();
		await page.getByTestId("confirm-resolve").click();

		// Run ends stopped and incident shows reopened
		await expect(page.getByTestId("header-reopen")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("header-resolve")).toHaveCount(0);
		await expect(page.getByTestId("latest-run-link")).toContainText("stopped");

		const d = await detail(page, inc.id);
		expect(d.status).toBe("closed");
	});

	test("header actions: status update timeline entry and severity change log", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		test.setTimeout(90_000);
		const inc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("HeaderActions"),
			service: LIVE,
			severity: "high",
			session: "success",
		});
		await waitForRun(page, inc.id, (r) => r.status === "completed", "ready");

		await page.setViewportSize({ width: 1440, height: 900 });
		await visit(page, `/incidents/${inc.id}`);

		// 1. Status update dialog and copy logs entry
		await page.getByTestId("header-more").click();
		await page.getByTestId("header-status-update").click();
		await expect(page.getByTestId("status-update-dialog")).toBeVisible();
		await page.getByTestId("status-update-copy").click();
		await expect(page.getByTestId("status-update-dialog")).toHaveCount(0);

		const statusRow = page
			.getByTestId("changes-row")
			.filter({ hasText: "Status update" });
		await expect(statusRow).toBeVisible({ timeout: 15_000 });

		// 2. Change severity to Low logs "Severity changed to Low"
		await page.getByTestId("header-more").click();
		await page.getByTestId("header-severity-menu").hover();
		await page.getByTestId("header-severity-low").click();

		await expect(page.getByTestId("header-severity")).toHaveText("Low");
		const sevRow = page
			.getByTestId("changes-row")
			.filter({ hasText: "Severity changed to Low" });
		await expect(sevRow).toBeVisible({ timeout: 15_000 });
	});

	test("service page: metric edit updates config.metric", async ({
		page,
		unique,
	}) => {
		test.setTimeout(60_000);
		const svcName = unique("metric-svc");
		const svcId = await ensureService(page, {
			name: svcName,
			displayName: "Metric Test Service",
		});

		let savedConfig: Record<string, unknown> | null = null;
		const connId = "c0000000-0000-4000-8000-000000000001";

		await page.route(
			new RegExp(`/api/integrations/service/${svcId}(\\?.*)?$`),
			(route) =>
				route.fulfill({
					json: [
						{
							connectionId: connId,
							connectionName: "Prometheus Main",
							templateId: "prometheus",
							templateName: "Prometheus",
							category: "observability",
							status: "ACTIVE",
							isGlobal: true,
							hasOverride: !!savedConfig,
							overrideId: savedConfig
								? "o0000000-0000-4000-8000-000000000001"
								: undefined,
							globalConfig: null,
							serviceConfig: savedConfig,
							effectiveConfig: savedConfig,
						},
					],
				}),
		);

		await page.route(
			/\/api\/integrations\/service-integrations/,
			async (route) => {
				const body = route.request().postDataJSON() as {
					config?: Record<string, unknown>;
				};
				savedConfig = body.config ?? null;
				await route.fulfill({
					json: {
						id: "o0000000-0000-4000-8000-000000000001",
						serviceId: svcId,
						connectionId: connId,
						config: savedConfig,
					},
				});
			},
		);

		await visit(page, `/services/${svcId}`);

		// Map the connection, then edit its impact metric in place (#848)
		await page.getByTestId("mapping-add").click();
		const editBtn = page.getByRole("button", {
			name: "Edit the mapping of Prometheus Main",
		});
		await expect(editBtn).toBeVisible();
		await editBtn.click();

		const metricInput = page.getByTestId("service-metric-input");
		await expect(metricInput).toBeVisible();
		await metricInput.fill("http_requests_total");
		await page.getByRole("button", { name: "Save" }).click();

		await expect
			.poll(() => savedConfig)
			.toEqual({ metric: "http_requests_total" });
	});
});
