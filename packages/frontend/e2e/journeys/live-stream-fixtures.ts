// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, type Route } from "@playwright/test";
import { type CanonicalEvent, rowKey } from "@prismalens/contracts";
import { trackRequests } from "./settled";

/**
 * Doubles shared by the specs that drive the live investigation stream (#280),
 * the conversation and its box.
 *
 * The real producers cannot be summoned from a spec: the demo seed ships no
 * `running` investigation, and the genuine `/stream` endpoint needs a live
 * investigation run and a funded LLM provider. Only the transport and the one
 * status field are faked — the contract boundary, the hook and the UI are all real.
 */

export const INVESTIGATION_ID = "d0111111-1111-4111-8111-111111111111";
/** The demo seed's second investigation — for navigating between two of them. */
export const SECOND_INVESTIGATION_ID = "d0222222-2222-4222-8222-222222222222";
export const RUN_ID = "e0111111-1111-4111-8111-111111111111";
export const DETAIL_URL = `/investigations/${INVESTIGATION_ID}`;

interface StreamSourceDouble {
	url: string;
	onmessage: ((event: { data: string }) => void) | null;
	onerror: ((event: Event) => void) | null;
	readyState: number;
	listeners: Map<string, Set<(e: MessageEvent) => void>>;
}

interface StreamControl {
	sources: StreamSourceDouble[];
	deliver(payload: string): void;
	fail(): void;
	emit(path: string, type: string, data: string): void;
}

declare global {
	interface Window {
		__liveStream: StreamControl;
	}
}

/**
 * A route this file rewrites one field of, `route.fetch()`-then-`fulfill()`.
 * Dev mode double-invokes effects (React StrictMode), so `GET
 * /api/investigations/:id` can fire twice for one navigation; the browser
 * cancels whichever one a newer request supersedes, and reading `.json()` on
 * that cancelled response throws `Response has been disposed` (observed
 * 2026-09-22 in the full suite, not always alone). That discarded
 * fetch has nothing left reading it — the surviving duplicate carries the
 * page — so this is swallowed rather than failing the test.
 */
function isDisposedResponse(error: unknown): boolean {
	return error instanceof Error && /disposed/i.test(error.message);
}

/** The longest `Retry-After-<throttler>` the API sent, in ms (at least 1s). */
function retryAfterMs(headers: Record<string, string>): number {
	const seconds = Object.entries(headers)
		.filter(([name]) => name.startsWith("retry-after"))
		.map(([, value]) => Number(value))
		.filter((n) => n > 0);
	return Math.max(1, ...seconds) * 1000;
}

/** Fetch the real response and hand it to `rewrite` for `route.fulfill()`. */
async function rewriteJsonResponse(
	page: Page,
	route: Route,
	rewrite: (body: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
	try {
		let response = await route.fetch();
		// The API throttles per client and the app never retries a 429 (router.tsx);
		// a burst of this spec's own reloads is not what it tests, so wait it out.
		for (let i = 0; response.status() === 429 && i < 3; i++) {
			await page.waitForTimeout(retryAfterMs(response.headers()));
			response = await route.fetch();
		}
		// Any other error rewritten into a 200 is a run with no id, which the page
		// keys every panel by; pass errors through as the API sent them.
		if (!response.ok()) {
			await route.fulfill({ response });
			return;
		}
		const body = (await response.json()) as Record<string, unknown>;
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(rewrite(body)),
		});
	} catch (error) {
		if (page.isClosed() || isDisposedResponse(error)) {
			return;
		}
		await route.abort().catch(() => {});
		throw error;
	}
}

/**
 * Serve the seeded investigation as `running`. `isActive` is what enables the
 * stream at all; one field of the real response is rewritten, the rest is the
 * API's own payload.
 */
export async function serveAsRunning(
	page: Page,
	investigationId: string = INVESTIGATION_ID,
): Promise<void> {
	await page.route(
		(url) => url.pathname === `/api/investigations/${investigationId}`,
		(route) =>
			rewriteJsonResponse(page, route, (body) => ({
				...body,
				status: "running",
			})),
	);
}

/**
 * Rewrite arbitrary fields of a real `GET /api/investigations/:id` response,
 * the same one-field-rewrite technique `serveAsRunning` uses for `status`.
 * Lets a spec put an investigation into a terminal state (`failed`,
 * `cancelled`) that the seed data does not carry, without inventing a whole
 * fixture investigation.
 */
export async function serveInvestigationAs(
	page: Page,
	investigationId: string,
	overrides: Record<string, unknown>,
): Promise<void> {
	await page.route(
		(url) => url.pathname === `/api/investigations/${investigationId}`,
		(route) =>
			rewriteJsonResponse(page, route, (body) => ({ ...body, ...overrides })),
	);
}

/**
 * Fake the durable canonical event history (`GET /investigations/:id/events`)
 * for an investigation whose events the seed never wrote — the demo seed
 * ships completed investigations with a report but no event rows, so the
 * conversation otherwise has nothing to show.
 */
export async function serveEventsHistory(
	page: Page,
	investigationId: string,
	events: CanonicalEvent[],
): Promise<void> {
	await page.route(
		(url) => url.pathname === `/api/investigations/${investigationId}/events`,
		async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ events, nextCursor: null }),
			});
		},
	);
}

/** The thread's window gen `serveThreadWindow` answers with; a live frame must carry it. */
export const WINDOW_GEN = 1;

