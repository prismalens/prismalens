// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import {
	deliver,
	ended,
	eventsOf,
	eventually,
	incidentsFor,
	newAlert,
	runStartedFor,
	scriptedSession,
	serviceWithRepo,
} from "./lib.mjs";

/** @import { Journey } from "./types.mjs" */

const SERVICE = "restart-resumes";

/** The tool calls an event stream names, so a replay of one shows as a repeated id. */
const callIds = (/** @type {any[]} */ events) =>
	events.flatMap((e) =>
		e.kind === "tool_result"
			? [`result:${e.result.toolCallId}`]
			: e.kind === "agent_step"
				? e.toolCalls.map((/** @type {any} */ c) => `step:${c.toolCallId}`)
				: [],
	);

/** Tool calls among the events past `baseline` that the baseline already holds, so replayed. */
export const replayedCalls = (
	/** @type {any[]} */ baseline,
	/** @type {any[]} */ after,
) => {
	const already = new Set(callIds(baseline));
	return callIds(after.slice(baseline.length)).filter((c) => already.has(c));
};

/**
 * A run PrismaLens's stop cuts off is taken up again in the same agent session, told once
 * what happened, and does not redo what it already did. Walks #981.
 * @type {Journey}
 */
export const restartResumes = {
	name: "restart-resumes",
	title:
		"Given a run working, When PrismaLens stops and starts, Then the run resumes in the same session with one message from PrismaLens and nothing from before the stop is replayed",
	timeoutMs: 20 * 60_000,
	async run(target, ctx) {
		await serviceWithRepo(target, SERVICE);
		const alert = newAlert(
			{
				alertname: `${SERVICE}${scriptedSession(target, "live-resume")}`,
				service: SERVICE,
				severity: "critical",
			},
			{
				summary: `${SERVICE} is slow`,
				description:
					"GET /books answers slowly since the last deploy. Find the cause.",
			},
		);
		await deliver(target, alert, "firing");
		const [incident] = await eventually(
			() => incidentsFor(target, alert),
			(found) => found.length === 1,
			`the ${SERVICE} incident`,
		);
		const started = await runStartedFor(target, incident);
		ctx.investigations.push(started.id);
		const id = started.id;

		// Cut the run where it has done work, so the restart interrupts a turn with a tool call in it.
		await eventually(
			() => eventsOf(target, id),
			(events) => events.some((e) => e.kind === "tool_result"),
			"the run to reach its first tool result",
			target.runTimeoutMs,
		);
		const working = await target.api(`/investigations/${id}`);
		assert.ok(working.acpSessionId, "the working run has no agent session id");
		assert.ok(
			!ended(working),
			`the run ended ${working.status} before the restart could cut it`,
		);
		ctx.log(`OK   run ${id} is working in session ${working.acpSessionId}`);

		await target.restart();
		ctx.log("OK   PrismaLens stopped and started again");

		const cut = await target.api(`/investigations/${id}`);
		assert.equal(cut.status, "pending");
		// Nothing runs while the run is pending, so this holds every event the run had when it was cut.
		const baseline = await eventsOf(target, id);
		const listed = await target.api("/restart");
		assert.ok(
			listed.resumed
				.map((/** @type {any} */ r) => r.investigationId)
				.includes(id),
			`GET /restart does not list run ${id} as resumed`,
		);

		await target.skipRecoveryDelay?.(id);
		const done = await eventually(
			() => target.api(`/investigations/${id}`),
			ended,
			"the resumed run to end",
			target.runTimeoutMs,
		);
		assert.equal(
			done.status,
			"completed",
			`the resumed run ended ${done.status}: ${done.error ?? ""}`,
		);
		assert.ok(done.report, "the resumed run has no report");
		assert.equal(done.acpSessionId, working.acpSessionId);

		const after = await eventsOf(target, id);
		const messages = after.filter(
			(e) => e.kind === "operator_message" && e.via?.restart,
		);
		assert.equal(messages.length, 1);
		assert.equal(messages[0].via.restart.by, "auto");
		assert.ok(
			messages[0].text.startsWith("PrismaLens stopped at"),
			`the restart message opens: ${messages[0].text.slice(0, 80)}`,
		);
		assert.match(
			messages[0].text,
			/Your last command may or may not have completed/,
		);
		ctx.log("OK   one message from PrismaLens told the agent what happened");

		const key = (/** @type {any} */ e) =>
			`${e.kind}:${"seq" in e ? e.seq : ""}`;
		assert.deepEqual(
			after.slice(0, baseline.length).map(key),
			baseline.map(key),
		);
		const added = after.slice(baseline.length);
		assert.ok(added.length > 0, "the resumed run added no event");
		assert.deepEqual(
			replayedCalls(baseline, after),
			[],
			"the resumed run replayed tool calls from before the stop",
		);
		ctx.log(`OK   ${added.length} new events, none replayed`);
	},
};
