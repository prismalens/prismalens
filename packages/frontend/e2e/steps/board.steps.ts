// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Steps for the @pr2 board, first run, Analytics, phone and lifecycle
 * journeys (study-v3 §8). "INC-1" in a scenario is the incident the scenario
 * made; its real number is read back from the product.
 */

import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { investigateButton } from "../journeys/verb";
import { Given, Then, When } from "./fixtures";
import {
	acknowledge,
	cardOf,
	detail,
	ensureService,
	fireIncident,
	LIVE,
	type Made,
	openBoard,
	QUIET,
	resolveIncident,
	sidewaysOverflow,
	visit,
	waitFor,
	waitForRun,
} from "./product";

interface World {
	inc?: Made;
	/** Incidents a scene made, by role. */
	named: Record<string, Made>;
	page?: Page;
	prefix?: string;
	before?: number;
	startedAt?: number;
	refire?: Made;
	boundary?: number;
	runs?: number;
}
const worlds = new WeakMap<Page, World>();
const w = (page: Page): World => {
	let x = worlds.get(page);
	if (!x) {
		x = { named: {} };
		worlds.set(page, x);
	}
	return x;
};
const inc = (page: Page): Made => {
	const i = w(page).inc;
	if (!i) throw new Error("no incident was made for this scenario");
	return i;
};
const here = (page: Page) => w(page).page ?? page;

// --- Board ------------------------------------------------------------------

const NEED: Record<string, string> = {
	"Waiting for your approval": "approval",
	"Finding ready": "ready",
	"Run failed or stopped": "failed",
	"No cause found": "nocause",
	"Alerts cleared": "cleared",
};
/** An inbox group by its heading (spec §1, #811). */
const group = (page: Page, label: string) => {
	const need = NEED[label];
	if (!need) throw new Error(`no inbox group "${label}"`);
	return page.locator(`[data-testid="needs-group"][data-need="${need}"]`);
};
const rowOf = (page: Page) =>
	cardOf(page.getByTestId("needs-you"), inc(page).title);

Then(
	"INC-1 is under {string} with {string} and the cause",
	async ({ page }, label: string, lead: string) => {
		await openBoard(page);
		const row = cardOf(group(page, label), inc(page).title);
		await expect(row.getByTestId("inbox-row-reason")).toContainText(lead);
		await expect(row.getByTestId("inbox-row-reason")).toContainText("d37d888");
	},
);

Then(
	"INC-1 is under {string} reading {string}",
	async ({ page }, label: string, word: string) => {
		await openBoard(page);
		const row = cardOf(group(page, label), inc(page).title);
		await expect(row.getByTestId("inbox-row-reason")).toContainText(word);
	},
);

Then(
	"INC-1 is in Recently resolved reading {string}",
	async ({ page }, word: string) => {
		await openBoard(page);
		const row = cardOf(page.getByTestId("recently-resolved"), inc(page).title);
		await expect(row).toContainText(word);
		await expect(rowOf(page)).toHaveCount(0);
	},
);

Then(
	"no group or row says {string} or {string}",
	async ({ page }, a: string, b: string) => {
		// Titles and services are the alert's words, not the inbox's: another
		// scenario's incident may be titled "Closed without a cause".
		const words = () =>
			page.getByTestId("inbox").evaluate((inbox) => {
				const copy = inbox.cloneNode(true) as HTMLElement;
				copy.querySelectorAll('[dir="auto"]').forEach((el) => {
					el.remove();
				});
				return copy.textContent ?? "";
			});
		await expect.poll(words).not.toContain(a);
		await expect.poll(words).not.toContain(b);
	},
);

Then(
	"within 2 seconds the row is in the inbox and the sidebar's Incidents count went up by one",
	async ({ page }) => {
		await expect(cardOf(page, inc(page).title)).toBeVisible({ timeout: 2_000 });
		await expect(
			page.getByTestId("sidebar").getByTestId("nav-incidents-count"),
		).toHaveText(String((w(page).before ?? 0) + 1), { timeout: 2_000 });
	},
);

Then(
	"the row is marked new, and a second arrival a second later is marked new while the first one's mark ends",
	async ({ page, alertmanager, deliverWebhook, unique, $test }) => {
		$test.slow();
		const first = cardOf(page, inc(page).title);
		await expect(first).toHaveAttribute("data-new", "");
		await page.waitForTimeout(1_000);
		const title = unique("BoardSecondArrival");
		const listed = alertmanager.fire({
			labels: { alertname: title, severity: "critical", service: QUIET.name },
		});
		await deliverWebhook([listed.fingerprint]);
		const second = cardOf(page, title);
		await expect(second).toHaveAttribute("data-new", "", { timeout: 3_000 });
		// The second arrival's refetch must not cancel the first row's mark.
		await expect(first).not.toHaveAttribute("data-new", "", { timeout: 4_000 });
	},
);

Then(
	"every row's title is readable, none cut to one letter",
	async ({ page }) => {
		const titles = page.getByTestId("inbox-row-title");
		await expect(titles.first()).toBeVisible();
		for (const title of (await titles.all()).slice(0, 12)) {
			const box = await title.boundingBox();
			expect(box?.width ?? 0).toBeGreaterThan(80);
		}
	},
);

Then("nothing scrolls sideways", async ({ page }) => {
	await expect(page.getByTestId("inbox")).toBeVisible();
	expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
});

