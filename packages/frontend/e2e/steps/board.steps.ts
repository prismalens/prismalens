// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Steps for the @pr2 board, first run, Analytics, phone and lifecycle
 * journeys (study-v3 §8). "INC-1" in a scenario is the incident the scenario
 * made; its real number is read back from the product.
 */

import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { Given, Then, When } from "./fixtures";
import {
	acknowledge,
	cardOf,
	detail,
	drag,
	ensureService,
	fireIncident,
	LIVE,
	type Made,
	openBoard,
	QUIET,
	resolveIncident,
	sidewaysOverflow,
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
const column = (page: Page, label: string) =>
	page.getByTestId(
		`board-column-${{ "Needs you": "needs_you", Working: "working", Concluded: "concluded", Resolved: "resolved" }[label]}`,
	);

// --- Board ------------------------------------------------------------------

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

Then(
	"INC-1's card shows one severity dot, {string}, the service and age on the first line, the title on its own line, and the run's current step with a ticking elapsed time",
	async ({ page }, _id: string) => {
		const made = inc(page);
		await openBoard(page);
		const card = cardOf(page, made.title);
		await expect(card).toBeVisible();
		await expect(card.getByTestId("card-dot")).toHaveCount(1);
		await expect(card.getByTestId("card-id")).toHaveText(`INC-${made.number}`);
		await expect(card.getByTestId("card-age")).toHaveText(/^\d+[smhd]$/);
		await expect(card.getByTestId("card-service")).toHaveText(LIVE.displayName);
		await expect(card.getByTestId("card-title")).toHaveText(made.title);
		const step = card.getByTestId("card-step");
		await expect(step).toContainText("Reading worker/consumer.py");
		const first = await step.innerText();
		await expect
			.poll(() => step.innerText(), { timeout: 5_000 })
			.not.toBe(first);
	},
);

Then("no card shows a second dot or a severity word", async ({ page }) => {
	for (const card of await page.getByTestId("board-card").all()) {
		await expect(card.locator(".rounded-full.size-2")).toHaveCount(1);
		await expect(
			card.getByText(/^(Critical|High|Medium|Low|Info)$/),
		).toHaveCount(0);
	}
});

Given(
	"INC-1 is Triggered and its run is working",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		const made = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("BooklogrWorkerStalled"),
			service: LIVE,
			session: "live",
		});
		await waitForRun(page, made.id, (r) => !!r.lastEventAt, "a working run");
		expect((await detail(page, made.id)).status).toBe("triggered");
		w(page).inc = made;
	},
);

Then(
	"INC-1's card is in {string} reading {string} with the run's step under it and an {string} button on the card",
	async ({ page }, col: string, word: string, button: string) => {
		await openBoard(page);
		const card = cardOf(column(page, col), inc(page).title);
		await expect(card).toBeVisible();
		await expect(card.getByTestId("card-word")).toHaveText(word);
		await expect(card.getByTestId("card-step")).toContainText(
			"Reading worker/consumer.py",
		);
		await expect(card.getByRole("button", { name: button })).toBeVisible();
	},
);

When("I press {string} on the card", async ({ page }, button: string) => {
	const p = here(page);
	await p.evaluate(() => {
		(window as unknown as { __noReload: boolean }).__noReload = true;
	});
	await cardOf(p, inc(page).title)
		.getByRole("button", { name: button })
		.click();
});

Then(
	"the card moves to {string} without a reload",
	async ({ page }, col: string) => {
		const p = here(page);
		await expect(cardOf(column(p, col), inc(page).title)).toBeVisible();
		expect(
			await p.evaluate(
				() => (window as unknown as { __noReload?: boolean }).__noReload,
			),
		).toBe(true);
	},
);

