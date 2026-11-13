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

/**
 * Each condition: the simulator id its entry names, and what it observed; `observed` keeps
 * numbers for the stamp, `detail` the rest.
 * @type {Record<string, (ctx: { api: (p: string, i?: any) => Promise<any> }) => Promise<{ simulator: string, observed: Record<string, unknown>, detail: Record<string, unknown> }>>}
 */
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
		const observed = {
			storedToolCalls: calls,
			runningAfterWatch: run.status === "running",
			stopMs: Date.now() - stopAt,
			cancelled: end.status === "cancelled",
			ranMs: stopAt - t,
		};
		return {
			simulator: "fake.runaway",
			observed,
			detail: { threadId: id, ...observed, statusAfterStop: end.status },
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
			simulator: "fake.budget-cap",
			observed: {
				costShownUsd: end.usage?.cost?.amount ?? -1,
				blocked: evs.some((e) => e.kind === "provider_blocked"),
				completed: end.status === "completed",
			},
			detail: {
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
		const stateDir = arg("--state-dir") ?? process.env.PRISMALENS_FAKES_STATE;
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
				simulator: "fake.protocol-drift",
				observed: {
					hostProtocolVersion: host,
					agentProtocolVersion: host + 1,
					knownTextShown: said.includes("pool limit change"),
					completed: end.status === "completed",
				},
				detail: {
					threadId: id,
					agentFacts: facts,
					unknownUpdates: ["plan_graph_update", "session_heartbeat"],
					unknownContent: ["hologram"],
					unknownToolKind: "teleport",
					status: end.status,
					lastTurnOutcome: end.lastTurnOutcome ?? null,
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
		const turnUsage = evs.filter((e) => e.kind === "turn_usage");
		return {
			simulator: "fake.usage-telemetry",
			observed: {
				turnUsageEvents: turnUsage.length,
				recordedTokens: turnUsage.reduce(
					(n, e) => n + (e.usage?.totalTokens ?? 0),
					0,
				),
			},
			detail: {
				threadId: id,
				usage: run.usage ?? null,
				turnUsage: turnUsage.map((e) => e.usage),
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
	const { simulator, observed, detail } = await play({ api });
	console.log(JSON.stringify(detail, null, 2));
	console.log(`Thread: ${url}/threads/${detail.threadId}`);
	writeStamp({ condition, simulator, observed, detail });
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : String(e));
	process.exitCode = 1;
});
