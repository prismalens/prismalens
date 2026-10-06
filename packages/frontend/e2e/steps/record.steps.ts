// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Steps for the @pr3 journeys design PR 3a builds (study-v3 §3.2, §3.3): the
 * record, the report's variants, connection lost and an agent that is not
 * signed in. Reports come from the fake agent's scripted sessions
 * (`scripts/fakes/sessions/`); nothing is written to the database.
 */

import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { Given, Then, When } from "./fixtures";
import {
	cardOf,
	detail,
	ensureService,
	fireIncident,
	incidentByTitle,
	LIVE,
	type Made,
	openBoard,
	waitForRun,
} from "./product";

interface World {
	inc?: Made;
	other?: Page;
	lastSeen?: string;
}
const worlds = new WeakMap<Page, World>();
const w = (page: Page): World => {
	let x = worlds.get(page);
	if (!x) {
		x = {};
		worlds.set(page, x);
	}
	return x;
};
const inc = (page: Page): Made => {
	const i = w(page).inc;
	if (!i) throw new Error("no incident was made for this scenario");
	return i;
};

const PAIRED_STATE = () =>
	join(process.env.PRISMALENS_E2E_WORKSPACE_DIR ?? "", "paired-state.json");

/** The element's box, scrolled or not; fails when it is not laid out. */
async function box(l: Locator) {
	const b = await l.boundingBox();
	if (!b) throw new Error("not laid out");
	return b;
}

/** A visible one among several matches (the share actions render per width). */
const shown = (l: Locator) => l.locator("visible=true").first();

async function reportFrom(
	page: Page,
	o: {
		name: string;
		session: "cause" | "nocause" | "not-signed-in" | "failure";
	},
	world: {
		alertmanager: Parameters<typeof fireIncident>[1];
		deliverWebhook: Parameters<typeof fireIncident>[2];
		unique: (n: string) => string;
	},
	done: (status: string) => boolean,
) {
	// fireIncident picks among product.ts's sessions; these reports have their own.
	await ensureService(page, { ...LIVE, trigger: "always" });
	const labels = {
		alertname: world.unique(o.name),
		severity: "critical",
		service: LIVE.name,
	};
	const listed = world.alertmanager.fire({
		labels,
		annotations: { summary: `fake-session:${o.session}` },
	});
	await world.deliverWebhook([listed.fingerprint]);
	const made = {
		...(await incidentByTitle(page, labels.alertname)),
		labels,
	};
	await waitForRun(
		page,
		made.id,
		(r) => done(r.status),
		`the ${o.session} run`,
	);
	w(page).inc = made;
	return made;
}

const finished = (s: string) => s === "completed";
const failed = (s: string) => s === "failed";

async function openReport(page: Page) {
	await page.goto(`/incidents/${inc(page).id}/report`);
	await expect(page.getByTestId("report-route")).toBeVisible();
}

async function ensureCauseReport(
	page: Page,
	fixtures: Parameters<typeof reportFrom>[2],
) {
	if (!w(page).inc)
		await reportFrom(
			page,
			{ name: "PaymentsCheckoutErrorRate", session: "cause" },
			fixtures,
			finished,
		);
	await openReport(page);
	await expect(page.getByTestId("report-answer")).toBeVisible();
}

// --- Shell and Back: connection lost ------------------------------------------

/**
 * The API going quiet, as the browser sees it: every /api call fails and the
 * open change stream breaks. `setOffline` leaves an open stream untouched, so
 * fetch is wrapped before the app loads; `window.__api.up()` undoes it.
 */
