// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { eventually, type Investigation, ScenarioApp } from "./support/scenario-app.js";
import type { DispatchService } from "../../src/infrastructure/dispatch/dispatch.service.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseReset } from "@prismalens/engine";
import {
	LIMIT_RESET_NOTE,
	PROVIDER_BACK_NOTE,
	UNBLOCKED_NOTE,
} from "../../src/modules/wakes/session.js";

const pl = new ScenarioApp();

beforeAll(async () => {
	await pl.boot();
}, 60_000);

afterAll(async () => {
	await pl.dispose();
});

type Session = {
	limit?: {
		mode?: string;
		window?: string;
		resetsAt?: string | null;
		nextAttemptAt?: string;
		attempts?: number;
		maxAttempts?: number;
		autoResume?: boolean;
		gaveUp?: boolean;
		message?: string;
		since?: string;
	};
};

type Event = { kind: string; [k: string]: unknown };

const finished = (i: Investigation) => !["pending", "running"].includes(i.status);

async function startThread(sessionName: string, text = "Please inspect books"): Promise<string> {
	const res = await pl.api<{ investigationId: string }>("/threads", {
		method: "POST",
		body: {
			subject: { kind: "none" },
			text: `${text} fake-session:${sessionName}`,
		},
	});
	return res.investigationId;
}

async function waitForStop(id: string, timeoutMs = 30_000): Promise<Investigation> {
	return eventually(() => pl.investigation(id), finished, "the run to stop", timeoutMs);
}

async function events(id: string): Promise<Event[]> {
	return (await pl.api<{ events: Event[] }>(`/investigations/${id}/events?limit=200`)).events;
}

async function session(id: string): Promise<Session> {
	return (await pl.api<{ session: Session }>(`/investigations/${id}`)).session;
}

function assertPartialTranscript(evs: Event[], toolId: string): void {
	const stepIdx = evs.findIndex(
		(e) =>
			e.kind === "agent_step" &&
			typeof e.text === "string" &&
			e.text.includes("Checking the recent deploys first."),
	);
	expect(stepIdx).toBeGreaterThanOrEqual(0);
	const toolIdx = evs.findIndex(
		(e) =>
			e.kind === "tool_result" &&
			(e.result as { toolCallId?: string })?.toolCallId === toolId,
	);
	expect(toolIdx).toBeGreaterThanOrEqual(0);
	const stopIdx = evs.findIndex((e) =>
		["provider_blocked", "usage_limit", "provider_retry"].includes(e.kind),
	);
	expect(stopIdx).toBeGreaterThanOrEqual(0);
	expect(stepIdx).toBeLessThan(stopIdx);
	expect(toolIdx).toBeLessThan(stopIdx);
}

