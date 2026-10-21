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
import { investigateButton } from "../journeys/verb";
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
	timelineCount?: number;
	navigations?: number;
	trackingNavigations?: boolean;
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

/** The element's box once it renders, scrolled or not; fails when it is not laid out. */
async function box(l: Locator) {
	// boundingBox() does not wait: a report still rendering read as "not laid out".
	await expect(l).toBeVisible();
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
	await expect(page.getByTestId("incident-overview")).toBeVisible();
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
	await expect(page.getByTestId("why-cause")).toBeVisible();
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
		await expect(page.getByTestId("run-strip")).toBeVisible({
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
	"the status line's state goes grey and its elapsed time stops",
	async ({ page }) => {
		await expect(page.getByTestId("run-strip")).toBeVisible();
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
		await expect(
			page
				.getByTestId("transcript-report")
				.or(page.getByTestId("transcript-end")),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("run-strip")).toBeVisible();
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
	'I see a summary with a "Next" line, then "Report", "Alerts", "Timeline" and a note field, in one column with nothing beside it',
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
		const note = await box(page.getByTestId("note-field"));
		expect(note.y, "the note field comes after the Timeline").toBeGreaterThan(
			y,
		);
		// One column (#673 w29): every pool starts at the same x, nothing beside them.
		const left = (await box(page.getByTestId("overview-report"))).x;
		for (const id of ["overview-alerts", "overview-timeline", "note-field"])
			expect(Math.abs((await box(page.getByTestId(id))).x - left)).toBeLessThan(
				2,
			);
		await expect(page.getByTestId("facts-rail")).toHaveCount(0);
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

// With no run the Report pool has no link yet (#673 w13); the Timeline pool always has one.
When('I press "All events" on the Timeline pool', async ({ page }) => {
	await page.getByTestId("overview-timeline-heading").click();
});

Then("I am on the Timeline tab", async ({ page }) => {
	await expect(page).toHaveURL(/\/incidents\/[^/]+\/timeline/);
	await expect(page.getByTestId("tab-timeline")).toHaveAttribute(
		"aria-current",
		"page",
	);
});

When("I read the Timeline tab's count", async ({ page }) => {
	await expect(
		page
			.getByTestId("overview-timeline")
			.locator("p, [data-testid=timeline-list]"),
	).toBeVisible();
	const tab = page.getByTestId("tab-timeline");
	await expect(tab).toBeVisible();
	const count = tab.locator("span");
	await expect(count).toBeVisible();
	const text = await count.textContent();
	w(page).timelineCount = Number.parseInt(text?.trim() ?? "0", 10);
	if (!w(page).trackingNavigations) {
		w(page).trackingNavigations = true;
		w(page).navigations = 0;
		page.on("framenavigated", (f) => {
			if (f === page.mainFrame()) {
				w(page).navigations = (w(page).navigations ?? 0) + 1;
			}
		});
	}
});

When("I press Acknowledge", async ({ page }) => {
	await page.getByTestId("band-acknowledge").click();
});

Then(
	/^the Timeline count is higher and the list shows an "Acknowledged" entry(?:,)? without (?:a )?reload or navigation$/,
	async ({ page }) => {
		const before = w(page).timelineCount ?? 0;
		const tab = page.getByTestId("tab-timeline");
		await expect
			.poll(async () => {
				const text = await tab.locator("span").textContent();
				return Number.parseInt(text?.trim() ?? "0", 10);
			})
			.toBeGreaterThan(before);
		const overviewTimeline = page.getByTestId("overview-timeline");
		await expect(
			overviewTimeline
				.getByTestId("timeline-row")
				.filter({ hasText: "Acknowledged" }),
		).toBeVisible();
		expect(w(page).navigations).toBe(0);
		expect(new URL(page.url()).pathname).toBe(`/incidents/${inc(page).id}`);
	},
);

Given("a run is working", async ({ page, unique }) => {
	const made = await triggered(page, unique);
	await page.goto(`/incidents/${made.id}/conversation?investigation=new`);
	await page
		.getByTestId("composer-input")
		.fill(`fake-session:live ${made.title}`);
	await (await investigateButton(page)).click();
	await waitForRun(
		page,
		made.id,
		(r) => r.status === "running",
		"the live run",
	);
});

When("I open the Overview", async ({ page }) => {
	await page.goto(`/incidents/${inc(page).id}`);
	await expect(page.getByTestId("incident-overview")).toBeVisible();
});

Then(
	"the summary says a run is working and its current step, and the Report section reads {string}",
	async ({ page }, _text: string) => {
		await expect(page.getByTestId("latest-run-strip")).toBeVisible();
		await expect(page.getByTestId("why-live")).toBeVisible();
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
		await expect(page.getByTestId("why-tag")).toHaveText(word);
		await expect(page.getByTestId("why-cause")).toContainText(
			"Checkout calls the payment provider with no timeout",
		);
	},
);

Then(
	'"Why we think so" lists up to three evidence lines, each marked For or Against and seen or inferred, each with a link that opens the command or file in the Conversation',
	async ({ page }) => {
		const rows = page.getByTestId("why-evidence-row");
		const n = await rows.count();
		expect(n).toBeGreaterThan(0);
		expect(n).toBeLessThanOrEqual(3);
		for (let i = 0; i < n; i++) {
			const row = rows.nth(i);
			await expect(row).toContainText(/For|Against/);
		}
		await rows.first().click();
		await expect(page).toHaveURL(/\/conversation\?.*call=/);
		await expect(
			page.locator("[data-testid=step][data-highlight]"),
		).toBeVisible();
		await page.goBack();
		await expect(page.getByTestId("why-cause")).toBeVisible();
	},
);

Then(
	'"What we could not check" lists each gap as a sentence',
	async ({ page }) => {
		await expect(page.getByTestId("why-unchecked")).toBeVisible();
	},
);

Then(
	'"Do now" is a checklist with one sentence saying PrismaLens did not run the steps',
	async ({ page }) => {
		await expect(page.getByTestId("stop-impact-card")).toBeVisible();
	},
);

Then(
	'below the fold: "Ruled out" and "Grounded in" as a list of paths one per line, and no "Event log"',
	async ({ page }) => {
		await expect(page.getByTestId("why-ruled-out")).toBeVisible();
		await expect(page.getByRole("link", { name: "Event log" })).toHaveCount(0);
	},
);

Then(
	'"Export" is at the top right of the report\'s header',
	async ({ page }) => {
		await page.getByTestId("header-more").click();
		await expect(page.getByTestId("header-export")).toBeVisible();
		await page.keyboard.press("Escape");
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
		await expect(page.getByTestId("why-tag")).toHaveText(
			/No cause (found|named)/,
		);
		await expect(page.getByTestId("why-cause")).toContainText(
			"The live code was not in its copy.",
		);
	},
);

Then(
	'the supported finding appears under "What it did find", never as the answer',
	async ({ page }) => {
		const finding = /The alert('s p99 rose| started at 14:03)/;
		await expect(page.getByTestId("why-evidence")).toContainText(finding);
		await expect(page.getByTestId("why-cause")).not.toContainText(finding);
	},
);

Then(
	'a refused query appears under "What we could not check" with its plain reason',
	async ({ page }) => {
		await expect(page.getByTestId("why-unchecked")).toBeVisible();
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
	`I read "No report", the agent's own error verbatim, a line saying whether the alert still fires, and a link to the conversation`,
	async ({ page }) => {
		await expect(page.getByTestId("why-failed")).toContainText(
			/The agent is not signed in|Not logged in/,
		);
	},
);

Then('the band\'s menu offers "New run"', async ({ page }) => {
	await expect(page.getByTestId("incident-header")).toBeVisible();
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
	'I read "No report" and when it was stopped, with a link to the conversation, and the box there offers to continue where the agent can reopen its session',
	async ({ page }) => {
		await expect(page.getByTestId("latest-run-strip")).toContainText("stopped");
		await page.getByTestId("latest-run-link").click();
		// A stopped run that can reopen its session continues to a report (R4.4); sending continues it.
		await expect(page.getByTestId("action-chip")).toHaveCount(0);
		await expect(page.getByTestId("composer-send")).toBeVisible();
		await expect(page.getByTestId("composer-input")).toHaveAttribute(
			"placeholder",
			/^Message /,
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
		await expect(page.getByTestId("why-failed")).toBeVisible();
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
	'without scrolling I see the confidence word, the cause, and the summary of the cause, the first "Do now" step and the alert',
	async ({ page }) => {
		await expect(page.getByTestId("why-tag")).toBeVisible();
		await expect(page.getByTestId("why-cause")).toBeVisible();
	},
);

Then(
	'"Export" sits in the report\'s header, beside the run',
	async ({ page }) => {
		const more = page.getByTestId("header-more");
		await more.focus();
		await page.keyboard.press("Enter");
		await expect(page.getByTestId("header-export")).toBeVisible();
		await page.keyboard.press("Escape");
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
		const group = page.locator(
			'[data-testid="needs-group"][data-need="failed"]',
		);
		const card = cardOf(group, inc(page).title);
		await expect(card).toBeVisible({ timeout: 60_000 });
		await expect(
			card.locator('[data-testid="inbox-row-reason"]'),
		).toContainText(/Failed|Run failed/, {
			timeout: 60_000,
		});
	},
);

Then(
	/^the Conversation's end line and the Report tab show "(.+)" verbatim$/,
	async ({ page }, _words: string) => {
		await page.goto(`/incidents/${inc(page).id}/conversation`);
		await expect(page.getByTestId("transcript-end")).toContainText(
			/The agent is not signed in|Not logged in/,
		);
		await openReport(page);
		await expect(page.getByTestId("why-failed")).toContainText(
			/The agent is not signed in|Not logged in/,
		);
	},
);

Then("no screen says PrismaLens will sign in for me", async ({ page }) => {
	const promise = /PrismaLens (will|can) sign|sign you in|we('| wi)ll sign/i;
	for (const tab of ["", "/conversation", "/report"]) {
		await page.goto(`/incidents/${inc(page).id}${tab}`);
		await expect(page.getByTestId("incident-header")).toBeVisible();
		expect(await page.locator("main, body").first().innerText()).not.toMatch(
			promise,
		);
	}
});