Given(
	"one Triggered incident, one whose run failed, one reopened by me and one whose alerts cleared",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		const quiet = (n: string) =>
			fireIncident(page, alertmanager, deliverWebhook, {
				name: unique(n),
				service: QUIET,
				quiet: true,
			});
		const cleared = await quiet("OrderCleared");
		alertmanager.clear(
			alertmanager.alerts().find((a) => a.labels.alertname === cleared.title)
				?.fingerprint ?? "",
		);
		await deliverWebhook();
		await waitFor(
			async () =>
				(await detail(page, cleared.id)).status === "resolved"
					? true
					: undefined,
			"alerts cleared",
		);
		const reopened = await quiet("OrderReopened");
		await resolveIncident(page, reopened.id, { actualCause: "a guess" });
		await page.request.patch(`/api/incidents/${reopened.id}`, {
			data: { status: "investigating" },
		});
		const failed = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("OrderFailed"),
			service: LIVE,
			session: "failure",
		});
		await waitForRun(
			page,
			failed.id,
			(r) => r.status === "failed",
			"a failed run",
		);
		const triggered = await quiet("OrderTriggered");
		w(page).named = { triggered, failed, reopened, cleared };
	},
);

Then(
	'"Needs you" lists them in that order, with the cleared one under a quiet "To wrap up" heading',
	async ({ page }) => {
		await openBoard(page);
		const needs = column(page, "Needs you");
		const titles = await needs.getByTestId("card-title").allInnerTexts();
		const { triggered, failed, reopened, cleared } = w(page).named;
		const order = [triggered, failed, reopened].map((m) =>
			titles.indexOf(m.title),
		);
		expect(
			order.every((i) => i >= 0),
			titles.join(" | "),
		).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
		const wrap = needs.getByTestId("board-wrap-up");
		await expect(wrap).toContainText("To wrap up");
		await expect(cardOf(wrap, cleared.title)).toBeVisible();
		await expect(cardOf(wrap, triggered.title)).toHaveCount(0);
		const heading = wrap.getByText("To wrap up", { exact: true });
		expect(
			await heading.evaluate((el) => getComputedStyle(el).fontWeight),
		).toBe("400");
	},
);

Given(
	'an incident in "Needs you"',
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		const needs = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("SidebarNeeds"),
			service: QUIET,
			quiet: true,
		});
		const done = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("SidebarResolved"),
			service: QUIET,
			quiet: true,
		});
		await resolveIncident(page, done.id);
		w(page).named = { needs, done };
	},
);

When("I open any screen", async ({ page }) => {
	await openBoard(page);
});