describe("Recorded-agent scenarios for provider stops and restart (#1101)", () => {
	it.each([
		{ sessionName: "api-credit", mode: "out_of_credit", toolId: "toolu_credit" },
		{ sessionName: "api-key-rejected", mode: "key_rejected", toolId: "toolu_key" },
		{ sessionName: "api-spend-cap", mode: "spend_cap", toolId: "call_cap" },
	])(
		"Blocked: $sessionName -> $mode ($toolId)",
		async ({ sessionName, mode, toolId }) => {
			const id = await startThread(sessionName);
			const stopped = await waitForStop(id);
			expect(stopped).toMatchObject({ status: "failed", endReason: "blocked" });

			const ses = await session(id);
			expect(ses.limit).toMatchObject({ mode, autoResume: true });
			expect(ses.limit?.nextAttemptAt).toBeUndefined();

			const all = await events(id);
			assertPartialTranscript(all, toolId);

			const lastError = [...all].reverse().find((e) => e.kind === "error");
			expect((lastError?.failure as { mode?: string })?.mode).toBe(mode);

			const blockedEvents = all.filter((e) => e.kind === "provider_blocked");
			expect(blockedEvents).toHaveLength(1);
			expect(blockedEvents[0]).toMatchObject({ mode });
			expect(all.filter((e) => e.kind === "resume_scheduled")).toHaveLength(0);

			// Restart, then process(now + 24 h). The status, endReason and session.limit are identical, no resumed event.
			await pl.stop();
			await pl.boot();
			const now = Date.now();
			await (await pl.sessions()).process(new Date(now + 24 * 60 * 60_000));

			const afterBoot = await pl.investigation(id);
			expect(afterBoot).toMatchObject({ status: "failed", endReason: "blocked" });
			expect((await session(id)).limit).toMatchObject({ mode, autoResume: true });
			expect((await session(id)).limit?.nextAttemptAt).toBeUndefined();
			const evsAfterBoot = await events(id);
			expect(evsAfterBoot.filter((e) => e.kind === "resumed")).toHaveLength(0);

			// POST retry-now resumes the turn once: one resumed, operator_message starting with UNBLOCKED_NOTE.
			await pl.api(`/investigations/${id}/retry-now`, { method: "POST" });

			const completed = await eventually(
				() => pl.investigation(id),
				(i) => i.status === "completed",
				"the thread to complete after retry-now",
				30_000,
			);
			expect(completed.status).toBe("completed");
			expect((await session(id)).limit).toBeUndefined();

			const evsCompleted = await events(id);
			const resumedEvents = evsCompleted.filter((e) => e.kind === "resumed");
			expect(resumedEvents).toHaveLength(1);
			const opMessages = evsCompleted.filter(
				(e) =>
					e.kind === "operator_message" &&
					typeof e.text === "string" &&
					e.text.startsWith(UNBLOCKED_NOTE),
			);
			expect(opMessages).toHaveLength(1);

			// A second retry-now answers 409
			await expect(
				pl.api(`/investigations/${id}/retry-now`, { method: "POST" }),
			).rejects.toThrow(/409/);
		},
		120_000,
	);

	it("api-rate-limit (retry-after 90 s): limited, attempts 2 of 5, restarts with same nextAttemptAt, resumes and completes", async () => {
		const id = await startThread("api-rate-limit");
		const stopped = await waitForStop(id);
		expect(stopped).toMatchObject({ status: "failed", endReason: "limited" });

		const ses = await session(id);
		expect(ses.limit).toMatchObject({
			mode: "rate_limited",
			attempts: 2,
			maxAttempts: 5,
		});

		const all = await events(id);
		assertPartialTranscript(all, "toolu_rate");

		const limitEv = all.find((e) => e.kind === "usage_limit");
		expect(limitEv).toMatchObject({ kind: "usage_limit", mode: "rate_limited" });
		const limitTs = Date.parse(limitEv!.ts as string);
		const nextAttemptTs = Date.parse(ses.limit!.nextAttemptAt as string);
		const diffSeconds = Math.round((nextAttemptTs - limitTs) / 1000);
		expect(Math.abs(diffSeconds - 90)).toBeLessThanOrEqual(2);

		// Restart; the same nextAttemptAt
		await pl.stop();
		await pl.boot();
		const afterRestartSes = await session(id);
		expect(afterRestartSes.limit?.nextAttemptAt).toBe(ses.limit!.nextAttemptAt);

		// process(nextAttemptAt + 1 s) twice: exactly one resumed, one operator_message starting with PROVIDER_BACK_NOTE, thread completes
		const processTime = new Date(nextAttemptTs + 1000);
		const sessions = await pl.sessions();
		await sessions.process(processTime);
		await sessions.process(processTime);

		const completed = await eventually(
			() => pl.investigation(id),
			(i) => i.status === "completed",
			"the thread to complete",
			30_000,
		);
		expect(completed.status).toBe("completed");

		const afterEvents = await events(id);
		expect(afterEvents.filter((e) => e.kind === "resumed")).toHaveLength(1);
		const notes = afterEvents.filter(
			(e) =>
				e.kind === "operator_message" &&
				typeof e.text === "string" &&
				e.text.startsWith(PROVIDER_BACK_NOTE),
		);
		expect(notes).toHaveLength(1);
	}, 120_000);

	it("api-rate-limit-short: completes with no usage_limit, one provider_retry that waits then succeeds on try 2, and turn_usage", async () => {
		const id = await startThread("api-rate-limit-short");
		const completed = await eventually(
			() => pl.investigation(id),
			(i) => i.status === "completed",
			"the thread to complete",
			30_000,
		);
		expect(completed.status).toBe("completed");

		const all = await events(id);
		assertPartialTranscript(all, "toolu_short");

		expect(all.filter((e) => e.kind === "usage_limit")).toHaveLength(0);

		const retries = all.filter((e) => e.kind === "provider_retry");
		// Each provider call keeps its outcome: try 2 is waited for, then recorded as gone through.
		expect(retries.map((e) => [e.mode, e.attempt, e.maxAttempts, e.phase])).toEqual([
			["rate_limited", 2, 5, "waiting"],
			["rate_limited", 2, 5, "succeeded"],
		]);

		const turnUsageEvents = all.filter((e) => e.kind === "turn_usage");
		expect(turnUsageEvents).toHaveLength(1);
		expect(turnUsageEvents[0]?.usage).toEqual({
			model: "claude-sonnet-5-5",
			inputTokens: 1200,
			outputTokens: 340,
			cacheReadTokens: 800,
			cacheWriteTokens: 60,
			totalTokens: 2400,
		});
	}, 120_000);

	it("api-overloaded: completes with overloaded provider_retry waits for tries 2 and 3, and try 3 succeeding", async () => {
		const id = await startThread("api-overloaded");
		const completed = await eventually(
			() => pl.investigation(id),
			(i) => i.status === "completed",
			"the thread to complete",
			30_000,
		);
		expect(completed.status).toBe("completed");

		const all = await events(id);
		assertPartialTranscript(all, "toolu_busy");

		const retries = all.filter((e) => e.kind === "provider_retry");
		expect(retries.map((e) => [e.mode, e.attempt, e.phase])).toEqual([
			["overloaded", 2, "waiting"],
			["overloaded", 3, "waiting"],
			["overloaded", 3, "succeeded"],
		]);
	}, 120_000);

	it("api-overloaded-gave-up: endReason limited, session.limit gaveUp, 4 provider_retry events, retry-now resumes and completes", async () => {
		const id = await startThread("api-overloaded-gave-up");
		const stopped = await waitForStop(id);
		expect(stopped).toMatchObject({ status: "failed", endReason: "limited" });

		const ses = await session(id);
		expect(ses.limit).toMatchObject({ mode: "overloaded", gaveUp: true });

		const all = await events(id);
		assertPartialTranscript(all, "toolu_busy5");

		const scheduled = all.filter((e) => e.kind === "resume_scheduled");
		expect(scheduled).toHaveLength(1);
		expect(scheduled[0]).toMatchObject({ gaveUp: true, maxAttempts: 5 });

		const retries = all.filter((e) => e.kind === "provider_retry");
		expect(retries.map((e) => [e.mode, e.attempt, e.phase])).toEqual(
			[2, 3, 4, 5].map((n) => ["overloaded", n, "waiting"]),
		);

		// retry-now resumes it once and it completes
		await pl.api(`/investigations/${id}/retry-now`, { method: "POST" });
		const completed = await eventually(
			() => pl.investigation(id),
			(i) => i.status === "completed",
			"the thread to complete after retry-now",
			30_000,
		);
		expect(completed.status).toBe("completed");
		const afterEvents = await events(id);
		expect(afterEvents.filter((e) => e.kind === "resumed")).toHaveLength(1);
	}, 120_000);

	it("provider-drop: completes after one overloaded provider_retry that waits then succeeds on try 2", async () => {
		const id = await startThread("provider-drop");
		const completed = await eventually(
			() => pl.investigation(id),
			(i) => i.status === "completed",
			"the thread to complete",
			30_000,
		);
		expect(completed.status).toBe("completed");

		const all = await events(id);
		assertPartialTranscript(all, "toolu_drop");

		const retries = all.filter((e) => e.kind === "provider_retry");
		expect(retries.map((e) => [e.mode, e.attempt, e.maxAttempts, e.phase])).toEqual([
			["overloaded", 2, 5, "waiting"],
			["overloaded", 2, 5, "succeeded"],
		]);
	}, 120_000);

	it("limit-mid-turn: resetsAt is next 06:10 Europe/London, restart preserves, process resumes with LIMIT_RESET_NOTE", async () => {
		const id = await startThread("limit-mid-turn");
		const stopped = await waitForStop(id);
		expect(stopped).toMatchObject({ status: "failed", endReason: "limited" });

		const all = await events(id);
		assertPartialTranscript(all, "toolu_limit");

		const limitEv = all.find((e) => e.kind === "usage_limit");
		// The plain line is what every surface shows; the agent's words, reset and all, stay as raw (#1101).
		expect(limitEv).toMatchObject({
			kind: "usage_limit",
			window: "session",
			text: "OpenCode reached its session limit",
			raw: "Internal error: You've hit your session limit · resets 6:10am (Europe/London)",
		});

		const limitTs = new Date(limitEv!.ts as string);
		const expectedReset = parseReset(
			limitEv!.raw as string,
			limitTs,
			"claude-code",
		);
		expect(expectedReset).not.toBeNull();
		expect(expectedReset!.toISOString()).toBe(next0610London(limitTs).toISOString());

		const ses = await session(id);
		expect(ses.limit?.resetsAt).toBe(expectedReset!.toISOString());

		// Restart: the same resetsAt and nextAttemptAt
		await pl.stop();
		await pl.boot();
		const afterSes = await session(id);
		expect(afterSes.limit?.resetsAt).toBe(ses.limit!.resetsAt);
		expect(afterSes.limit?.nextAttemptAt).toBe(ses.limit!.nextAttemptAt);

		// process(reset + 3 min) twice: one resumed (reason: limit_reset), one operator_message starting with LIMIT_RESET_NOTE
		const processTime = new Date(expectedReset!.getTime() + 3 * 60_000);
		const sessions = await pl.sessions();
		await sessions.process(processTime);
		await sessions.process(processTime);

		const completed = await eventually(
			() => pl.investigation(id),
			(i) => i.status === "completed",
			"the thread to complete",
			30_000,
		);
		expect(completed.status).toBe("completed");

		const afterEvents = await events(id);
		const resumedEvents = afterEvents.filter((e) => e.kind === "resumed");
		expect(resumedEvents).toHaveLength(1);
		expect(resumedEvents[0]).toMatchObject({ reason: "limit_reset" });

		const notes = afterEvents.filter(
			(e) =>
				e.kind === "operator_message" &&
				typeof e.text === "string" &&
				e.text.startsWith(LIMIT_RESET_NOTE),
		);
		expect(notes).toHaveLength(1);
	}, 120_000);

	it("crash boundary (a): crash after resumed event before admission admits exactly once on next process", async () => {
		const id = await startThread("api-rate-limit");
		await waitForStop(id);
		const ses = await session(id);
		const nextAttemptTs = Date.parse(ses.limit!.nextAttemptAt as string);

		const { DispatchService } = await import(
			"../../src/infrastructure/dispatch/dispatch.service.js"
		);
		// An unresolved service makes the spy throw, which fails the test.
		const dispatch = pl.resolve<DispatchService>(DispatchService);
		const crash = vi
			.spyOn(dispatch!, "resumeInvestigation")
			.mockRejectedValueOnce(new Error("crash before admission"));

		const processTime = new Date(nextAttemptTs + 1000);
		const sessions = await pl.sessions();
		await sessions.process(processTime);
		expect(crash).toHaveBeenCalledTimes(1);
		expect((await events(id)).filter((e) => e.kind === "resumed")).toHaveLength(1);
		expect((await pl.investigation(id)).status).toBe("failed");
		crash.mockRestore();

		// Next process resumes
		await sessions.process(processTime);

		await eventually(
			() => pl.investigation(id),
			(i) => i.status === "completed",
			"resumed run to complete",
			30_000,
		);

		const all = await events(id);
		expect(all.filter((e) => e.kind === "resumed")).toHaveLength(1);
		const notes = all.filter(
			(e) =>
				e.kind === "operator_message" &&
				typeof e.text === "string" &&
				e.text.startsWith(PROVIDER_BACK_NOTE),
		);
		expect(notes).toHaveLength(1);
	}, 120_000);

	it("crash boundary (b): queue delivery across a restart delivers note, interrupted turn and queued message once", async () => {
		const askText = "Inspect deploy history";
		const id = await startThread("api-rate-limit", askText);
		await waitForStop(id);

		const queuedMsg = "Then check the cache hit rate.";
		await pl.api(`/investigations/${id}/auto-resume`, {
			method: "PUT",
			body: { on: true, message: queuedMsg },
		});

		// Restart
		await pl.stop();
		await pl.boot();

		const ses = await session(id);
		expect(ses.limit?.message).toBe(queuedMsg);

		const nextAttemptTs = Date.parse(ses.limit!.nextAttemptAt as string);
		const sessions = await pl.sessions();
		await sessions.process(new Date(nextAttemptTs + 1000));

		await eventually(
			() => pl.investigation(id),
			(i) => i.status === "completed",
			"the thread to complete",
			30_000,
		);

		const all = await events(id);
		const expectedFullText = `${PROVIDER_BACK_NOTE}\n\n${askText} fake-session:api-rate-limit\n\n${queuedMsg}`;
		const matching = all.filter(
			(e) => e.kind === "operator_message" && e.text === expectedFullText,
		);
		expect(matching).toHaveLength(1);
	}, 120_000);

	it("crash boundary (c): restart while resumed run is in flight records run_interrupted and does not re-fire wake", async () => {
		const id = await startThread("limit-mid-turn");
		await waitForStop(id);

		const allBefore = await events(id);
		const limitEv = allBefore.find((e) => e.kind === "usage_limit");
		const limitTs = new Date(limitEv!.ts as string);
		const expectedReset = parseReset(
			limitEv!.raw as string,
			limitTs,
			"claude-code",
		);
		expect(expectedReset).not.toBeNull();

		const processTime = new Date(expectedReset!.getTime() + 3 * 60_000);
		const sessions = await pl.sessions();
		await sessions.process(processTime);

		await eventually(
			() => pl.investigation(id),
			(i) => i.status === "running",
			"resumed run to be running",
			30_000,
		);

		await pl.ranSince(new Date(Date.now() - 10 * 60_000));
		await pl.stop();
		await pl.boot();

		const allAfter = await events(id);
		const interrupted = allAfter.filter((e) => e.kind === "run_interrupted");
		expect(interrupted).toHaveLength(1);

		const notes = allAfter.filter(
			(e) =>
				e.kind === "operator_message" &&
				typeof e.text === "string" &&
				e.text.startsWith(LIMIT_RESET_NOTE),
		);
		expect(notes).toHaveLength(1);

		// The wake is not fired again: process(reset + 1 h) adds no resumed
		const freshSessions = await pl.sessions();
		await freshSessions.process(
			new Date(expectedReset!.getTime() + 60 * 60_000),
		);

		const finalEvents = await events(id);
		expect(finalEvents.filter((e) => e.kind === "resumed")).toHaveLength(1);
	}, 120_000);
});

/** The first 06:10 London wall time after `from`, computed apart from parseReset. */
function next0610London(from: Date): Date {
	const london = new Intl.DateTimeFormat("en-GB", {
		timeZone: "Europe/London",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});
	const hits: number[] = [];
	for (let day = -1; day <= 2; day++)
		for (const offsetHours of [0, 1]) {
			const at = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + day, 6 - offsetHours, 10);
			if (london.format(new Date(at)).endsWith(" 06:10") && at > from.getTime()) hits.push(at);
		}
	return new Date(Math.min(...hits));
}