async function installApiSwitch(page: Page) {
	await page.addInitScript(() => {
		const original = window.fetch.bind(window);
		const open = new Set<ReadableStreamDefaultController<Uint8Array>>();
		let down = false;
		const w = window as unknown as { __api: { down(): void; up(): void } };
		w.__api = {
			down() {
				down = true;
				open.forEach((c) => {
					c.error(new TypeError("Failed to fetch"));
				});
				open.clear();
			},
			up() {
				down = false;
			},
		};
		window.fetch = async (input, init) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.href
						: input.url;
			if (down && url.includes("/api/")) throw new TypeError("Failed to fetch");
			const res = await original(input, init);
			if (!url.includes("/api/live/changes") || !res.body) return res;
			const reader = res.body.getReader();
			const body = new ReadableStream<Uint8Array>({
				start: (c) => {
					open.add(c);
				},
				pull: async (c) => {
					try {
						const { done, value } = await reader.read();
						if (done) c.close();
						else c.enqueue(value);
					} catch (e) {
						c.error(e);
					}
				},
				cancel: (r) => reader.cancel(r),
			});
			return new Response(body, { status: res.status, headers: res.headers });
		};
	});
}

Given(
	"the API stops answering while I am on INC-1's Conversation",
	async ({ page, unique }) => {
		const made = await incidentByTitle(
			page,
			unique("BooklogrApiLatencyP99High"),
		);
		w(page).inc = { ...made, labels: {} };
		// The service may start a run of its own on intake; let it end first.
		const settled = (s: string) => s !== "pending" && s !== "running";
		const runs = (await detail(page, made.id)).investigations ?? [];
		if (runs.length > 0)
			await waitForRun(
				page,
				made.id,
				(r) => settled(r.status),
				"the first run",
			);
		const res = await page.request.post(
			`/api/incidents/${made.id}/investigate`,
			{
				data: { brief: `fake-session:live hold on ${made.title}` },
			},
		);
		expect(res.ok(), await res.text()).toBe(true);
		const { investigationId } = (await res.json()) as {
			investigationId: string;
		};
		await waitForRun(
			page,
			made.id,
			(r) => r.status === "running",
			"the live run",
		);
		await installApiSwitch(page);
		// Pinned: a run the service started on intake must not be the one the strip follows.
		await page.goto(
			`/incidents/${made.id}/conversation?investigation=${investigationId}`,
		);
		await expect(page.getByTestId("run-strip-mark")).toBeVisible({
			timeout: 20_000,
		});
		await expect(page.getByTestId("transcript")).toContainText(
			"worker/consumer.py",
		);
		await page.evaluate(() =>
			(window as unknown as { __api: { down(): void } }).__api.down(),
		);
	},
);

Then(
	"within 10 seconds a line at the top of the page reads {string}",
	async ({ page }, text: string) => {
		const [lead] = text.split("<time>");
		const line = page.getByTestId("reconnect-line");
		await expect(line).toBeVisible({ timeout: 15_000 });
		await expect(line).toHaveText(
			new RegExp(`^${(lead ?? "").replace(/[.?]/g, "\\$&")}\\d\\d:\\d\\d\\.?$`),
		);
		const top = await box(line);
		expect(top.y).toBeLessThan(5);
	},
);

Then(
	"the run's mark goes grey and its elapsed time stops",
	async ({ page }) => {
		const strip = page.getByTestId("run-strip");
		await expect(strip).toHaveAttribute("data-disconnected", "");
		const mark = page.getByTestId("run-strip-mark");
		await expect(mark).toHaveClass(/bg-text-3/);
		const elapsed = page.getByTestId("run-strip-elapsed");
		await expect(elapsed).toHaveText(/^Last seen \d\d:\d\d$/);
		const before = await elapsed.textContent();
		await page.waitForTimeout(2_500);
		await expect(elapsed).toHaveText(before ?? "");
		w(page).lastSeen = before ?? "";
	},
);

When("the API answers again", async ({ page, release }) => {
	// The run goes on while the page cannot hear it; what it says arrives on reconnect.
	release(inc(page).title);
	await waitForRun(
		page,
		inc(page).id,
		(r) => r.status === "completed",
		"the report",
	);
	await page.evaluate(() =>
		(window as unknown as { __api: { up(): void } }).__api.up(),
	);
});

