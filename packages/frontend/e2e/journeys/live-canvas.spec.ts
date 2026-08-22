// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";

import {
	DETAIL_URL,
	deliver,
	eventFactory,
	installStreamDouble,
	serveAsRunning,
	setTheme,
	SHOTS,
} from "./live-stream-fixtures";

/**
 * #247 — the investigation canvas streams live.
 *
 * The behaviour under test is the CHANGE, not the page: the canvas used to
 * render once, from `AgentExecution` rows, after the run had finished. It now
 * builds itself from the canonical event stream while the run is still going.
 * So every assertion here is about the graph *growing* — a node that was not
 * there before an event arrives and is there after it, with nothing else
 * reloaded in between.
 *
 * The transport and the `running` status are doubles; see
 * `./live-stream-fixtures.ts` for what is faked and why.
 */

/**
 * Assert a node is fully inside the canvas frame. `fitView` runs on an
 * animation, so this polls rather than sampling once.
 */
async function expectNodeInFrame(page: Page, label: string): Promise<void> {
	const canvas = page.getByTestId("investigation-canvas");
	await expect
		.poll(
			async () => {
				const frame = await canvas.boundingBox();
				const node = await canvas.getByText(label).boundingBox();
				if (!frame || !node) return false;
				return (
					node.y >= frame.y && node.y + node.height <= frame.y + frame.height
				);
			},
			{ timeout: 10_000 },
		)
		.toBe(true);
}

test.describe("#247 — the investigation canvas streams live", () => {
	test("grows the graph event by event instead of waiting for completion", async ({
		page,
	}) => {
		await serveAsRunning(page);
		await installStreamDouble(page);

		const events = eventFactory();
		await page.goto(DETAIL_URL);

		// 1. Stream open, nothing received yet. The canvas must say so rather
		//    than render an empty graph that looks like "no agents ran".
		await expect(page.getByTestId("canvas-stream-connecting")).toBeVisible({
			timeout: 20_000,
		});

		const canvas = page.getByTestId("investigation-canvas");
		const nodes = canvas.locator(".react-flow__node");

		// 2. First agent step — the graph appears mid-run: START + one agent.
		await deliver(page, events.agentStep("scout", "Mapping services"));
		await expect(page.getByTestId("canvas-stream-connecting")).toBeHidden();
		await expect(canvas.getByText("Scout")).toBeVisible();
		await expect(canvas.getByText("START")).toBeVisible();
		await expect(nodes).toHaveCount(2);

		// 3. A tool result lands on the agent that is currently running, and the
		//    node it belongs to updates in place — no new node, no reload.
		await deliver(page, events.toolResult("search_logs", "412 matching lines"));
		await expect(canvas.getByText("1 tool")).toBeVisible();
		await expect(nodes).toHaveCount(2);

		// 4. The next agent step appends a second node while the first stays.
		//    This is the whole point of #247: render-on-completion could not
		//    show this intermediate shape at all.
		await deliver(page, events.agentStep("analyst", "Correlating deploys"));
		await expect(canvas.getByText("Analyst")).toBeVisible();
		await expect(canvas.getByText("Scout")).toBeVisible();
		await expect(nodes).toHaveCount(3);

		// 4b. The newest node stays inside the canvas viewport. `fitView` fires
		//     once at mount, which was enough when the graph arrived complete —
		//     a growing graph pushes the node you are watching off the bottom
		//     unless the view re-fits as it grows.
		await expectNodeInFrame(page, "Analyst");

		// 5. Both agent edges animate while the run is in flight. The stream
		//    carries no per-node completion signal — only `branch_done` ends a
		//    branch — so a node stays `running` until then, and the canvas
		//    animates every step it has seen rather than guessing at one.
		const animated = canvas.locator(".react-flow__edge.animated");
		await expect(animated).toHaveCount(2);

		// 6. A canonical error fails the node the branch is currently on,
		//    surfaces the message on that node, and stops its animation. The
		//    earlier agent is untouched and keeps running.
		await deliver(page, events.failure("harness lost the tool socket"));
		await expect(canvas.getByText("harness lost the tool socket")).toBeVisible();
		await expect(animated).toHaveCount(1);
		await expect(nodes).toHaveCount(3);

		// 7. `branch_done` settles whatever is still running and the graph
		//    stops moving — the terminal state the old render-on-completion
		//    canvas was the only thing that could ever show.
		await deliver(page, events.branchDone());
		await expect(animated).toHaveCount(0);
		await expect(canvas.getByText("harness lost the tool socket")).toBeVisible();
		await expect(nodes).toHaveCount(3);
	});

	test("#436 — minimap uses dark theme styling in dark mode", async ({
		page,
	}) => {
		const setTheme = async (theme: "light" | "dark") => {
			await page.evaluate((value) => {
				document.cookie = `prismalens-theme=${value}; path=/; max-age=31536000`;
			}, theme);
			await page.reload();
			await expect(page.locator("html")).toHaveClass(new RegExp(theme));
		};

		await serveAsRunning(page);
		await installStreamDouble(page);
		await page.goto(DETAIL_URL);

		const events = eventFactory();
		await setTheme("dark");
		await expect(page.getByTestId("canvas-stream-connecting")).toBeVisible({
			timeout: 20_000,
		});
		await deliver(page, events.agentStep("scout", "Mapping services"));
		await expectNodeInFrame(page, "Scout");

		const minimap = page.locator(".react-flow__minimap");
		await expect(minimap).toBeVisible();

		// In dark mode, the minimap container background must not stay white (#fff / rgb(255, 255, 255))
		const bg = await minimap.evaluate((el) => {
			return window.getComputedStyle(el).backgroundColor;
		});
		expect(bg).not.toBe("rgb(255, 255, 255)");
	});

	/**
	 * Design evidence for the frontend gate (AGENTS.md): the changed surface in
	 * both themes plus its empty and error states, captured the same way #286's
	 * `manual-authorship.spec.ts` captures the incidents surface.
	 */
	test("design evidence: connecting, streaming in both themes, and the error state", async ({
		page,
	}) => {
		const shot = (name: string) =>
			page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

		const stream = async () => {
			const events = eventFactory();
			await expect(page.getByTestId("canvas-stream-connecting")).toBeVisible({
				timeout: 20_000,
			});
			await deliver(page, events.agentStep("scout", "Mapping services"));
			await deliver(page, events.toolResult("search_logs", "412 lines"));
			await deliver(page, events.agentStep("analyst", "Correlating deploys"));
			// Wait for the re-fit animation to settle, or the shot catches the
			// canvas mid-pan.
			await expectNodeInFrame(page, "Analyst");
			return events;
		};

		await serveAsRunning(page);
		await installStreamDouble(page);
		await page.goto(DETAIL_URL);

		// Empty state: connected, no events yet (dark is the product default).
		await setTheme(page, "dark");
		await expect(page.getByTestId("canvas-stream-connecting")).toBeVisible({
			timeout: 20_000,
		});
		await page.waitForLoadState("networkidle");
		await shot("live-canvas-connecting-empty");

		// Streaming, dark.
		await stream();
		await shot("live-canvas-streaming-dark");

		// Streaming, light.
		await setTheme(page, "light");
		await stream();
		await shot("live-canvas-streaming-light");

		// Error state: a canonical error mid-stream.
		await setTheme(page, "dark");
		const events = await stream();
		await deliver(page, events.failure("harness lost the tool socket"));
		await expect(
			page
				.getByTestId("investigation-canvas")
				.getByText("harness lost the tool socket"),
		).toBeVisible();
		await shot("live-canvas-error");
	});
});
