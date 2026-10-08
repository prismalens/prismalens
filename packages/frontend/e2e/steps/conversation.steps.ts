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
import { investigateButton } from "../journeys/verb";
import { Given, Then, When } from "./fixtures";
import {
	detail,
	ensureService,
	firstPaint,
	incidentByTitle,
	LIVE,
	type Made,
	sidewaysOverflow,
	visit,
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

async function openConversation(page: Page) {
	await visit(page, `/incidents/${inc(page).id}/conversation`);
	await expect(page.getByTestId("conversation-route")).toBeVisible();
}

const box = (page: Page) => page.getByTestId("composer-input");
/** The run's state in the status line under the box (#673), elapsed after it. */
const strip = (page: Page) => page.getByTestId("run-status-state");

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
	"I type {string} in the draft's box and press {string}",
	async ({ page, unique }, text: string, button: string) => {
		const made = await incidentByTitle(page, unique("BandAction"));
		w(page).inc = { ...made, labels: {} };
		await visit(page, `/incidents/${made.id}/conversation?investigation=new`);
		// The script name rides in the brief so the run holds for the Then.
		await box(page).fill(`${text} fake-session:live`);
		await expect(page.getByTestId("composer-investigate")).toHaveText(button);
		await page.getByTestId("composer-investigate").click();
		await waitForRun(page, made.id, (r) => r.status === "running", "the run");
	},
);

Then(
	'the status line reads "Working" and the chips name the agent and model',
	async ({ page }) => {
		await expect(strip(page)).toHaveText(/^Working/);
		await expect(page.getByTestId("agent-picker")).toHaveAttribute(
			"aria-label",
			/^Agent and model: OpenCode, /,
		);
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
		await expect(strip(page)).toHaveText(/^Working/);
		await expect(page.getByTestId("composer-stop")).toHaveText("Stop");
		await expect(page.locator("kbd:visible")).toHaveCount(0);
		await expect(page.locator("body")).not.toContainText(
			/Ctrl ?Enter|Shift ?Enter/,
		);
	},
);

Given("the agent is working and the box has focus", async ({ page }) => {
	await expect(strip(page)).toHaveText(/^Working/);
	await box(page).focus();
});

When("I press Escape", async ({ page }) => {
	await page.keyboard.press("Escape");
});

Then(
	'the status line reads "Stopped by you" and I am still on the Conversation',
	async ({ page }) => {
		await expect(strip(page)).toHaveText(/^Stopped by you/);
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

Then(
	'the end line offers "Read the report" and no "Event log"',
	async ({ page }) => {
		const end = page.getByTestId("transcript-end");
		await expect(end).toContainText("Report ready");
		await expect(
			end.getByRole("link", { name: "Read the report" }),
		).toBeVisible();
		await expect(page.getByRole("link", { name: "Event log" })).toHaveCount(0);
	},
);

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
		await expect(page.getByTestId("agent-picker")).toHaveAttribute(
			"aria-label",
			/^Agent and model: OpenCode, /,
		);
	},
);

When('I press "Stop" in the box', async ({ page }) => {
	await page.getByTestId("composer-stop").click();
});

Then(
	'the status line reads "Stopped by you" and the conversation ends with "Stopped by you at <time> after <elapsed>", and no "Failed"',
	async ({ page }) => {
		await expect(strip(page)).toHaveText(/^Stopped by you/);
		const end = page.getByTestId("transcript-end");
		await expect(end).toContainText(
			/^Stopped by you at \d\d:\d\d after \d+[sm][^.]*\./,
		);
		await expect(page.getByTestId("transcript")).not.toContainText("Failed");
	},
);

Then("nothing counts down or waits", async ({ page }) => {
	const elapsed = strip(page);
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
		await expect(strip(page)).toHaveText(/^Stopped by you/);
	},
);

Then(
	'the box reads "Say what to change, or just continue" and no note explains it',
	async ({ page }) => {
		await expect(box(page)).toHaveAttribute(
			"placeholder",
			"Say what to change, or just continue",
		);
		// The placeholder names what the box does; explaining copy is gone (look ruling L43).
		await expect(page.getByTestId("composer-note")).toHaveCount(0);
	},
);

