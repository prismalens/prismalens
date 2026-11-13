#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Plays one recorded provider failure against a running PrismaLens (#1101): an alert
// whose name picks the fake agent's session, so a judge or a developer sees the
// thread's dock, row and rail for that mode. The server must run the fake agent:
//   node scripts/fakes/failure-case.mjs --install <bin-dir>   (then put <bin-dir> first on its PATH)
//   node scripts/fakes/failure-case.mjs api-key-rejected --url http://127.0.0.1:3320
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
	"limit-with-child-reports":
		"Limit mid-turn after starting three children: stays Limited while their reports arrive, each waiting; Retry now delivers each once, in order",
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
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : String(e));
	process.exitCode = 1;
});