Then(
	"the line goes and the conversation shows what arrived meanwhile",
	async ({ page }) => {
		await expect(page.getByTestId("reconnect-line")).toBeHidden({
			timeout: 15_000,
		});
		await expect(page.getByTestId("transcript")).toContainText(
			"recent commits",
			{
				timeout: 15_000,
			},
		);
		await expect(page.getByTestId("transcript-end")).toContainText(
			"Report ready",
		);
		await expect(page.getByTestId("run-strip")).not.toHaveAttribute(
			"data-disconnected",
			"",
		);
	},
);

// --- Incident page ----------------------------------------------------------------

const triggered = async (page: Page, unique: (n: string) => string) => {
	const made = await incidentByTitle(page, unique("BandAction"));
	w(page).inc = { ...made, labels: {} };
	return made;
};

When("I open INC-1's Overview", async ({ page, unique }) => {
	const made = await triggered(page, unique);
	await page.goto(`/incidents/${made.id}`);
	await expect(page.getByTestId("incident-summary")).toBeVisible();
});

Then(
	'I see a summary with a "Next" line, then "Report", "Alerts", "Timeline" with a note field, and one details line',
	async ({ page }) => {
		await expect(page.getByTestId("incident-next")).toContainText("Next:");
		const order = [
			"incident-summary",
			"overview-report",
			"overview-alerts",
			"overview-timeline",
		];
		let y = -1;
		for (const id of order) {
			const b = await box(page.getByTestId(id));
			expect(b.y, `${id} comes after the one before`).toBeGreaterThan(y);
			y = b.y;
		}
		await expect(
			page.getByTestId("overview-timeline").getByTestId("note-field"),
		).toBeVisible();
		// Facts once (study-v3 §3.3): the rail from 1280, the details line below it.
		const rail = await page.getByTestId("facts-rail").isVisible();
		const line = await page.getByTestId("details-line").isVisible();
		expect([rail, line].filter(Boolean)).toHaveLength(1);
	},
);

Then(
	'no "See all", "Open conversation", "Details" or "Read the report" links',
	async ({ page }) => {
		const record = page.getByTestId("incident-record");
		for (const name of [
			"See all",
			"Open conversation",
			"Details",
			"Read the report",
		]) {
			await expect(record.getByRole("link", { name, exact: true })).toHaveCount(
				0,
			);
			await expect(
				record.getByRole("button", { name, exact: true }),
			).toHaveCount(0);
		}
	},
);

When('I press the "Report" heading', async ({ page }) => {
	await page.getByTestId("overview-report-heading").click();
});

Then("I am on the Report tab", async ({ page }) => {
	await expect(page).toHaveURL(/\/incidents\/[^/]+\/report/);
	await expect(page.getByTestId("tab-report")).toHaveAttribute(
		"aria-current",
		"page",
	);
});

Given("a run is working", async ({ page, unique }) => {
	const made = await triggered(page, unique);
	await page.goto(`/incidents/${made.id}`);
	await page
		.getByTestId("composer-input")
		.fill(`fake-session:live ${made.title}`);
	await page.getByTestId("composer-investigate").click();
	await waitForRun(
		page,
		made.id,
		(r) => r.status === "running",
		"the live run",
	);
});

When("I open the Overview", async ({ page }) => {
	await page.goto(`/incidents/${inc(page).id}`);
	await expect(page.getByTestId("incident-summary")).toBeVisible();
});

Then(
	"the summary says a run is working and its current step, and the Report section reads {string}",
	async ({ page }, text: string) => {
		await expect(page.getByTestId("incident-summary")).toContainText(
			/An investigation is working now: [^.]+\./,
			{ timeout: 15_000 },
		);
		await expect(page.getByTestId("overview-report")).toContainText(text);
	},
);

// --- Report ------------------------------------------------------------------------

Given(
	"INC-1's run finished naming {string}",
	async ({ page, alertmanager, deliverWebhook, unique }, cause: string) => {
		await reportFrom(
			page,
			{ name: "PaymentsCheckoutErrorRate", session: "cause" },
			{ alertmanager, deliverWebhook, unique },
			finished,
		);
		expect(cause).toBe("Checkout calls the payment provider with no timeout");
	},
);

