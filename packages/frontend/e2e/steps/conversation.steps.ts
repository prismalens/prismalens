// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Steps for the @pr3 journeys design PR 3b builds (study-v3 §3.4, R4.2–R4.4):
 * the box, the conversation, Stop then continue, the model reaching the agent,
 * attachments and two devices. Every run is the fake agent replaying a script
 * (`scripts/fakes/sessions/`); `live` and `tools` hold their first turn until
 * the test releases the incident's title.
 */

import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import type { FakeAlertmanager } from "../../../../scripts/fakes/fake-alertmanager.mjs";
import { Given, Then, When } from "./fixtures";
import {
	detail,
	ensureService,
	incidentByTitle,
	LIVE,
	type Made,
	sidewaysOverflow,
	waitFor,
	waitForRun,
} from "./product";

interface World {
	inc?: Made;
	phone?: Page;
	report?: string;
	uploads?: number;
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

type Fire = {
	alertmanager: FakeAlertmanager;
	deliverWebhook: (only?: string[]) => Promise<void>;
	unique: (n: string) => string;
};

/** An alert on the live service whose run replays `session`, and its incident. */
async function runOn(page: Page, f: Fire, name: string, session: string) {
	await ensureService(page, { ...LIVE, trigger: "always" });
	const labels = {
		alertname: f.unique(name),
		severity: "critical",
		service: LIVE.name,
	};
	const listed = f.alertmanager.fire({
		labels,
		annotations: { summary: `fake-session:${session}` },
	});
	await f.deliverWebhook([listed.fingerprint]);
	const made = { ...(await incidentByTitle(page, labels.alertname)), labels };
	w(page).inc = made;
	await waitForRun(page, made.id, (r) => r.status === "running", "the run");
	return made;
}

async function runId(page: Page): Promise<string> {
	const run = (await detail(page, inc(page).id)).investigations?.[0];
	if (!run) throw new Error("no run on the incident");
	return run.id;
}

async function toolResults(page: Page): Promise<number> {
	const res = await page.request.get(
		`/api/investigations/${await runId(page)}/events?limit=200`,
	);
	const { events } = (await res.json()) as { events: { kind: string }[] };
	return events.filter((e) => e.kind === "tool_result").length;
}

/**
 * A cold page on the dev server fetches ~350 modules before the route renders:
 * about 2 s here, past 5 s on a loaded CI runner (#786), so first paint gets longer.
 */
const FIRST_PAINT = { timeout: 15_000 };

/** An incident's page, once its frame has painted. */
async function visit(page: Page, path: string) {
	await page.goto(path);
	await expect(page.getByTestId("incident-record-frame")).toBeVisible(
		FIRST_PAINT,
	);
}

async function openConversation(page: Page) {
	await visit(page, `/incidents/${inc(page).id}/conversation`);
	await expect(page.getByTestId("conversation-route")).toBeVisible();
}

const box = (page: Page) => page.getByTestId("composer-input");
const strip = (page: Page) => page.getByTestId("run-strip-state");

async function check(page: Page, id: string) {
	const res = await page.request.post("/api/settings/harness/check", {
		data: { id },
	});
	expect(res.ok(), await res.text()).toBe(true);
}

async function pick(page: Page, harness: string, model?: string) {
	const res = await page.request.patch("/api/settings/harness", {
		data: { harness, ...(model ? { models: { [harness]: model } } : {}) },
	});
	expect(res.ok(), await res.text()).toBe(true);
}

/** A file pasted into the box, the way a screenshot arrives from the clipboard. */
async function pasteFile(
	page: Page,
	file: { name: string; type: string; base64: string },
) {
	await box(page).evaluate((el, f) => {
		const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
		const data = new DataTransfer();
		data.items.add(new File([bytes], f.name, { type: f.type }));
		el.dispatchEvent(
			new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
		);
	}, file);
}

const PNG = {
	name: "panel.png",
	type: "image/png",
	// A 1x1 transparent PNG.
	base64:
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
};

// --- Incident page -----------------------------------------------------------------

When(
	"I type {string} in the box and press {string}",
	async ({ page, unique }, text: string, button: string) => {
		const made = await incidentByTitle(page, unique("BandAction"));
		w(page).inc = { ...made, labels: {} };
		await visit(page, `/incidents/${made.id}`);
		// The script name rides in the brief so the run holds for the Then.
		await box(page).fill(`${text} fake-session:live`);
		await expect(page.getByTestId("composer-investigate")).toHaveText(button);
		await page.getByTestId("composer-investigate").click();
		await waitForRun(page, made.id, (r) => r.status === "running", "the run");
	},
);

Then(
	'the run strip reads "Working" with the agent and model',
	async ({ page }) => {
		await expect(strip(page)).toHaveText("Working");
		await expect(page.getByTestId("run-strip")).toContainText("OpenCode");
	},
);

Then(
	'the box reads "Message the agent" with one Stop button',
	async ({ page }) => {
		await expect(box(page)).toHaveAttribute("placeholder", "Message the agent");
		await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(1);
		await expect(page.getByTestId("composer-stop")).toBeVisible();
	},
);

// --- Conversation ------------------------------------------------------------------

Given(
	"a paired browser at 1440 px and INC-1 has a run in progress",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await runOn(
			page,
			{ alertmanager, deliverWebhook, unique },
			"BooklogrLibraryPageSlow",
			"tools",
		);
		await waitFor(
			async () => ((await toolResults(page)) >= 4 ? true : undefined),
			"the run's four tool calls",
		);
		await openConversation(page);
	},
);