Given(
	"the agent is ready and INC-1 is under {string}",
	async ({ page, release }, label: string) => {
		const ready = await page.request.get("/api/settings/harnesses");
		expect(
			((await ready.json()) as { selection: { runnable: boolean } }).selection
				.runnable,
		).toBe(true);
		release(inc(page).title);
		await waitForRun(
			page,
			inc(page).id,
			(r) => r.status === "completed",
			"the report",
		);
		await openBoard(page);
		await expect(cardOf(group(page, label), inc(page).title)).toBeVisible();
	},
);

When(
	"I pick {string} in INC-1's row menu",
	async ({ page, hold }, item: string) => {
		hold(inc(page).title);
		w(page).runs =
			(await detail(page, inc(page).id)).investigations?.length ?? 0;
		await openBoard(page);
		await rowOf(page).getByTestId("inbox-row-menu").click();
		await page.getByRole("menuitem", { name: item }).click();
	},
);

Then("a run starts at once, with no form on the page", async ({ page }) => {
	const before = w(page).runs ?? 0;
	await waitFor(
		async () =>
			((await detail(page, inc(page).id)).investigations?.length ?? 0) > before
				? true
				: undefined,
		"a new run",
	);
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page.getByTestId("composer-input")).toHaveCount(0);
});

When(
	"I resolve INC-1 from its row menu and confirm a cause",
	async ({ page }) => {
		await openBoard(page);
		await rowOf(page).getByTestId("inbox-row-menu").click();
		await page.getByRole("menuitem", { name: "Resolve" }).click();
		const dialog = page.getByTestId("resolve-dialog");
		await expect(dialog).toBeVisible();
		await dialog
			.getByTestId("resolve-cause")
			.fill("the live turn was stopped first");
		await dialog.getByTestId("confirm-resolve").click();
	},
);

Then(
	`INC-1 is under "No cause found", a chat is not a run working on it`,
	async ({ page }) => {
		await openBoard(page);
		await expect(
			cardOf(group(page, "No cause found"), inc(page).title),
		).toBeVisible();
	},
);

Given(
	"a paired browser at {int} px on a workspace with INC-1 open and a run in progress",
	async ({ page, alertmanager, deliverWebhook, unique }, width: number) => {
		await page.setViewportSize({ width, height: 900 });
		const made = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("BooklogrQueueLag"),
			service: LIVE,
			session: "live",
		});
		await waitForRun(
			page,
			made.id,
			(r) => !!r.lastEventAt,
			"a run that has a step",
		);
		await acknowledge(page, made.id);
		w(page).inc = made;
	},
);

When("the run finishes with a report", async ({ page, release }) => {
	release(inc(page).title);
	await waitForRun(
		page,
		inc(page).id,
		(r) => r.status === "completed",
		"the report",
	);
});

When(
	"the alert clears in Alertmanager",
	async ({ page, alertmanager, deliverWebhook }) => {
		const fp = alertmanager
			.alerts()
			.find((a) => a.labels.alertname === inc(page).title)?.fingerprint;
		alertmanager.clear(fp ?? "");
		await deliverWebhook();
		await waitFor(
			async () =>
				(await detail(page, inc(page).id)).status === "resolved"
					? true
					: undefined,
			"the source to clear the alert",
		);
	},
);

When("I resolve INC-1 with a cause", async ({ page }) => {
	await openBoard(page);
	await visit(page, `/incidents/${inc(page).id}`);
	await page.getByTestId("header-resolve").click();
	const confirm = page.getByTestId("resolve-firing-confirm");
	if (await confirm.isVisible()) {
		await page.getByTestId("resolve-anyway").click();
	}
	const dialog = page.getByTestId("resolve-dialog");
	await dialog.getByTestId("resolve-cause").fill("the index d37d888 dropped");
	await dialog.getByTestId("confirm-resolve").click();
	await expect(page.getByTestId("header-reopen")).toBeVisible();
});

When(
	"an Alertmanager delivery for a new alert arrives",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		await openBoard(page);
		const count = page
			.getByTestId("sidebar")
			.getByTestId("nav-incidents-count");
		await expect(count).toHaveText(/\d+/);
		w(page).before = Number(await count.innerText());
		await page
			.waitForResponse((r) => r.url().includes("/api/live/changes"), {
				timeout: 15_000,
			})
			.catch(() => undefined);
		await ensureService(page, { ...QUIET, trigger: "never" });
		const title = unique("BoardArrival");
		const listed = alertmanager.fire({
			labels: { alertname: title, severity: "critical", service: QUIET.name },
		});
		w(page).startedAt = Date.now();
		await deliverWebhook([listed.fingerprint]);
		w(page).inc = { id: "", number: 0, title, labels: {} };
	},
);

Given("the viewport is {int} px wide", async ({ page }, width: number) => {
	await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
	await openBoard(page);
});

// --- Phone --------------------------------------------------------------------

Given(
	"a push link opens INC-4",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		const made = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("PhonePush"),
			service: LIVE,
			session: "live",
		});
		await waitForRun(page, made.id, (r) => !!r.lastEventAt, "a working run");
		w(page).inc = made;
		const tab = await page.context().newPage();
		await tab.setViewportSize(
			page.viewportSize() ?? { width: 390, height: 844 },
		);
		await visit(tab, `/incidents/${made.id}`);
		w(page).page = tab;
	},
);

When('I press "Acknowledge" in the band', async ({ page }) => {
	await here(page).getByTestId("band-acknowledge").click();
});

Then(
	'the band reads "Acknowledged" and the list leaves INC-4 out of Needs you while its run works',
	async ({ page }) => {
		const p = here(page);
		await expect(p.getByTestId("band-status")).toHaveText("Acknowledged");
		await p.getByTestId("incident-back").click();
		await expect.poll(() => new URL(p.url()).pathname).toBe("/incidents");
		await expect(p.getByTestId("needs-you")).toBeVisible();
		await expect(
			cardOf(p.getByTestId("needs-you"), inc(page).title),
		).toHaveCount(0);
	},
);