/**
 * Serve a thread's transcript the way the thread page opens it, `GET /investigations/:id/window`,
 * one page holding every event `events()` returns. The page opens its stream only after this.
 */
export async function serveThreadWindow(
	page: Page,
	threadId: string,
	events: () => CanonicalEvent[],
): Promise<void> {
	await page.route(
		(url) => url.pathname === `/api/investigations/${threadId}/window`,
		(route) => {
			const list = events();
			// The stored row's key: the page sorts by it, so a made-up one reorders the thread.
			const key = (i: number) => {
				const e = list[i];
				return rowKey(e && "branchId" in e ? e.branchId : "main", e?.seq ?? i);
			};
			return route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					gen: WINDOW_GEN,
					revision: list.length,
					index: {
						gen: WINDOW_GEN,
						revision: list.length,
						total: list.length,
						lost: 0,
						turns: [],
						entries: [],
					},
					page: {
						gen: WINDOW_GEN,
						revision: list.length,
						lo: list.length ? key(0) : null,
						hi: list.length ? key(list.length - 1) : null,
						hasBefore: false,
						hasAfter: false,
						items: list.map((event, i) => ({
							key: key(i),
							ordinal: i + 1,
							event,
						})),
						context: {
							stepsBefore: 0,
							endsBefore: 0,
							operatorsBefore: 0,
							agentBefore: false,
						},
						folded: [],
						target: null,
					},
					state: { openAsks: [], queue: [], hypotheses: [] },
					landing: null,
				}),
			});
		},
	);
}

/** One worktree in a thread's context; its counts are the details box's Changes row. */
export interface ContextRepo {
	name: string;
	branch: string | null;
	head: string;
	additions: number | null;
	deletions: number | null;
}

/**
 * Serve `GET /threads/:id/context`, what the details box beside the transcript reads: a
 * project thread when `project` is given, else one with no subject.
 */
export async function serveThreadContext(
	page: Page,
	threadId: string,
	ctx: () => {
		title: string;
		cwd: string;
		repos: ContextRepo[];
		project?: { id: string; name: string };
	},
): Promise<void> {
	await page.route(
		(url) => url.pathname === `/api/threads/${threadId}/context`,
		(route) => {
			const c = ctx();
			const base = {
				threadId,
				title: c.title,
				machine: { hostName: "devbox", os: "linux", isHost: true },
				agent: { harness: null, model: null, effort: null },
				workspace: {
					layout: "single",
					cwd: c.cwd,
					repos: c.repos,
					kept: [],
				},
				lineage: [],
				plan: null,
				pullRequests: [],
			};
			return route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(
					c.project
						? { kind: "project", ...base, project: c.project, scripts: [] }
						: { kind: "none", ...base, helperPlace: null },
				),
			});
		},
	);
}

/** Push one event down a thread's open window stream, as the server's `live` frame. */
export async function deliverLive(
	page: Page,
	threadId: string,
	event: CanonicalEvent,
): Promise<void> {
	const path = `/api/investigations/${threadId}/stream`;
	// The page opens its stream once the window is in; wait for that, not for a fixed time.
	await expect
		.poll(() =>
			page.evaluate(
				(p) =>
					window.__liveStream.sources.some(
						(s) =>
							s.readyState !== 2 &&
							new URL(s.url, location.href).pathname === p,
					),
				path,
			),
		)
		.toBe(true);
	await page.evaluate(
		({ p, data }) => window.__liveStream.emit(p, "live", data),
		{ p: path, data: JSON.stringify({ gen: WINDOW_GEN, event }) },
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
			readonly listeners = new Map<string, Set<(e: MessageEvent) => void>>();

			constructor(url: string) {
				this.url = url;
				window.__liveStream.sources.push(this);
			}

			addEventListener(type: string, fn: (e: MessageEvent) => void): void {
				const set = this.listeners.get(type) ?? new Set();
				set.add(fn);
				this.listeners.set(type, set);
			}

			removeEventListener(type: string, fn: (e: MessageEvent) => void): void {
				this.listeners.get(type)?.delete(fn);
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
			emit(path: string, type: string, data: string) {
				const source = window.__liveStream.sources.findLast(
					(s) =>
						s.readyState !== 2 &&
						new URL(s.url, location.href).pathname === path,
				);
				if (!source) throw new Error(`no open EventSource for ${path}`);
				source.listeners.get(type)?.forEach((fn) => {
					fn(new MessageEvent(type, { data }));
				});
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

/**
 * Hide the TanStack Query devtools button the dev server renders at the
 * bottom-right corner, where it sits over the docked box's own button (#743).
 * It is dev tooling, not the app under test.
 */
export async function hideQueryDevtools(page: Page): Promise<void> {
	trackRequests(page);
	await page.addInitScript(() => {
		const style = document.createElement("style");
		style.textContent = ".tsqd-parent-container { display: none !important; }";
		document.addEventListener("DOMContentLoaded", () =>
			document.head.append(style),
		);
	});
}

/**
 * Forget the panel width a resize stored for the person: it lives on the stack's server, so a
 * width one test dragged would open the next test's panel at that width (#1154).
 */
export async function forgetPanelWidth(page: Page): Promise<void> {
	const r = await page.request.get("/api/settings/person");
	const { values } = (await r.json()) as { values: Record<string, string> };
	const { "pl.panelWidth": _, ...rest } = values;
	const put = await page.request.put("/api/settings/person", {
		data: { values: rest },
	});
	expect(put.ok()).toBe(true);
}
