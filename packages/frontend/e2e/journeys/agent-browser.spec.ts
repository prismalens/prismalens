// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { hideQueryDevtools, installStreamDouble } from "./live-stream-fixtures";

/**
 * The browser pane while an agent drives it (#1061), on a served thread: the live frame,
 * who has control, Take control, and the card a held form submit opens. With DESIGN_SHOTS
 * set it also writes the states to DESIGN_SHOTS_DIR (default design-shots/matrix).
 */
const ID = "b10c0000-0000-4000-8000-000000000001";
const OUT = resolve(process.env.DESIGN_SHOTS_DIR ?? "design-shots/matrix");
const URL_ = "https://grafana.example.com/d/checkout?from=now-1h";

const PAGE = `<!doctype html><html><body style="margin:0;font-family:sans-serif;background:#f7f7f8">
<div style="height:64px;background:#1f2430;color:#fff;font-size:22px;padding:20px 32px;box-sizing:border-box">Checkout latency</div>
<div style="margin:24px 32px;height:300px;background:#fff;border:1px solid #e3e3e8;border-radius:8px;position:relative">
<svg width="1200" height="300"><polyline fill="none" stroke="#3b82f6" stroke-width="4" points="20,260 160,240 300,250 440,180 580,100 720,40 860,50 1000,30 1180,20"/></svg></div>
<form style="margin:0 32px"><label style="font-size:18px">Note <input value="Rolled back checkout to v412" style="width:420px;font-size:16px;padding:6px"></label>
<div style="margin-top:12px"><button style="background:#3b82f6;color:#fff;border:0;border-radius:6px;font-size:16px;padding:10px 24px">Save note</button></div></form>
</body></html>`;

const tab = (owner: "agent" | "human", acting: string | null) => ({
	id: "t1",
	threadId: ID,
	url: URL_,
	title: "Checkout latency",
	loading: false,
	owner,
	generation: owner === "agent" ? 0 : 1,
	acting,
});

const CARD = {
	askId: "a5c00000-0000-4000-8000-000000000001",
	threadId: ID,
	kind: "permission",
	requiresHost: true,
	source: { kind: "tool", tool: "pl_browser_act", requestId: "r1" },
	title: "Submit a form on grafana.example.com?",
	detail: "Sends POST https://grafana.example.com/api/annotations",
	openedAt: new Date().toISOString(),
	permission: {
		toolKind: "act",
		input:
			'POST https://grafana.example.com/api/annotations\n\n{\n "text": "Rolled back checkout to v412",\n "csrf": "[hidden]"\n}',
		options: [
			{ optionId: "allow", name: "Allow once", kind: "allow_once" },
			{ optionId: "deny", name: "Deny", kind: "reject_once" },
		],
	},
};

/** A real frame: the page above rendered by the test's own browser, as the screencast sends it. */
async function frameOf(page: Page): Promise<string> {
	const other = await page.context().newPage();
	await other.setViewportSize({ width: 1280, height: 800 });
	await other.setContent(PAGE);
	const jpeg = await other.screenshot({ type: "jpeg", quality: 70 });
	await other.close();
	return jpeg.toString("base64");
}