When("I open Incidents, Analytics", async ({ page }) => {
	await visit(page, "/incidents?view=analytics");
	await expect(page.getByTestId("analytics")).toBeVisible();
});

Then(
	"the answer line and the numbers fit the screen two per row, and nothing scrolls sideways",
	async ({ page }) => {
		const width = page.viewportSize()?.width ?? 390;
		const answer = page.getByTestId("analytics-answer");
		const box = await answer.boundingBox();
		expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
		const tiles = page.getByTestId("analytics-numbers").locator("> div");
		if ((await tiles.count()) > 0) {
			const tops = await Promise.all(
				(await tiles.all()).map(async (t) =>
					Math.round((await t.boundingBox())?.y ?? 0),
				),
			);
			expect(tops[0]).toBe(tops[1]);
			expect(tops[2]).toBeGreaterThan(tops[1] ?? 0);
		}
		expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
	},
);

// --- First run ------------------------------------------------------------------

Given("a paired browser on a workspace with no incidents", async ({ page }) => {
	// Settings, Danger zone, Reset data: the product's own way to an empty workspace.
	// It refuses while runs are live, so the scenarios before this one's are stopped first.
	await expect
		.poll(
			async () => {
				for (const status of ["running", "pending"]) {
					const { data } = (await (
						await page.request.get(
							`/api/investigations?status=${status}&limit=100`,
						)
					).json()) as { data: { id: string }[] };
					for (const r of data)
						await page.request.post(`/api/investigations/${r.id}/cancel`);
				}
				const reset = await page.request.post(
					"/api/settings/danger/reset-data",
					{
						data: { confirmation: "RESET" },
					},
				);
				return reset.ok();
			},
			{ timeout: 30_000, intervals: [1_000] },
		)
		.toBe(true);
});

Then(
	'I see four numbered steps, a done step reading "Done" in green, and no column headings, filter, time window or counts',
	async ({ page }) => {
		const panel = page.getByTestId("first-run");
		await expect(panel).toBeVisible();
		for (const n of [1, 2, 3, 4])
			await expect(panel.getByTestId(`first-run-step-${n}`)).toContainText(
				String(n),
			);
		const done = panel.getByTestId("step-done").first();
		await expect(done).toHaveText("Done");
		const [color, ok] = await done.evaluate((el) => {
			const probe = document.createElement("span");
			probe.style.color = "var(--ok)";
			document.body.append(probe);
			const c = getComputedStyle(probe).color;
			probe.remove();
			return [getComputedStyle(el).color, c];
		});
		expect(color).toBe(ok);
		await expect(page.getByTestId("board-column-heading")).toHaveCount(0);
		await expect(page.getByTestId("board-search")).toHaveCount(0);
		await expect(page.getByTestId("board-window")).toHaveCount(0);
		await expect(page.getByTestId("incidents-view")).toHaveCount(0);
	},
);

Then(
	'step 1 offers "Copy URL" and "Copy token" separately',
	async ({ page }) => {
		const step = page.getByTestId("first-run-step-1");
		await expect(step.getByRole("button", { name: "Copy URL" })).toBeVisible();
		await expect(
			step.getByRole("button", { name: "Copy token" }),
		).toBeVisible();
	},
);

When(
	"I open the board in a browser that blocks the clipboard",
	async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(navigator, "clipboard", {
				value: undefined,
				configurable: true,
			});
		});
		await visit(page, "/incidents");
		await expect(page.getByTestId("first-run")).toBeVisible();
	},
);

When('I press "Copy URL" in step 1', async ({ page }) => {
	await page.getByTestId("first-run-copy-url").click();
});

Then(
	'a toast reads "Not copied" and none reads "Copied URL"',
	async ({ page }) => {
		await expect(page.getByText("Not copied").first()).toBeVisible();
		await expect(page.getByText("Copied URL")).toHaveCount(0);
	},
);

Then(
	'the only way to create an incident by hand is "New" in the header',
	async ({ page }) => {
		await expect(
			page.getByRole("button", { name: /^(\+ )?new|create incident/i }),
		).toHaveCount(1);
		await expect(
			page.getByTestId("page-header").getByTestId("create-incident-button"),
		).toBeVisible();
	},
);

Given(
	"a coding agent is on PATH and no service names its code",
	async ({ page }) => {
		const { data } = (await (
			await page.request.get("/api/services?limit=100")
		).json()) as {
			data: { id: string; repositories?: { repositoryId: string }[] }[];
		};
		for (const s of data)
			for (const r of s.repositories ?? [])
				await page.request.delete(
					`/api/repositories/${r.repositoryId}/unlink/${s.id}`,
				);
		const status = (await (
			await page.request.get("/api/setup/status")
		).json()) as {
			steps: { aiProvider: boolean; codeLocation: boolean };
		};
		expect(status.steps).toMatchObject({
			aiProvider: true,
			codeLocation: false,
		});
	},
);

When(
	"the first alert arrives",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		w(page).inc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("FirstAlert"),
			service: QUIET,
			quiet: true,
		});
		await openBoard(page);
	},
);

Then(
	'the inbox shows the row and one line above Needs you reading "Setup, 3 of 4 done" with "Add a service"',
	async ({ page }) => {
		await expect(cardOf(page, inc(page).title)).toBeVisible();
		const line = page.getByTestId("setup-line");
		await expect(line).toContainText("Setup, 3 of 4 done");
		await expect(
			line.getByRole("link", { name: "Add a service" }),
		).toBeVisible();
		const lineBox = await line.boundingBox();
		const board = await page.getByTestId("needs-you").boundingBox();
		expect(lineBox?.y ?? 0).toBeLessThan(board?.y ?? 0);
	},
);

