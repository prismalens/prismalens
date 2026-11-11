// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import { type CanonicalEvent, HARNESS_DATA_NOTE } from "@prismalens/contracts";
import { hideQueryDevtools } from "./live-stream-fixtures";

/**
 * #1020: helper threads on empty pages and transcript properties (more journeys).
 * Verifies:
 * 1. A helper thread can be started from each of empty Alerts, Services, and Automation's schedules.
 * 2. First reply to "hi" is a plain answer: steps list shows no tool step before the answer.
 * 3. The webhook token never appears in the page DOM of the helper thread while Copy token exists on Alerts.
 * 4. The "PrismaLens data" note shows at most once per run in the transcript.
 */
const THREAD_ID = "f5555555-5555-4555-8555-555555555555";

async function emptyAlerts(page: Page): Promise<void> {
	await page.route(
		(url) => url.pathname.startsWith("/api/alerts"),
		async (route) => {
			if (route.request().method() !== "GET") return route.fallback();
			const { pathname } = new URL(route.request().url());
			if (pathname === "/api/alerts/stats")
				return route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({ total: 0, byStatus: {}, bySeverity: {} }),
				});
			if (pathname === "/api/alerts")
				return route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						data: [],
						pagination: { total: 0, limit: 100, offset: 0, hasMore: false },
					}),
				});
			return route.fallback();
		},
	);
}

async function emptyServices(page: Page): Promise<void> {
	await page.route("**/api/services/teams*", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ teams: [] }),
		}),
	);
	await page.route("**/api/services?*", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ data: [], total: 0 }),
		}),
	);
}

async function emptySchedules(page: Page): Promise<void> {
	await page.route(/\/api\/schedules(\?.*)?$/, async (route) => {
		if (route.request().method() !== "GET") return route.fallback();
		return route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				schedules: [],
				builtIns: [],
				canEdit: true,
				hostName: "localhost",
			}),
		});
	});
}

async function captureStart(
	page: Page,
	threadId = THREAD_ID,
): Promise<{ body: () => string | null }> {
	let sent: string | null = null;
	await page.route(
		(url) => url.pathname === "/api/threads",
		async (route) => {
			if (route.request().method() !== "POST") return route.fallback();
			sent = route.request().postData();
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					investigationId: threadId,
					jobId: "job-1",
					queued: true,
				}),
			});
		},
	);
	return { body: () => sent };
}

async function serveThread(
	page: Page,
	threadId: string,
	events: CanonicalEvent[],
	overrides: Record<string, unknown> = {},
): Promise<void> {
	const row = {
		id: threadId,
		incidentId: null,
		serviceId: null,
		scheduleId: null,
		repositoryId: null,
		subject: "none",
		status: "completed",
		kind: "chat",
		title: "Helper thread",
		accessLevel: null,
		harness: null,
		model: null,
		effort: null,
		hasReport: false,
		startedAt: new Date().toISOString(),
		completedAt: new Date().toISOString(),
		summary: null,
		rootCause: null,
		rootCauseCategory: null,
		report: null,
		error: null,
		liveTurn: null,
		workspace: null,
		resumable: true,
		resumeBlockedReason: null,
		continuable: false,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
	await page.route(
		(url) => url.pathname === `/api/investigations/${threadId}`,
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(row),
			}),
	);
	await page.route(
		(url) => url.pathname === `/api/investigations/${threadId}/status`,
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ investigation: row, job: null }),
			}),
	);
	await page.route(
		(url) => url.pathname === `/api/investigations/${threadId}/events`,
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ events, nextCursor: null }),
			}),
	);
}