When("I expand {string}", async ({ page }, _label: string) => {
	const tools = page.getByTestId("transcript-tools").first();
	await expect(tools).toContainText(/ran \d+ commands?/i);
	await tools.getByRole("button").first().click();
	await expect(page.getByTestId("tool-command").first()).toBeVisible();
});

Then(
	"each row shows the command or path that ran, such as {string} or {string}",
	async ({ page }, command: string, path: string) => {
		const rows = page.getByTestId("tool-command");
		await expect(rows.filter({ hasText: command })).toHaveCount(1);
		await expect(
			rows.filter({ hasText: path.replace("read ", "read repo/") }),
		).toHaveCount(1);
	},
);

Then(
	"no row shows {string} or {string}",
	async ({ page }, a: string, b: string) => {
		const text = await page.getByTestId("transcript").innerText();
		expect(text).not.toContain(a);
		expect(text).not.toContain(b);
	},
);

Then(
	"the run's workspace path appears as {string}",
	async ({ page }, repo: string) => {
		const text = await page.getByTestId("transcript").innerText();
		expect(text).toContain(`${repo}api/models.py`);
		expect(text).not.toMatch(/\/runs\/[0-9a-f-]{36}\//);
	},
);

Then(
	"a refused call reads {string} followed by a plain reason",
	async ({ page }, prefix: string) => {
		await expect(page.getByTestId("tool-refused").first()).toHaveText(
			`${prefix} it reaches a host outside the brief.`,
		);
	},
);

Then(
	"neither the page nor the transcript scrolls sideways at 1440, 1024 or 390 px",
	async ({ page }) => {
		for (const width of [1440, 1024, 390]) {
			await page.setViewportSize({ width, height: 900 });
			await expect.poll(() => sidewaysOverflow(page)).toBe(0);
			const scroller = page.getByTestId("transcript-scroller");
			const over = await scroller.evaluate(
				(el) => el.scrollWidth - el.clientWidth,
			);
			expect(over, `transcript at ${width}`).toBeLessThanOrEqual(0);
		}
	},
);

Given(
	"the agent wrote {string} and a {string} heading",
	async ({ page }, _bold: string, _heading: string) => {
		await expect(page.getByTestId("transcript-prose").first()).toBeVisible();
	},
);

Then(
	"I see bold {string}, inline code {string} and a heading {string}",
	async ({ page }, bold: string, code: string, heading: string) => {
		const prose = page.getByTestId("transcript-prose").first();
		await expect(prose.locator("strong")).toHaveText(bold);
		await expect(prose.locator("code").first()).toHaveText(code);
		await expect(prose.locator("h4")).toHaveText(heading);
		await expect(prose).not.toContainText("**");
		await expect(prose).not.toContainText("###");
	},
);

When("I type {string} and press Enter", async ({ page }, text: string) => {
	await box(page).fill(text);
	await box(page).press("Enter");
});

Then(
	'my message shows as "You" with "Delivered at the next pause", and the agent answers it after its current step',
	async ({ page, release }) => {
		const mine = page.getByTestId("transcript-operator").last();
		await expect(mine).toContainText("You");
		await expect(mine.getByTestId("transcript-delivery")).toHaveText(
			"Waits for the next pause",
		);
		release(inc(page).title);
		await expect(mine.getByTestId("transcript-delivery")).toHaveText(
			"Delivered at the next pause",
		);
		const text = await mine.locator("p").first().innerText();
		await expect(
			page
				.getByTestId("transcript-prose")
				.filter({ hasText: `On your question (${text})` }),
		).toBeVisible();
	},
);

When(
	"I type {string} and press {string}",
	async ({ page }, text: string, button: string) => {
		await box(page).fill(text);
		await page.getByRole("button", { name: button }).click();
	},
);

Then(
	"the agent's current step ends and my message is answered next",
	async ({ page }) => {
		const mine = page.getByTestId("transcript-operator").last();
		await expect(mine.getByTestId("transcript-delivery")).toHaveText(
			"Sent now",
		);
		await expect(
			page
				.getByTestId("transcript-prose")
				.filter({ hasText: "On your question (Only the 14:02 deploy)" }),
		).toBeVisible();
	},
);

Then(
	'the box shows "Stop" as a word while the agent works, and no key names anywhere on screen',
	async ({ page }) => {
		await expect(strip(page)).toHaveText("Working");
		await expect(page.getByTestId("composer-stop")).toHaveText("Stop");
		await expect(page.locator("kbd:visible")).toHaveCount(0);
		await expect(page.locator("body")).not.toContainText(
			/Ctrl ?Enter|Shift ?Enter/,
		);
	},
);

Given("the agent is working and the box has focus", async ({ page }) => {
	await expect(strip(page)).toHaveText("Working");
	await box(page).focus();
});

When("I press Escape", async ({ page }) => {
	await page.keyboard.press("Escape");
});

Then(
	'the run strip reads "Stopped by you" and I am still on the Conversation',
	async ({ page }) => {
		await expect(strip(page)).toHaveText("Stopped by you");
		await expect(page).toHaveURL(/\/conversation/);
	},
);

Given("the box has no focus", async ({ page }) => {
	await box(page).blur();
	await expect(box(page)).not.toBeFocused();
});

Then(
	"the Conversation header shows no {string} control",
	async ({ page }, _control: string) => {
		const route = page.getByTestId("conversation-route");
		await expect(route.getByText("Ledger", { exact: true })).toHaveCount(0);
		await expect(route.getByText("Transcript", { exact: true })).toHaveCount(0);
	},
);

When("the run ends", async ({ page, release }) => {
	release(inc(page).title);
	await waitForRun(
		page,
		inc(page).id,
		(r) => r.status === "completed",
		"the run's end",
	);
});

Then('the end line offers "Event log"', async ({ page }) => {
	const end = page.getByTestId("transcript-end");
	await expect(end).toContainText("Report ready");
	await end.getByRole("link", { name: "Event log" }).click();
	await expect(page.getByTestId("investigation-panel")).toBeVisible();
});

// --- Stop then continue --------------------------------------------------------------

Given(
	"a paired browser at 1440 px and INC-1 has a run in progress on OpenCode",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await runOn(
			page,
			{ alertmanager, deliverWebhook, unique },
			"BooklogrCacheMissSpike",
			"live",
		);
		await waitFor(
			async () => ((await toolResults(page)) >= 1 ? true : undefined),
			"the run's first tool call",
		);
		await openConversation(page);
		await expect(page.getByTestId("run-strip")).toContainText("OpenCode");
	},
);