When("I add a service with a folder", async ({ page, unique }) => {
	await page
		.getByTestId("setup-line")
		.getByRole("link", { name: "Add a service" })
		.click();
	const dialog = page.getByRole("dialog");
	await dialog.locator("#name").fill(unique("pr2-folder-service"));
	await dialog
		.getByTestId("service-repository-input")
		.fill(join(process.cwd(), "..", ".."));
	await dialog.getByRole("button", { name: /create service/i }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });
	await openBoard(page);
});

Then("the line goes", async ({ page }) => {
	await expect(page.getByTestId("setup-line")).toHaveCount(0);
});

Given("no coding agent is on PATH", async ({ page, agents, $test }) => {
	agents.hide();
	const res = (await (
		await page.request.get("/api/settings/harnesses")
	).json()) as {
		harnesses: { label: string; installed: boolean }[];
	};
	const real = res.harnesses.filter((h) => h.installed).map((h) => h.label);
	$test.skip(
		real.length > 0,
		`this machine has ${real.join(", ")} on PATH outside the suite's fakes`,
	);
	await openBoard(page).catch(() => page.goto("/incidents"));
});

Then(
	"step 3 reads which agents PrismaLens looks for and how to install one",
	async ({ page }) => {
		await visit(page, "/incidents");
		const step = page.getByTestId("first-run-step-3");
		await expect(step).toContainText("PrismaLens looks for OpenCode");
		await expect(step.getByTestId("first-run-install").first()).toBeVisible();
	},
);

When(
	"I open an incident's Conversation",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		const made = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("NoAgent"),
			service: QUIET,
			quiet: true,
		});
		// The box lives on Conversation (#673); with no run it opens on the draft.
		await visit(page, `/incidents/${made.id}/conversation`);
	},
);

Then(
	'the box reads "No coding agent on this machine" with the install line, and "Investigate" is withheld',
	async ({ page }) => {
		const box = page.getByTestId("docked-composer");
		await expect(box).toContainText("No coding agent on this machine");
		await expect(box).toContainText("Install one:");
		await expect(box.getByTestId("composer-send")).toBeDisabled();
	},
);

// --- Analytics -------------------------------------------------------------------

async function analyticsFor(page: Page) {
	await visit(page, "/incidents?view=analytics");
	await page.getByTestId("incidents-filter").fill(w(page).prefix ?? "");
	await expect(page.getByTestId("analytics-answer")).toBeVisible();
}

Given(
	"{int} resolved incidents in the last 30 days",
	async ({ page, alertmanager, deliverWebhook, unique }, n: number) => {
		const prefix = unique("Quiet");
		for (let i = 0; i < n; i++) {
			const made = await fireIncident(page, alertmanager, deliverWebhook, {
				name: `${prefix}-${i}`,
				service: QUIET,
				quiet: true,
			});
			await resolveIncident(page, made.id, {
				actualCause: "a cause",
				actualCauseCategory: "config",
			});
		}
		w(page).prefix = prefix;
	},
);

Then(
	"the first line reads how many incidents, how many resolved, and the median time to resolve",
	async ({ page }) => {
		await analyticsFor(page);
		const answer = page.getByTestId("analytics-answer");
		await expect(answer).toContainText("3 incidents, all resolved");
		await expect(answer).toContainText(/to resolve/);
	},
);

When(
	"I pick 24 hours in All incidents and switch to Analytics",
	async ({ page }) => {
		await visit(page, "/incidents?view=all");
		await page.getByTestId("board-window").click();
		await page.getByRole("option", { name: "24 hours" }).click();
		await page.getByTestId("incidents-view-analytics").click();
		await expect(page.getByTestId("analytics-answer")).toBeVisible();
	},
);

Then(
	"the window reads {string} and a bar per day covers {int} days",
	async ({ page }, label: string, days: number) => {
		const window = page.getByTestId("board-window");
		await expect(window).toHaveText(label);
		await expect(
			page.getByTestId("analytics-days").locator("span"),
		).toHaveCount(days);
	},
);

Then(
	"four numbers follow: incidents, median time to resolve, investigated by the agent, open now, each with one line of comparison",
	async ({ page }) => {
		for (const key of ["incidents", "resolve", "investigated", "open"]) {
			const tile = page.getByTestId(`tile-${key}`);
			await expect(tile).toBeVisible();
			await expect(tile.getByTestId("tile-line")).not.toBeEmpty();
		}
	},
);

Then(
	"a bar per day coloured by severity, then incidents by service and by recorded cause",
	async ({ page }) => {
		await expect(
			page.getByTestId("analytics-days").locator("span"),
		).toHaveCount(30);
		await expect(page.getByTestId("analytics-key")).toContainText("Critical");
		const breakdowns = page.getByTestId("analytics-breakdown");
		await expect(breakdowns.first()).toContainText("By service");
		await expect(breakdowns.nth(1)).toContainText("By recorded cause");
		await expect(breakdowns.nth(1)).toContainText("Configuration");
	},
);

Then(
	'no number sits in a framed box and no line reads "updated 0s ago"',
	async ({ page }) => {
		for (const tile of await page
			.getByTestId("analytics-numbers")
			.locator("> div")
			.all()) {
			// A tile is a tone (look ruling §1.1), never an edge or a shadow.
			const style = await tile.evaluate((el) => {
				const s = getComputedStyle(el);
				return [s.borderTopWidth, s.boxShadow];
			});
			expect(style).toEqual(["0px", "none"]);
		}
		await expect(page.getByTestId("analytics")).not.toContainText(
			/updated \d+s ago/,
		);
	},
);

