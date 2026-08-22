// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page } from "@playwright/test";
import type { CanonicalEvent } from "@prismalens/contracts";

/**
 * Doubles shared by the specs that drive the live investigation stream
 * (`live-canvas.spec.ts` #247, `investigation-stream-panel.spec.ts` #280).
 *
 * The real producers cannot be summoned from a spec: the demo seed ships no
 * `running` investigation, and the genuine `/stream` endpoint needs a worker, a
 * queue and a funded LLM provider. Only the transport and the one status field
 * are faked — the contract boundary, the hook and the UI are all real.
 */

export const INVESTIGATION_ID = "d0111111-1111-4111-8111-111111111111";
export const RUN_ID = "e0111111-1111-4111-8111-111111111111";
export const DETAIL_URL = `/investigations/${INVESTIGATION_ID}`;
export const SHOTS = "e2e/journeys/screenshots";

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
 * Serve the seeded investigation as `running`. `isActive` is what enables the
 * stream at all; one field of the real response is rewritten, the rest is the
 * API's own payload.
 */
export async function serveAsRunning(page: Page): Promise<void> {
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
export async function installStreamDouble(page: Page): Promise<void> {
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

/** Push one canonical event down the open stream, exactly as the SSE frame body. */
export async function deliver(
	page: Page,
	event: CanonicalEvent,
): Promise<void> {
	await page.evaluate(
		(payload) => window.__liveStream.deliver(payload),
		JSON.stringify(event),
	);
}

/** A per-test sequence counter — `(branchId, seq)` is the stream's ordering key. */
export function eventFactory(branchId = "main") {
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

/** Flip the app's theme cookie and reload onto the new theme. */
export async function setTheme(
	page: Page,
	theme: "light" | "dark",
): Promise<void> {
	await page.evaluate((value) => {
		document.cookie = `prismalens-theme=${value}; path=/; max-age=31536000`;
	}, theme);
	await page.reload();
	await expect(page.locator("html")).toHaveClass(new RegExp(theme));
}