When('I press "Stop" in the box', async ({ page }) => {
	await page.getByTestId("composer-stop").click();
});

Then(
	'the run strip reads "Stopped by you" and the conversation ends with "Stopped by you at <time> after <elapsed>" with "Event log", and no "Failed"',
	async ({ page }) => {
		await expect(strip(page)).toHaveText("Stopped by you");
		const end = page.getByTestId("transcript-end");
		await expect(end).toContainText(
			/^Stopped by you at \d\d:\d\d after \d+[sm][^.]*\./,
		);
		await expect(end.getByRole("link", { name: "Event log" })).toBeVisible();
		await expect(page.getByTestId("transcript")).not.toContainText("Failed");
	},
);

Then("nothing counts down or waits", async ({ page }) => {
	const elapsed = page.getByTestId("run-strip-elapsed");
	const first = await elapsed.innerText();
	await page.waitForTimeout(2_000);
	await expect(elapsed).toHaveText(first);
	await expect(page.getByTestId("composer-stop")).toHaveCount(0);
	await expect(page.getByTestId("transcript")).not.toContainText(
		/Stopping|resum/i,
	);
});

Given(
	"INC-1's run was stopped and OpenCode can reopen it",
	async ({ page }) => {
		await page.getByTestId("composer-stop").click();
		await expect(strip(page)).toHaveText("Stopped by you");
	},
);