Then(
	"its sidebar row carries the red mark, a working run's row the teal mark, and a resolved incident's row no mark",
	async ({ page }) => {
		const { needs, done } = w(page).named;
		const row = (title: string) =>
			page
				.getByTestId("sidebar")
				.getByTestId("incident-row")
				.filter({ hasText: title });
		const glyph = (title: string) =>
			row(title).locator("[data-glyph]").getAttribute("data-glyph");
		for (const where of ["board", "record"]) {
			if (where === "record") await page.goto(`/incidents/${needs.id}`);
			await expect(row(needs.title)).toBeVisible();
			expect(await glyph(needs.title)).toBe("attention");
			expect(await glyph(inc(page).title)).toBe("live");
			// Resolved rows fold into Settled; open it to read the row.
			if ((await row(done.title).count()) === 0)
				await page.getByTestId("sidebar").getByText("Settled").click();
			expect(await glyph(done.title)).toBe("ended");
		}
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

Then(
	"the card is in {string} with {string} and the cause",
	async ({ page }, col: string, lead: string) => {
		await openBoard(page);
		const card = cardOf(column(page, col), inc(page).title);
		await expect(card).toBeVisible();
		await expect(card.getByTestId("board-card-headline")).toContainText(lead);
		await expect(card.getByTestId("board-card-headline")).toContainText(
			"d37d888",
		);
	},
);

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

Then(
	"the card is in {string} reading {string}",
	async ({ page }, col: string, word: string) => {
		const p = here(page);
		if (!new URL(p.url()).pathname.endsWith("/incidents")) await openBoard(p);
		const card = cardOf(column(p, col), (w(page).refire ?? inc(page)).title);
		await expect(card).toBeVisible();
		await expect(card).toContainText(word);
	},
);

When("I resolve INC-1 with a cause", async ({ page }) => {
	await openBoard(page);
	await page.goto(`/incidents/${inc(page).id}`);
	await page.getByTestId("band-resolve").click();
	const dialog = page.getByTestId("resolve-dialog");
	await dialog.getByTestId("resolve-cause").fill("the index d37d888 dropped");
	await dialog.getByTestId("confirm-resolve").click();
	await expect(page.getByTestId("band-status")).toHaveText("Resolved");
});

Then(
	"the card is in {string} with {string} and the text",
	async ({ page }, col: string, lead: string) => {
		await openBoard(page);
		const card = cardOf(column(page, col), inc(page).title);
		await expect(card.getByTestId("board-card-headline")).toHaveText(
			`${lead} the index d37d888 dropped`,
		);
	},
);

Then(
	"no column or card says {string} or {string}",
	async ({ page }, a: string, b: string) => {
		// Titles and services are the alert's words, not the board's: another
		// scenario's incident may be titled "Closed without a cause".
		const words = () =>
			page.getByTestId("incident-board").evaluate((board) => {
				const copy = board.cloneNode(true) as HTMLElement;
				copy
					.querySelectorAll(
						'[data-testid="card-title"], [data-testid="card-service"]',
					)
					.forEach((el) => {
						el.remove();
					});
				return copy.textContent ?? "";
			});
		await expect.poll(words).not.toContain(a);
		await expect.poll(words).not.toContain(b);
	},
);

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

Then(
	"within 2 seconds the card is on the board and the sidebar's Incidents count went up by one",
	async ({ page }) => {
		await expect(cardOf(page, inc(page).title)).toBeVisible({ timeout: 2_000 });
		await expect(
			page.getByTestId("sidebar").getByTestId("nav-incidents-count"),
		).toHaveText(String((w(page).before ?? 0) + 1), { timeout: 2_000 });
	},
);

Then(
	"the card is marked new, and a second arrival a second later starts its own glow at once and leaves the first one's to end",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
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
		// A later batch is not queued behind marks still showing (ruling §3.2: 300 ms within a batch).
		// Inline: reduced motion (this suite's default) resets the computed delay.
		await expect(second).toHaveAttribute("style", /animation-delay: 0ms/);
		// The second arrival's refetch must not cancel the first card's 3 s mark.
		await expect(first).not.toHaveAttribute("data-new", "", { timeout: 4_000 });
	},
);

Given("the run has sent nothing for 5 minutes", async ({ page }) => {
	const run = await waitForRun(
		page,
		inc(page).id,
		(r) => !!r.lastEventAt,
		"a step",
	);
	const last = Date.parse(run.lastEventAt ?? "");
	// The browser's clock moves on; the server's record of the run stays put.
	await page.clock.setFixedTime(last + 5 * 60_000 + 30_000);
	w(page).boundary = Date.parse(run.createdAt);
});

Then(
	"the card's step line reads {string} in the warning colour",
	async ({ page }, _example: string) => {
		await openBoard(page);
		const step = cardOf(page, inc(page).title).getByTestId("card-step");
		const now = await page.evaluate(() => Date.now());
		const run = (await detail(page, inc(page).id)).investigations?.[0];
		const minutes = Math.floor(
			(now - Date.parse(run?.createdAt ?? "")) / 60_000,
		);
		const quiet = Math.floor(
			(now - Date.parse(run?.lastEventAt ?? "")) / 60_000,
		);
		await expect(step).toHaveText(
			`Working ${minutes}m, quiet for ${quiet} min`,
		);
		expect(quiet).toBe(5);
		const color = await step.evaluate((el) => getComputedStyle(el).color);
		const warn = await page.evaluate(() => {
			const probe = document.createElement("span");
			probe.style.color = "var(--warn)";
			document.body.append(probe);
			const c = getComputedStyle(probe).color;
			probe.remove();
			return c;
		});
		expect(color).toBe(warn);
	},
);

Given("the viewport is {int} px wide", async ({ page }, width: number) => {
	await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
	await openBoard(page);
});

Then(
	"the sidebar is a rail of icons and every card's title and service are readable, none cut to one letter",
	async ({ page }) => {
		const sidebar = page.getByTestId("sidebar");
		expect((await sidebar.boundingBox())?.width).toBeLessThanOrEqual(64);
		await expect(sidebar.getByText("Incidents", { exact: true })).toBeHidden();
		for (const card of (await page.getByTestId("board-card").all()).slice(
			0,
			12,
		)) {
			for (const id of ["card-title", "card-service"]) {
				const el = card.getByTestId(id);
				if ((await el.count()) === 0) continue;
				const box = await el.boundingBox();
				expect(box?.width ?? 0).toBeGreaterThan(80);
			}
		}
	},
);

Then(
	"the columns stack with their headings and nothing scrolls sideways",
	async ({ page }) => {
		const heads = page.getByTestId("board-column-heading");
		await expect(heads).toHaveCount(4);
		const boxes = await Promise.all(
			(await heads.all()).map((h) => h.boundingBox()),
		);
		const xs = new Set(boxes.map((b) => Math.round(b?.x ?? -1)));
		expect(xs.size).toBe(1);
		const ys = boxes.map((b) => b?.y ?? 0);
		expect([...ys].sort((a, b) => a - b)).toEqual(ys);
		expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
	},
);

Given(
	'the agent is ready and INC-1 is in "Concluded"',
	async ({ page, release }) => {
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
		await expect(
			cardOf(column(page, "Concluded"), inc(page).title),
		).toBeVisible();
	},
);

When(
	/^I drag (?:INC-1's|its) card to "([^"]+)"$/,
	async ({ page, hold }, col: string) => {
		hold(inc(page).title);
		await openBoard(page);
		await drag(page, cardOf(page, inc(page).title), column(page, col));
		// Read at once, not retried: the drop animation's copy lives ~250ms (#780).
		expect(await cardOf(page, inc(page).title).count()).toBe(1);
	},
);

Then(
	"a run starts at once and the card shows its step, with no form under the card",
	async ({ page }) => {
		const card = cardOf(column(page, "Working"), inc(page).title);
		await expect(card).toBeVisible({ timeout: 10_000 });
		await expect(card.getByTestId("card-step")).toBeVisible({
			timeout: 10_000,
		});
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect(page.getByTestId("composer-input")).toHaveCount(0);
	},
);

Given("INC-1 is Resolved", async ({ page }) => {
	const made = inc(page);
	const run = (await detail(page, made.id)).investigations?.[0];
	if (run && (run.status === "running" || run.status === "pending"))
		await page.request.post(`/api/investigations/${run.id}/cancel`);
	await waitForRun(
		page,
		made.id,
		(r) => r.status !== "running" && r.status !== "pending",
		"the run to end",
	);
	await resolveIncident(page, made.id, { actualCause: "pool capped at 10" });
});

Then("a dialog asks {string}", async ({ page }, question: string) => {
	const dialog = page.getByTestId("reopen-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText(
		question.replace("INC-1", `INC-${inc(page).number}`),
	);
});

When("I confirm the reopen", async ({ page }) => {
	await page.getByTestId("confirm-reopen-incident").click();
});

Then(
	'a toast reads "No run started" and the card no longer reads "Reopening"',
	async ({ page }) => {
		await expect(page.getByText("No run started").first()).toBeVisible();
		const card = cardOf(page, inc(page).title);
		await expect(card).toBeVisible();
		await expect(card).not.toContainText("Reopening", { timeout: 10_000 });
	},
);

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
		await tab.goto(`/incidents/${made.id}`);
		w(page).page = tab;
	},
);

