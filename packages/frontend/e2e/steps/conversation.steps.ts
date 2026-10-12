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
	fireIncident,
	firstPaint,
	incidentByTitle,
	LIVE,
	type Made,
	QUIET,
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
	await waitForRun(
		page,
		made.id,
		(r) => r.status === "running" || r.status === "completed",
		"the run",
	);
	return made;
}

/** A run started by a person on an incident whose service trigger is never. */
async function runAsPerson(
	page: Page,
	f: Fire,
	name: string,
	session: string,
	accessLevel: "supervised" | "auto-edits" = "supervised",
) {
	const made = await fireIncident(page, f.alertmanager, f.deliverWebhook, {
		name: f.unique(name),
		service: QUIET,
		quiet: true,
		session,
	});
	w(page).inc = made;
	const res = await page.request.post(`/api/incidents/${made.id}/investigate`, {
		data: { accessLevel },
	});
	expect(res.ok(), await res.text()).toBe(true);
	await waitForRun(
		page,
		made.id,
		(r) => r.status === "running" || r.status === "completed",
		"the run",
	);
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
	await expect(page.getByTestId("run-page")).toBeVisible();
}

const box = (page: Page) => page.getByTestId("composer-input");
/** The run's state in the status line under the header (#811), elapsed after it. */
const strip = (page: Page) => page.getByTestId("run-strip-detail");

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
		await expect(page.getByTestId("action-chip")).toHaveText(button);
		await page.getByTestId("composer-send").click();
		await waitForRun(page, made.id, (r) => r.status === "running", "the run");
	},
);

Then(
	/^(?:the status line reads "([^"]+)"|the status line shows what the agent is doing) and the chips name the agent and model$/,
	async ({ page }, sentence?: string) => {
		if (sentence && sentence !== "Working") {
			await expect(strip(page)).toHaveText(sentence);
		} else {
			await expect(strip(page)).toHaveText(
				"Reading worker/consumer.py to see how the queue is drained.",
			);
		}
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
		await expect(page.getByTestId("run-strip-stop")).toBeVisible();
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
	await expect(page.getByTestId("step-toggle").first()).toBeVisible();
	if (await page.getByTestId("steps-unfold").isVisible()) {
		await page.getByTestId("steps-unfold").click();
	}
	for (const toggle of await page.getByTestId("step-toggle").all()) {
		if ((await toggle.getAttribute("aria-expanded")) !== "true") {
			await toggle.click();
		}
	}
	await expect(page.getByTestId("step-body").first()).toBeVisible();
});

