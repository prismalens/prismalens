// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Contract for the Part A refusal-gate sequence that packed-smoke.sh and
// cross-os-app-boot.mjs both call (#551). Extracting the sequence stops the two
// copies drifting; this stops the one remaining copy drifting silently.

import assert from "node:assert/strict";
import { test } from "node:test";

import { assertRefusalGate } from "./refusal-gate-check.mjs";

const VERDICT = {
	runnable: false,
	failure: "no-harness",
	reason: "no agent binary on PATH",
};

const REFUSAL_412 = JSON.stringify({
	code: "PRECONDITION_FAILED",
	data: { failure: VERDICT.failure, reason: VERDICT.reason },
});

const response = (status, body) => ({
	ok: status >= 200 && status < 300,
	status,
	text: async () => body,
});

/**
 * Drives the sequence against a stub server and records every reporter call.
 *
 * @param {object} [opts]
 * @param {string} [opts.refusalBody] Body for POST /investigate.
 * @param {number} [opts.refusalStatus]
 * @param {object} [opts.createResponse] Response for POST /api/incidents.
 * @param {string} [opts.cookie]
 * @param {object} [opts.verdict] What resolveExpected() returns.
 * @param {string} [opts.log] Boot-log contents the fork gate reads.
 */
async function run(opts = {}) {
	const events = [];
	const requests = [];
	let resolveExpectedCalls = 0;
	let sampleCalls = 0;

	const result = await assertRefusalGate({
		json: async (path, init) => {
			requests.push({ path, method: init?.method });
			if (path.endsWith("/investigate")) {
				return response(
					opts.refusalStatus ?? 412,
					opts.refusalBody ?? REFUSAL_412,
				);
			}
			return (
				opts.createResponse ?? response(201, JSON.stringify({ id: "inc_1" }))
			);
		},
		cookie: opts.cookie ?? "prismalens.session=abc",
		resolveExpected: async () => {
			resolveExpectedCalls++;
			return opts.verdict ?? VERDICT;
		},
		readLog: () => opts.log ?? "",
		getLogOffset: () => 4096,
		ok: (name, detail = "") => events.push({ level: "ok", name, detail }),
		bad: (name, detail) => events.push({ level: "bad", name, detail }),
		incidentTitle: "unit probe",
		sample: () => {
			sampleCalls++;
		},
	});

	return {
		events,
		requests,
		resolveExpectedCalls,
		sampleCalls,
		...result,
		failures: events.filter((e) => e.level === "bad"),
		names: events.map((e) => `${e.level}:${e.name}`),
	};
}

test("a correct 412 with no forked child is the only all-green path", async () => {
	const r = await run();
	assert.deepEqual(r.names, [
		"ok:unrunnable investigation refused",
		"ok:no child forked on unrunnable investigation",
	]);
	assert.equal(r.partBLogOffset, 4096);
	assert.deepEqual(
		r.requests.map((q) => q.path),
		["/api/incidents", "/api/incidents/inc_1/investigate"],
	);
});

// Issue #551 item 1. cross-os-app-boot.mjs asserted only that `failure` and
// `reason` were TRUTHY, so a server refusing for an entirely different reason
// passed the gate. The shared sequence compares them to the locally computed
// verdict, so a wrong-reason refusal is a failure.
test("a 412 refusing for the WRONG reason fails", async () => {
	const r = await run({
		refusalBody: JSON.stringify({
			code: "PRECONDITION_FAILED",
			data: { failure: "some-other-failure", reason: "some other reason" },
		}),
	});
	assert.deepEqual(r.names, [
		"bad:POST /api/incidents/:id/investigate refusal",
	]);
});

test("a non-412 response fails rather than being read as a refusal", async () => {
	const r = await run({ refusalStatus: 200, refusalBody: "{}" });
	assert.deepEqual(r.names, [
		"bad:POST /api/incidents/:id/investigate refusal",
	]);
});

test("a 412 whose body is not JSON fails instead of throwing", async () => {
	const r = await run({ refusalBody: "<html>gateway error</html>" });
	assert.deepEqual(r.names, [
		"bad:POST /api/incidents/:id/investigate refusal",
	]);
});

// Issue #551 item 2. The fork-log check used to run unconditionally after the
// precondition chain, so a machine that never refused anything was told an
// "investigation child forked despite 412 refusal". It now runs only inside the
// branch where a refusal was confirmed.
test("a runnable machine reports the precondition, never the fork gate", async () => {
	const r = await run({
		verdict: { runnable: true },
		log: '{"context":"InvestigationProcessor","msg":"starting"}',
	});
	assert.deepEqual(r.names, ["bad:clean-machine refusal"]);
	assert.match(r.failures[0].detail, /machine is runnable/);
});

test("a confirmed refusal that still forked a child fails the fork gate", async () => {
	const r = await run({
		log: '{"context":"InvestigationProcessor","msg":"starting"}',
	});
	assert.deepEqual(r.names, [
		"ok:unrunnable investigation refused",
		"bad:refusal fork gate",
	]);
});

