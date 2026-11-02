// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page } from "@playwright/test";
import { test } from "../steps/fixtures";
import { fireIncident, LIVE, visit, waitForRun } from "../steps/product";

// The walk's browser drew real scrollbars, which narrow a scrolling pane; headless hides them by default.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

const WIDTHS = [320, 360, 390] as const;

/** One row of the walk's measurement: the document, the scrolling pane, and each named box. */
async function measure(page: Page, pane: string, ids: readonly string[]) {
	return page.evaluate(
		({ pane, ids }) => {
			const de = document.documentElement;
			const p = document.querySelector<HTMLElement>(pane);
			const boxes: Record<string, string> = {};
			const over: string[] = [];
			for (const id of ids) {
				const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
				const r = el?.getBoundingClientRect();
				if (!el || !r || r.width === 0 || !el.checkVisibility()) {
					boxes[id] = "hidden";
					continue;
				}
				boxes[id] = `${Math.round(r.left)}-${Math.round(r.right)}`;
				if (r.right > innerWidth + 0.5) over.push(id);
			}
			return {
				doc: `${de.scrollWidth}/${de.clientWidth}`,
				docOver: de.scrollWidth > de.clientWidth,
				pane: p ? `${p.scrollWidth}/${p.clientWidth}` : "none",
				paneOver: !!p && p.scrollWidth > p.clientWidth,
				boxes,
				over,
			};
		},
		{ pane, ids },
	);
}

/** Measures at 320, 360 and 390 px, logs the table, and asserts once per width. */
async function walk(
	page: Page,
	label: string,
	pane: string,
	ids: readonly string[],
	ready: () => Promise<void>,
) {
	const rows: string[] = [
		`${label}: width | doc sw/cw | ${pane} sw/cw | ${ids.join(" | ")}`,
	];
	for (const width of WIDTHS) {
		await page.setViewportSize({ width, height: 844 });
		await ready();
		await page.waitForTimeout(300);
		const m = await measure(page, pane, ids);
		rows.push(
			`${width} | ${m.doc} | ${m.pane} | ${ids.map((id) => m.boxes[id]).join(" | ")}`,
		);
		expect.soft(m.docOver, `${label} document at ${width}`).toBe(false);
		expect.soft(m.paneOver, `${label} ${pane} at ${width}`).toBe(false);
		expect.soft(m.over, `${label} boxes past ${width}`).toEqual([]);
	}
	console.log(rows.join("\n"));
	await test.info().attach(`${label} measurements`, { body: rows.join("\n") });
}

test.describe("the walk's phone measurements (0.5.3 walk W11, F2)", () => {
	test.beforeEach(async ({ page, agents }) => {
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

	test("INC-1's overview, Run 1 with no cause named: nothing past the screen", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		test.setTimeout(90_000);
		const inc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("WalkWorkerQueueBacklog"),
			service: LIVE,
			severity: "high",
			session: "nocause",
		});
		await waitForRun(page, inc.id, (r) => r.status === "completed", "ready");
		await visit(page, `/incidents/${inc.id}`);
		await expect(page.getByTestId("why-transcript")).toHaveText(
			"Run 1 transcript",
		);
		await walk(
			page,
			"overview",
			'main[data-testid="overview-grid"]',
			["why-transcript", "runs-menu"],
			async () => {
				await expect(page.getByTestId("why-card")).toBeVisible();
				await expect(page.getByTestId("runs-menu")).toBeAttached();
			},
		);
	});

	test("a fresh run cloned from a folder: its strip keeps Code and Runs on screen", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		test.setTimeout(90_000);
		const inc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("WalkApiHookFailing"),
			service: LIVE,
			severity: "critical",
			session: "success",
		});
		const run = await waitForRun(
			page,
			inc.id,
			(r) => r.status === "completed",
			"ready",
		);
		const folder = { source: "none", label: "folder", via: "a local folder" };
		await page.route(
			new RegExp(`/api/investigations/${run.id}(\\?.*)?$`),
			async (route) => {
				const res = await route.fetch();
				const body = await res.json();
				const ws = body.workspace ?? {
					layout: "single",
					cwd: "/work",
					repos: [],
				};
				const repos = ws.repos.length
					? ws.repos
					: [
							{
								name: "walk",
								dir: "/work/walk",
								sourceKind: "folder",
								url: "/src/walk",
								subPath: null,
								connectionId: null,
								head: "a".repeat(40),
								branch: "main",
								services: [],
							},
						];
				body.workspace = {
					...ws,
					repos: repos.map((r: object) => ({ ...r, credential: folder })),
				};
				await route.fulfill({ response: res, json: body });
			},
		);
		await page.setViewportSize({ width: 1280, height: 800 });
		await visit(page, `/incidents/${inc.id}/conversation`);
		await expect(page.getByTestId("run-strip-code")).toHaveText("Code: folder");
		await walk(
			page,
			"fresh run",
			'[data-testid="transcript-scroller"]',
			["run-strip-code", "runs-menu"],
			async () => {
				await expect(page.getByTestId("run-strip")).toBeVisible();
			},
		);
	});
});
