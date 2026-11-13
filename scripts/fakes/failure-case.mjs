#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Plays one recorded provider failure against a running PrismaLens (#1101): an alert
// whose name picks the fake agent's session, so a judge or a developer sees the
// thread's dock, row and rail for that mode. The server must run the fake agent:
//   node scripts/fakes/failure-case.mjs --install <bin-dir>   (then put <bin-dir> first on its PATH)
//   node scripts/fakes/failure-case.mjs api-key-rejected --url http://127.0.0.1:3320
// `--stamp <condition>` plays every case named, waits for each thread to show its state, and
// writes the condition's stamp (cases, reached) through conditions/stamp.mjs:
//   node scripts/fakes/failure-case.mjs api-key-rejected not-signed-in --url <base> --stamp login.expired
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	ACTIVE,
	connect,
	events,
	sleep,
	startThread,
	waitFor,
} from "./conditions/lib.mjs";
import { writeStamp } from "./conditions/stamp.mjs";
import { installFakeAgent } from "./fake-acp-agent.mjs";

/** Each case, and what the thread should show once it plays. */
export const FAILURE_CASES = {
	"limit-mid-turn":
		"Session limit mid-turn: partial turn kept, Limited, resumes at the zone's 6:10am",
	"limit-codex":
		"Usage limit with a known reset: Limited, resumes at the reset, once",
	"limit-no-time":
		"Usage limit with no reset: says so, try 2 of 7 every 30 minutes",
	"api-credit": "Out of credit: Blocked, Add credit and Switch agent, no timer",
	"api-key-rejected":
		"Rejected API key: Blocked, Update key and Switch agent, never sign in",
	"api-spend-cap":
		"Organization spend cap: Blocked, Raise the cap and Switch agent",
	"api-rate-limit":
		"429 with retry-after 90 s: Limited, trying again at the time, try 2 of 5",
	"api-rate-limit-short":
		"429 with retry-after 1 s: waited out inside the turn, which finishes",
	"api-overloaded":
		"Provider busy twice: retried inside the turn, answers on try 3",
	"api-overloaded-gave-up":
		"Provider busy on all five tries: needs you, with Retry now",
	"provider-drop":
		"Provider connection dropped mid-turn: retried in place, the turn finishes",
	"live-stuck": "A stalled turn: Working, quiet for N min",
	"not-signed-in": "The agent is not signed in: the thread stops and says so",
	"message-loop":
		"Two threads message each other in a loop: the pair cap stops it with a notice",
	"limit-with-child-reports":
		"Limit mid-turn after starting three children: stays Limited while their reports arrive, each waiting; Retry now delivers each once, in order",
	runaway:
		"A runaway agent: the same call ten times a second until stopped; Stop ends it at once",
	"budget-cap":
		"The organization spend cap after the cost climbs to $5.00: Blocked, Raise the cap and Switch agent, no timer",
	"protocol-drift":
		"Update kinds the host does not know: skipped, the known text still shows (version drift needs session-condition.mjs)",
	"usage-telemetry":
		"Usage on every turn: tokens and cost shown on the thread and recorded",
	"settle-cleanup":
		"Leaves a wake, a cron and a running process: settling the thread ends all three",
};

/** The statuses a stamped case's thread may end in; message-loop is read from its messages. */
const EXPECT = {
	"limit-mid-turn": ["limited"],
	"api-key-rejected": ["blocked"],
	"not-signed-in": ["failed", "blocked"],
};

/** What a judge does for a case beyond firing it. */
const CASE_NOTES = {
	"limit-with-child-reports":
		"Needs the fake agents from --install (they take the gateway). If Settings > Agent > Agents start threads is Ask, approve the three starts; the children report 4, 7 and 10 s later. Retry now then delivers the three reports and the run finishes with its report.",
};