When("I open the Report tab", async ({ page }) => {
	await openReport(page);
});

Then(
	/^the first thing I read is a confidence word \("(.+)"\) and the cause as a headline, with inline code rendered$/,
	async ({ page }, word: string) => {
		const answer = page.getByTestId("report-answer");
		await expect(page.getByTestId("report-answer-word")).toHaveText(word);
		await expect(page.getByTestId("report-headline")).toContainText(
			"Checkout calls the payment provider with no timeout",
		);
		await expect(
			page.getByTestId("report-headline").locator("code"),
		).toHaveText("timeout");
		// Nothing above the answer in the reading column at this width.
		const top = await box(answer);
		const col = await box(page.getByTestId("report-route"));
		expect(top.y - col.y).toBeLessThan(40);
	},
);

Then(
	'"Why we think so" lists up to three evidence lines, each marked For or Against and seen or inferred, each with a link that opens the command or file in the Conversation',
	async ({ page }) => {
		const rows = page.getByTestId("report-why").getByTestId("evidence-row");
		const n = await rows.count();
		expect(n).toBeGreaterThan(0);
		expect(n).toBeLessThanOrEqual(3);
		for (let i = 0; i < n; i++) {
			const row = rows.nth(i);
			const label =
				(await row.getByTestId("evidence-label").textContent()) ?? "";
			expect(label).toMatch(/^(For|Against), (seen|inferred)$/);
			// A line a tool showed links to its call; an inference has no single call.
			if (label.endsWith("seen"))
				await expect(row.getByTestId("evidence-open")).toBeVisible();
		}
		await rows.first().getByTestId("evidence-open").click();
		await expect(page).toHaveURL(/\/conversation\?.*call=/);
		await expect(
			page.locator("[data-testid=transcript-tools][data-cited]"),
		).toBeVisible();
		await page.goBack();
		await expect(page.getByTestId("report-answer")).toBeVisible();
	},
);

Then(
	'"What we could not check" lists each gap as a sentence',
	async ({ page }) => {
		const gaps = page.getByTestId("report-gaps").getByTestId("report-gap");
		expect(await gaps.count()).toBeGreaterThan(0);
		for (const text of await gaps.allTextContents())
			expect(text.trim()).toMatch(/\.( See the refusal)?$/);
	},
);

Then(
	'"Do now" is a checklist with one sentence saying PrismaLens did not run the steps',
	async ({ page }) => {
		const doNow = page.getByTestId("do-now");
		await expect(doNow).toContainText("PrismaLens did not run these.");
		expect(await doNow.getByTestId("do-now-check").count()).toBeGreaterThan(0);
	},
);

Then(
	'below the fold: "Ruled out", "Grounded in" as a list of paths one per line, and a run line with "Conversation" and "Event log"',
	async ({ page }) => {
		const ruled = page.getByTestId("report-ruled-out");
		await ruled.scrollIntoViewIfNeeded();
		await expect(ruled).toContainText("Ruled out");
		const rows = page.getByTestId("report-grounded-row");
		expect(await rows.count()).toBeGreaterThan(1);
		for (const r of await rows.all())
			expect((await box(r)).height).toBeLessThan(40);
		// From 1280 the rail carries the run line; below it, the line under the report.
		const line = shown(
			page
				.getByTestId("report-run-line")
				.or(page.getByTestId("report-rail-links")),
		);
		await expect(
			line.getByRole("link", { name: "Conversation" }),
		).toBeVisible();
		await expect(line.getByRole("link", { name: "Event log" })).toBeVisible();
	},
);

Then(
	'"Export Markdown" and "Post to GitHub" are at the top right',
	async ({ page }) => {
		const headline = await box(page.getByTestId("report-headline"));
		for (const id of ["export-report-markdown", "post-report-github"]) {
			const b = await box(shown(page.getByTestId(id)));
			expect(b.x, `${id} sits right of the answer`).toBeGreaterThan(
				headline.x + headline.width - 10,
			);
			expect(b.y + b.height, `${id} is on the first screen`).toBeLessThan(
				page.viewportSize()?.height ?? 720,
			);
		}
	},
);

