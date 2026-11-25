// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// What every journey needs and none may reach past: HTTP calls through a Target, no product imports.
import assert from "node:assert/strict";
import { join } from "node:path";
import { fingerprintOf } from "../fakes/fake-alertmanager.mjs";
import { makeIntakeFixtureRepo } from "../lib/intake-fixture.mjs";

/** @import { Target } from "./types.mjs" */

/** One oRPC handler serves a whole contract, so polls share its 10/s throttle bucket. */
const POLL_MS = 500;

/**
 * @template T
 * @param {() => Promise<T>} read
 * @param {(value: T) => boolean} ok
 * @param {string} what
 * @param {number} [timeoutMs]
 * @returns {Promise<T>}
 */
export async function eventually(read, ok, what, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	/** @type {T | undefined} */
	let last;
	while (Date.now() < deadline) {
		last = await read();
		if (ok(last)) return last;
		await new Promise((r) => setTimeout(r, POLL_MS));
	}
	throw new Error(
		`timed out after ${timeoutMs}ms waiting for ${what}; last: ${JSON.stringify(last)}`,
	);
}

/**
 * @typedef {object} Alert
 * @property {Record<string, string>} labels
 * @property {Record<string, string>} [annotations]
 * @property {string} startsAt
 */

/** A firing alert whose labels carry `probe`, so one journey's alerts never meet another's. */
export function newAlert(
	/** @type {Record<string, string>} */ labels,
	/** @type {Record<string, string>} */ annotations = {},
) {
	return {
		labels: { ...labels, probe: probeId() },
		annotations,
		startsAt: new Date().toISOString(),
	};
}

let probes = 0;
function probeId() {
	probes += 1;
	return `${Date.now().toString(36)}-${probes}`;
}

/** The fingerprint Alertmanager would give this label set, which PrismaLens stores as the alert's `externalId`. */
export const fingerprint = (/** @type {Alert} */ alert) =>
	fingerprintOf(alert.labels);

/**
 * An Alertmanager v4 webhook group carrying one alert.
 * @param {Alert} alert
 * @param {"firing" | "resolved"} status
 */
export function webhookBody(alert, status) {
	const wire = {
		labels: alert.labels,
		annotations: alert.annotations ?? {},
		startsAt: alert.startsAt,
		endsAt:
			status === "resolved"
				? new Date().toISOString()
				: "0001-01-01T00:00:00.000Z",
		generatorURL: "http://prometheus.fake:9090/graph?g0.expr=up",
		fingerprint: fingerprint(alert),
		status,
	};
	return {
		version: "4",
		groupKey: `{}:{alertname="${alert.labels.alertname ?? ""}"}`,
		truncatedAlerts: 0,
		status,
		receiver: "prismalens",
		groupLabels: { alertname: alert.labels.alertname ?? "" },
		commonLabels: alert.labels,
		commonAnnotations: {},
		externalURL: "http://alertmanager.fake:9093",
		alerts: [wire],
	};
}

/** Delivers the alert as the webhook contract takes it and checks the answer is a success. */
export async function deliver(
	/** @type {Target} */ target,
	/** @type {Alert} */ alert,
	/** @type {"firing" | "resolved"} */ status,
) {
	const res = await target.sendAlert(webhookBody(alert, status));
	assert.ok(
		res.status >= 200 && res.status < 300,
		`POST /api/webhooks/prometheus (${status}) answered ${res.status}: ${(await res.text()).slice(0, 200)}`,
	);
}

/**
 * @typedef {object} Incident
 * @property {string} id
 * @property {number} number
 * @property {string} status
 * @property {string} [reopenReason]
 * @property {{ number: number, actualCause: string | null } | null} [priorIncident]
 * @property {{ number: number } | null} [refiredAs]
 * @property {Array<{ externalId: string | null, status: string }>} [alerts]
 */

/** The incidents whose alerts carry this fingerprint, newest page first. */
export async function incidentsFor(
	/** @type {Target} */ target,
	/** @type {Alert} */ alert,
) {
	const body = await target.api("/incidents?limit=100");
	return /** @type {Incident[]} */ (body.data).filter((i) =>
		(i.alerts ?? []).some((a) => a.externalId === fingerprint(alert)),
	);
}

/**
 * The scripted agent plays the session a prompt names; a real agent is given no such token.
 * @param {Target} target
 * @param {string} session
 */
export const scriptedSession = (target, session) =>
	target.agent === "scripted" ? ` fake-session:${session}` : "";

/**
 * A checkout the alert's service points at: `target.repo`, else the built-in fixture.
 * @param {Target} target
 */
export async function serviceWithRepo(target, name) {
	const repo = target.repo ?? makeIntakeFixtureRepo(join(target.workDir, name));
	const service = await target.api("/services", {
		method: "POST",
		body: { name },
	});
	await target.api("/repositories/source", {
		method: "POST",
		body: { serviceId: service.id, source: repo },
	});
	return { repo, service };
}

/**
 * Every event of a run, following `/events` paging to the end.
 * @param {Target} target
 * @param {string} id
 * @returns {Promise<any[]>}
 */
export async function eventsOf(target, id) {
	const all = [];
	for (let cursor; ; ) {
		const page = await target.api(
			`/investigations/${id}/events?limit=200${cursor === undefined ? "" : `&cursor=${cursor}`}`,
		);
		all.push(...page.events);
		if (page.nextCursor == null || page.events.length === 0) return all;
		cursor = page.nextCursor;
	}
}

export const ended = (/** @type {{ status: string }} */ run) =>
	!["pending", "running"].includes(run.status);

/**
 * The run an incident's alert started on its own.
 * @param {Target} target
 * @param {Incident} incident
 */
export async function runStartedFor(target, incident) {
	const runs = await eventually(
		async () => {
			const body = await target.api("/investigations?limit=100");
			return /** @type {Array<{ id: string, incidentId: string | null }>} */ (
				body.data
			).filter((r) => r.incidentId === incident.id);
		},
		(found) => found.length > 0,
		`a run for incident #${incident.number}`,
		60_000,
	);
	assert.equal(
		runs.length,
		1,
		`incident #${incident.number} started ${runs.length} runs, not one`,
	);
	return runs[0];
}
