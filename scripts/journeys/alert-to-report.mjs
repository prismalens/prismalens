// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { reportCitedPaths } from "../lib/cited-paths.mjs";
import {
	deliver,
	ended,
	eventually,
	incidentsFor,
	newAlert,
	runStartedFor,
	scriptedSession,
	serviceWithRepo,
} from "./lib.mjs";

/** @import { Journey, JourneyContext, Target } from "./types.mjs" */

/** The service the alert names; the scripted session's report names it as the culprit. */
const SERVICE = "packed-intake";

/**
 * An alert opens an incident, the app investigates it unattended and ends with a report
 * citing real files, a resolution closes it, and the same alert firing again is linked to
 * the incident it follows. Walks #630, #884 and #981.
 * @type {Journey}
 */
export const alertToReport = {
	name: "alert-to-report",
	title:
		"Given an alert for a mapped service, When it fires, Then an incident opens, the app investigates it unattended and reports, a resolution closes it, and the same alert firing again is linked",
	timeoutMs: 20 * 60_000,
	async run(target, ctx) {
		await investigatedAndResolved(target, ctx);
		await refiresAfterTheOperatorClosed(target, ctx);
		await refiresAfterItsAlertsCleared(target, ctx);
	},
};

/**
 * @param {Target} target
 * @param {JourneyContext} ctx
 */
async function investigatedAndResolved(target, ctx) {
	const { repo } = await serviceWithRepo(target, SERVICE);
	const alert = newAlert(
		{
			alertname: `PackedIntakeProbe${scriptedSession(target, "intake")}`,
			severity: "critical",
			service: SERVICE,
		},
		{
			summary: "Synthetic alert for the packed intake e2e",
			description:
				"POST /api/webhooks/prometheus answers 500 when the bearer token file under the workspace is empty. Find the cause.",
		},
	);

	const sentAt = Date.now();
	await deliver(target, alert, "firing");
	ctx.log("OK   POST /api/webhooks/prometheus (firing)");
	const last = await target.api("/webhooks/last-delivery");
	assert.deepEqual(
		{ received: last.received, accepted: last.accepted },
		{ received: 1, accepted: 1 },
	);
	assert.ok(
		Date.parse(last.at) >= sentAt - 1_000,
		`the last delivery is stamped ${last.at}, before this one was sent`,
	);

	const [open, ...others] = await eventually(
		() => incidentsFor(target, alert),
		(found) => found.length > 0,
		"the incident the alert opens",
	);
	assert.deepEqual(others, [], "one alert opened more than one incident");
	assert.ok(
		!["resolved", "closed"].includes(open.status),
		`the incident opened ${open.status}`,
	);
	ctx.log(`OK   open incident #${open.number} carries the alert`);

	const started = await runStartedFor(target, open);
	ctx.investigations.push(started.id);
	ctx.log(`OK   investigation ${started.id} started on its own`);
	const finished = await eventually(
		async () => {
			const body = await target.api(`/investigations/${started.id}`);
			return body.investigation ?? body;
		},
		ended,
		`investigation ${started.id} to reach a terminal state`,
		target.runTimeoutMs,
	);
	assert.equal(
		finished.status,
		"completed",
		`investigation ${started.id} ended ${finished.status}: ${finished.error ?? ""}`,
	);
	assert.ok(finished.report, `investigation ${started.id} has no report`);
	const hypotheses = finished.report.hypotheses ?? [];
	assert.ok(
		hypotheses.length > 0,
		`investigation ${started.id} completed with no hypothesis`,
	);
	const cited = reportCitedPaths(finished.report);
	assert.ok(
		cited.size > 0,
		`report for investigation ${started.id} cites no file path in any evidence source`,
	);
	// A path counts only inside the repo: an absolute path or a `..` escape is missing however real the file.
	const root = resolve(repo) + sep;
	const missing = [...cited].filter((p) => {
		const abs = resolve(repo, p);
		return !abs.startsWith(root) || !existsSync(abs);
	});
	assert.deepEqual(missing, [], `report cites paths absent from ${repo}`);
	ctx.log(
		`OK   report: ${hypotheses.length} hypothesis(es), ${cited.size} cited path(s) all present`,
	);

	await deliver(target, alert, "resolved");
	ctx.log("OK   POST /api/webhooks/prometheus (resolved)");
	const closed = await eventually(
		async () => (await incidentsFor(target, alert))[0],
		(incident) => ["resolved", "closed"].includes(incident?.status),
		`incident #${open.number} to resolve after the resolved delivery`,
	);
	ctx.log(`OK   incident #${closed.number} resolved (status=${closed.status})`);
}

/**
 * @param {Target} target
 * @param {JourneyContext} ctx
 */
async function refiresAfterTheOperatorClosed(target, ctx) {
	const alert = newAlert({ alertname: "PoolCapped", severity: "high" });
	await deliver(target, alert, "firing");
	const [first] = await eventually(
		() => incidentsFor(target, alert),
		(found) => found.length === 1,
		"the first incident",
	);
	await target.api(`/incidents/${first.id}/close`, {
		method: "POST",
		body: { actualCause: "pool capped at 10" },
	});

	await deliver(target, alert, "firing");
	const both = await eventually(
		() => incidentsFor(target, alert),
		(found) => found.length === 2,
		"a new incident after the operator's Resolve",
	);
	const next = both.find((i) => i.id !== first.id);
	const after = await target.api(`/incidents/${next?.id}`);
	assert.equal(after.status, "triggered");
	assert.deepEqual(
		{
			number: after.priorIncident?.number,
			actualCause: after.priorIncident?.actualCause,
		},
		{ number: first.number, actualCause: "pool capped at 10" },
	);
	const old = await target.api(`/incidents/${first.id}`);
	assert.equal(old.status, "closed");
	assert.equal(old.refiredAs?.number, after.number);
	ctx.log(
		`OK   incident #${after.number} names #${first.number}, which names it back`,
	);
}

/**
 * @param {Target} target
 * @param {JourneyContext} ctx
 */
async function refiresAfterItsAlertsCleared(target, ctx) {
	const alert = newAlert({ alertname: "QueueLag", severity: "high" });
	await deliver(target, alert, "firing");
	const [incident] = await eventually(
		() => incidentsFor(target, alert),
		(found) => found.length === 1,
		"the incident",
	);
	await deliver(target, alert, "resolved");
	await eventually(
		() => target.api(`/incidents/${incident.id}`),
		(i) => i.status === "resolved",
		"the incident to resolve when its alerts cleared",
	);

	await deliver(
		target,
		{ ...alert, startsAt: new Date().toISOString() },
		"firing",
	);
	const again = await eventually(
		() => target.api(`/incidents/${incident.id}`),
		(i) => i.status === "triggered",
		"the same incident back",
	);
	assert.equal(again.reopenReason, "flap");
	assert.equal((await incidentsFor(target, alert)).length, 1);
	ctx.log(`OK   incident #${incident.number} is triggered again as a flap`);
}