Given(
	"the run finished with no root cause and one supported finding",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		await reportFrom(
			page,
			{ name: "BooklogrApiLatencyP99High", session: "nocause" },
			{ alertmanager, deliverWebhook, unique },
			finished,
		);
		await openReport(page);
	},
);

Then(
	'the first thing I read is "No cause found" and a headline saying what stopped it',
	async ({ page }) => {
		await expect(page.getByTestId("report-answer-word")).toHaveText(
			"No cause found",
		);
		await expect(page.getByTestId("report-headline")).toHaveText(
			"The run could not name a cause. The live code was not in its copy.",
		);
	},
);

Then(
	'the supported finding appears under "What it did find", never as the answer',
	async ({ page }) => {
		const finding = "The alert's p99 rose right after the 14:02 deploy";
		await expect(page.getByTestId("report-found")).toContainText(
			"What it did find",
		);
		await expect(page.getByTestId("report-found")).toContainText(finding);
		await expect(page.getByTestId("report-headline")).not.toContainText(
			finding,
		);
	},
);

Then(
	'a refused query appears under "What we could not check" with its plain reason',
	async ({ page }) => {
		const gap = page
			.getByTestId("report-gap")
			.filter({ hasText: "metrics.elsewhere.example" });
		await expect(gap).toContainText(
			/Not run: it (sends a request body|reaches a host outside the brief)\./,
		);
	},
);

Given(
	/^the run failed with "(.+)"$/,
	async ({ page, alertmanager, deliverWebhook, unique }, _error: string) => {
		await reportFrom(
			page,
			{ name: "BooklogrDbPoolExhausted", session: "not-signed-in" },
			{ alertmanager, deliverWebhook, unique },
			failed,
		);
	},
);

Then(
	`I read "No report", the agent's own error verbatim, a line saying whether the alert still fires, and "Event log"`,
	async ({ page }) => {
		const empty = page.getByTestId("report-empty");
		await expect(empty).toContainText("No report");
		await expect(page.getByTestId("report-error")).toHaveText(
			"Not logged in. Run claude /login",
		);
		await expect(page.getByTestId("report-now")).toContainText(
			/still firing since \d\d:\d\d/,
		);
		await expect(empty.getByRole("link", { name: "Event log" })).toBeVisible();
	},
);

Then('the box offers "Investigate again"', async ({ page }) => {
	await expect(page.getByTestId("composer-investigate")).toHaveText(
		"Investigate again",
	);
});

Given(
	"the run was stopped",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		const made = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("StoppedRun"),
			service: LIVE,
			session: "live",
		});
		w(page).inc = made;
		const running = await waitForRun(
			page,
			made.id,
			(r) => r.status === "running",
			"the live run",
		);
		// claude-agent-acp resumes (@prismalens/config harness.ts), so cancelling
		// a real run here, rather than mocking the status, exercises the same
		// resumable computation a reopened session relies on (#747).
		const res = await page.request.post(
			`/api/investigations/${running.id}/cancel`,
		);
		expect(res.ok(), await res.text()).toBe(true);
		await waitForRun(
			page,
			made.id,
			(r) => r.status === "cancelled",
			"the stopped run",
		);
	},
);

Then(
	'I read "No report" and when it was stopped, with "Conversation" and "Event log", and the box offers to continue where the agent can reopen its session',
	async ({ page }) => {
		const empty = page.getByTestId("report-empty");
		await expect(empty.getByRole("heading")).toHaveText(
			/^No report\. You stopped the run at \d\d:\d\d after .+\.$/,
		);
		await expect(
			empty.getByRole("link", { name: "Conversation" }),
		).toBeVisible();
		await expect(empty.getByRole("link", { name: "Event log" })).toBeVisible();
		// A stopped run that can reopen its session continues to a report (R4.4).
		await expect(
			page.getByTestId("composer-box").locator("[data-mode]"),
		).toHaveAttribute("data-mode", "continue");
		await expect(page.getByTestId("composer-investigate")).toHaveCount(0);
		await expect(page.getByTestId("composer-input")).toHaveAttribute(
			"placeholder",
			"Continue the investigation",
		);
	},
);