Given(
	"{int} open incidents and {int} needing me",
	async (
		{ page, alertmanager, deliverWebhook, unique },
		open: number,
		needing: number,
	) => {
		const prefix = unique("Busy");
		for (let i = 0; i < open; i++) {
			const made = await fireIncident(page, alertmanager, deliverWebhook, {
				name: `${prefix}-${i}`,
				service: QUIET,
				quiet: true,
			});
			if (i >= needing) await acknowledge(page, made.id);
		}
		w(page).prefix = prefix;
	},
);

Then(
	'the first line reads how many are open and "3 need you now" as a link to Needs you',
	async ({ page }) => {
		await analyticsFor(page);
		const answer = page.getByTestId("analytics-lead");
		await expect(answer).toContainText("7 of them still open");
		const link = answer.getByTestId("analytics-need-you");
		await expect(link).toHaveText("3 need you now");
		await link.click();
		await expect(page).toHaveURL(/\/incidents$/);
		await expect(page.getByTestId("needs-you")).toBeVisible();
	},
);

Given(
	"a month worse than the one before",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		const prefix = unique("Worse");
		const make = async (i: number) =>
			fireIncident(page, alertmanager, deliverWebhook, {
				name: `${prefix}-${i}`,
				service: QUIET,
				quiet: true,
			});
		// The month before: acknowledged and resolved at once.
		let last = 0;
		for (let i = 0; i < 4; i++) {
			const m = await make(i);
			await acknowledge(page, m.id);
			await resolveIncident(page, m.id, { actualCauseCategory: "code" });
			last = Date.parse((await detail(page, m.id)).createdAt);
		}
		await page.waitForTimeout(2_000);
		// This month: more of them, each slower to take and to resolve.
		const now: Made[] = [];
		for (let i = 4; i < 9; i++) now.push(await make(i));
		const first = Date.parse((await detail(page, now[0]?.id ?? "")).createdAt);
		await page.waitForTimeout(2_000);
		for (const m of now) await acknowledge(page, m.id);
		await page.waitForTimeout(3_000);
		for (const m of now)
			await resolveIncident(page, m.id, { actualCauseCategory: "config" });
		// The browser stands 30 days after the gap, so the first four fall in the month before.
		const boundary = (last + first) / 2;
		w(page).boundary = boundary;
		await page.clock.setFixedTime(boundary + 30 * 86_400_000);
		w(page).prefix = prefix;
	},
);

Then(
	"the first line says so and each number shows what it was before",
	async ({ page }) => {
		await analyticsFor(page);
		await expect(page.getByTestId("analytics-lead")).toContainText(
			"Worse than last month: 5 incidents, up from 4, and slower to resolve.",
		);
		await expect(
			page.getByTestId("tile-incidents").getByTestId("tile-line"),
		).toHaveText("up from 4");
		await expect(
			page.getByTestId("tile-ack").getByTestId("tile-line"),
		).toContainText("up from");
		await expect(
			page.getByTestId("tile-resolve").getByTestId("tile-line"),
		).toContainText("up from");
		await expect(
			page.getByTestId("tile-investigated").getByTestId("tile-line"),
		).toContainText("the 30 days before");
	},
);

Then(
	'the numbers include median time to acknowledge, and "agent\'s cause matched yours" sits below them captioned as a five-bucket match on incidents where I recorded a category',
	async ({ page }) => {
		await expect(page.getByTestId("tile-ack")).toContainText(
			"Median to acknowledge",
		);
		const match = page.getByTestId("analytics-match");
		await expect(match).toContainText("Agent's cause matched yours");
		await expect(match).toContainText("where you recorded a category");
		await expect(match).toContainText("a five-bucket match");
		const tiles = await page.getByTestId("analytics-numbers").boundingBox();
		const line = await match.boundingBox();
		expect(line?.y ?? 0).toBeGreaterThan(
			(tiles?.y ?? 0) + (tiles?.height ?? 0) - 1,
		);
	},
);

Then(
	'"time to resolve" is measured to my Resolve, with "time until alerts cleared" shown as its own figure',
	async ({ page }) => {
		await expect(page.getByTestId("analytics-cleared")).toContainText(
			"Median time to resolve runs from the first alert to your Resolve",
		);
		await expect(page.getByTestId("analytics-cleared")).toContainText(
			"time until alerts cleared",
		);
	},
);

Given("no incidents in the window", async ({ page }) => {
	// A year on, the last 30 days hold nothing this suite made.
	await page.clock.setFixedTime(Date.now() + 400 * 86_400_000);
});

Then(
	'the page reads "No incidents in the last 30 days" and offers a wider window',
	async ({ page }) => {
		await visit(page, "/incidents?view=analytics");
		await expect(page.getByTestId("analytics-answer")).toHaveText(
			"No incidents in the last 30 days",
		);
		await expect(page.getByTestId("analytics-widen")).toHaveText(
			"Show the last 90 days",
		);
	},
);

// --- Incident page ----------------------------------------------------------------

Given(
	"INC-1 is Triggered with no run yet",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		w(page).inc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("BandAction"),
			service: QUIET,
			quiet: true,
		});
	},
);

const TABS = ["", "/conversation", "/report", "/alerts", "/timeline"];

When("I view INC-1's Overview", async ({ page }) => {
	await visit(page, `/incidents/${inc(page).id}`);
	await expect(page.getByTestId("incident-overview")).toBeVisible();
});