Then(
	"each row shows the command or path that ran, such as {string} or {string}",
	async ({ page }, command: string, path: string) => {
		const rows = page.getByTestId("step");
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
		const failed = page.locator('[data-testid="step"]').filter({
			has: page.locator('[data-testid="step-verb"]:text("Failed")'),
		});
		if (!(await failed.getByTestId("step-body").isVisible())) {
			await failed.getByTestId("step-toggle").click();
		}
		await expect(failed.getByTestId("step-output")).toHaveText(
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
			/waits for the next pause/i,
		);
		release(inc(page).title);
		await expect(mine.getByTestId("transcript-delivery")).toHaveText(
			/delivered at the next pause/i,
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
		if (button === "Send now") {
			await box(page).press("Control+Enter");
		} else {
			await page.getByRole("button", { name: button }).click();
		}
	},
);

Then(
	"the agent's current step ends and my message is answered next",
	async ({ page }) => {
		const mine = page.getByTestId("transcript-operator").last();
		await expect(mine.getByTestId("transcript-delivery")).toHaveText(
			/sent now/i,
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
		await expect(page.getByTestId("run-strip-label")).toHaveText(
			/investigating/,
		);
		await expect(page.getByTestId("run-strip-stop")).toContainText("Stop");
		await expect(page.locator("kbd:visible")).toHaveCount(0);
		await expect(page.locator("body")).not.toContainText(
			/Ctrl ?Enter|Shift ?Enter/,
		);
	},
);

Given("the agent is working and the box has focus", async ({ page }) => {
	await expect(page.getByTestId("run-strip-label")).toHaveText(/investigating/);
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
		const header = page.getByTestId("incident-header");
		await expect(header.getByText("Ledger", { exact: true })).toHaveCount(0);
		await expect(header.getByText("Transcript", { exact: true })).toHaveCount(
			0,
		);
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
	/^(?:the end line offers|the report card offers) "(See it on the overview|Read the report)" and no "Event log"$/,
	async ({ page }, _offer: string) => {
		const end = page
			.getByTestId("transcript-report")
			.or(page.getByTestId("transcript-end"));
		await expect(end).toBeVisible();
		await expect(
			end.getByRole("link", { name: /See it on the overview|Read the report/ }),
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
	await page.getByTestId("run-strip-stop").click();
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
	await expect(page.getByTestId("run-strip-stop")).toHaveCount(0);
	await expect(page.getByTestId("transcript")).not.toContainText(
		/Stopping|resum/i,
	);
});

Given(
	"INC-1's run was stopped and OpenCode can reopen it",
	async ({ page }) => {
		await page.getByTestId("run-strip-stop").click();
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
	await visit(page, `/incidents/${inc(page).id}`);
	await expect(page.getByTestId("why-cause")).toBeVisible();
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
	/^(?:the box reads "(?:This run kept no agent session, so it can't continue\. Start a new run\.|This run can't continue\. Start a new run\.)" with "New run", and no field to type into)$/,
	async ({ page }) => {
		await expect(page.getByTestId("composer-no-session")).toContainText(
			"This run kept no agent session, so it can't continue. Start a new run.",
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
	await (await investigateButton(page)).click();
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
		await visit(page, `/incidents/${inc(page).id}`);
		const header = page.getByTestId("incident-header");
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
		await (await investigateButton(page)).click();
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
		await visit(page, `/incidents/${inc(page).id}`);
		await expect(page.getByTestId("why-card")).toContainText(
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
		await expect(phone.getByTestId("run-page")).toBeVisible();
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
	await phone.getByTestId("composer-input").press("Control+Enter");
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
	await page.getByTestId("run-strip-stop").click();
});

Then(
	'the phone\'s status line reads "Stopped by you" and its box reads "Say what to change, or just continue"',
	async ({ page }) => {
		const phone = phoneOf(page);
		await expect(phone.getByTestId("run-strip-detail")).toHaveText(
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
	"the Report tab shows the report and the Overview's report pool shows it, the answer working under it",
	async ({ page }) => {
		await visit(page, `/incidents/${inc(page).id}`);
		await expect(page.getByTestId("why-card")).toBeVisible();
		await expect(page.getByTestId("why-tag")).toHaveText("Likely");
		await expect(page.getByTestId("why-live")).toBeVisible();
		await expect(page.getByTestId("why-cause")).toBeVisible();
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
		if (link === "Investigate again") {
			await page.getByTestId("action-chip").click();
			await page.getByTestId("action-recheck").click();
			await page.getByTestId("composer-send").click();
		} else {
			await page
				.getByTestId("run-strip")
				.getByRole("button", { name: link })
				.click();
		}
	},
);

Then(
	"a draft opens holding {string}, the file {string} and the quote {string}",
	async ({ page }, text: string, file: string, quote: string) => {
		await expect(
			page
				.getByTestId("run-tree-draft")
				.or(page.getByTestId("run-page").locator("[data-draft]"))
				.or(page.getByTestId("draft-known"))
				.first(),
		).toBeVisible();
		await expect(box(page)).toHaveValue(
			new RegExp(`^${text}\n\n${quote}\\d+\\. It found: `),
		);
		await expect(page.getByTestId("composer-file")).toContainText(file);
		await expect(page.getByTestId("action-chip")).toHaveAttribute(
			"data-action",
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
	async ({ page }, _first: string, second: string) => {
		await expect(strip(page)).toHaveText(/^Stopped by you/);
		const chip = page.getByTestId("action-chip");
		await expect(chip).toHaveAttribute("data-action", "continue");
		await chip.click();
		const menu = page.getByTestId("action-menu");
		await expect(menu).toContainText("Continue");
		await expect(menu).toContainText(second);
		await expect(menu).toContainText(
			"Resumes the agent's session and takes the run on to a report.",
		);
		await page.getByTestId("action-follow-up").click();
		await expect(page.getByTestId("composer-send")).toBeVisible();
	},
);

/** A real chat on INC-1 whose agent dies mid-turn (the `failure` script), kept for its session. */
const chats = new WeakMap<Page, string>();
Given("the run is a chat that ended in an error", async ({ page }) => {
	await page.getByTestId("run-strip-stop").click();
	await expect(strip(page)).toHaveText(/^Stopped by you/);
	const res = await page.request.post(`/api/incidents/${inc(page).id}/chat`, {
		data: { text: "What broke? fake-session:failure" },
	});
	expect(res.ok(), await res.text()).toBe(true);
	const { investigationId } = (await res.json()) as { investigationId: string };
	chats.set(page, investigationId);
	await waitFor(async () => {
		const r = await page.request.get(`/api/investigations/${investigationId}`);
		const run = (await r.json()) as {
			status: string;
			kind: string;
			resumable?: boolean;
		};
		return run.kind === "chat" && run.status === "failed" ? run : undefined;
	}, "the chat's error");
	await visit(
		page,
		`/incidents/${inc(page).id}/conversation?investigation=${investigationId}`,
	);
	await expect(page.getByTestId("run-page")).toBeVisible();
});

When("the chat answers a message", async ({ page }) => {
	const id = chats.get(page);
	if (!id) throw new Error("no chat was started");
	// The box on a chat in Error continues it: the backend reopens the session and settles the turn.
	await expect(box(page)).toHaveAttribute("placeholder", "Ask a follow-up");
	await box(page).fill("Try again?");
	await box(page).press("Enter");
	await waitFor(async () => {
		const r = await page.request.get(`/api/investigations/${id}`);
		const run = (await r.json()) as {
			status: string;
			lastTurnOutcome?: string | null;
		};
		return run.status === "completed" && run.lastTurnOutcome === "answered"
			? run
			: undefined;
	}, "the chat's answer to be settled");
	await expect(
		page
			.getByTestId("transcript-prose")
			.filter({ hasText: "Heard: Try again?" }),
	).toBeVisible();
});

Then("the status line reads {string}", async ({ page }, word: string) => {
	if (word === "Error") {
		await expect(page.getByTestId("run-strip-label")).toHaveText(/failed$/);
	} else if (word === "Ended") {
		await expect(page.getByTestId("run-strip-label")).toHaveText(/answered$/);
	} else {
		await expect(strip(page)).toHaveText(new RegExp(`^${word}`));
	}
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
		await expect(page.getByTestId("composer-send")).toBeDisabled();
		expect(sent).toBe(0);
	},
);

// --- Asks (#673 w21) -----------------------------------------------------------------

Given(
	/^(?:INC-1 has a run started on|INC-1 has a run in progress on) "(.+)"$/,
	async ({ page, alertmanager, deliverWebhook, unique }, session: string) => {
		const s = session.replace(/^fake-session:/, "");
		await runAsPerson(
			page,
			{ alertmanager, deliverWebhook, unique },
			"BooklogrAskProbe",
			s,
			"supervised",
		);
		await openConversation(page);
		await expect(page.getByTestId("dock-ask")).toBeVisible();
	},
);

Given(
	"a paired browser at {int} px and INC-1 has a run started on {string}",
	async (
		{ page, alertmanager, deliverWebhook, unique },
		width: number,
		session: string,
	) => {
		await page.setViewportSize({ width, height: 900 });
		const s = session.replace(/^fake-session:/, "");
		await runAsPerson(
			page,
			{ alertmanager, deliverWebhook, unique },
			"BooklogrAskProbe",
			s,
			"supervised",
		);
		await openConversation(page);
		await expect(page.getByTestId("dock-ask")).toBeVisible();
	},
);

Then(
	/^(?:the band shows|the band reads) "Waiting for your approval"$/,
	async ({ page }) => {
		// The ask waits in the dock on the box; the strip and its step say so (#820).
		await expect(page.getByTestId("dock-ask")).toBeVisible();
		await expect(page.getByTestId("run-strip-label")).toContainText(
			"waiting for you",
		);
		await expect(page.getByTestId("step-ask")).toContainText(
			"Waiting for your approval",
		);
	},
);

Then(
	/^(?:the )?(?:ask )?card names "(.+)"$/,
	async ({ page }, name: string) => {
		const card = page.getByTestId("dock-ask");
		await expect(card).toBeVisible();
		await expect(card).toContainText(name);
	},
);

When(
	/^(?:I click|clicking) "(Approve|Deny)"(?: on the ask card)?$/,
	async ({ page }, action: string) => {
		const testId = action === "Approve" ? "ask-approve" : "ask-deny";
		await page.getByTestId(testId).click();
	},
);

Then(
	/^(?:the )?(?:ask )?card reads "(You approved it|You denied it)"$/,
	async ({ page }, text: string) => {
		const line = page.getByTestId("step-ask");
		const expectedState = text === "You approved it" ? "approved" : "denied";
		await expect(line).toHaveAttribute("data-state", expectedState);
		await expect(line).toHaveText(text);
	},
);

Then(
	/^(?:the band text goes away|the band no longer shows "Waiting for your approval")$/,
	async ({ page }) => {
		await expect(page.getByTestId("dock-ask")).toHaveCount(0);
	},
);

Then(
	/^(?:the run ends with|the end line offers) "(Report ready|No report)"$/,
	async ({ page }, expected: string) => {
		await waitForRun(
			page,
			inc(page).id,
			(r) => r.status === "completed",
			`the run's end with ${expected}`,
		);
		if (expected === "Report ready") {
			await expect(
				page
					.getByTestId("transcript-report")
					.or(page.getByTestId("transcript-end")),
			).toBeVisible();
		} else {
			const end = page.getByTestId("transcript-end");
			await expect(end).toBeVisible();
			await expect(end).toContainText(expected);
		}
	},
);

Given(
	'INC-2 has a run started on {string} at "Auto-accept edits"',
	async ({ page, alertmanager, deliverWebhook, unique }, session: string) => {
		const oldRuns = await page.request
			.get("/api/investigations?status=running&limit=100")
			.catch(() => null);
		if (oldRuns?.ok()) {
			const { data } = (await oldRuns.json()) as { data: { id: string }[] };
			for (const r of data) {
				await page.request
					.post(`/api/investigations/${r.id}/cancel`)
					.catch(() => null);
			}
		}

		const s = session.replace(/^fake-session:/, "");
		await runAsPerson(
			page,
			{ alertmanager, deliverWebhook, unique },
			"BooklogrAutoEditsProbe",
			s,
			"auto-edits",
		);
		await openConversation(page);
	},
);

Then(
	"no card waits and the transcript says nobody was there",
	async ({ page }) => {
		await expect(page.getByTestId("dock-ask")).toHaveCount(0);
		await expect(page.getByTestId("transcript-ask")).toHaveCount(0);
		await expect(page.getByTestId("band-awaiting-approval")).toHaveCount(0);
		await expect(page.getByTestId("transcript-unattended")).toContainText(
			"Refused, nobody was there to approve: Write /tmp/pl-ask-probe.txt",
		);
	},
);

Then(
	"no card waits and the conversation shows {string}",
	async ({ page }, text: string) => {
		await expect(page.getByTestId("dock-ask")).toHaveCount(0);
		await expect(page.getByTestId("band-awaiting-approval")).toHaveCount(0);
		const allowed = page.getByTestId("transcript-allowed");
		await expect(allowed).toBeVisible();
		await expect(allowed).toContainText(text);
	},
);

Given(
	/^(?:an alert starts a run on|an alert-started run on) "(.+)"$/,
	async ({ page, alertmanager, deliverWebhook, unique }, session: string) => {
		const oldRuns = await page.request
			.get("/api/investigations?status=running&limit=100")
			.catch(() => null);
		if (oldRuns?.ok()) {
			const { data } = (await oldRuns.json()) as { data: { id: string }[] };
			for (const r of data) {
				await page.request
					.post(`/api/investigations/${r.id}/cancel`)
					.catch(() => null);
			}
		}

		const s = session.replace(/^fake-session:/, "");
		await runOn(
			page,
			{ alertmanager, deliverWebhook, unique },
			"BooklogrAlertAskProbe",
			s,
		);
		await openConversation(page);
	},
);

Given(
	"INC-3 has a run started on {string}",
	async ({ page, alertmanager, deliverWebhook, unique }, session: string) => {
		const oldRuns = await page.request
			.get("/api/investigations?status=running&limit=100")
			.catch(() => null);
		if (oldRuns?.ok()) {
			const { data } = (await oldRuns.json()) as { data: { id: string }[] };
			for (const r of data) {
				await page.request
					.post(`/api/investigations/${r.id}/cancel`)
					.catch(() => null);
			}
		}

		const s = session.replace(/^fake-session:/, "");
		await runOn(
			page,
			{ alertmanager, deliverWebhook, unique },
			"BooklogrSwitchModeProbe",
			s,
		);
		await openConversation(page);
	},
);

Then("the conversation shows {string}", async ({ page }, text: string) => {
	const kept = page.getByTestId("transcript-mode-kept");
	if ((await kept.count()) > 0) {
		await expect(kept).toBeVisible();
		await expect(kept).toContainText(text);
		return;
	}
	await expect(page.getByTestId("transcript")).toContainText(text);
});