When('I press "Acknowledge" in the band', async ({ page }) => {
	await here(page).getByTestId("band-acknowledge").click();
});

Then(
	'the band reads "Acknowledged" and the list shows INC-4 under Working',
	async ({ page }) => {
		const p = here(page);
		await expect(p.getByTestId("band-status")).toHaveText("Acknowledged");
		await p.getByTestId("incident-back").click();
		await expect.poll(() => new URL(p.url()).pathname).toBe("/incidents");
		await expect(cardOf(column(p, "Working"), inc(page).title)).toBeVisible();
	},
);

When("I open Incidents, Analytics", async ({ page }) => {
	await page.goto("/incidents?view=analytics");
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
		await page.goto("/incidents");
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
	'the board shows the card and one line above the columns reading "Setup, 3 of 4 done" with "Add a service"',
	async ({ page }) => {
		await expect(cardOf(page, inc(page).title)).toBeVisible();
		const line = page.getByTestId("setup-line");
		await expect(line).toContainText("Setup, 3 of 4 done");
		await expect(
			line.getByRole("link", { name: "Add a service" }),
		).toBeVisible();
		const lineBox = await line.boundingBox();
		const board = await page.getByTestId("incident-board").boundingBox();
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
		await page.goto("/incidents");
		const step = page.getByTestId("first-run-step-3");
		await expect(step).toContainText("PrismaLens looks for OpenCode");
		await expect(step.getByTestId("first-run-install").first()).toBeVisible();
	},
);

When(
	"I open an incident",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		const made = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("NoAgent"),
			service: QUIET,
			quiet: true,
		});
		await page.goto(`/incidents/${made.id}`);
	},
);