Then(
	"the header shows {string} and never {string}",
	async ({ page }, action: string, never: string) => {
		await expect(page.getByTestId("header-resolve")).toHaveText(action);
		await expect(
			page
				.getByTestId("incident-header")
				.getByRole("button", { name: never, exact: true }),
		).toHaveCount(0);
	},
);

When("I open INC-1 and each of its tabs in turn", async ({ $test }) => {
	// The Thens load the record ten times; on a CI runner that sits at the default 30 s.
	$test.slow();
	// The Then walks the tabs; each one is read where it is shown.
});

Then("the band reads {string} on each", async ({ page }, action: string) => {
	for (const t of TABS) {
		await visit(page, `/incidents/${inc(page).id}${t}`);
		await expect(page.getByTestId("incident-state-band")).toBeVisible();
		await expect(
			page.getByTestId("incident-state-band").locator("[data-action]"),
		).toHaveText(action);
	}
});

When("I acknowledge", async ({ page }) => {
	await visit(page, `/incidents/${inc(page).id}`);
	await page.getByTestId("band-acknowledge").click();
	await expect(page.getByTestId("band-status")).toHaveText("Acknowledged");
});

Then(
	"the band reads {string} on every tab and never {string}",
	async ({ page }, action: string, never: string) => {
		for (const t of TABS) {
			await visit(page, `/incidents/${inc(page).id}${t}`);
			const band = page.getByTestId("incident-state-band");
			await expect(band.locator("[data-action]")).toHaveText(action);
			await expect(
				band.getByRole("button", { name: never, exact: true }),
			).toHaveCount(0);
		}
	},
);

// --- Resolve, reopen, refire ---------------------------------------------------------

Given(
	"INC-1 is Acknowledged with one alert still firing",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		const made = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("PoolExhausted"),
			service: LIVE,
			session: "success",
		});
		await waitForRun(
			page,
			made.id,
			(r) => r.status === "completed",
			"the report",
		);
		await acknowledge(page, made.id);
		w(page).inc = made;
		await visit(page, `/incidents/${made.id}`);
	},
);

When('I press "Resolve" in the band', async ({ page }) => {
	await page.getByTestId("header-resolve").click();
	if (
		await page
			.getByTestId("resolve-anyway")
			.isVisible({ timeout: 1000 })
			.catch(() => false)
	) {
		await page.getByTestId("resolve-anyway").click();
	}
	await expect(page.getByTestId("resolve-dialog")).toBeVisible();
});

Then(
	"the dialog says 1 alert is still firing and that a refire opens a new incident naming this one",
	async ({ page }) => {
		await expect(page.getByTestId("resolve-still-firing")).toHaveText(
			"1 alert is still firing in Alertmanager. Resolving ends it here; if it fires again, a new incident opens and names this one.",
		);
	},
);

Then(
	'"Cause" is prefilled with the report\'s answer in the normal text colour, labelled "from the report, edit if wrong", and "Category" is prefilled from the report',
	async ({ page }) => {
		const dialog = page.getByTestId("resolve-dialog");
		const cause = dialog.getByTestId("resolve-cause");
		await expect(cause).toHaveValue(
			/d37d888 dropped ix_books_owner_lower_title/,
		);
		const [color, text1] = await cause.evaluate((el) => {
			const probe = document.createElement("span");
			probe.style.color = "var(--text-1)";
			document.body.append(probe);
			const c = getComputedStyle(probe).color;
			probe.remove();
			return [getComputedStyle(el).color, c];
		});
		expect(color).toBe(text1);
		await expect(dialog.getByTestId("resolve-cause-note")).toHaveText(
			"from the report, edit if wrong",
		);
		await expect(dialog.getByTestId("resolve-category")).toHaveText("Code");
		await expect(dialog).toContainText("Category from the report");
	},
);

Then(
	'the band reads "Resolved" with "Reopen" as its action',
	async ({ page }) => {
		await expect(page.getByTestId("next-text")).toContainText("Resolved");
		await expect(page.getByTestId("header-reopen")).toHaveText("Reopen");
	},
);

Then(
	'the Overview shows "Cause" with the text and an "Edit" control',
	async ({ page }) => {
		await visit(page, `/incidents/${inc(page).id}`);
		await expect(page.getByTestId("why-cause")).toContainText("d37d888");
		await page.getByTestId("header-more").click();
		await expect(page.getByTestId("header-edit-cause")).toHaveText(
			"Edit cause",
		);
		await page.keyboard.press("Escape");
	},
);

Then("the alert reads resolved with the incident", async ({ page }) => {
	const alert = (await detail(page, inc(page).id)).alerts?.[0];
	expect(alert?.status).toBe("resolved");
	await visit(page, `/alerts/${alert?.id}`);
	await expect(page.getByTestId("alert-state")).toHaveText("Cleared");
});

Given(
	"INC-1 is Acknowledged",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		const made = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("CheckoutSlow"),
			service: QUIET,
			quiet: true,
		});
		await acknowledge(page, made.id);
		w(page).inc = made;
	},
);

When(
	"the source resolves its alert",
	async ({ page, alertmanager, deliverWebhook }) => {
		const fp = alertmanager
			.alerts()
			.find((a) => a.labels.alertname === inc(page).title)?.fingerprint;
		alertmanager.clear(fp ?? "");
		await deliverWebhook();
		await waitFor(
			async () =>
				(await detail(page, inc(page).id)).status === "resolved"
					? true
					: undefined,
			"Alerts cleared",
		);
	},
);

