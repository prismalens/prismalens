// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalEvent, PendingAsk } from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type FakeAlertmanager,
	startFakeAlertmanager,
} from "../../../../scripts/fakes/fake-alertmanager.mjs";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

// The fake agent takes the gateway, so its sessions call PrismaLens's tools.
const pl = new ScenarioApp({ mcp: true });
let am: FakeAlertmanager;

beforeAll(async () => {
	am = await startFakeAlertmanager();
	await pl.boot();
	// OpenCode: Claude Code and Codex ask through their own question tool instead.
	await pl.api("/settings/harness", { method: "PATCH", body: { harness: "opencode" } });
}, 60_000);

afterAll(async () => {
	await am.close();
	await pl.dispose();
});

async function events(runId: string): Promise<CanonicalEvent[]> {
	const page = await pl.api<{ events: CanonicalEvent[] }>(
		`/investigations/${runId}/events?limit=200`,
	);
	return page.events;
}

const openAsk = (runId: string, kind: PendingAsk["kind"]) =>
	eventually(
		async () => {
			const all = await events(runId);
			const closed = new Set(all.flatMap((e) => (e.kind === "ask_closed" ? [e.askId] : [])));
			return all
				.flatMap((e) => (e.kind === "ask_opened" ? [e.ask] : []))
				.find((a) => a.kind === kind && !closed.has(a.askId));
		},
		(a) => Boolean(a),
		`an open ${kind} ask`,
		30_000,
	);

async function startRun(service: string, session: string): Promise<string> {
	await pl.serviceWithRepo(service);
	const alert = am.fire({
		labels: { alertname: `${service}Slow fake-session:${session}`, service, severity: "medium" },
		annotations: { summary: `${service} latency` },
	});
	await am.post(pl.webhookUrl, pl.webhookToken);
	const [incident] = await eventually(
		() => pl.incidentFor(alert.fingerprint),
		(found) => found.length === 1,
		"an incident carrying the alert",
	);
	if (!incident) throw new Error("no incident");
	await pl.api(`/incidents/${incident.id}/investigate`, {
		method: "POST",
		body: { accessLevel: "supervised" },
	});
	const [run] = await eventually(
		() => pl.investigations(incident.id),
		(runs) => runs.length === 1,
		"the run started",
	);
	if (!run) throw new Error("no run");
	return run.id;
}

/** Every file under `dir` whose bytes hold `needle`: the database, its journal, transcripts and logs. */
function filesHolding(dir: string, needle: string): string[] {
	const found: string[] = [];
	const walk = (d: string) => {
		for (const name of readdirSync(d)) {
			const path = join(d, name);
			const info = statSync(path);
			if (info.isDirectory()) walk(path);
			else if (info.isFile() && readFileSync(path).includes(needle)) found.push(path);
		}
	};
	walk(dir);
	return found;
}

describe("Walk: the agent asks the user through PrismaLens's own tools (#1024 spec B)", () => {
	it("Given pl_ask_user, When the user picks an option, Then the ask docks as the tool's, returns at once, and the answer reaches the agent as a message", async () => {
		const runId = await startRun("atlas", "ask-user");
		const ask = await openAsk(runId, "question");
		expect(ask).toMatchObject({
			title: "Roll back d37d888, or restore the index by hand?",
			requiresHost: true,
			source: { kind: "tool", tool: "pl_ask_user" },
		});
		expect(ask?.questions?.[0]).toMatchObject({
			id: "q1",
			header: "Fix",
			allowOther: true,
			multiSelect: false,
			options: [
				{ id: "o1", label: "Roll back", preview: "git revert d37d888" },
				{ id: "o2", label: "Restore the index" },
			],
		});
		// The tool returned at once: the run finished while the question still waits.
		await eventually(
			async () => (await pl.investigation(runId)).status,
			(s) => s === "completed",
			"the first turn ends without waiting",
			60_000,
		);
		const said = (await events(runId)).flatMap((e) => (e.kind === "agent_step" ? [e.text] : [])).join("");
		expect(said).toContain('ask_user said:');
		expect(said).toContain('"status": "asked"');

		await pl.api(`/investigations/${runId}/asks/${ask?.askId}`, {
			method: "POST",
			body: { answer: { kind: "question", answers: { q1: { options: ["o2"], other: "and add a test" } } } },
		});
		const heard = await eventually(
			async () => (await events(runId)).flatMap((e) => (e.kind === "agent_step" ? [e.text] : [])).join(""),
			(t) => t.includes("Heard:"),
			"the agent hears the answer",
			60_000,
		);
		expect(heard).toContain("Roll back d37d888, or restore the index by hand? → Restore the index; Other: and add a test");
	}, 180_000);

	it("Given pl_secret_request, When the user gives the value and the agent echoes it everywhere, Then the agent reads it from its env and no event, transcript, log or push holds it", async () => {
		const runId = await startRun("vault", "secret");
		const ask = await openAsk(runId, "secret");
		expect(ask).toMatchObject({
			title: "BOOKS_API_TOKEN",
			detail: "Read the books service's admin API",
			requiresHost: true,
			source: { kind: "tool", tool: "pl_secret_request" },
		});
		expect(JSON.stringify(ask)).not.toMatch(/value/i);
		// A secret is never answered through the ordinary ask endpoint.
		const wrong = await pl.fetchAs("POST", `/investigations/${runId}/asks/${ask?.askId}`, {
			answer: { kind: "input", values: { value: "x" } },
		});
		expect(wrong.status).toBe(400);
		await eventually(
			async () => (await pl.investigation(runId)).status,
			(s) => s === "completed",
			"the first turn ends",
			60_000,
		);

		// Short, so a length floor would have let it through; the user typed it once.
		const value = "tok-9q";
		const given = await pl.fetchAs("POST", `/investigations/${runId}/secrets/${ask?.askId}`, { value });
		expect(given.status).toBe(200);
		expect(await given.text()).not.toContain(value);
		expect(
			(await pl.fetchAs("POST", `/investigations/${runId}/secrets/${ask?.askId}`, { value })).status,
		).toBe(409);

		const all = await eventually(
			() => events(runId),
			(evs) => evs.some((e) => e.kind === "agent_step" && e.text.includes("Done with")),
			"the reopened session's answer",
			60_000,
		);
		const closed = all.find((e) => e.kind === "ask_closed" && e.askId === ask?.askId);
		expect(closed).toMatchObject({ outcome: "answered" });
		expect(closed && "answer" in closed ? closed.answer : undefined).toBeUndefined();
		// It reached the agent: the echo is there, redacted.
		const text = JSON.stringify(all);
		expect(text).toContain("the token is [redacted]");
		expect(text).not.toContain(value);
		const row = await (await pl.prisma()).secretRequested.findUnique({ where: { requestId: ask?.askId ?? "" } });
		expect(row?.valueEnc).toBeTruthy();
		expect(row?.valueEnc).not.toContain(value);
		expect(filesHolding(pl.workspace, value)).toEqual([]);
		// The scan read the run's transcript, which shows the echo redacted.
		expect(
			filesHolding(pl.workspace, "[redacted]").some((f) => f.endsWith("transcript.jsonl")),
		).toBe(true);
	}, 180_000);
});