Then(
	'the box reads "No coding agent on this machine" with the install line, and "Start investigation" is withheld',
	async ({ page }) => {
		const box = page.getByTestId("docked-composer");
		await expect(box).toContainText("No coding agent on this machine");
		await expect(box).toContainText("Install one:");
		await expect(box.getByTestId("composer-investigate")).toBeDisabled();
	},
);

// --- Analytics -------------------------------------------------------------------

async function analyticsFor(page: Page) {
	await page.goto("/incidents?view=analytics");
	await page.getByTestId("board-search").fill(w(page).prefix ?? "");
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
	"I pick 24 hours on the board and switch to Analytics",
	async ({ page }) => {
		await page.goto("/incidents");
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
		await expect(column(page, "Needs you")).toBeVisible();
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
		await page.goto("/incidents?view=analytics");
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

When("I open INC-1 and each of its tabs in turn", async () => {
	// The Then walks the tabs; each one is read where it is shown.
});

Then("the band reads {string} on each", async ({ page }, action: string) => {
	for (const t of TABS) {
		await page.goto(`/incidents/${inc(page).id}${t}`);
		await expect(page.getByTestId("incident-state-band")).toBeVisible();
		await expect(
			page.getByTestId("incident-state-band").locator("[data-action]"),
		).toHaveText(action);
	}
});

When("I acknowledge", async ({ page }) => {
	await page.goto(`/incidents/${inc(page).id}`);
	await page.getByTestId("band-acknowledge").click();
	await expect(page.getByTestId("band-status")).toHaveText("Acknowledged");
});

Then(
	"the band reads {string} on every tab and never {string}",
	async ({ page }, action: string, never: string) => {
		for (const t of TABS) {
			await page.goto(`/incidents/${inc(page).id}${t}`);
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
		await page.goto(`/incidents/${made.id}`);
	},
);

When('I press "Resolve" in the band', async ({ page }) => {
	await page.getByTestId("band-resolve").click();
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
		await expect(page.getByTestId("band-status")).toHaveText("Resolved");
		await expect(page.getByTestId("band-reopen")).toHaveText("Reopen");
	},
);

Then(
	'the Overview shows "Cause" with the text and an "Edit" control',
	async ({ page }) => {
		await page.goto(`/incidents/${inc(page).id}`);
		const cause = page.getByTestId("actual-cause");
		await expect(cause).toContainText("Cause");
		await expect(cause.getByTestId("cause-text")).toContainText("d37d888");
		await expect(cause.getByTestId("edit-cause")).toHaveText("Edit");
	},
);

Then("the alert reads resolved with the incident", async ({ page }) => {
	const alert = (await detail(page, inc(page).id)).alerts?.[0];
	expect(alert?.status).toBe("resolved");
	await page.goto(`/alerts/${alert?.id}`);
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
	'the band reads "Alerts cleared" with "Resolve" as its action and the card sits in "Needs you"',
	async ({ page }) => {
		await page.goto(`/incidents/${inc(page).id}`);
		await expect(page.getByTestId("band-status")).toHaveText("Alerts cleared");
		await expect(page.getByTestId("band-resolve")).toHaveText("Resolve");
		await openBoard(page);
		await expect(
			cardOf(column(page, "Needs you"), inc(page).title),
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
	"within 2 seconds a new incident's card is in {string} reading {string}",
	async ({ page }, col: string, words: string) => {
		const made = inc(page);
		await openBoard(page);
		const cards = cardOf(column(page, col), made.title).filter({
			hasNot: page.getByText(`INC-${made.number}`, { exact: true }),
		});
		await expect(cards.first()).toBeVisible({ timeout: 2_000 });
		await expect(cards.first().getByTestId("card-lineage")).toHaveText(
			words.replace("INC-1", `INC-${made.number}`),
		);
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
	'INC-1 stays Resolved, and INC-1\'s card and Overview read "Fired again as INC-11, <time>"',
	async ({ page }) => {
		const made = inc(page);
		const refire = w(page).refire;
		const old = cardOf(column(page, "Resolved"), made.title).filter({
			has: page
				.getByTestId("card-id")
				.getByText(`INC-${made.number}`, { exact: true }),
		});
		const line = new RegExp(
			`^Fired again as INC-${refire?.number}, \\d\\d:\\d\\d$`,
		);
		await expect(old.getByTestId("card-lineage")).toHaveText(line);
		await page.goto(`/incidents/${made.id}`);
		await expect(page.getByTestId("band-status")).toHaveText("Resolved");
		await expect(page.getByTestId("incident-lineage")).toHaveText(line);
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
	"INC-1's card is in {string} reading {string} and the band reads {string}",
	async ({ page }, col: string, word: string, band: string) => {
		await waitFor(
			async () =>
				(await detail(page, inc(page).id)).status === "triggered"
					? true
					: undefined,
			"the flap to put it back",
		);
		await openBoard(page);
		await expect(
			cardOf(column(page, col), inc(page).title).getByTestId("card-word"),
		).toHaveText(word);
		await page.goto(`/incidents/${inc(page).id}`);
		await expect(page.getByTestId("band-status")).toHaveText(band);
	},
);

When('I press "Reopen" and confirm', async ({ page }) => {
	await page.goto(`/incidents/${inc(page).id}`);
	await page.getByTestId("band-reopen").click();
	await page.getByTestId("confirm-reopen-incident").click();
});

Then(
	'the band reads "Acknowledged", the Overview shows "Previous cause", and the card is in "Needs you" reading "Reopened by you, cause not confirmed"',
	async ({ page }) => {
		await expect(page.getByTestId("band-status")).toHaveText("Acknowledged");
		await expect(page.getByTestId("previous-cause")).toContainText(
			"Previous cause",
		);
		await openBoard(page);
		await expect(
			cardOf(column(page, "Needs you"), inc(page).title).getByTestId(
				"card-word",
			),
		).toHaveText("Reopened by you, cause not confirmed");
	},
);

When("I start a run from the box", async ({ page }) => {
	await page.goto(`/incidents/${inc(page).id}`);
	await page
		.getByTestId("composer-input")
		.fill("fake-session:live check the pool");
	await page.getByTestId("composer-investigate").click();
	await waitForRun(
		page,
		inc(page).id,
		(r) => r.status === "running",
		"the run",
	);
});

Then('the card moves to "Working"', async ({ page }) => {
	await openBoard(page);
	await expect(cardOf(column(page, "Working"), inc(page).title)).toBeVisible();
});