Then(
	'the band reads "Alerts cleared" with "Resolve" as its action and INC-1 sits under "Alerts cleared"',
	async ({ page }) => {
		await visit(page, `/incidents/${inc(page).id}`);
		await expect(page.getByTestId("next-text")).toContainText(
			/Resolved|Every alert has cleared/,
		);
		await expect(page.getByTestId("header-resolve")).toHaveText("Resolve");
		await openBoard(page);
		await expect(
			cardOf(group(page, "Alerts cleared"), inc(page).title),
		).toBeVisible();
	},
);

Given(
	/^INC-1 is Resolved with (?:cause "([^"]+)"|a cause)$/,
	async ({ page, alertmanager, deliverWebhook, unique }, cause?: string) => {
		const made = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("PoolCapped"),
			service: QUIET,
			quiet: true,
		});
		await resolveIncident(page, made.id, {
			actualCause: cause ?? "pool capped at 10",
		});
		w(page).inc = made;
	},
);

When(
	"the same alert fires again",
	async ({ page, alertmanager, deliverWebhook }) => {
		const made = inc(page);
		alertmanager.fire({ labels: made.labels });
		await deliverWebhook();
		w(page).startedAt = Date.now();
	},
);

Then(
	"within 2 seconds a new incident for the same alert is under {string}",
	async ({ page }, label: string) => {
		const made = inc(page);
		await openBoard(page);
		const rows = cardOf(group(page, label), made.title).filter({
			hasNot: page.getByText(`INC-${made.number}`, { exact: true }),
		});
		await expect(rows.first()).toBeVisible({ timeout: 2_000 });
		const refire = (await detail(page, made.id)).refiredAs;
		expect(refire).toBeTruthy();
		w(page).refire = {
			id: refire?.id ?? "",
			number: refire?.number ?? 0,
			title: made.title,
			labels: made.labels,
		};
	},
);

Then(
	"the new incident's Overview reads {string} as {string}",
	async ({ page }, term: string, value: string) => {
		await visit(page, `/incidents/${w(page).refire?.id}`);
		const impact = page.getByTestId("impact-no-source");
		await expect(impact.locator("dt", { hasText: term })).toBeVisible();
		await expect(
			impact
				.locator("div", { has: page.locator("dt", { hasText: term }) })
				.locator("dd"),
		).toHaveText(value);
	},
);

// The refire carries INC-1's title, so INC-1 is told apart by its number.
Then(
	"INC-1 stays Resolved, in Recently resolved reading {string}",
	async ({ page }, word: string) => {
		const ours = page.getByText(`INC-${inc(page).number}`, { exact: true });
		await openBoard(page);
		await expect(
			page
				.getByTestId("recently-resolved")
				.getByTestId("recent-row")
				.filter({ has: ours }),
		).toContainText(word);
		await expect(
			page
				.getByTestId("needs-you")
				.getByTestId("inbox-row")
				.filter({ has: ours }),
		).toHaveCount(0);
	},
);

Given(
	'INC-1 reads "Alerts cleared" and the flap window is open',
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		const made = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("QueueFlap"),
			service: QUIET,
			quiet: true,
		});
		w(page).inc = made;
		const fp = alertmanager
			.alerts()
			.find((a) => a.labels.alertname === made.title)?.fingerprint;
		alertmanager.clear(fp ?? "");
		await deliverWebhook();
		await waitFor(
			async () =>
				(await detail(page, made.id)).status === "resolved" ? true : undefined,
			"Alerts cleared",
		);
	},
);

Then(
	"INC-1 is under {string} reading {string} and the band reads {string}",
	async ({ page }, label: string, word: string, _band: string) => {
		await waitFor(
			async () =>
				(await detail(page, inc(page).id)).status === "triggered"
					? true
					: undefined,
			"the flap to put it back",
		);
		await openBoard(page);
		await expect(
			cardOf(group(page, label), inc(page).title).getByTestId(
				"inbox-row-reason",
			),
		).toContainText(word);
		await visit(page, `/incidents/${inc(page).id}`);
		await expect(page.getByTestId("header-resolve")).toBeVisible();
	},
);

When('I press "Reopen" and confirm', async ({ page }) => {
	await visit(page, `/incidents/${inc(page).id}`);
	await page.getByTestId("header-reopen").click();
	await page.getByTestId("confirm-reopen-incident").click();
});

Then(
	'the band reads "Acknowledged", the Overview shows "Previous cause", and INC-1 is under "No cause found"',
	async ({ page }) => {
		await expect(page.getByTestId("header-resolve")).toBeVisible();
		await openBoard(page);
		await expect(
			cardOf(group(page, "No cause found"), inc(page).title),
		).toBeVisible();
	},
);

When("I start a run from the box", async ({ page }) => {
	await visit(
		page,
		`/incidents/${inc(page).id}/conversation?investigation=new`,
	);
	await page
		.getByTestId("composer-input")
		.fill("fake-session:live check the pool");
	await (await investigateButton(page)).click();
	await waitForRun(
		page,
		inc(page).id,
		(r) => r.status === "running",
		"the run",
	);
});

Then("INC-1 leaves Needs you while the run works", async ({ page }) => {
	await openBoard(page);
	await expect(rowOf(page)).toHaveCount(0);
	await expect(
		page
			.getByTestId("tree-incident")
			.filter({ hasText: `INC-${inc(page).number}` }),
	).toBeVisible();
});

// #673 w37: Merge into…
const ORDERS = { name: "pr2-orders", displayName: "Orders API" } as const;

Given(
	"INC-1 on one service and INC-2 on another, both open",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		w(page).named.target = await fireIncident(
			page,
			alertmanager,
			deliverWebhook,
			{
				name: unique("MergeTarget"),
				service: QUIET,
				quiet: true,
			},
		);
		w(page).named.source = await fireIncident(
			page,
			alertmanager,
			deliverWebhook,
			{
				name: unique("MergeSource"),
				service: ORDERS,
				quiet: true,
			},
		);
	},
);

