#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Plays one scripted-agent condition on a running PrismaLens and stamps what the thread
// showed (#1101): agent.runaway, budget.cap, protocol.drift, usage.telemetry. The server
// runs the fakes from `node scripts/fakes/failure-case.mjs --install <bin-dir>`.
//   PRISMALENS_WORKSPACE_DIR=<ws> node scripts/fakes/conditions/session-condition.mjs agent.runaway --url http://127.0.0.1:3410
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setFakeProtocolVersion } from "../fake-acp-agent.mjs";
import {
	ACTIVE,
	arg,
	connect,
	events,
	sleep,
	startThread,
	waitFor,
} from "./lib.mjs";
import { REPO_ROOT, writeStamp } from "./stamp.mjs";

const SIMULATOR = "fake.session";
const kinds = (/** @type {any[]} */ evs) =>
	Object.fromEntries(
		[...new Set(evs.map((e) => e.kind))].map((k) => [
			k,
			evs.filter((e) => e.kind === k).length,
		]),
	);

/** The protocol version the host speaks, read from the ACP SDK the engine uses. */
async function hostProtocolVersion() {
	const req = createRequire(
		join(REPO_ROOT, "packages/@prismalens/engine/package.json"),
	);
	const m = await import(
		pathToFileURL(req.resolve("@agentclientprotocol/sdk/unstable")).href
	);
	return /** @type {number} */ (m.PROTOCOL_VERSION);
}

/** The Claude Code row of agent-host's agent facts, which the fake answers as. */
async function agentFacts() {
	const { tsImport } = await import("tsx/esm/api");
	const { AGENT_REGISTRY } = await tsImport(
		pathToFileURL(
			join(REPO_ROOT, "packages/@prismalens/agent-host/src/registry/agents.ts"),
		).href,
		import.meta.url,
	);
	const row = AGENT_REGISTRY["claude-code"];
	return {
		agent: row.id,
		binary: row.binary,
		adapterPackage: row.adapterPackage,
	};
}

/** @type {Record<string, (ctx: { api: (p: string, i?: any) => Promise<any> }) => Promise<{ profile: Record<string, unknown>, observed: Record<string, unknown> }>>} */
const CONDITIONS = {
	async "agent.runaway"({ api }) {
		const id = await startThread(api, "runaway", "Fix the flaky retry test");
		const t = Date.now();
		await sleep(20_000);
		const before = await events(api, id);
		const run = await api(`/investigations/${id}`);
		const calls = before.filter((e) => e.kind === "tool_result").length;
		// The simulator stops it, as the user would; the measure is what the thread showed before.
		const stopAt = Date.now();
		await api(`/investigations/${id}/cancel`, { method: "POST", body: {} });
		const end = await waitFor(api, id, (r) => !ACTIVE.includes(r.status));
		return {
			profile: { callsPerSecond: 10, passes: 3000, watchedS: 20 },
			observed: {
				threadId: id,
				toolCallsIn20s: calls,
				statusAfter20s: run.status,
				stopMs: Date.now() - stopAt,
				statusAfterStop: end.status,
				ranMs: stopAt - t,
			},
		};
	},
	async "budget.cap"({ api }) {
		const id = await startThread(
			api,
			"budget-cap",
			"Why are checkouts failing",
		);
		const end = await waitFor(api, id, (r) => !ACTIVE.includes(r.status));
		const evs = await events(api, id);
		return {
			profile: { costUsd: 5, stopReason: "max_turn_requests" },
			observed: {
				threadId: id,
				status: end.status,
				lastTurnOutcome: end.lastTurnOutcome ?? null,
				usage: end.usage ?? null,
				events: kinds(evs),
			},
		};
	},
	async "protocol.drift"({ api }) {
		const host = await hostProtocolVersion();
		const facts = await agentFacts();
		const stateDir = arg("--state-dir");
		setFakeProtocolVersion(host + 1, stateDir);
		try {
			const id = await startThread(api, "protocol-drift", "Checkout 502s");
			const end = await waitFor(api, id, (r) => !ACTIVE.includes(r.status));
			const evs = await events(api, id);
			const said = evs
				.filter((e) => e.kind === "agent_step")
				.map((e) => e.text)
				.join("");
			return {
				profile: {
					...facts,
					hostProtocolVersion: host,
					agentProtocolVersion: host + 1,
					unknownUpdates: ["plan_graph_update", "session_heartbeat"],
					unknownContent: ["hologram"],
					unknownToolKind: "teleport",
				},
				observed: {
					threadId: id,
					status: end.status,
					lastTurnOutcome: end.lastTurnOutcome ?? null,
					knownTextShown: said.includes("pool limit change"),
					events: kinds(evs),
				},
			};
		} finally {
			setFakeProtocolVersion(null, stateDir);
		}
	},
	async "usage.telemetry"({ api }) {
		const id = await startThread(api, "usage-telemetry", "Checkout 502s");
		await waitFor(api, id, (r) => !ACTIVE.includes(r.status));
		for (const text of ["Check the replica too", "And the cache"]) {
			await api(`/investigations/${id}/messages`, {
				method: "POST",
				body: { text },
			});
			await sleep(1000);
			await waitFor(api, id, (r) => !ACTIVE.includes(r.status));
		}
		const run = await api(`/investigations/${id}`);
		const evs = await events(api, id);
		return {
			profile: { turns: 3, tokensPerTurn: [12000, 3000, 3000] },
			observed: {
				threadId: id,
				usage: run.usage ?? null,
				turnUsage: evs
					.filter((e) => e.usage || e.kind?.includes("usage"))
					.map((e) => ({ kind: e.kind, usage: e.usage ?? null })),
				events: kinds(evs),
			},
		};
	},
};

async function main() {
	const condition = process.argv[2];
	const play = condition ? CONDITIONS[condition] : undefined;
	if (!play) {
		console.log(
			`Usage: session-condition.mjs <${Object.keys(CONDITIONS).join("|")}> --url <base> [--state-dir <fake state>]`,
		);
		process.exitCode = condition ? 1 : 0;
		return;
	}
	const url = (arg("--url") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
	const { api } = await connect(url);
	const { profile, observed } = await play({ api });
	console.log(JSON.stringify(observed, null, 2));
	console.log(`Thread: ${url}/threads/${observed.threadId}`);
	writeStamp({ condition, simulator: SIMULATOR, profile, observed });
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : String(e));
	process.exitCode = 1;
});