Given(
	"the run failed after 9 minutes with findings in the conversation",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		await reportFrom(
			page,
			{ name: "BooklogrQueueLag", session: "failure" },
			{ alertmanager, deliverWebhook, unique },
			failed,
		);
	},
);

Then(
	/^I read "No report\. The run failed after 9m\." and how many commands and files it got through, with a link to the Conversation$/,
	async ({ page }) => {
		// The fake fails seconds in, not nine minutes; the sentence carries the real elapsed time.
		const empty = page.getByTestId("report-empty");
		await expect(empty.getByRole("heading")).toHaveText(
			/^No report\. The run failed after \d+(s|m \d\ds)\.$/,
		);
		await expect(empty).toContainText("It ran 1 command before it stopped");
		await expect(
			empty.getByRole("link", { name: "Conversation" }).first(),
		).toBeVisible();
	},
);

Given(
	"a phone at 390 px and INC-1's report names a cause",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await reportFrom(
			page,
			{ name: "PaymentsCheckoutErrorRate", session: "cause" },
			{ alertmanager, deliverWebhook, unique },
			finished,
		);
	},
);

Then(
	'without scrolling I see the confidence word, the cause, a line saying whether the alert still fires, and the first "Do now" step',
	async ({ page }) => {
		const boxTop = (await box(page.getByTestId("composer-box"))).y;
		const ids = ["report-answer-word", "report-headline", "report-now"];
		for (const id of ids) {
			const b = await box(page.getByTestId(id));
			expect(b.y + b.height, `${id} is above the box`).toBeLessThanOrEqual(
				boxTop,
			);
			expect(b.y, `${id} is on screen`).toBeGreaterThanOrEqual(0);
		}
		const first = await box(page.getByTestId("do-now-step").first());
		expect(
			first.y + first.height,
			"the first step is above the box",
		).toBeLessThanOrEqual(boxTop);
		const scrolled = await page
			.getByTestId("report-route")
			.evaluate((el) => el.scrollTop);
		expect(scrolled).toBe(0);
	},
);

Then(
	'"Export" and "Post to GitHub" are not above the answer',
	async ({ page }) => {
		const answer = await box(page.getByTestId("report-answer"));
		for (const id of ["export-report-markdown", "post-report-github"]) {
			for (const b of await page.getByTestId(id).locator("visible=true").all())
				expect((await box(b)).y, `${id} is below the answer`).toBeGreaterThan(
					answer.y,
				);
		}
	},
);

// Tagged: shell.steps' generic `I press {string}` would otherwise match it too.
When(
	'I press "Copy fix brief for your agent"',
	{ tags: "@pr3" },
	async ({ page, alertmanager, deliverWebhook, unique, context }) => {
		await context.grantPermissions(["clipboard-read", "clipboard-write"]);
		await ensureCauseReport(page, { alertmanager, deliverWebhook, unique });
		await shown(
			page.getByRole("button", { name: "Copy fix brief for your agent" }),
		).click();
		await expect(shown(page.getByTestId("copy-fix-brief"))).toHaveText(
			"Copied",
		);
	},
);

Then(
	"the clipboard holds the cause, the commit, the evidence sources and the open steps as text",
	async ({ page }) => {
		const text = await page.evaluate(() => navigator.clipboard.readText());
		expect(text).toContain(
			"Cause (Likely): Checkout calls the payment provider with no `timeout`",
		);
		expect(text).toContain("Commit: 7f3c2a1");
		expect(text).toContain("api/payments/provider.py:48");
		expect(text).toMatch(/Open steps:\n1\. Map Booklogr API to its repository/);
		expect(text).toContain(
			"Roll back 7f3c2a1 or set a 5 s timeout on the provider call",
		);
	},
);