function arg(name) {
	const i = process.argv.indexOf(name);
	return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
	const install = arg("--install");
	if (install) {
		// With the gateway, so a case's agent can start threads (#1101).
		installFakeAgent(install, { mcp: true });
		console.log(
			`Fake agents written to ${install}. Start PrismaLens with it first on PATH.`,
		);
		return;
	}
	const name = process.argv[2];
	if (!name || !(name in FAILURE_CASES)) {
		console.log(
			"Usage: node scripts/fakes/failure-case.mjs <case> [--url <base>] [--token <webhook token>]\n",
		);
		for (const [k, v] of Object.entries(FAILURE_CASES))
			console.log(`  ${k.padEnd(24)} ${v}`);
		process.exitCode = name ? 1 : 0;
		return;
	}
	const url = (arg("--url") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
	const stamp = arg("--stamp");
	if (!stamp) {
		await fire(url, name);
		return;
	}
	const cases = process.argv
		.slice(2)
		.filter((a, i, all) => a in FAILURE_CASES && !all[i - 1]?.startsWith("--"));
	const { api } = await connect(url);
	const seen = [];
	for (const c of cases) seen.push(await observe(api, url, c));
	const loop = seen.find((o) => o.case === "message-loop");
	const observed = loop
		? { messages: loop.messages, pairCapAt: loop.pairCapAt, held: loop.held }
		: {
				cases: seen.length,
				reached: seen.filter((o) => o.reached).length,
				...(seen.some((o) => o.retryAfterS !== undefined)
					? {
							retryAfterS: seen.find((o) => o.retryAfterS !== undefined)
								?.retryAfterS,
						}
					: {}),
			};
	console.log(JSON.stringify(seen, null, 2));
	writeStamp({
		condition: stamp,
		simulator: loop ? "fake.message-loop" : "fake.failure-case",
		observed,
		detail: { cases: seen },
	});
}

/** Fires the case's alert; returns the alert's id. */
async function fire(url, name) {
	const workspace = process.env.PRISMALENS_WORKSPACE_DIR;
	const token =
		arg("--token") ??
		(workspace
			? readFileSync(
					join(workspace, "PRISMALENS_WEBHOOK_SECRET_FILE"),
					"utf8",
				).trim()
			: undefined);
	if (!token)
		throw new Error(
			"Pass --token, or set PRISMALENS_WORKSPACE_DIR to the server's workspace.",
		);
	const labels = {
		alertname: `Simulated ${name} fake-session:${name}`,
		severity: "warning",
		service: arg("--service") ?? "simulated",
	};
	const res = await fetch(`${url}/api/webhooks/prometheus`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"user-agent": "Alertmanager/0.28.1",
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			version: "4",
			groupKey: `{}:{alertname="${labels.alertname}"}`,
			truncatedAlerts: 0,
			status: "firing",
			receiver: "prismalens",
			groupLabels: { alertname: labels.alertname },
			commonLabels: labels,
			commonAnnotations: {},
			externalURL: url,
			alerts: [
				{
					status: "firing",
					labels,
					annotations: { summary: FAILURE_CASES[name] },
					startsAt: new Date().toISOString(),
					endsAt: "0001-01-01T00:00:00Z",
					generatorURL: url,
					fingerprint: `${name}-${Date.now()}`,
				},
			],
		}),
	});
	if (res.status >= 300)
		throw new Error(`The webhook answered ${res.status}: ${await res.text()}`);
	console.log(
		`Fired "${labels.alertname}". Open ${url}/ and the new incident's thread: ${FAILURE_CASES[name]}.`,
	);
	if (name in CASE_NOTES) console.log(CASE_NOTES[name]);
	const { alertIds } = await res.json();
	return /** @type {string} */ (alertIds[0]);
}

/**
 * The message loop runs in a thread the agent starts, so it plays as a chat thread; each
 * thread start it asks for is approved, as the user would, until the pair cap holds a message.
 */
async function loopCase(api) {
	const id = await startThread(
		api,
		"message-loop",
		"Check the cache with a peer",
	);
	let evs = [];
	for (let i = 0; i < 360; i++) {
		const { asks } = await api("/threads/asks");
		for (const { ask, ended } of asks)
			if (!ended && ask.kind === "permission")
				await api(`/investigations/${ask.threadId}/asks/${ask.askId}`, {
					method: "POST",
					body: { askId: ask.askId, decision: "approve" },
					ok: [404, 409],
				});
		// The held message shows on whichever side sent it: read both threads.
		const own = (await events(api, id)).filter(
			(e) => e.kind === "thread_message",
		);
		const peer = own.find((e) => e.peerId)?.peerId;
		const theirs = peer
			? (await events(api, peer)).filter((e) => e.kind === "thread_message")
			: [];
		evs = [...own, ...theirs.filter((e) => e.direction === "sent")].sort(
			(x, y) => Date.parse(x.ts) - Date.parse(y.ts),
		);
		if (evs.some((e) => e.held)) break;
		await sleep(1000);
	}
	const cap = evs.findIndex((e) => e.held);
	return {
		case: "message-loop",
		threadId: id,
		messages: evs.length,
		pairCapAt: cap,
		held: cap > -1,
	};
}

/** Fires one case and waits for its thread to show what the case promises. */
async function observe(api, url, name) {
	if (name === "message-loop") return loopCase(api);
	const alertId = await fire(url, name);
	const { incidentId } = await api(`/alerts/${alertId}`);
	let id;
	for (let i = 0; i < 10 && !id; i++) {
		const list = await api(`/investigations?incidentId=${incidentId}&limit=5`);
		id = list.data?.find((/** @type {{ status: string }} */ r) =>
			ACTIVE.includes(r.status),
		)?.id;
		if (!id) await sleep(500);
	}
	// An alert with no service never starts one on its own: press Investigate, as a reader would.
	if (!id)
		({ investigationId: id } = await api(
			`/incidents/${incidentId}/investigate`,
			{
				method: "POST",
				body: {},
			},
		));
	if (!id) throw new Error(`No thread started for the ${name} alert`);
	const run = await waitFor(
		api,
		id,
		(r) => !ACTIVE.includes(r.status),
		120_000,
	);
	// A stop's wake is written just after the run ends: give the status a moment to settle.
	let state = null;
	for (let i = 0; i < 20; i++) {
		const { statuses } = await api("/threads/statuses", {
			method: "POST",
			body: { ids: [id] },
		});
		state = statuses?.[id] ?? null;
		if ((EXPECT[name] ?? []).includes(state?.status)) break;
		await sleep(500);
	}
	const limit = (await events(api, id)).findLast(
		(e) => e.kind === "usage_limit",
	);
	const resetsAt = limit?.resetsAt ? Date.parse(limit.resetsAt) : null;
	return {
		case: name,
		threadId: id,
		link: `${url}/threads/${id}`,
		runStatus: run.status,
		state,
		reached: (EXPECT[name] ?? []).includes(state?.status),
		...(name === "limit-mid-turn"
			? {
					retryAfterS:
						resetsAt === null ? -1 : Math.round((resetsAt - Date.now()) / 1000),
				}
			: {}),
	};
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : String(e));
	process.exitCode = 1;
});
