// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { test } from "node:test";
import { replayedCalls, restartResumes } from "./restart-resumes.mjs";

const step = (/** @type {string} */ id, seq = 0) => ({
	kind: "agent_step",
	seq,
	toolCalls: [{ toolCallId: id }],
});
const result = (/** @type {string} */ id, seq = 0) => ({
	kind: "tool_result",
	seq,
	result: { toolCallId: id },
});

const cut = { kind: "run_interrupted", seq: 5 };
// A finished before the first look; B finished between that look and the stop (#981).
const baseline = [
	step("A", 1),
	result("A", 2),
	step("B", 3),
	result("B", 4),
	cut,
];

test("a call that finished just before the stop and runs again after it is a replay", () => {
	assert.deepEqual(replayedCalls([...baseline, step("B", 6), result("B", 7)]), [
		"step:B",
		"result:B",
	]);
});

test("a call from before the first look that runs again is a replay", () => {
	assert.deepEqual(replayedCalls([...baseline, step("A", 6)]), ["step:A"]);
});

test("a call that streams as two steps before the stop is not a replay", () => {
	assert.deepEqual(
		replayedCalls([step("A", 1), step("A", 2), result("A", 3), cut]),
		[],
	);
});

test("a call the run had not made before the stop is not a replay", () => {
	assert.deepEqual(
		replayedCalls([...baseline, step("C", 6), result("C", 7)]),
		[],
	);
});

const restartNote = {
	kind: "operator_message",
	seq: 6,
	text: "PrismaLens stopped at 10:00. Your last command may or may not have completed.",
	via: { restart: { by: "auto" } },
};

/**
 * A target whose run is cut after one look at its events: `cutEvents` is what it holds when
 * PrismaLens has stopped and started, `resumedEvents` what it holds once the run ended.
 */
const cutRun = (
	/** @type {any[]} */ firstLook,
	/** @type {any[]} */ cutEvents,
	/** @type {any[]} */ resumedEvents,
) => {
	let phase = "working";
	let fingerprint = "";
	const events = () =>
		phase === "working"
			? firstLook
			: phase === "cut"
				? cutEvents
				: resumedEvents;
	return /** @type {any} */ ({
		name: "in-process",
		agent: "scripted",
		repo: "/fixture",
		workDir: "/work",
		runTimeoutMs: 1_000,
		sendAlert: async (/** @type {any} */ body) => {
			fingerprint = body.alerts[0].fingerprint;
			return new Response("{}", { status: 200 });
		},
		restart: async () => {
			phase = "cut";
		},
		skipRecoveryDelay: async () => {
			phase = "resumed";
		},
		api: async (/** @type {string} */ path) => {
			if (path.startsWith("/services")) return { id: "svc" };
			if (path.startsWith("/repositories")) return {};
			if (path === "/incidents?limit=100")
				return {
					data: [
						{ id: "inc", number: 1, alerts: [{ externalId: fingerprint }] },
					],
				};
			if (path === "/investigations?limit=100")
				return { data: [{ id: "run", incidentId: "inc" }] };
			if (path === "/restart") return { resumed: [{ investigationId: "run" }] };
			if (path.startsWith("/investigations/run/events"))
				return { events: events(), nextCursor: null };
			if (path === "/investigations/run")
				return {
					status:
						phase === "working"
							? "running"
							: phase === "cut"
								? "pending"
								: "completed",
					acpSessionId: "session-1",
					report: phase === "resumed" ? { cause: "x" } : null,
				};
			throw new Error(`unexpected call ${path}`);
		},
	});
};

const run = (/** @type {any} */ target) =>
	restartResumes.run(target, { log() {}, investigations: [] });

// B finished after the journey's first look and before the stop, so only a baseline read after the stop holds it.
const firstLook = [step("A", 1), result("A", 2)];

test("the journey passes when the resumed run makes a call it had not made before the stop", async () => {
	await run(
		cutRun(firstLook, baseline, [
			...baseline,
			restartNote,
			step("C", 7),
			result("C", 8),
		]),
	);
});

test("the journey rejects a resumed run that repeats a call finished between its first look and the stop", async () => {
	await assert.rejects(
		run(
			cutRun(firstLook, baseline, [
				...baseline,
				restartNote,
				step("B", 7),
				result("B", 8),
			]),
		),
		/replayed tool calls from before the stop/,
	);
});

test("the journey rejects a replay that landed before its baseline read", async () => {
	const early = [...baseline, step("B", 6)];
	await assert.rejects(
		run(
			cutRun(firstLook, early, [
				...early,
				{ ...restartNote, seq: 7 },
				step("C", 8),
				result("C", 9),
			]),
		),
		/replayed tool calls from before the stop/,
	);
});