Then(
	'the box reads "Continue the investigation" and no note explains it',
	async ({ page }) => {
		await expect(box(page)).toHaveAttribute(
			"placeholder",
			"Continue the investigation",
		);
		// The placeholder names what the box does; explaining copy is gone (look ruling L43).
		await expect(page.getByTestId("composer-note")).toHaveCount(0);
	},
);

Then(
	'the strip reads "Working" and the agent\'s next message answers with what it had already found',
	async ({ page }) => {
		await expect(
			page
				.getByTestId("transcript-prose")
				.filter({ hasText: "the index drop is still the only change" }),
		).toBeVisible();
		// The continued run is the run again, so the strip went live before its report.
		const run = (await detail(page, inc(page).id)).investigations?.[0];
		expect(["running", "completed"]).toContain(run?.status);
	},
);

When("the run finishes", async ({ page }) => {
	await waitForRun(
		page,
		inc(page).id,
		(r) => r.status === "completed",
		"the continued run's report",
	);
});

Then("the Report tab shows a report", async ({ page }) => {
	await page.getByTestId("tab-report").click();
	await expect(page.getByTestId("report-answer")).toBeVisible();
});

Given("INC-1's run finished with a report", async ({ page, release }) => {
	release(inc(page).title);
	await waitForRun(
		page,
		inc(page).id,
		(r) => r.status === "completed",
		"the report",
	);
	const res = await page.request.get(
		`/api/investigations/${await runId(page)}`,
	);
	w(page).report = JSON.stringify(
		((await res.json()) as { report: unknown }).report,
	);
	await openConversation(page);
});

When(
	"I send {string} from the box reading {string}",
	async ({ page }, text: string, placeholder: string) => {
		await expect(box(page)).toHaveAttribute("placeholder", placeholder);
		await box(page).fill(text);
		await box(page).press("Enter");
	},
);

Then(
	"the agent answers in the conversation and the report is unchanged",
	async ({ page }) => {
		await expect(
			page
				.getByTestId("transcript-prose")
				.filter({ hasText: "On your question (Why the 14:02 deploy?)" }),
		).toBeVisible();
		const res = await page.request.get(
			`/api/investigations/${await runId(page)}`,
		);
		const now = JSON.stringify(
			((await res.json()) as { report: unknown }).report,
		);
		expect(now).toBe(w(page).report);
	},
);

Given(
	"the run was on deepagents and was stopped",
	async ({ page, agents, alertmanager, deliverWebhook, unique }) => {
		agents.install(["dcode"], "live");
		await pick(page, "deepagents");
		await runOn(
			page,
			{ alertmanager, deliverWebhook, unique },
			"DeepagentsStopped",
			"live",
		);
		const res = await page.request.post(
			`/api/investigations/${await runId(page)}/cancel`,
		);
		expect(res.ok(), await res.text()).toBe(true);
		await waitForRun(
			page,
			inc(page).id,
			(r) => r.status === "cancelled",
			"the stopped run",
		);
		await openConversation(page);
	},
);

Then(
	'the box reads "Brief a new investigation" with "Investigate again" and a note saying deepagents cannot reopen a finished session',
	async ({ page }) => {
		await expect(box(page)).toHaveAttribute(
			"placeholder",
			"Brief a new investigation",
		);
		await expect(page.getByTestId("composer-investigate")).toHaveText(
			"Investigate again",
		);
		await expect(page.getByTestId("composer-note")).toContainText(
			"deepagents can't reopen a finished session",
		);
	},
);

// --- Agent controls ------------------------------------------------------------------

Given(
	"Codex is picked with {string}",
	async ({ page, agents, unique }, model: string) => {
		agents.install(["codex-acp"], "codex");
		await check(page, "codex");
		await pick(page, "codex", model.toLowerCase());
		const made = await incidentByTitle(page, unique("BandAction"));
		w(page).inc = { ...made, labels: {} };
	},
);

When("a run starts", async ({ page }) => {
	await visit(page, `/incidents/${inc(page).id}`);
	await page.getByTestId("composer-investigate").click();
	await waitForRun(
		page,
		inc(page).id,
		(r) => r.status === "completed" || r.status === "failed",
		"the Codex run",
	);
});

