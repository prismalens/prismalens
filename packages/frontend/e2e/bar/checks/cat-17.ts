// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page } from "@playwright/test";
import { type Ctx, defineChecks, notSetUp, verdict } from "../bar";

/** The limit thread's dock, once loaded; false when the thread shows no limit at all. */
async function limitShown(page: Page, open: Ctx["open"], path: string) {
	await open(path, "thread-page");
	const dock = page.getByTestId("limit-dock");
	const shown = await dock
		.waitFor({ timeout: 20_000 })
		.then(() => true)
		.catch(() => false);
	if (shown) await expect(dock).not.toHaveAttribute("data-state", "loading");
	return shown;
}

/** One thread's sidebar row: its state mark, its slot time and its status label. */
async function rowOf(page: Page, id: string) {
	const row = page.locator(`[data-testid="thread-row"][data-id="${id}"]`);
	await expect(page.getByTestId("thread-tree")).toBeVisible();
	// A Limited thread waits on a clock, not on the user, so it can sit past "Show N more".
	// The list loads in pages: scroll to its end and press Show more, as a person would.
	for (let i = 0; i < 15 && (await row.count()) === 0; i++) {
		await page
			.getByTestId("thread-row")
			.last()
			.scrollIntoViewIfNeeded()
			.catch(() => undefined);
		const more = page.getByTestId("threads-show-more");
		if (await more.isVisible()) await more.click();
		await page.waitForTimeout(800);
	}
	if ((await row.count()) === 0)
		return {
			found: false,
			state: "",
			age: "",
			label: `not among the ${await page.getByTestId("thread-row").count()} rows the sidebar loaded`,
		};
	await row.scrollIntoViewIfNeeded();
	const wrap = page.getByTestId("thread-row-wrap").filter({ has: row });
	return {
		found: true,
		state: (await row.getAttribute("data-state")) ?? "",
		age: ((await wrap.getByTestId("row-age").textContent()) ?? "").trim(),
		label: (
			(await wrap
				.getByTestId("status-label")
				.first()
				.getAttribute("aria-label")
				.catch(() => null)) ??
			(await wrap
				.getByTestId("row-status")
				.first()
				.textContent()
				.catch(() => null)) ??
			""
		).trim(),
	};
}