test("the error-path-only InvestigationRun context also trips the fork gate", async () => {
	const r = await run({ log: '{"context":"InvestigationRun","err":"boom"}' });
	assert.equal(r.names.at(-1), "bad:refusal fork gate");
});

test("no session short-circuits before any request", async () => {
	const r = await run({ cookie: "" });
	assert.deepEqual(r.names, ["bad:refusal"]);
	assert.deepEqual(r.requests, []);
	assert.equal(r.partBLogOffset, 0);
	assert.equal(r.resolveExpectedCalls, 0);
});

test("a failed incident create short-circuits", async () => {
	const r = await run({ createResponse: response(503, "upstream down") });
	assert.deepEqual(r.names, ["bad:POST /api/incidents (unconfigured)"]);
	assert.equal(r.partBLogOffset, 0);
	assert.equal(r.resolveExpectedCalls, 0);
});

// packed-smoke.sh used to do a bare `JSON.parse(body).id` here, so a 2xx with a
// non-JSON body threw and the whole probe died as "probe threw" rather than
// naming what went wrong. The shared sequence takes cross-os-app-boot.mjs's
// guarded form.
test("a 2xx create with an unparseable body fails cleanly, not by throwing", async () => {
	const r = await run({ createResponse: response(201, "<html>proxy</html>") });
	assert.deepEqual(r.names, ["bad:POST /api/incidents (unconfigured)"]);
	assert.match(r.failures[0].detail, /no usable id/);
	assert.equal(r.partBLogOffset, 0);
});

test("sample() is invoked before every log read", async () => {
	const r = await run();
	assert.equal(r.sampleCalls, 2);
});

test("sample is optional — omitting it does not throw", async () => {
	const events = [];
	await assertRefusalGate({
		json: async (path) =>
			path.endsWith("/investigate")
				? response(412, REFUSAL_412)
				: response(201, JSON.stringify({ id: "inc_1" })),
		cookie: "s=1",
		resolveExpected: async () => VERDICT,
		readLog: () => "",
		getLogOffset: () => 0,
		ok: (name) => events.push(name),
		bad: (name, detail) => events.push(`FAIL ${name} ${detail}`),
		incidentTitle: "unit probe",
	});
	assert.deepEqual(events, [
		"unrunnable investigation refused",
		"no child forked on unrunnable investigation",
	]);
});

// The access gate's red-team corpus (r4 R4.1 rev) at every level, so an edit
// to the gate's rules cannot pass CI without the corpus file, which the
// reviewer lane reads, agreeing with it. Vitest runs the same corpus per instance.
test("the red-team corpus: every instance at every access level", async (t) => {
	const { tsImport } = await import("tsx/esm/api");
	const { readOnlyPolicyFor } = await tsImport(
		"../src/run/permission.ts",
		import.meta.url,
	);
	const { telemetryOrigins } = await tsImport(
		"../src/run/connectors.ts",
		import.meta.url,
	);
	const { mkdtempSync, readFileSync, realpathSync, rmSync } = await import(
		"node:fs"
	);
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const corpus = JSON.parse(
		readFileSync(
			new URL("../src/run/__fixtures__/red-team-corpus.json", import.meta.url),
			"utf8",
		),
	);
	const cwd = mkdtempSync(join(realpathSync(tmpdir()), "pl-corpus-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const allowedOrigins = telemetryOrigins({
		telemetry: {
			prometheusUrl: corpus.brief.prometheusUrl,
			alertmanagerUrl: corpus.brief.alertmanagerUrl,
			apiUrl: corpus.brief.apiUrl,
		},
		logs: { url: corpus.brief.logsUrl },
	});
	const mismatches = [];
	const todo = [];
	for (const level of corpus.levels) {
		const policy = readOnlyPolicyFor({ cwd, level, allowedOrigins });
		for (const i of corpus.instances) {
			const rawInput = {};
			if (i.command !== undefined) rawInput.command = i.command;
			if (i.path !== undefined) rawInput.filePath = i.path;
			const d = policy({
				options: [
					{ optionId: "once", kind: "allow_once" },
					{ optionId: "reject", kind: "reject_once" },
				],
				toolCall: {
					kind: i.kind ?? "execute",
					title: i.command ?? "",
					rawInput,
				},
			});
			const why = typeof i.why === "string" ? i.why : i.why?.[level];
			const ok =
				(d.allow ? "allow" : "refuse") === i.expect[level] &&
				(d.allow || !why || d.why === why);
			if (!ok)
				(i.todo ? todo : mismatches).push(
					`${level} ${i.class}: ${i.command ?? i.path ?? i.kind} -> ${d.allow ? "allow" : d.why}`,
				);
		}
	}
	t.diagnostic(
		`corpus: ${corpus.instances.length} instances x ${corpus.levels.length} levels = ${corpus.instances.length * corpus.levels.length} checks, ${mismatches.length} mismatches, ${todo.length} todo`,
	);
	assert.deepEqual(mismatches, []);
});
