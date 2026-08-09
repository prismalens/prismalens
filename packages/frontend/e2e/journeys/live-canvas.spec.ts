// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { expect, type Page, test } from "@playwright/test";

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
 * Two deliberate substitutions, because the real producers cannot be summoned
 * from a spec:
 *
 *  1. **The investigation is served as `running`.** The demo seed ships only
 *     completed investigations (by design — a permanently "running" row in
 *     demo data is a lie about the product), and `isActive` is what enables
 *     the stream at all. One field of the real `GET /investigations/{id}`
 *     response is rewritten; everything else is the API's own payload.
 *
 *  2. **The SSE transport is a double, the events are real.** Driving the
 *     genuine `/stream` endpoint needs a worker, a queue and a funded LLM
 *     provider, and it would deliver events on the harness's schedule rather
 *     than the test's — untestable and flaky in the same move. `EventSource`
 *     is replaced with a controllable stand-in; what travels through it is
 *     `CanonicalEvent` (ADR-0008), typed against the contract package, in the
 *     exact JSON shape the SSE controller emits. The transport is faked; the
 *     contract boundary, the hook, the transform and the canvas are all real.
 */

const INVESTIGATION_ID = "d0111111-1111-4111-8111-111111111111";
const RUN_ID = "e0111111-1111-4111-8111-111111111111";
const DETAIL_URL = `/investigations/${INVESTIGATION_ID}`;
const SHOTS = "e2e/journeys/screenshots";

interface StreamSourceDouble {
	onmessage: ((event: { data: string }) => void) | null;
	onerror: ((event: Event) => void) | null;
	readyState: number;
}

interface StreamControl {
	sources: StreamSourceDouble[];
	deliver(payload: string): void;
	fail(): void;
}

declare global {
	interface Window {
		__liveStream: StreamControl;
	}
}

/**
 * Serve the seeded investigation as `running` so the detail route takes the
 * active path: the SSE hook is enabled and the canvas is handed `streamEvents`
 * instead of the finished `agentExecutions`.
 */
async function serveAsRunning(page: Page): Promise<void> {
	await page.route(
		(url) => url.pathname === `/api/investigations/${INVESTIGATION_ID}`,
		async (route) => {
			const response = await route.fetch();
			const body = (await response.json()) as Record<string, unknown>;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ ...body, status: "running" }),
			});
		},
	);
}

/** Replace `EventSource` with a stand-in the test can push events through. */
async function installStreamDouble(page: Page): Promise<void> {
	await page.addInitScript(() => {
		class ControlledEventSource {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			static readonly CLOSED = 2;

			readonly url: string;
			readyState = 1;
			onmessage: ((event: { data: string }) => void) | null = null;
			onerror: ((event: Event) => void) | null = null;
			onopen: ((event: Event) => void) | null = null;

			constructor(url: string) {
				this.url = url;
				window.__liveStream.sources.push(this);
			}

			close(): void {
				this.readyState = 2;
			}
		}

		window.__liveStream = {
			sources: [],
			deliver(payload: string) {
				const source = window.__liveStream.sources.at(-1);
				if (!source) {
					throw new Error("no EventSource was opened by the page");
				}
				source.onmessage?.({ data: payload });
			},
			fail() {
				window.__liveStream.sources.at(-1)?.onerror?.(new Event("error"));
			},
		};

		window.EventSource = ControlledEventSource as unknown as typeof EventSource;
	});
}

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

/** Push one canonical event down the open stream, exactly as the SSE frame body. */
async function deliver(page: Page, event: CanonicalEvent): Promise<void> {
	await page.evaluate(
		(payload) => window.__liveStream.deliver(payload),
		JSON.stringify(event),
	);
}

/** A per-test sequence counter — `(branchId, seq)` is the stream's ordering key. */
function eventFactory(branchId = "main") {
	let seq = 0;
	const base = () => ({
		runId: RUN_ID,
		branchId,
		path: [] as string[],
		seq: seq++,
		ts: new Date().toISOString(),
	});

	return {
		agentStep(label: string, text: string): CanonicalEvent {
			return { kind: "agent_step", ...base(), label, text, toolCalls: [] };
		},
		toolResult(name: string, preview: string): CanonicalEvent {
			return {
				kind: "tool_result",
				...base(),
				label: null,
				result: {
					name,
					toolCallId: `call-${name}-${Date.now()}`,
					source: `${name} --window 15m`,
					ok: true,
					preview,
				},
			};
		},
		failure(message: string): CanonicalEvent {
			return { kind: "error", ...base(), label: null, message };
		},
		branchDone(): CanonicalEvent {
			return {
				kind: "branch_done",
				...base(),
				label: null,
				reason: "submitted",
			};
		},
	};
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
		await deliver(page, events.agentStep("cartographer", "Mapping services"));
		await expect(page.getByTestId("canvas-stream-connecting")).toBeHidden();
		await expect(canvas.getByText("Cartographer")).toBeVisible();
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
		await deliver(page, events.agentStep("detective", "Correlating deploys"));
		await expect(canvas.getByText("Detective")).toBeVisible();
		await expect(canvas.getByText("Cartographer")).toBeVisible();
		await expect(nodes).toHaveCount(3);

		// 4b. The newest node stays inside the canvas viewport. `fitView` fires
		//     once at mount, which was enough when the graph arrived complete —
		//     a growing graph pushes the node you are watching off the bottom
		//     unless the view re-fits as it grows.
		await expectNodeInFrame(page, "Detective");

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

		const setTheme = async (theme: "light" | "dark") => {
			await page.evaluate((value) => {
				document.cookie = `prismalens-theme=${value}; path=/; max-age=31536000`;
			}, theme);
			await page.reload();
			await expect(page.locator("html")).toHaveClass(new RegExp(theme));
		};

		const stream = async () => {
			const events = eventFactory();
			await expect(page.getByTestId("canvas-stream-connecting")).toBeVisible({
				timeout: 20_000,
			});
			await deliver(page, events.agentStep("cartographer", "Mapping services"));
			await deliver(page, events.toolResult("search_logs", "412 lines"));
			await deliver(page, events.agentStep("detective", "Correlating deploys"));
			// Wait for the re-fit animation to settle, or the shot catches the
			// canvas mid-pan.
			await expectNodeInFrame(page, "Detective");
			return events;
		};

		await serveAsRunning(page);
		await installStreamDouble(page);
		await page.goto(DETAIL_URL);

		// Empty state: connected, no events yet (dark is the product default).
		await setTheme("dark");
		await expect(page.getByTestId("canvas-stream-connecting")).toBeVisible({
			timeout: 20_000,
		});
		await page.waitForLoadState("networkidle");
		await shot("live-canvas-connecting-empty");

		// Streaming, dark.
		await stream();
		await shot("live-canvas-streaming-dark");

		// Streaming, light.
		await setTheme("light");
		await stream();
		await shot("live-canvas-streaming-light");

		// Error state: a canonical error mid-stream.
		await setTheme("dark");
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