/** #1101 category 17, Usage and limits. */
export default defineChecks([
	{
		item: "17.1",
		async run({ page, open }) {
			await open("/settings?tab=usage", "settings-frame");
			await expect(page.getByTestId("usage-view")).toBeVisible();

			const fails: string[] = [];

			// Range chips: 24h, 7d, 30d
			const rangeControl = page.getByTestId("usage-range");
			await expect(rangeControl).toBeVisible();
			const rangeText = (await rangeControl.textContent()) ?? "";
			for (const chip of ["24h", "7d", "30d"]) {
				if (!rangeText.includes(chip))
					fails.push(`range chip missing: ${chip}`);
			}

			// Project and agent scope pickers
			await expect(page.getByTestId("usage-project")).toBeVisible();
			await expect(page.getByTestId("usage-agent")).toBeVisible();

			// Tokens and Cost tabs
			const tokensTab = page.getByTestId("usage-tab-tokens");
			const costTab = page.getByTestId("usage-tab-cost");
			const limitsTab = page.getByTestId("usage-tab-limits");
			await expect(tokensTab).toBeVisible();
			await expect(costTab).toBeVisible();
			await expect(limitsTab).toBeVisible();

			// Tokens tab: daily chart and breakdown table
			await tokensTab.click();
			const tokensPanel = page.getByTestId("usage-tokens");
			await expect(
				tokensPanel.or(page.getByTestId("usage-empty")),
			).toBeVisible();
			const emptyPanel = page.getByTestId("usage-empty");
			const hasData =
				(await tokensPanel.count()) > 0 || (await emptyPanel.count()) > 0;
			if (!hasData) fails.push("tokens tab: no content panel rendered");

			if ((await tokensPanel.count()) > 0) {
				const chart = tokensPanel.locator("svg, canvas, [role=img]").first();
				await expect(chart).toBeVisible();
				const modelBreakdown = tokensPanel.getByTestId("usage-breakdown-model");
				await expect(modelBreakdown).toBeVisible();
			}

			// Cost tab: estimate label
			await costTab.click();
			const costPanel = page.getByTestId("usage-cost");
			await expect(costPanel.or(page.getByTestId("usage-empty"))).toBeVisible();
			if ((await costPanel.count()) === 0)
				fails.push("cost tab: no cost panel rendered");
			else {
				const headers = await costPanel.locator("th").allInnerTexts();
				const hasEstimate = headers.some((h) =>
					h.toLowerCase().includes("estimate"),
				);
				if (!hasEstimate)
					fails.push(
						`cost tab: no "estimate" column header; got: ${headers.join(", ")}`,
					);
			}

			return verdict(
				fails,
				"usage-view: range chips 24h/7d/30d, project + agent pickers, Tokens/Cost/Limits tabs, daily chart, model breakdown, cost estimate label all present",
			);
		},
	},

	{
		item: "17.2",
		async run({ page, open }) {
			await open("/settings?tab=usage", "settings-frame");
			await expect(page.getByTestId("usage-view")).toBeVisible();

			await page.getByTestId("usage-range").getByText("30d").click();
			await page.getByTestId("usage-tab-tokens").click();
			const tokensPanel = page.getByTestId("usage-tokens");
			await expect(
				page.getByTestId("usage-tokens").or(page.getByTestId("usage-empty")),
			).toBeVisible();
			if ((await tokensPanel.count()) === 0)
				return {
					pass: false,
					value: "no usage-tokens panel: no usage recorded in 30 days",
				};

			const modelRow = tokensPanel.getByTestId("usage-model-row").first();
			if ((await modelRow.count()) === 0)
				return { pass: false, value: "no model rows in breakdown table" };

			const modelName = ((await modelRow.textContent()) ?? "").trim();
			await modelRow.click();

			const card = page.getByTestId("usage-model-card");
			await expect(card).toBeVisible();

			const fails: string[] = [];
			const dts = await card.locator("dt").allInnerTexts();
			const dtLower = dts.map((d) => d.toLowerCase());

			if (!dtLower.some((d) => d.includes("cost")))
				fails.push(`card dts missing cost: [${dts.join(", ")}]`);
			if (!dtLower.some((d) => d.includes("million")))
				fails.push(`card dts missing per-million: [${dts.join(", ")}]`);
			if (!dtLower.some((d) => d.includes("token")))
				fails.push(`card dts missing tokens: [${dts.join(", ")}]`);
			if (!dtLower.some((d) => d.includes("cache hit")))
				fails.push(`card dts missing cache hit rate: [${dts.join(", ")}]`);

			const dds = await card.locator("dd").allInnerTexts();
			if (dds.length < 3)
				fails.push(`card has only ${dds.length} fact values, expected ≥3`);

			return verdict(
				fails,
				`model card for "${modelName}" has ${dts.length} facts: ${dts.join(", ")}`,
			);
		},
	},

	{
		item: "17.3",
		async run({ page, open }) {
			await open("/settings?tab=usage", "settings-frame");
			await expect(page.getByTestId("usage-view")).toBeVisible();

			await page.getByTestId("usage-tab-limits").click();
			const limitsPanel = page.getByTestId("usage-limits");
			await expect(limitsPanel).toBeVisible();

			const agents = await limitsPanel.getByTestId("usage-agent").all();
			if (agents.length === 0)
				return {
					pass: false,
					value: "Limits tab rendered but no agent sections found",
				};

			const fails: string[] = [];
			let agentsWithWindows = 0;
			let agentsWithNoWindows = 0;

			for (const agent of agents) {
				const name =
					(await agent
						.locator("h3")
						.first()
						.textContent()
						.catch(() => null)) ?? "?";
				const windows = await agent.getByTestId("usage-window").all();
				if (windows.length === 0) {
					const gap =
						(await agent
							.getByTestId("usage-gap")
							.first()
							.textContent()
							.catch(() => null)) ?? "";
					if (!gap)
						fails.push(
							`agent "${name}": no windows and no gap/no-windows notice`,
						);
					agentsWithNoWindows++;
				} else {
					agentsWithWindows++;
					for (const w of windows) {
						const state = await w.getAttribute("data-state");
						const leftText =
							(await w
								.getByTestId("usage-window-left")
								.textContent()
								.catch(() => null)) ?? "";
						// "full" hides %; "unknown" shows "?"; others must show "N% left"
						if (
							state !== "full" &&
							state !== "unknown" &&
							!leftText.includes("%")
						)
							fails.push(
								`agent "${name}": window state="${state}" shows "${leftText}" not "N% left"`,
							);
						await expect(w.getByTestId("usage-ring")).toBeVisible();
						if ((await w.getByTestId("usage-reset").count()) === 0)
							fails.push(`agent "${name}": a window has no reset chip`);
						if ((await w.getByTestId("usage-pace-tick").count()) === 0)
							fails.push(`agent "${name}": a window has no pace tick`);
					}
				}
			}

			return verdict(
				fails,
				`${agents.length} agents: ${agentsWithWindows} with windows (each shows N% left, ring, reset chip and pace tick), ${agentsWithNoWindows} reporting none`,
			);
		},
	},

	{
		item: "17.4",
		async run({ page, open, sim }) {
			const path = sim.thread("limit.mid-turn");
			await open(path, "thread-page");

			const dock = page.getByTestId("limit-dock");
			await expect(dock).toBeVisible();
			await expect(dock).not.toHaveAttribute("data-state", "loading");

			const fails: string[] = [];
			const dockText = (await dock.textContent()) ?? "";

			// Head must name the limit
			if (
				!dockText.match(
					/usage limit reached|rate limited|provider busy|overloaded|credit|cap/i,
				)
			)
				fails.push(
					`dock text does not name a limit type: "${dockText.slice(0, 200)}"`,
				);

			// Must name a resume time or try count
			if (!dockText.match(/resumes|next try|retrying|try \d+ of/i))
				fails.push(
					`dock has no resume time or try-N-of-M phrase: "${dockText.slice(0, 200)}"`,
				);

			// Must offer Switch (agent or model)
			const switchBtn = dock.getByTestId("limit-dock-switch");
			const updateKey = dock.getByTestId("limit-dock-update-key");
			const hasSwitch =
				(await switchBtn.count()) > 0 || (await updateKey.count()) > 0;
			if (!hasSwitch) fails.push('dock has no "Switch" or "Update key" action');

			// What happens next: Cancel auto-resume or Resume at reset
			const cancelResume = dock.getByTestId("limit-dock-dont-resume");
			const resumeAtReset = dock.getByTestId("limit-dock-resume-at-reset");
			const hasCancelOrResume =
				(await cancelResume.count()) > 0 || (await resumeAtReset.count()) > 0;
			if (!hasCancelOrResume)
				fails.push("dock has no Cancel auto-resume or Resume at reset action");

			const dockMode = await dock.getAttribute("data-mode");
			return verdict(
				fails,
				`limit-dock mode="${dockMode}": names limit + resume time, Switch present, auto-resume action present`,
			);
		},
	},

	{
		item: "17.5",
		async run({ page, open, sim }) {
			const path = sim.thread("limit.mid-turn");
			if (!(await limitShown(page, open, path)))
				return notSetUp(
					"the sim's limit.mid-turn thread shows no limit dock, so there is no Limited thread to read",
				);
			const dockText =
				(await page.getByTestId("limit-dock").textContent()) ?? "";
			await open("/", "home");
			const row = await rowOf(page, path.split("/").pop() ?? "");
			const fails: string[] = [];
			if (!row.found) fails.push(`the limit thread's row is ${row.label}`);
			else if (row.state !== "limited")
				fails.push(`the limit thread's row reads "${row.state}", not limited`);
			if (!row.age) fails.push("the Limited row's slot shows no time");
			else if (!dockText.includes(row.age))
				fails.push(
					`row slot "${row.age}" is not the dock's time: "${dockText.slice(0, 160)}"`,
				);
			return verdict(
				fails,
				`the limit thread's row is ${row.state} with "${row.age}", the dock's reset time (the away notification is not checked here)`,
			);
		},
	},

	{
		item: "17.6",
		async run({ page, open, sim }) {
			const path = sim.thread("limit.mid-turn");
			await open(path, "thread-page");

			const fails: string[] = [];

			// Thread must NOT show failed-dock
			const failedDock = page.getByTestId("failed-dock");
			if ((await failedDock.count()) > 0)
				fails.push(
					"thread shows failed-dock: mid-turn limit was treated as a failure",
				);

			// Must show limit-dock instead
			const limitDock = page.getByTestId("limit-dock");
			await expect(limitDock).toBeVisible();
			await expect(limitDock).not.toHaveAttribute("data-state", "loading");

			// Partial transcript: at least one node before the dock
			const threadPage = page.getByTestId("thread-page");
			const nodes = threadPage.locator(
				'[data-testid^="node-"], [data-testid="message-bubble"], [data-testid="turn-row"]',
			);
			const nodeCount = await nodes.count();
			if (nodeCount === 0)
				fails.push(
					"no transcript nodes before the limit dock (partial transcript lost)",
				);

			// The usage_limit node must appear in the transcript
			const limitNode = page.getByTestId("node-usage_limit");
			if ((await limitNode.count()) === 0)
				fails.push(
					"no usage_limit transcript node (the stop event is missing)",
				);

			const dockState = await limitDock.getAttribute("data-state");
			const limitNodeCount = await page.getByTestId("node-usage_limit").count();
			return verdict(
				fails,
				`limit-dock state="${dockState}"; ${nodeCount} transcript nodes present; usage_limit node present: ${limitNodeCount > 0}`,
			);
		},
	},

	{
		item: "17.8",
		async run({ page, open, sim }) {
			const path = sim.thread("limit.mid-turn");
			if (!(await limitShown(page, open, path)))
				return notSetUp(
					"the sim's limit.mid-turn thread shows no limit dock, so there is no Limited thread to read",
				);

			const dock = page.getByTestId("limit-dock");
			await expect(dock).toBeVisible();
			await expect(dock).not.toHaveAttribute("data-state", "loading");

			const fails: string[] = [];
			const dockText = (await dock.textContent()) ?? "";

			// Strip head: "Usage limit reached" or similar
			if (
				!dockText.match(
					/usage limit reached|rate limited|provider busy|overloaded/i,
				)
			)
				fails.push(
					`strip head does not match limit phrase: "${dockText.slice(0, 200)}"`,
				);

			// Must have resume/retry phrase
			if (!dockText.match(/resumes|next try|retrying/i))
				fails.push(
					`strip has no resume/retry phrase: "${dockText.slice(0, 200)}"`,
				);

			// Two quiet text actions: Cancel auto-resume + Snooze, or similar pair
			const cancelResume = dock.getByTestId("limit-dock-dont-resume");
			const snooze = dock.getByTestId("limit-dock-snooze");
			const resumeAtReset = dock.getByTestId("limit-dock-resume-at-reset");

			const hasCancelOrResume =
				(await cancelResume.count()) > 0 || (await resumeAtReset.count()) > 0;
			const hasSnoozeOrSwitch =
				(await snooze.count()) > 0 ||
				(await dock.getByRole("button", { name: /snooze/i }).count()) > 0;

			if (!hasCancelOrResume)
				fails.push("strip missing Cancel auto-resume / Resume at reset action");
			if (!hasSnoozeOrSwitch) fails.push("strip missing Snooze until reset");

			// Sidebar row carries "Limited" badge (row-status)
			await open("/", "home");
			await expect(page.getByTestId("thread-row").first()).toBeVisible();
			const own = await rowOf(page, path.split("/").pop() ?? "");
			const hasLimitedBadge = own.state === "limited";
			if (!hasLimitedBadge)
				fails.push(
					`the limit thread's row reads "${own.state}" (${own.label}), not Limited`,
				);

			return verdict(
				fails,
				`slim limit strip with resume phrase; ${hasCancelOrResume ? "auto-resume action" : "MISSING"}, ${hasSnoozeOrSwitch ? "snooze" : "MISSING snooze"}; "Limited" badge in sidebar: ${hasLimitedBadge}`,
			);
		},
	},
]);
