// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, PendingAsk } from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type FakeAlertmanager,
	startFakeAlertmanager,
} from "../../../../scripts/fakes/fake-alertmanager.mjs";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();
let am: FakeAlertmanager;

beforeAll(async () => {
	am = await startFakeAlertmanager();
	await pl.boot();
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

/** The run's newest ask the dock would show, from its events. */
async function openAsk(runId: string, kind: PendingAsk["kind"]) {
	return eventually(
		async () => {
			const all = await events(runId);
			const closed = new Set(
				all.flatMap((e) => (e.kind === "ask_closed" ? [e.askId] : [])),
			);
			return all
				.flatMap((e) => (e.kind === "ask_opened" ? [e.ask] : []))
				.find((a) => a.kind === kind && !closed.has(a.askId));
		},
		(a) => Boolean(a),
		`an open ${kind} ask`,
		30_000,
	);
}

describe("Walk: the agent asks a question and for input, and the dock answers (#1024)", () => {
	it("Given a run whose agent elicits a choice and a form, When the person answers both, Then the agent receives each answer and the thread list showed what it asked", async () => {
		await pl.serviceWithRepo("books");
		const alert = am.fire({
			labels: {
				alertname: "BooksListSlow fake-session:elicit",
				service: "books",
				severity: "medium",
			},
			annotations: { summary: "p99 of GET /books above 2s" },
		});
		expect(
			(await am.post(pl.webhookUrl, pl.webhookToken)).status,
		).toBeLessThan(300);
		const [incident] = await eventually(
			() => pl.incidentFor(alert.fingerprint),
			(found) => found.length === 1,
			"an incident carrying the alert",
		);
		if (!incident) throw new Error("no incident");
		// A person starts it, so its questions wait for them instead of being declined.
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

		const question = await openAsk(run.id, "question");
		expect(question).toMatchObject({
			title: "Which environment is slow?",
			requiresHost: false,
			source: { kind: "agent" },
		});
		expect(question?.questions?.[0]).toMatchObject({
			id: "question_0",
			allowOther: true,
			options: [
				{ id: "staging", label: "Staging", description: "The canary cluster" },
				{ id: "prod", label: "Production" },
			],
		});

		const feed = await pl.api<{
			units: { threads: { id: string; waitingAsk?: unknown }[] }[];
		}>("/threads/feed");
		const row = feed.units.flatMap((u) => u.threads).find((t) => t.id === run.id);
		expect(row?.waitingAsk).toEqual({
			kind: "question",
			title: "Which environment is slow?",
		});

		const answered = await pl.api<{ outcome: string }>(
			`/investigations/${run.id}/asks/${question?.askId}`,
			{
				method: "POST",
				body: {
					answer: {
						kind: "question",
						answers: { question_0: { options: ["prod"], other: "canary too" } },
					},
				},
			},
		);
		expect(answered).toEqual({ outcome: "answered" });
		await expect(
			pl.api(`/investigations/${run.id}/asks/${question?.askId}`, {
				method: "POST",
				body: { answer: { kind: "decline" } },
			}),
		).rejects.toThrow(/409/);

		const input = await openAsk(run.id, "input");
		expect(input?.input?.schema.required).toEqual(["hours"]);
		await pl.api(`/investigations/${run.id}/asks/${input?.askId}`, {
			method: "POST",
			body: { answer: { kind: "input", values: { hours: 6, includeDeploys: true } } },
		});

		const said = await eventually(
			async () =>
				(await events(run.id))
					.flatMap((e) => (e.kind === "agent_step" ? [e.text] : []))
					.join(""),
			(text) => text.includes('"hours":6'),
			"the agent says both answers back",
			30_000,
		);
		expect(said).toContain(
			'You answered: {"action":"accept","content":{"question_0":"prod","question_0_custom":"canary too"}}',
		);
		expect(said).toContain('{"action":"accept","content":{"hours":6,"includeDeploys":true}}');
		const closings = (await events(run.id)).flatMap((e) =>
			e.kind === "ask_closed" ? [e.outcome] : [],
		);
		expect(closings).toEqual(["answered", "answered"]);
	});

	it("Given an alert-started run, When its agent elicits, Then the question is declined at once and no ask waits", async () => {
		await pl.serviceWithRepo("authors");
		const alert = am.fire({
			labels: {
				alertname: "AuthorsSlow fake-session:elicit",
				service: "authors",
				severity: "critical",
			},
			annotations: { summary: "p99 of GET /authors above 2s" },
		});
		await am.post(pl.webhookUrl, pl.webhookToken);
		const [incident] = await eventually(
			() => pl.incidentFor(alert.fingerprint),
			(found) => found.length === 1,
			"an incident carrying the alert",
		);
		if (!incident) throw new Error("no incident");
		const [run] = await eventually(
			() => pl.investigations(incident.id),
			(r) => r.length === 1,
			"the run the alert started",
			30_000,
		);
		if (!run) throw new Error("no run");
		const said = await eventually(
			async () =>
				(await events(run.id))
					.flatMap((e) => (e.kind === "agent_step" ? [e.text] : []))
					.join(""),
			(text) => text.includes("You answered"),
			"the agent hears the decline",
			30_000,
		);
		expect(said).toContain('You answered: {"action":"decline"}');
		expect((await events(run.id)).some((e) => e.kind === "ask_opened")).toBe(false);
	});

	it("Given a permission ask, When the person denies it with a reason, Then the rejection reaches the agent and the reason follows as its next message", async () => {
		await pl.serviceWithRepo("ledger");
		const alert = am.fire({
			labels: {
				alertname: "LedgerSlow fake-session:ask",
				service: "ledger",
				severity: "medium",
			},
			annotations: { summary: "ledger latency" },
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
		const ask = await eventually(
			async () => (await events(run.id)).find((e) => e.kind === "permission_ask"),
			(e) => Boolean(e),
			"the permission ask",
			30_000,
		);
		if (ask?.kind !== "permission_ask") throw new Error("no ask");
		const out = await pl.api<{ outcome: string }>(
			`/investigations/${run.id}/asks/${ask.askId}`,
			{
				method: "POST",
				body: {
					answer: {
						kind: "permission",
						decision: "deny",
						reason: "Write to the scratch folder instead",
					},
				},
			},
		);
		expect(out).toEqual({ outcome: "denied" });
		const after = await eventually(
			() => events(run.id),
			(all) =>
				all.some(
					(e) =>
						e.kind === "agent_step" &&
						e.text.includes("Write to the scratch folder instead"),
				),
			"the agent answers the reason",
			30_000,
		);
		expect(
			after.find((e) => e.kind === "permission_answer" && e.askId === ask.askId),
		).toMatchObject({ outcome: "denied" });
		expect(
			after.some(
				(e) =>
					e.kind === "operator_message" &&
					e.text === "Write to the scratch folder instead" &&
					e.delivered,
			),
		).toBe(true);
	});
});