Then(
	"the run is working again and the agent's next message answers with what it had already found",
	async ({ page }) => {
		await expect(
			page
				.getByTestId("transcript-prose")
				.filter({ hasText: "the index drop is still the only change" }),
		).toBeVisible();
		// The continued run is the run again, so it went live before its report.
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
	'the box reads "This run can\'t continue. Start a new run." with "New run", and no field to type into',
	async ({ page }) => {
		await expect(page.getByTestId("composer-no-session")).toContainText(
			"This run can't continue. Start a new run.",
		);
		await expect(page.getByTestId("composer-new-run")).toHaveText("New run");
		await expect(box(page)).toHaveCount(0);
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
	await visit(
		page,
		`/incidents/${inc(page).id}/conversation?investigation=new`,
	);
	await page.getByTestId("composer-investigate").click();
	await waitForRun(
		page,
		inc(page).id,
		(r) => r.status === "completed" || r.status === "failed",
		"the Codex run",
	);
});

Then(
	"the report's header names no agent or model, and the conversation shows the agent accepting {string} before its first words",
	async ({ page }, model: string) => {
		const run = (await detail(page, inc(page).id)).investigations?.[0];
		expect(run?.status).toBe("completed");
		await visit(page, `/incidents/${inc(page).id}/report`);
		const header = page.getByTestId("report-header");
		await expect(header).toBeVisible();
		await expect(header).not.toContainText(model);
		await expect(header).not.toContainText("Ran on");
		await visit(page, `/incidents/${inc(page).id}/conversation`);
		const took = page.getByTestId("transcript-line").filter({
			hasText: `The agent took model ${model.toLowerCase()} before the first prompt`,
		});
		await expect(took).toBeVisible();
		// It is the first thing the run did: before any of the agent's own words.
		const prose = page.getByTestId("transcript-prose").first();
		const [a, b] = [await took.boundingBox(), await prose.boundingBox()];
		expect(a?.y ?? 0).toBeLessThan(b?.y ?? 0);
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
	"the run does not start and its end line says which models it offered",
	async ({ page }) => {
		await visit(page, `/incidents/${inc(page).id}/conversation`);
		await expect(page.getByTestId("transcript-end")).toContainText(
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
		await visit(page, `/incidents/${made.id}/conversation?investigation=new`);
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
		await visit(page, `/incidents/${id}/conversation`);
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
	await firstPaint(page);
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
	// The incident has a report by now, so its draft opens on Ask (#673 w59).
	await (await investigateButton(page)).click();
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
		await visit(phone, `/incidents/${inc(page).id}/conversation`);
		await expect(phone.getByTestId("conversation-route")).toBeVisible();
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
	'the phone\'s status line reads "Stopped by you" and its box reads "Say what to change, or just continue"',
	async ({ page }) => {
		const phone = phoneOf(page);
		await expect(phone.getByTestId("run-status-state")).toHaveText(
			/^Stopped by you/,
		);
		await expect(phone.getByTestId("composer-input")).toHaveAttribute(
			"placeholder",
			"Say what to change, or just continue",
		);
		await phone.context().close();
	},
);

// --- One thread, two verbs (#673 w59) -------------------------------------------------

/** GET replies for the run and the incident, reshaped; the rest of the API stays real. */
async function reshape(
	page: Page,
	path: string,
	fix: (body: Record<string, unknown>) => Record<string, unknown>,
) {
	await page.route(
		(url) => url.pathname === path,
		async (route) => {
			if (route.request().method() !== "GET") return route.continue();
			try {
				const res = await route.fetch();
				await route.fulfill({
					response: res,
					json: fix((await res.json()) as Record<string, unknown>),
				});
			} catch (error) {
				if (page.isClosed() || /disposed/i.test(String(error))) return;
				throw error;
			}
		},
	);
}

const mapRuns = (
	body: Record<string, unknown>,
	f: (r: Record<string, unknown>, i: number) => Record<string, unknown>,
) => ({
	...body,
	investigations: (
		(body.investigations as Record<string, unknown>[]) ?? []
	).map(f),
});

Given("an answer to a question is running on it", async ({ page }) => {
	const id = await runId(page);
	const live = { status: "running", liveTurn: "answer", completedAt: null };
	await reshape(page, `/api/investigations/${id}`, (b) => ({ ...b, ...live }));
	await reshape(page, `/api/incidents/${inc(page).id}`, (b) =>
		mapRuns(b, (r) => (r.id === id ? { ...r, ...live } : r)),
	);
});

Then(
	'the Report tab shows the report and the Overview\'s report pool shows it, not "working"',
	async ({ page }) => {
		await visit(page, `/incidents/${inc(page).id}/report`);
		await expect(page.getByTestId("report-answer")).toBeVisible();
		await expect(page.getByTestId("report-empty")).toHaveCount(0);
		await visit(page, `/incidents/${inc(page).id}`);
		const pool = page.getByTestId("overview-report");
		await expect(pool).toBeVisible();
		await expect(pool).not.toContainText("working");
		await expect(pool).not.toContainText("No report");
	},
);

When(
	"I type {string} and attach {string}, then press {string}",
	async ({ page }, text: string, file: string, link: string) => {
		await box(page).fill(text);
		await expect(box(page)).toHaveValue(text);
		await page.getByTestId("composer-file-input").setInputFiles({
			name: file,
			mimeType: "text/plain",
			buffer: Buffer.from("14:02 deploy raised the pool wait\n"),
		});
		await expect(page.getByTestId("composer-file")).toContainText(file);
		await page
			.getByTestId("run-status")
			.getByRole("button", { name: link })
			.click();
	},
);

Then(
	"a draft opens holding {string}, the file {string} and the quote {string}",
	async ({ page }, text: string, file: string, quote: string) => {
		await expect(
			page
				.getByTestId("run-tree-draft")
				.or(page.getByTestId("draft-heading"))
				.first(),
		).toBeVisible();
		await expect(box(page)).toHaveValue(
			new RegExp(`^${text}\n\n${quote}\\d+\\. It found: `),
		);
		await expect(page.getByTestId("composer-file")).toContainText(file);
		await expect(page.getByTestId("verb-chip")).toHaveAttribute(
			"data-verb",
			"investigate",
		);
	},
);

Then("the report is unchanged", async ({ page }) => {
	const res = await page.request.get(
		`/api/investigations/${await runId(page)}`,
	);
	const now = JSON.stringify(
		((await res.json()) as { report: unknown }).report,
	);
	expect(now).toBe(w(page).report);
});

Then(
	'the status line reads "Stopped by you" and the verb chip offers {string} and {string}',
	async ({ page }, first: string, second: string) => {
		await expect(strip(page)).toHaveText(/^Stopped by you/);
		const chip = page.getByTestId("verb-chip");
		await expect(chip).toHaveAttribute("data-verb", "investigate");
		await expect(page.getByTestId("composer-investigate")).toHaveText(first);
		await chip.click();
		await expect(page.getByTestId("verb-menu")).toContainText(first);
		await expect(page.getByTestId("verb-menu")).toContainText(second);
		await expect(page.getByTestId("verb-menu")).toContainText(
			"Continues this run to its report.",
		);
		await page.getByTestId("verb-ask").click();
		await expect(page.getByTestId("composer-investigate")).toHaveCount(0);
		await expect(page.getByTestId("composer-send")).toBeVisible();
	},
);

/** The run read as a chat in `state`; the API behind it stays real. */
const chatState: WeakMap<Page, Record<string, unknown>> = new WeakMap();
Given("the run is a chat that ended in an error", async ({ page }) => {
	await page.getByTestId("composer-stop").click();
	await expect(strip(page)).toHaveText(/^Stopped by you/);
	const id = await runId(page);
	chatState.set(page, {
		kind: "chat",
		status: "failed",
		error: "the agent crashed",
		liveTurn: null,
	});
	await reshape(page, `/api/investigations/${id}`, (b) => ({
		...b,
		...chatState.get(page),
	}));
	await openConversation(page);
});

When("the chat answers a message", async ({ page }) => {
	chatState.set(page, {
		kind: "chat",
		status: "completed",
		error: null,
		liveTurn: null,
		lastTurnOutcome: "answered",
	});
	await openConversation(page);
});

Then("the status line reads {string}", async ({ page }, word: string) => {
	await expect(strip(page)).toHaveText(new RegExp(`^${word}`));
});

When("another run on INC-1 starts working", async ({ page }) => {
	await expect(strip(page)).toHaveText(/^Stopped by you/);
	const stopped = await runId(page);
	await reshape(page, `/api/incidents/${inc(page).id}`, (b) => {
		const runs = (b.investigations as Record<string, unknown>[]) ?? [];
		const first = runs.find((r) => r.id === stopped) ?? {};
		const other = {
			...first,
			id: "0b5e0000-0000-4000-8000-000000000002",
			status: "running",
			liveTurn: "report",
			createdAt: new Date(Date.now() + 60_000).toISOString(),
			completedAt: null,
		};
		return { ...b, investigations: [other, ...runs] };
	});
	await visit(
		page,
		`/incidents/${inc(page).id}/conversation?investigation=${stopped}`,
	);
});

Then(
	"the stopped run's box says {string} and sends nothing",
	async ({ page }, words: string) => {
		await expect(page.getByTestId("composer-blocked")).toContainText(words);
		let sent = 0;
		page.on("request", (r) => {
			if (r.method() === "POST" && r.url().endsWith("/messages")) sent++;
		});
		await expect(box(page)).toBeDisabled();
		await expect(page.getByTestId("composer-investigate")).toBeDisabled();
		expect(sent).toBe(0);
	},
);