Then(
	"the report's run line names {string} and the event log shows the agent accepting it before the first prompt",
	async ({ page }, model: string) => {
		const run = (await detail(page, inc(page).id)).investigations?.[0];
		expect(run?.status).toBe("completed");
		await visit(page, `/incidents/${inc(page).id}/report`);
		await expect(page.getByTestId("report-route")).toContainText(model);
		await visit(page, `/incidents/${inc(page).id}/conversation?ledger=1`);
		const panel = page.getByTestId("investigation-stream-panel");
		await expect(panel).toContainText(
			`The agent took model ${model.toLowerCase()} before the first prompt`,
		);
		// It is the first thing the run did: before any of the agent's own words.
		const first = panel.getByTestId("stream-event-row").first();
		await expect(first).toContainText("The agent took model");
	},
);

Given("the agent will not take the model", async ({ page }) => {
	await pick(page, "codex", "gpt-9");
	// The finished run takes follow-ups in the box, so the new run starts as the band would.
	const res = await page.request.post(
		`/api/incidents/${inc(page).id}/investigate`,
		{ data: {} },
	);
	expect(res.ok(), await res.text()).toBe(true);
	await waitForRun(
		page,
		inc(page).id,
		(r) => r.status === "failed",
		"the refused run",
	);
});

Then(
	"the run does not start and the box says which models it offered",
	async ({ page }) => {
		await visit(page, `/incidents/${inc(page).id}`);
		await expect(page.getByTestId("composer-note")).toHaveText(
			"Codex would not switch to gpt-9; it offered gpt-5.6",
		);
		const res = await page.request.get(
			`/api/investigations/${await runId(page)}/events?limit=200`,
		);
		const { events } = (await res.json()) as { events: { kind: string }[] };
		expect(events.some((e) => e.kind === "agent_step")).toBe(false);
	},
);

When(
	"I paste a screenshot into the box while Claude Code is picked",
	async ({ page, unique }) => {
		await check(page, "claude-code");
		await pick(page, "claude-code");
		const made = await incidentByTitle(page, unique("BandAction"));
		w(page).inc = { ...made, labels: {} };
		await visit(page, `/incidents/${made.id}`);
		await box(page).fill("The panel at 14:02");
		await pasteFile(page, PNG);
	},
);

Then(
	"a thumbnail chip appears above the field and goes with my message",
	async ({ page }) => {
		await expect(page.getByTestId("composer-thumb")).toBeVisible();
		await page.getByTestId("composer-investigate").click();
		await waitForRun(
			page,
			inc(page).id,
			(r) => r.status !== "pending",
			"the run with the screenshot",
		);
		await visit(page, `/incidents/${inc(page).id}/conversation`);
		const mine = page.getByTestId("transcript-operator").first();
		await expect(mine).toContainText("The panel at 14:02");
		await expect(
			mine.getByTestId("transcript-attachments").locator("img"),
		).toHaveAttribute("alt", "panel.png");
	},
);

When(
	"I pick an agent whose check recorded no image capability",
	async ({ page, agents, unique }) => {
		agents.install(["codex-acp"], "codex");
		await check(page, "codex");
		await pick(page, "codex");
		const made = await incidentByTitle(page, unique("BandAction"));
		w(page).uploads = 0;
		page.on("request", (r) => {
			if (r.url().includes("/attachments") && r.method() === "POST")
				w(page).uploads = (w(page).uploads ?? 0) + 1;
		});
		// A fresh incident: the previous step's run took the first one.
		const fresh = await page.request.post("/api/incidents", {
			data: { title: `${made.title}-codex`, severity: "high" },
		});
		expect(fresh.ok(), await fresh.text()).toBe(true);
		const { id } = (await fresh.json()) as { id: string };
		w(page).inc = { ...made, id, labels: {} };
		await visit(page, `/incidents/${id}`);
		await pasteFile(page, PNG);
	},
);

Then(
	'the box says "<Agent> can\'t take images" and nothing is uploaded',
	async ({ page }) => {
		await expect(page.getByTestId("composer-refusal")).toHaveText(
			"Codex can't take images",
		);
		await expect(page.getByTestId("composer-thumb")).toHaveCount(0);
		expect(w(page).uploads).toBe(0);
	},
);

