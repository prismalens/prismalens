// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import type { CanonicalEvent } from "@prismalens/contracts";
import {
	hideQueryDevtools,
	INVESTIGATION_ID,
	installStreamDouble,
	RUN_ID,
	serveAsRunning,
	serveEventsHistory,
	serveInvestigationAs,
} from "./live-stream-fixtures";
import { settled } from "./settled";

/**
 * Manual: `PRISMALENS_E2E_PERF=1 pnpm --filter @prismalens/frontend exec playwright test run-page-perf --project=chromium`.
 * Prints long-animation-frame totals and the dev render probe's counts on a 500-event run (#874).
 */
test.skip(
	!process.env.PRISMALENS_E2E_PERF,
	"manual probe: set PRISMALENS_E2E_PERF=1",
);

const INCIDENT_ID = "b0111111-1111-4111-8111-111111111111";
const PAGE = `/incidents/${INCIDENT_ID}/conversation?investigation=${INVESTIGATION_ID}`;
const IDLE_MS = 10_000;
const TRACE_S = Number(process.env.PRISMALENS_E2E_PERF_TRACE_S ?? 120);
const T0 = Date.parse("2026-10-20T10:00:00Z");

function event(seq: number, ts: number) {
	return {
		runId: RUN_ID,
		branchId: "main",
		path: [] as string[],
		seq,
		ts: new Date(ts).toISOString(),
	};
}

/** `pairs` steps of prose, a tool call and its result; every 25th step comes after a long thought. */
function longRun(pairs: number, from = 1, start = T0): CanonicalEvent[] {
	const out: CanonicalEvent[] = [];
	let ts = start;
	for (let i = from; i < from + pairs; i++) {
		ts += i % 25 === 0 ? 30_000 : 1_000;
		const callId = `perf-call-${i}`;
		const file = i % 3 === 0;
		out.push({
			kind: "agent_step",
			...event(i * 2 - 1, ts),
			label: "agent",
			text:
				i % 4 === 0
					? `Step ${i}: the **p99** moved after \`deploy-${i}\`.`
					: "",
			toolCalls: [
				{
					toolCallId: callId,
					name: file ? "read_file" : "bash",
					args: file
						? { path: `repo/src/file-${i}.ts` }
						: { command: `grep -n timeout svc-${i}.log` },
				},
			],
		});
		out.push({
			kind: "tool_result",
			...event(i * 2, ts + 200),
			label: null,
			result: {
				toolCallId: callId,
				name: file ? "read_file" : "bash",
				toolCategory: file ? "file" : "logs",
				ok: i % 17 !== 0,
				source: file
					? `read_file(repo/src/file-${i}.ts)`
					: `grep -n timeout svc-${i}.log`,
				preview: `line ${i}: connection pool exhausted after 30s\n`.repeat(3),
			},
		});
	}
	return out;
}

async function installLoafObserver(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const w = window as unknown as {
			__loaf: { start: number; duration: number; blocking: number }[];
		};
		w.__loaf = [];
		new PerformanceObserver((list) => {
			for (const e of list.getEntries() as (PerformanceEntry & {
				blockingDuration: number;
			})[])
				w.__loaf.push({
					start: e.startTime,
					duration: e.duration,
					blocking: e.blockingDuration,
				});
		}).observe({ type: "long-animation-frame", buffered: true });
	});
}

interface Sample {
	frames: number;
	loafMs: number;
	blockingMs: number;
	renders: Record<string, number>;
	why: [string, number][];
}

async function mark(page: Page): Promise<number> {
	return page.evaluate(() => {
		(window as unknown as { __renderProbe?: Probe }).__renderProbe?.reset();
		return performance.now();
	});
}

async function measure(page: Page, since: number): Promise<Sample> {
	return page.evaluate((t0) => {
		const loaf = (
			window as unknown as {
				__loaf: { start: number; duration: number; blocking: number }[];
			}
		).__loaf.filter((e) => e.start >= t0);
		return {
			frames: loaf.length,
			loafMs: Math.round(loaf.reduce((s, e) => s + e.duration, 0)),
			blockingMs: Math.round(loaf.reduce((s, e) => s + e.blocking, 0)),
			renders:
				(
					window as unknown as { __renderProbe?: Probe }
				).__renderProbe?.counts() ?? {},
			// The commonest reasons a component rendered, `name: reason`.
			why: Object.entries(
				(
					(window as unknown as { __renderProbe?: Probe }).__renderProbe?.log ??
					[]
				).reduce<Record<string, number>>((acc, r) => {
					const k = `${r.name}: ${r.reason}`;
					acc[k] = (acc[k] ?? 0) + 1;
					return acc;
				}, {}),
			)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 6),
		};
	}, since);
}

