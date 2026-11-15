// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { defineChecks, verdict } from "../bar";

/** The sim's failing threads: every stop and error condition that owns one. */
const FAILURES = [
	"limit.mid-turn",
	"limit.out-of-credit",
	"limit.overloaded",
	"limit.rate-limited",
	"login.expired",
	"budget.cap",
	"git.worktree-disk",
	"net.provider-drop",
	"protocol.drift",
	"agent.runaway",
	"host.restart",
];

/** Sim threads that end on a failure or stop dock; recovered retries have none. */
const FAILURE_DOCK_CASES = [
	{ id: "limit.mid-turn" },
	{ id: "limit.out-of-credit" },
	{ id: "limit.overloaded", n: 1 },
	{ id: "login.expired" },
	{ id: "login.expired", n: 1 },
	{ id: "budget.cap" },
	{ id: "git.worktree-disk" },
	{ id: "host.restart" },
	{ id: "agent.stalled" },
];

/** What a raw code looks like on screen: errno names, HTTP status lines, snake_case modes, JSON. */
const RAW =
	/\b(E[A-Z]{4,}|HTTP\/?\s?\d\.?\d? ?[45]\d\d|status(?: code)? [45]\d\d|[a-z]+_[a-z_]+_?(?:error|limit|credit|rejected|exceeded)\w*|ERR_[A-Z_]+|[A-Z][a-zA-Z]+Error\b|Exception\b)|\{"\w+":/;

/** #1101 category 23, Error notices. */
export default defineChecks([
	{
		item: "23.1",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			const measured: { id: string; head: string; action: string }[] = [];

			for (const f of FAILURE_DOCK_CASES) {
				const threadUrl =
					f.n !== undefined ? sim.thread(f.id, f.n) : sim.thread(f.id);
				const label = `${f.id}${f.n !== undefined ? `#${f.n}` : ""}`;
				await open(threadUrl);
				await expect(page.getByTestId("thread-page")).toBeVisible();

				const dock = page
					.locator(
						"[data-testid='failed-dock'], [data-testid='limit-dock'], [data-testid='interrupted-dock'], [data-testid='disk-dock']",
					)
					.first();
				try {
					await expect(dock).toBeVisible({ timeout: 20_000 });
				} catch {
					fails.push(`${label}: no failure dock visible`);
					continue;
				}

				await dock
					.locator("button, a")
					.first()
					.waitFor({ timeout: 10_000 })
					.catch(() => undefined);
				const actions = (await dock.locator("button, a").allInnerTexts())
					.map((t) => t.trim())
					.filter(Boolean);
				let cause = ((await dock.innerText()) ?? "").replace(/\s+/g, " ");
				for (const a of actions) cause = cause.replace(a, " ");
				cause = cause.replace(/\s+/g, " ").trim();

				if (cause.split(" ").length < 3) {
					fails.push(`${label}: dock names no cause: "${cause}"`);
				}
				if (actions.length === 0) {
					fails.push(`${label}: dock has no action button`);
				}
				measured.push({ id: label, head: cause, action: actions[0] ?? "" });
			}

			return verdict(
				fails,
				`${measured.length} failure threads verified: each names cause and has action button (${measured.map((m) => `${m.id}: "${m.head}" -> [${m.action}]`).join("; ")})`,
			);
		},
	},
	{
		item: "23.2",
		async run({ page, open }) {
			// A thread this check makes, so its draft never lands on a shared sim thread.
			const made = await page.request.post("/api/incidents", {
				data: { title: "Bar check 23.2 connection", tags: ["chat"] },
			});
			if (!made.ok())
				throw new Error(`create incident failed: ${await made.text()}`);
			const { id: incidentId } = (await made.json()) as { id: string };
			const started = await page.request.post(
				`/api/incidents/${incidentId}/chat`,
				{
					data: {
						text: "Investigate latency fake-session:compact",
						harness: "claude-code",
					},
				},
			);
			if (!started.ok())
				throw new Error(`start chat failed: ${await started.text()}`);
			const { investigationId: runId } = (await started.json()) as {
				investigationId: string;
			};
			await open(`/threads/${runId}`);
			await expect(page.getByTestId("thread-page")).toBeVisible();
			await expect(
				page.getByText("The p99 rise follows d37d888").first(),
			).toBeVisible({ timeout: 40_000 });

			const composer = page.getByTestId("composer-input");
			await expect(composer).toBeVisible();
			const draftText = "Keep this draft across connection drop";
			await composer.fill(draftText);

			const fails: string[] = [];
			try {
				await page.context().setOffline(true);

				// ConnectionDock appears after reconnectAsOf wait (10s threshold)
				const connectionDock = page.getByTestId("connection-dock");
				await expect(connectionDock).toBeVisible({ timeout: 30_000 });

				const head = await connectionDock
					.locator("span.font-semibold, span[data-testid$='-head']")
					.first()
					.textContent();
				if (!head?.includes("Reconnecting")) {
					fails.push(`expected head 'Reconnecting', saw '${head}'`);
				}
				if ((await page.getByTestId("connection-dock-retry").count()) === 0) {
					fails.push("connection-dock-retry button not present");
				}
				if ((await page.locator("[role='dialog']:visible").count()) > 0) {
					fails.push(
						"modal dialog visible during lost connection (should be quiet dock)",
					);
				}
				const during = await composer.textContent();
				if (!during?.includes(draftText)) {
					fails.push(`draft was lost during the drop: saw '${during}'`);
				}
			} finally {
				await page.context().setOffline(false);
			}

			// Back online the dock goes and the draft is still there
			await expect(page.getByTestId("connection-dock")).toHaveCount(0, {
				timeout: 30_000,
			});
			const after = await composer.textContent();
			if (!after?.includes(draftText)) {
				fails.push(`draft was lost after reconnecting: saw '${after}'`);
			}

			return verdict(
				fails,
				`lost connection showed a quiet dock ("Reconnecting", Retry now), no modal; the draft stayed in the composer during the drop and after the dock cleared`,
			);
		},
	},
	{
		item: "23.3",
		async run({ page, open, sim }) {
			const fails: string[] = [];

			// 1. Interrupted run reads "Interrupted by restart" with Resume
			await open(sim.thread("host.restart"));
			await expect(page.getByTestId("thread-page")).toBeVisible();

			const interruptedDock = page.getByTestId("interrupted-dock");
			await expect(interruptedDock).toBeVisible();

			const headText = (await interruptedDock.textContent()) ?? "";
			if (!headText.includes("Interrupted by restart")) {
				fails.push(
					`interrupted dock text does not include 'Interrupted by restart': '${headText}'`,
				);
			}

			const resumeBtn = page.getByTestId("interrupted-dock-resume");
			await expect(resumeBtn).toBeVisible();
			const resumeText = (await resumeBtn.textContent())?.trim();
			if (resumeText !== "Resume") {
				fails.push(`expected 'Resume' button, saw '${resumeText}'`);
			}

			// 2. Limit keeps its reset time
			await open(sim.thread("limit.mid-turn"));
			await expect(page.getByTestId("thread-page")).toBeVisible();

			const limitDock = page.getByTestId("limit-dock");
			await expect(limitDock).toBeVisible();

			const limitLine =
				(await page.getByTestId("limit-dock-line").textContent()) ?? "";
			if (!/Resumes \d{1,2}:\d{2}/.test(limitLine)) {
				fails.push(`limit dock line shows no reset time: '${limitLine}'`);
			}

			return verdict(
				fails,
				`interrupted run reads "Interrupted by restart" with Resume button; limit dock keeps reset time ("${limitLine.trim()}")`,
			);
		},
	},
	{
		item: "23.4",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			let scanned = 0;
			for (const id of FAILURES) {
				await open(sim.thread(id));
				await expect(page.getByTestId("thread-page")).toBeVisible();
				await expect(page.getByTestId("transcript")).toContainText(/\S{3}/, {
					timeout: 30_000,
				});
				// Visible text only: raw words behind a closed disclosure are allowed.
				// biome-ignore lint/performance/useDomNodeTextContent: visible text only
				const text = await page.locator("main").innerText();
				scanned += text.length;
				const hit = RAW.exec(text);
				if (hit) fails.push(`${id}: "${hit[0]}"`);
			}
			return verdict(
				fails,
				`${FAILURES.length} failing threads, ${scanned} visible characters scanned: no raw error code`,
			);
		},
	},
	{
		item: "23.5",
		async run({ page, open, sim }) {
			const fails: string[] = [];

			// A thread whose turn failed: the agent is not signed in
			await open(sim.thread("login.expired", 1));
			await expect(page.getByTestId("thread-page")).toBeVisible();

			const failedDock = page.getByTestId("failed-dock");
			await expect(failedDock).toBeVisible({ timeout: 20_000 });

			const head = (
				await page.getByTestId("failed-dock-head").textContent()
			)?.trim();
			if (head !== "Failed") {
				fails.push(`failed dock head should be 'Failed', saw '${head}'`);
			}

			const detail =
				(await page.getByTestId("failed-dock-detail").textContent())?.trim() ??
				"";
			if (detail.split(" ").length < 3) {
				fails.push(`failed dock cause is "${detail}"`);
			}

			// One line, drawn with the danger tone, and no card in the transcript
			const height = (await failedDock.boundingBox())?.height ?? 0;
			if (height > 56) {
				fails.push(
					`failed dock is ${Math.round(height)} px tall, not one line`,
				);
			}
			if ((await failedDock.locator(".text-danger").count()) === 0) {
				fails.push("failed dock has nothing in the danger tone");
			}
			const cardInMain = await page
				.locator("main [data-testid='failed-card']")
				.count();
			if (cardInMain > 0) {
				fails.push("found failed-card in main area (should be one quiet line)");
			}

			return verdict(
				fails,
				`failed turn is one ${Math.round(height)} px line (data-testid="failed-dock", "${head}: ${detail}") with a danger-tone mark, and no failed card`,
			);
		},
	},
]);