When("I pick an agent not yet checked", async ({ page, agents }) => {
	agents.install(["gemini"], "attach");
	await pick(page, "gemini");
	await page.reload();
	await expect(page.getByTestId("incident-record-frame")).toBeVisible(
		FIRST_PAINT,
	);
	await expect(page.getByTestId("agent-picker")).toContainText("Gemini");
});

Then(
	'the paperclip\'s tooltip reads "Images: not checked yet" and only text attaches',
	async ({ page }) => {
		await expect(async () => {
			await page.mouse.move(0, 0);
			await page.getByTestId("composer-attach").hover();
			await expect(page.getByTestId("hint").last()).toContainText(
				"Images: not checked yet",
				{ timeout: 1_500 },
			);
		}).toPass({ timeout: 10_000 });
		await pasteFile(page, PNG);
		await expect(page.getByTestId("composer-refusal")).toContainText(
			"Images: not checked yet",
		);
		await expect(page.getByTestId("composer-thumb")).toHaveCount(0);
	},
);

When("I attach a 20-line log file", async ({ page }) => {
	const log = Array.from(
		{ length: 20 },
		(_, i) =>
			`14:02:${String(i).padStart(2, "0")} pool exhausted (${i + 1}/20)`,
	).join("\n");
	await page.getByTestId("composer-file-input").setInputFiles({
		name: "app.log",
		mimeType: "text/plain",
		buffer: Buffer.from(log),
	});
	await expect(page.getByTestId("composer-file")).toContainText("app.log");
	await box(page).fill("The log from the pod fake-session:attach");
	await page.getByTestId("composer-investigate").click();
});

Then(
	'the agent cites it as "attachment: <name>" in the report\'s evidence',
	async ({ page }) => {
		await waitForRun(
			page,
			inc(page).id,
			(r) => r.status === "completed",
			"the run with the log",
		);
		await visit(page, `/incidents/${inc(page).id}/conversation`);
		// The agent saw the file as fenced data in its prompt, by name.
		await expect(
			page
				.getByTestId("transcript-prose")
				.filter({ hasText: "Reading what you attached: app.log." }),
		).toBeVisible();
		await visit(page, `/incidents/${inc(page).id}/report`);
		await expect(page.getByTestId("report-route")).toContainText(
			"attachment: app.log",
		);
	},
);

// --- Two devices ---------------------------------------------------------------------

Given(
	"INC-1's run is working and the laptop and the phone both show its Conversation",
	async ({ page, browser, alertmanager, deliverWebhook, unique }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await runOn(
			page,
			{ alertmanager, deliverWebhook, unique },
			"BooklogrQueueLag",
			"live",
		);
		// Working means a step is in: the agent has started, not just been spawned.
		await waitFor(
			async () => ((await toolResults(page)) >= 1 ? true : undefined),
			"the run's first tool call",
		);
		await openConversation(page);
		const ctx = await browser.newContext({
			storageState: PAIRED_STATE(),
			viewport: { width: 390, height: 844 },
			hasTouch: true,
		});
		const phone = await ctx.newPage();
		await phone.goto(`/incidents/${inc(page).id}/conversation`);
		await expect(phone.getByTestId("conversation-route")).toBeVisible(
			FIRST_PAINT,
		);
		w(page).phone = phone;
	},
);

const phoneOf = (page: Page): Page => {
	const p = w(page).phone;
	if (!p) throw new Error("no phone");
	return p;
};

When("I send {string} from the phone", async ({ page }, text: string) => {
	const phone = phoneOf(page);
	await phone.getByTestId("composer-input").fill(text);
	// The agent is mid-step, so the phone sends now rather than waiting for a pause.
	await phone.getByTestId("composer-send-now").click();
});

Then(
	'the laptop shows the message as "You" within 2 seconds',
	async ({ page }) => {
		await expect(
			page
				.getByTestId("transcript-operator")
				.filter({ hasText: "Check the deploy diff" }),
		).toContainText("You", { timeout: 2_000 });
	},
);

When("I press Stop on the laptop", async ({ page }) => {
	await page.getByTestId("composer-stop").click();
});

Then(
	'the phone\'s strip reads "Stopped by you" and its box reads "Continue the investigation"',
	async ({ page }) => {
		const phone = phoneOf(page);
		await expect(phone.getByTestId("run-strip-state")).toHaveText(
			"Stopped by you",
		);
		await expect(phone.getByTestId("composer-input")).toHaveAttribute(
			"placeholder",
			"Continue the investigation",
		);
		await phone.context().close();
	},
);
