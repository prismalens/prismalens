#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Walk 6 of #1101 against a running PrismaLens with the fake agent on its PATH: an alert
// whose thread starts one child through pl_thread_start, messages it, waits, and hears
// its answer. With "Agents may start threads" on Ask, approve the start card first.
// The alert needs a service with a repository; without one, type
// "fake-session:child-walk Why do checkouts 502?" in New instead.
//   node scripts/fakes/child-walk.mjs --url http://127.0.0.1:3311 --service <name> [--token <webhook token>]
import { readFileSync } from "node:fs";
import { join } from "node:path";

function arg(name) {
	const i = process.argv.indexOf(name);
	return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
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
		alertname: `Checkout 502s child walk fake-session:child-walk`,
		severity: "warning",
		service: arg("--service") ?? "simulated",
	};
	const now = Date.now();
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
					annotations: {
						summary:
							"The agent starts a child thread, messages it, and hears its answer",
					},
					startsAt: new Date(now).toISOString(),
					endsAt: "0001-01-01T00:00:00Z",
					generatorURL: url,
					fingerprint: `child-walk-${now}`,
				},
			],
		}),
	});
	if (res.status >= 300)
		throw new Error(`The webhook answered ${res.status}: ${await res.text()}`);
	console.log(
		`Fired "${labels.alertname}". Open ${url}/ and the new incident's thread: it starts "Check the database pool", messages it, and shows its answer.`,
	);
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : String(e));
	process.exitCode = 1;
});