async function serve(page: Page, frame: string) {
	const now = new Date().toISOString();
	const row = {
		id: ID,
		incidentId: null,
		serviceId: null,
		scheduleId: null,
		repositoryId: null,
		subject: "none",
		status: "running",
		kind: "chat",
		title: "Why did checkout slow down?",
		accessLevel: "supervised",
		harness: null,
		model: null,
		effort: null,
		hasReport: false,
		startedAt: now,
		completedAt: null,
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
		createdAt: now,
		updatedAt: now,
	};
	const base = { runId: ID, branchId: "main", path: [], ts: now };
	const events = [
		{
			...base,
			seq: 1,
			kind: "operator_message",
			text: "Why did checkout slow down? Check the Grafana dashboard.",
			mode: "queue",
			delivered: true,
		},
		{
			...base,
			seq: 2,
			kind: "agent_step",
			text: "I'll open the checkout dashboard and note the rollback.",
			toolCalls: [],
		},
		{ ...base, seq: 3, kind: "ask_opened", ask: CARD },
	];
	const json = (body: unknown) => ({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify(body),
	});
	await page.route(
		(u) => u.pathname === `/api/investigations/${ID}`,
		(r) => r.fulfill(json(row)),
	);
	await page.route(
		(u) => u.pathname === `/api/investigations/${ID}/status`,
		(r) => r.fulfill(json({ investigation: row, job: null })),
	);
	await page.route(
		(u) => u.pathname === `/api/investigations/${ID}/events`,
		(r) => r.fulfill(json({ events, nextCursor: null })),
	);
	let owner: "agent" | "human" = "agent";
	const controls: unknown[] = [];
	await page.route(
		(u) => u.pathname === `/api/threads/${ID}/browser`,
		(r) =>
			r.fulfill(
				json({
					engine: "running",
					engineName: "Microsoft Edge",
					canDrive: true,
					tabs: [tab(owner, owner === "agent" ? 'Clicked "Save note"' : null)],
				}),
			),
	);
	await page.route(
		(u) => u.pathname === `/api/threads/${ID}/browser/t1/stream`,
		(r) =>
			r.fulfill({
				status: 200,
				contentType: "text/event-stream",
				body: [
					{
						kind: "tab",
						tab: tab(owner, owner === "agent" ? 'Clicked "Save note"' : null),
					},
					{ kind: "frame", data: frame, width: 1280, height: 800 },
					{ kind: "flash", box: { x: 32, y: 446, width: 130, height: 40 } },
				]
					.map((e) => `event: message\ndata: ${JSON.stringify(e)}\n\n`)
					.join(""),
			}),
	);
	await page.route(
		(u) => u.pathname === `/api/threads/${ID}/browser/t1/control`,
		(r) => {
			const body = r.request().postDataJSON() as { to: "agent" | "human" };
			controls.push(body);
			owner = body.to;
			return r.fulfill(json(tab(owner, null)));
		},
	);
	return controls;
}

const shots = !!process.env.DESIGN_SHOTS;
async function shot(page: Page, name: string) {
	if (!shots) return;
	mkdirSync(OUT, { recursive: true });
	await page.waitForTimeout(300);
	await page.screenshot({
		path: join(OUT, `${name}.png`),
		animations: "disabled",
	});
}

test.describe("#1061 — the browser pane while an agent drives it", () => {
	test.beforeEach(async ({ page }) => {
		await hideQueryDevtools(page);
		await installStreamDouble(page);
	});

	test("the pane shows the live page and the agent's strip, the held submit's card names the request, and Take control hands the tab to the user", async ({
		page,
	}) => {
		const controls = await serve(page, await frameOf(page));
		await page.setViewportSize({ width: 1600, height: 900 });
		await page.goto(`/threads/${ID}?panel=new`);
		await page.getByTestId("new-tab-open-browser").click();
		const strip = page.getByTestId("browser-control-strip");
		await expect(strip).toHaveAttribute("data-owner", "agent");
		await expect(strip).toContainText("Agent is using this tab");
		await expect(page.getByTestId("browser-acting")).toHaveText(
			'Clicked "Save note"',
		);
		await expect(
			page.getByTestId("browser-frame").locator("img"),
		).toBeVisible();
		await expect(page.getByTestId("browser-address")).toHaveValue(URL_);
		await expect(page.getByTestId("ask-dock-title")).toHaveText(
			"Submit a form on grafana.example.com?",
		);
		await page.getByTestId("ask-dock-request").locator("summary").click();
		await expect(
			page.getByTestId("ask-dock-request").locator("pre"),
		).toContainText('"csrf": "[hidden]"');
		await shot(page, "browser-agent-driving-1600");
		await page.getByTestId("browser-take-control").click();
		await expect(strip).toHaveAttribute("data-owner", "human");
		await expect(strip).toContainText("You have control");
		expect(controls).toEqual([{ to: "human" }]);
		await shot(page, "browser-user-control-1600");
	});

	test("Settings → Agent has the browser switch, on by default, as only the host can change it", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto("/settings?tab=agent");
		const row = page.getByTestId("agent-browser-row");
		await expect(row).toContainText("Agents can use the browser");
		await expect(row).toContainText("Asks before each new site");
		await expect(page.getByTestId("agent-browser")).toHaveAttribute(
			"data-state",
			"checked",
		);
		await row.scrollIntoViewIfNeeded();
		await shot(page, "browser-switch-settings-1280");
	});
});