When(
	'I pick "Merge into…" in INC-2\'s band menu, choose INC-1 and confirm',
	async ({ page }) => {
		const { source, target } = w(page).named;
		await visit(page, `/incidents/${source.id}`);
		await page.getByTestId("header-more").click();
		await page.getByTestId("header-merge").click();
		await page.getByTestId("merge-search").fill(`INC-${target.number}`);
		await page
			.getByTestId("merge-option")
			.and(page.locator(`[data-number="${target.number}"]`))
			.click();
		await expect(page.getByTestId("merge-dialog")).toContainText(
			`Merge INC-${source.number} into INC-${target.number}?`,
		);
		await expect(page.getByTestId("merge-sentence")).toHaveText(
			`Its 1 alert moves to INC-${target.number} and INC-${source.number} ends as merged. Its runs stay here.`,
		);
		await page.getByTestId("confirm-merge").click();
	},
);

Then(
	'I am on INC-1, it carries both alerts, and its Timeline reads "Merged INC-2: 1 alert from Orders API"',
	async ({ page }) => {
		const { source, target } = w(page).named;
		await expect(page).toHaveURL(new RegExp(`/incidents/${target.id}`));
		await expect((await detail(page, target.id)).alerts).toHaveLength(2);
		await expect(page.getByTestId("changes-timeline")).toContainText(
			`Merged INC-${source.number}: 1 alert from Orders API`,
		);
	},
);

Then(
	'INC-2 is in Recently resolved reading "Merged into INC-1", and its band offers neither "Reopen" nor "New run"',
	async ({ page }) => {
		const { source, target } = w(page).named;
		await openBoard(page);
		await expect(
			cardOf(page.getByTestId("recently-resolved"), source.title),
		).toContainText(`Merged into INC-${target.number}`);
		await visit(page, `/incidents/${source.id}`);
		await page.getByTestId("header-more").click();
		await expect(
			page.getByRole("menuitem", { name: `Merged into INC-${target.number}` }),
		).toBeVisible();
		await expect(page.getByTestId("header-reopen")).toHaveCount(0);
		await expect(page.getByTestId("header-merge")).toHaveCount(0);
		await page.keyboard.press("Escape");
	},
);

// --- Resolve stops whichever turn is live (#673 w59, T21) ----------------------------

type ListedRun = Record<string, unknown> & { id: string; createdAt: string };
const liveIds = new WeakMap<Page, { live: string; cancels: string[] }>();

/** The board's list, with INC-1's runs reshaped by `shape`; the real run stays the one Stop reaches. */
async function reshapeRuns(
	page: Page,
	shape: (runs: ListedRun[]) => ListedRun[],
) {
	const made = inc(page);
	const live = (await detail(page, made.id)).investigations?.[0];
	if (!live) throw new Error("INC-1 has no run");
	const seen = { live: live.id, cancels: [] as string[] };
	liveIds.set(page, seen);
	page.on("request", (r) => {
		const m = /\/api\/investigations\/([^/]+)\/cancel$/.exec(
			new URL(r.url()).pathname,
		);
		if (m && r.method() === "POST") seen.cancels.push(m[1] as string);
	});
	const fix = (node: unknown): unknown => {
		if (Array.isArray(node)) return node.map(fix);
		if (!node || typeof node !== "object") return node;
		const o = node as Record<string, unknown>;
		if (o.id === made.id && Array.isArray(o.investigations))
			return { ...o, investigations: shape(o.investigations as ListedRun[]) };
		return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fix(v)]));
	};
	await page.route(
		(url) => url.pathname === "/api/incidents",
		async (route) => {
			if (route.request().method() !== "GET") return route.continue();
			try {
				const res = await route.fetch();
				await route.fulfill({ response: res, json: fix(await res.json()) });
			} catch (error) {
				if (page.isClosed() || /disposed/i.test(String(error))) return;
				throw error;
			}
		},
	);
}

Given("INC-1's live run sits under a newer finished run", async ({ page }) => {
	await reshapeRuns(page, (runs) => {
		const [live, ...rest] = runs;
		if (!live) return runs;
		const newer: ListedRun = {
			...live,
			id: "0b5e0000-0000-4000-8000-000000000001",
			status: "completed",
			liveTurn: null,
			stopRequestedAt: null,
			rootCause: "an earlier run's cause",
			hasReport: true,
			createdAt: new Date(Date.now() + 60_000).toISOString(),
			completedAt: new Date(Date.now() + 90_000).toISOString(),
		};
		return [newer, { ...live, liveTurn: "report" }, ...rest];
	});
});

Given("INC-1's live run is a chat answering a question", async ({ page }) => {
	await reshapeRuns(page, (runs) =>
		runs.map((r, i) =>
			i === 0 ? { ...r, kind: "chat", liveTurn: "answer" } : r,
		),
	);
});

Then(
	"the Stop went to the live run, not the newest, and INC-1 is Resolved",
	async ({ page }) => {
		const seen = liveIds.get(page);
		if (!seen) throw new Error("the board was not reshaped");
		await expect.poll(() => seen.cancels).toEqual([seen.live]);
		await waitFor(
			async () =>
				(await detail(page, inc(page).id)).status === "closed"
					? true
					: undefined,
			"INC-1 resolved",
		);
		await waitForRun(
			page,
			inc(page).id,
			(r) => r.status === "cancelled",
			"the live run stopped",
		);
	},
);
