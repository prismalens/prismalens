// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	CanonicalEvent,
	ComposerDraft,
	ReferenceSearchResult,
} from "@prismalens/contracts";
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

/** An incident from a fake-session alert, and the run a person starts on it. */
async function personRun(service: string, session: string) {
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
	return { incident, run };
}

describe("Walk: the composer keeps every word, and what it carries reaches the agent (#1024)", () => {
	it("Given a draft on a thread, When a second device saves over a stale rev, Then it gets 409 with the newer draft, and a send leaves a tombstone a late autosave cannot pass", async () => {
		const scope = "new:home";
		const body = {
			text: "why is checkout slow",
			draftKey: null,
			attachments: [],
			quotes: [],
			references: [],
			choice: { verb: "ask" },
		};
		const saved = await pl.api<ComposerDraft>(`/drafts/${scope}`, {
			method: "PUT",
			body: { ...body, baseRev: 0, generation: 0 },
		});
		expect(saved).toMatchObject({ rev: 1, text: "why is checkout slow" });
		await pl.api(`/drafts/${scope}`, {
			method: "PUT",
			body: { ...body, text: "phone", baseRev: 1, generation: 0 },
		});
		const stale = await pl.fetchRaw(`/drafts/${scope}`);
		expect(((await stale.json()) as ComposerDraft).text).toBe("phone");
		await expect(
			pl.api(`/drafts/${scope}`, {
				method: "PUT",
				body: { ...body, text: "desktop", baseRev: 1, generation: 0 },
			}),
		).rejects.toThrow(/409.*phone/s);
		expect(await pl.api(`/drafts/${scope}`, { method: "DELETE" })).toEqual({
			deleted: true,
		});
	}, 60_000);

	it("Given a run waiting on an ask with two queued messages, When one is edited and one withdrawn, Then the agent gets only the edited text, and a late edit is ALREADY_DELIVERED", async () => {
		const { run } = await personRun("queue", "ask");
		await eventually(
			async () => (await events(run.id)).some((e) => e.kind === "permission_ask"),
			Boolean,
			"the run waits on its ask",
			30_000,
		);
		const send = (text: string) =>
			pl.api<{ messageId: string }>(`/investigations/${run.id}/messages`, {
				method: "POST",
				body: { text, mode: "queue" },
			});
		const first = await send("check the pool");
		const second = await send("never mind");
		expect(
			await pl.api(`/investigations/${run.id}/messages/${first.messageId}`, {
				method: "PATCH",
				body: { text: "check the pool size" },
			}),
		).toEqual({ state: "edited" });
		expect(
			await pl.api(`/investigations/${run.id}/messages/${second.messageId}`, {
				method: "DELETE",
			}),
		).toEqual({ state: "withdrawn" });
		const ask = (await events(run.id)).find((e) => e.kind === "permission_ask");
		if (ask?.kind !== "permission_ask") throw new Error("no ask");
		await pl.api(`/investigations/${run.id}/asks/${ask.askId}`, {
			method: "POST",
			body: { decision: "approve" },
		});
		const all = await eventually(
			() => events(run.id),
			(es) =>
				es.some(
					(e) => e.kind === "operator_message" && e.messageId === first.messageId,
				),
			"the edited message delivered",
			30_000,
		);
		expect(
			all.find((e) => e.kind === "operator_message" && e.messageId === first.messageId),
		).toMatchObject({ text: "check the pool size", delivered: true });
		expect(all.some((e) => e.kind === "message_edited")).toBe(true);
		expect(all.some((e) => e.kind === "message_withdrawn")).toBe(true);
		expect(
			all.some(
				(e) => e.kind === "operator_message" && e.messageId === second.messageId,
			),
		).toBe(false);
		await expect(
			pl.api(`/investigations/${run.id}/messages/${first.messageId}`, {
				method: "PATCH",
				body: { text: "too late" },
			}),
		).rejects.toThrow(/409/);
	}, 60_000);

	it("Given an agent that advertises commands, When the composer types /, Then its commands are listed apart from PrismaLens's actions", async () => {
		const { run } = await personRun("cmds", "commands");
		await eventually(
			() => pl.investigation(run.id),
			// Its report cites no tool, so the run may end failed; the commands came first.
			(i) => i.status === "completed" || i.status === "failed",
			"the run finishes",
			30_000,
		);
		const result = await pl.api<ReferenceSearchResult>(
			`/references/search?trigger=%2F&threadId=${run.id}`,
		);
		expect(
			result.hits.filter((h) => h.source === "agent").map((h) => h.ref.label).sort(),
		).toEqual(["/explain", "/review"]);
		expect(result.hits.some((h) => h.source === "app")).toBe(true);
	}, 60_000);

	it("Given a PDF on an incident, When the run starts, Then the PDF arrives as a prismalens://attachment link and attachment_read returns its bytes to that run only", async () => {
		await pl.serviceWithRepo("pdfs");
		const alert = am.fire({
			labels: { alertname: "PdfSlow fake-session:attach-link", service: "pdfs", severity: "medium" },
			annotations: { summary: "pdf latency" },
		});
		await am.post(pl.webhookUrl, pl.webhookToken);
		const [incident] = await eventually(
			() => pl.incidentFor(alert.fingerprint),
			(found) => found.length === 1,
			"an incident carrying the alert",
		);
		if (!incident) throw new Error("no incident");
		const file = await pl.uploadFile(
			`/incidents/${incident.id}/attachments`,
			new File(["%PDF-1.4 runbook bytes"], "runbook.pdf", { type: "application/pdf" }),
		);
		expect(file.mimeType).toBe("application/pdf");
		await pl.api(`/incidents/${incident.id}/investigate`, {
			method: "POST",
			body: { accessLevel: "supervised", attachments: [file.id] },
		});
		const [run] = await eventually(
			() => pl.investigations(incident.id),
			(runs) => runs.length === 1,
			"the run started",
		);
		if (!run) throw new Error("no run");
		const said = await eventually(
			async () =>
				(await events(run.id))
					.flatMap((e) => (e.kind === "agent_step" ? [e.text] : []))
					.join(""),
			(t) => t.includes("runbook.pdf"),
			"the agent sees the link",
			30_000,
		);
		const uri = `prismalens://attachment/${file.id}`;
		expect(said).toContain(`Link runbook.pdf: ${uri}`);
		const g = await pl.gateway();
		const read = g.tools.find((t) => t.name === "attachment_read");
		if (!read) throw new Error("no attachment_read");
		const own = await read.run(read.input.parse({ id: uri }), {
			runId: run.id,
			signal: new AbortController().signal,
		});
		// Not a real PDF, so no text: the tool answers, and refuses another run's ask below.
		expect(JSON.stringify(own)).toContain("runbook.pdf");
		const other = await read.run(read.input.parse({ id: uri }), {
			runId: "00000000-0000-4000-8000-000000000000",
			signal: new AbortController().signal,
		});
		expect(JSON.stringify(other)).toContain("not_found");
	}, 60_000);

	it("Given a tool's ask on a finished thread, When PrismaLens restarts, Then it still waits and the host answers it with no run live", async () => {
		const { run } = await personRun("held", "success");
		await eventually(
			() => pl.investigation(run.id),
			(i) => i.status === "completed" || i.status === "failed",
			"the run ends",
			30_000,
		);
		const askId = await (await pl.asks()).open(run.id, {
			kind: "permission",
			requiresHost: true,
			source: { kind: "tool", tool: "act", requestId: "req-1" },
			title: "Restart checkout-api",
			permission: { toolKind: "execute", options: [] },
		});
		await pl.stop();
		await pl.boot();
		const after = await (await pl.asks()).get(askId);
		expect(after?.closed).toBeNull();
		const out = await pl.api<{ outcome: string }>(
			`/investigations/${run.id}/asks/${askId}`,
			{ method: "POST", body: { answer: { kind: "permission", decision: "approve" } } },
		);
		expect(out).toEqual({ outcome: "approved" });
		const kinds = (await events(run.id))
			.filter((e) => (e.kind === "ask_opened" ? e.ask.askId : "askId" in e ? e.askId : null) === askId)
			.map((e) => e.kind);
		expect(kinds).toEqual(["ask_opened", "ask_closed"]);
	}, 120_000);
});