Given("the report's first step is {string}", async ({ page }, step: string) => {
	await expect(page.getByTestId("do-now-step").first()).toContainText(step);
});

Then(
	"that step is a link to the service page, not a checkbox",
	async ({ page }) => {
		const first = page.getByTestId("do-now-step").first();
		await expect(first).toHaveAttribute("data-kind", "link");
		await expect(first.getByRole("checkbox")).toHaveCount(0);
		await first.getByTestId("do-now-service-link").click();
		await expect(page).toHaveURL(/\/services\/[^/]+$/);
	},
);

When(
	'I tick the first "Do now" step',
	async ({ page, browser, alertmanager, deliverWebhook, unique }) => {
		await ensureCauseReport(page, { alertmanager, deliverWebhook, unique });
		// The other browser is open on the same report before the tick.
		const ctx = await browser.newContext({ storageState: PAIRED_STATE() });
		const other = await ctx.newPage();
		await other.goto(`/incidents/${inc(page).id}/report`);
		await expect(other.getByTestId("do-now-check").first()).toBeVisible();
		await other.waitForTimeout(1_000);
		w(page).other = other;
		await page.getByTestId("do-now-check").first().click();
	},
);

Then(
	'the heading reads {string} and "Done by you at <time>"',
	async ({ page }, count: string) => {
		await expect(page.getByTestId("do-now-count")).toHaveText(count);
		await expect(page.getByTestId("do-now-step").nth(1)).toContainText(
			/Done by you at \d\d:\d\d/,
		);
	},
);

Then(
	"another paired browser sees the tick without a reload",
	async ({ page }) => {
		const other = w(page).other;
		if (!other) throw new Error("no second browser");
		let navigations = 0;
		other.on("framenavigated", (f) => {
			if (f === other.mainFrame()) navigations += 1;
		});
		await expect(other.getByTestId("do-now-check").first()).toHaveAttribute(
			"data-state",
			"checked",
			{ timeout: 5_000 },
		);
		await expect(other.getByTestId("do-now-count")).toHaveText("1 of 3 done");
		expect(navigations).toBe(0);
		await other.context().close();
	},
);

// --- Agent not signed in --------------------------------------------------------------

Given(
	"Claude Code is installed and not signed in",
	async ({ page, agents }) => {
		agents.install(["claude-agent-acp"], "not-signed-in");
		const res = await page.request.patch("/api/settings/harness", {
			data: { harness: "claude-code" },
		});
		expect(res.ok(), await res.text()).toBe(true);
	},
);

When(
	"a run starts on it",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		const made = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("ClaudeNotSignedIn"),
			service: LIVE,
		});
		w(page).inc = made;
	},
);

Then(
	'within a minute the card is in "Needs you" reading "Run failed"',
	async ({ page }) => {
		await waitForRun(
			page,
			inc(page).id,
			(r) => r.status === "failed",
			"the failed run",
		);
		await openBoard(page);
		const card = cardOf(
			page.getByTestId("board-column-needs_you"),
			inc(page).title,
		);
		await expect(card.getByTestId("card-word")).toHaveText("Run failed", {
			timeout: 60_000,
		});
	},
);

Then(
	/^the Conversation's end line and the Report tab show "(.+)" verbatim$/,
	async ({ page }, words: string) => {
		await page.goto(`/incidents/${inc(page).id}/conversation`);
		await expect(page.getByTestId("transcript-end")).toContainText(words);
		await openReport(page);
		await expect(page.getByTestId("report-error")).toHaveText(words);
	},
);

Then("no screen says PrismaLens will sign in for me", async ({ page }) => {
	const promise = /PrismaLens (will|can) sign|sign you in|we('| wi)ll sign/i;
	for (const tab of ["", "/conversation", "/report"]) {
		await page.goto(`/incidents/${inc(page).id}${tab}`);
		await expect(page.getByTestId("incident-state-band")).toBeVisible();
		expect(await page.locator("main, body").first().innerText()).not.toMatch(
			promise,
		);
	}
});