test.describe("helper threads more journeys (#1020)", () => {
	test.beforeEach(async ({ page }) => {
		await hideQueryDevtools(page);
	});

	test("1a. a helper thread can be started from the empty Services page", async ({
		page,
	}) => {
		await emptyServices(page);
		const start = await captureStart(page);
		await page.goto("/services");
		const helper = page.getByTestId("helper-thread");
		await expect(helper).toHaveAttribute("data-place", "services", {
			timeout: 20_000,
		});
		const input = helper.getByTestId("composer-input");
		await expect(input).toHaveAttribute(
			"placeholder",
			"Ask how to add a service",
		);
		await input.fill("How do I add a service?");
		await input.press("Enter");
		await expect(page).toHaveURL(new RegExp(`/threads/${THREAD_ID}`));
		const body = start.body() ?? "";
		expect(JSON.parse(body)).toMatchObject({
			subject: { kind: "none" },
			text: "How do I add a service?",
			place: "services",
		});
	});

	test("1b. a helper thread can be started from Automation with no schedules", async ({
		page,
	}) => {
		await emptySchedules(page);
		const start = await captureStart(page);
		await page.goto("/automation");
		await expect(page.getByTestId("schedules-empty")).toBeVisible({
			timeout: 20_000,
		});
		const helper = page.getByTestId("helper-thread");
		await expect(helper).toHaveAttribute("data-place", "schedules", {
			timeout: 20_000,
		});
		const input = helper.getByTestId("composer-input");
		await expect(input).toHaveAttribute(
			"placeholder",
			"Ask how schedules work",
		);
		await input.fill("How do schedules work?");
		await input.press("Enter");
		await expect(page).toHaveURL(new RegExp(`/threads/${THREAD_ID}`));
		const body = start.body() ?? "";
		expect(JSON.parse(body)).toMatchObject({
			subject: { kind: "none" },
			text: "How do schedules work?",
			place: "schedules",
		});
	});

	test("1c. a helper thread can be started from the empty Alerts page with a prompt", async ({
		page,
	}) => {
		await emptyAlerts(page);
		const start = await captureStart(page);
		await page.goto("/alerts");
		const helper = page.getByTestId("helper-thread");
		await expect(helper).toHaveAttribute("data-place", "alerts", {
			timeout: 20_000,
		});
		const input = helper.getByTestId("composer-input");
		await expect(input).toHaveAttribute(
			"placeholder",
			"Ask how to send alerts",
		);
		await input.fill("Where do incoming alerts appear?");
		await input.press("Enter");
		await expect(page).toHaveURL(new RegExp(`/threads/${THREAD_ID}`));
		const body = start.body() ?? "";
		expect(JSON.parse(body)).toMatchObject({
			subject: { kind: "none" },
			text: "Where do incoming alerts appear?",
			place: "alerts",
		});
	});

	test("2. the helper's first reply to 'hi' is a plain answer with no tool step before it", async ({
		page,
	}) => {
		const replyText =
			"Hello! PrismaLens is ready to assist you. What would you like help with?";
		const events: CanonicalEvent[] = [
			{
				kind: "operator_message",
				runId: THREAD_ID,
				branchId: "main",
				path: [],
				seq: 0,
				ts: new Date().toISOString(),
				text: "hi",
				mode: "queue",
				delivered: true,
			},
			{
				kind: "agent_step",
				runId: THREAD_ID,
				branchId: "main",
				path: [],
				seq: 1,
				ts: new Date().toISOString(),
				label: "answer",
				text: replyText,
				toolCalls: [],
			},
		];
		await emptyAlerts(page);
		await captureStart(page);
		await serveThread(page, THREAD_ID, events, { title: "hi" });

		await page.goto("/alerts");
		const helper = page.getByTestId("helper-thread");
		const input = helper.getByTestId("composer-input");
		await input.fill("hi");
		await input.press("Enter");

		await expect(page).toHaveURL(new RegExp(`/threads/${THREAD_ID}`));
		const prose = page.getByTestId("transcript-prose");
		await expect(prose).toBeVisible();
		await expect(prose).toContainText(replyText);
		await expect(page.getByTestId("transcript-tools")).toHaveCount(0);
		await expect(page.getByTestId("step")).toHaveCount(0);
	});

	test("3. the webhook token never appears in the page DOM of the helper thread while Copy token exists on Alerts", async ({
		page,
	}) => {
		const tokenRes = await page.request.get("/api/webhooks/token");
		const token = tokenRes.ok()
			? ((await tokenRes.json()) as { token: string }).token
			: null;
		expect(token).toBeTruthy();
		if (!token) return;

		await emptyAlerts(page);
		await captureStart(page);
		const events: CanonicalEvent[] = [
			{
				kind: "operator_message",
				runId: THREAD_ID,
				branchId: "main",
				path: [],
				seq: 0,
				ts: new Date().toISOString(),
				text: "How do I configure alert webhooks?",
				mode: "queue",
				delivered: true,
			},
			{
				kind: "agent_step",
				runId: THREAD_ID,
				branchId: "main",
				path: [],
				seq: 1,
				ts: new Date().toISOString(),
				label: "answer",
				text: "Copy the URL and token from the Alerts page under Copy URL / Copy token. In your config use <webhook-url> and <webhook-token>.",
				toolCalls: [],
			},
		];
		await serveThread(page, THREAD_ID, events);

		await page.goto("/alerts");
		// Copy token exists on the Alerts page for the host
		const copyToken = page.getByTestId("alerts-copy-token");
		await expect(copyToken).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId("alerts-copy-url")).toBeVisible();

		// Check helper composer on the Alerts page
		const helper = page.getByTestId("helper-thread");
		await expect(helper).toBeVisible();
		const helperHtml = await helper.evaluate((el) => el.outerHTML);
		expect(helperHtml).not.toContain(token);

		// Navigate into the helper thread
		const input = helper.getByTestId("composer-input");
		await input.fill("How do I configure alert webhooks?");
		await input.press("Enter");
		await expect(page).toHaveURL(new RegExp(`/threads/${THREAD_ID}`));

		// The webhook token never appears anywhere in the helper thread's page DOM (text, attributes, hidden nodes)
		const threadPageHtml = await page.evaluate(
			() => document.documentElement.outerHTML,
		);
		expect(threadPageHtml).not.toContain(token);
		expect(await page.content()).not.toContain(token);
	});

	test("4. the 'PrismaLens data' note shows at most once per run in the transcript", async ({
		page,
	}) => {
		const ts = new Date().toISOString();
		const eventsWithMultipleTools: CanonicalEvent[] = [
			{
				kind: "operator_message",
				runId: THREAD_ID,
				branchId: "main",
				path: [],
				seq: 0,
				ts,
				text: "Help me configure alerts and publish a runbook",
				mode: "queue",
				delivered: true,
			},
			{
				kind: "agent_step",
				runId: THREAD_ID,
				branchId: "main",
				path: [],
				seq: 1,
				ts,
				label: "call",
				text: "I will set thread title and publish the guide.",
				toolCalls: [
					{
						toolCallId: "call-step-1",
						name: "mcp__prismalens-1__thread_title",
						args: { title: "Alert setup helper" },
					},
					{
						toolCallId: "call-step-2",
						name: "mcp__prismalens-1__artifact_publish",
						args: { path: "guide.md" },
					},
				],
			},
			{
				kind: "harness_tool_call",
				runId: THREAD_ID,
				branchId: "main",
				path: [],
				seq: 2,
				ts,
				label: null,
				server: "prismalens-1",
				name: "pl_thread_title",
				at: ts,
				turn: "first",
				output: `${HARNESS_DATA_NOTE}\n{"title":"Alert setup helper"}`,
			},
			{
				kind: "harness_tool_call",
				runId: THREAD_ID,
				branchId: "main",
				path: [],
				seq: 3,
				ts,
				label: null,
				server: "prismalens-1",
				name: "pl_artifact_publish",
				at: ts,
				turn: "first",
				output: `${HARNESS_DATA_NOTE}\nPublished guide.md`,
			},
			{
				kind: "agent_step",
				runId: THREAD_ID,
				branchId: "main",
				path: [],
				seq: 4,
				ts,
				label: "answer",
				text: "Done. Both tools completed.",
				toolCalls: [],
			},
		];

		await serveThread(page, THREAD_ID, eventsWithMultipleTools);
		await page.goto(`/threads/${THREAD_ID}`);

		// A finished turn's steps fold behind Worked for ...; open the fold to inspect steps
		const turnFold = page.getByTestId("turn-fold");
		await expect(turnFold).toBeVisible({ timeout: 20_000 });
		await turnFold.click();

		const toolsExpand = page.getByTestId("tools-expand");
		if (await toolsExpand.isVisible().catch(() => false)) {
			await toolsExpand.click();
		}

		// Steps render for the tools
		await expect(page.getByTestId("step")).toHaveCount(2, {
			timeout: 20_000,
		});

		// The "PrismaLens data" note shows at most once per run in the transcript
		const notes = page.getByTestId("step-data-note");
		await expect(notes).toHaveCount(1);
		await expect(notes.first()).toContainText("PrismaLens data.");
	});
});