type Probe = {
	log: { name: string; reason: string }[];
	reset(): void;
	counts(): Record<string, number>;
};

function report(name: string, w: Sample | Record<string, unknown>) {
	console.log(`[perf] ${name} ${JSON.stringify(w)}`);
}

async function open(page: Page, lastStep: number) {
	await page.goto(PAGE);
	await expect(page.getByTestId("transcript")).toBeVisible({ timeout: 30_000 });
	await expect(
		page.locator(`[data-testid="step"][data-step="${lastStep}"]`),
	).toBeAttached({ timeout: 30_000 });
	await settled(page);
	await page.waitForTimeout(1_000);
}

test.describe("run page perf probe (#874)", () => {
	test.setTimeout(TRACE_S * 1000 + 180_000);

	test.beforeEach(async ({ page }) => {
		await hideQueryDevtools(page);
		await installLoafObserver(page);
	});

	test("ended 500-event run: load, then 10 s idle", async ({ page }) => {
		await serveInvestigationAs(page, INVESTIGATION_ID, {
			status: "completed",
			report: null,
		});
		await serveEventsHistory(page, INVESTIGATION_ID, longRun(250));
		const load = await mark(page);
		await open(page, 250);
		report("ended.load", await measure(page, load));
		const t = await mark(page);
		await page.waitForTimeout(IDLE_MS);
		report("ended.idle10s", await measure(page, t));
	});

	test("live 500-event run: idle, a 50-event burst, one tool result", async ({
		page,
	}) => {
		await installStreamDouble(page);
		await serveAsRunning(page);
		await serveEventsHistory(page, INVESTIGATION_ID, longRun(250));
		await open(page, 250);

		let t = await mark(page);
		await page.waitForTimeout(IDLE_MS);
		report("live.idle10s", await measure(page, t));

		const now = Date.now();
		const burst = longRun(25, 251, now - 60_000).map((e) => JSON.stringify(e));
		t = await mark(page);
		// 50 tasks queued at once, one per message, the way a replayed SSE chunk is dispatched.
		await page.evaluate(
			(frames) =>
				new Promise<void>((done) => {
					let n = 0;
					for (const f of frames)
						setTimeout(() => {
							window.__liveStream.deliver(f);
							if (++n === frames.length) done();
						}, 0);
				}),
			burst,
		);
		await expect(
			page.locator('[data-testid="step"][data-step="275"]'),
		).toBeAttached({ timeout: 15_000 });
		await page.waitForTimeout(1_000);
		report("live.burst50", await measure(page, t));

		const [call, result] = longRun(1, 276, Date.now() - 1_000);
		await page.evaluate(
			(f) => window.__liveStream.deliver(f),
			JSON.stringify(call),
		);
		await page.waitForTimeout(500);
		t = await mark(page);
		await page.evaluate(
			(f) => window.__liveStream.deliver(f),
			JSON.stringify(result),
		);
		await page.waitForTimeout(500);
		report("live.oneToolResult", await measure(page, t));
	});

	test("live run under change hints: no repeated first-page history reads", async ({
		page,
	}) => {
		await installStreamDouble(page);
		await serveAsRunning(page);
		await serveEventsHistory(page, INVESTIGATION_ID, longRun(250));
		const firstPages: string[] = [];
		const rowReads: string[] = [];
		page.on("request", (r) => {
			const url = new URL(r.url());
			if (
				url.pathname === `/api/investigations/${INVESTIGATION_ID}/events` &&
				!url.searchParams.get("cursor")
			)
				firstPages.push(url.search);
			if (url.pathname === `/api/investigations/${INVESTIGATION_ID}`)
				rowReads.push(url.search);
		});
		await open(page, 250);
		const before = { firstPages: firstPages.length, rowReads: rowReads.length };
		const t = await mark(page);
		// Each run another incident's agent makes writes Investigation rows, which the change stream hints.
		const deadline = Date.now() + TRACE_S * 1000;
		let started = 0;
		while (Date.now() < deadline) {
			const res = await page.request.post(
				`/api/incidents/${INCIDENT_ID}/investigate`,
				{
					data: { brief: "perf probe hint source" },
				},
			);
			if (res.ok()) started++;
			await page.waitForTimeout(
				Math.min(15_000, Math.max(0, deadline - Date.now())),
			);
		}
		report("live.trace", {
			seconds: TRACE_S,
			runsStarted: started,
			rowReadsFromHints: rowReads.length - before.rowReads,
			firstPageEventReads: firstPages.length - before.firstPages,
			...(await measure(page, t)),
		});
	});
});
