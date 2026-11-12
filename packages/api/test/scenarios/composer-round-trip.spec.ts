// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomUUID } from "node:crypto";
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
import { setFakeCapability } from "../../../../scripts/fakes/fake-acp-agent.mjs";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

const PDF_TEXT = "PrismaLens runbook 42";

/** A one-page PDF whose page says `text`, with a correct cross-reference table. */
function pdfWith(text: string): string {
	const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	let out = "%PDF-1.4\n";
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return out;
}

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

/** A PUT as this paired device, answered with its status and body whatever they are. */
async function fetchJson(path: string, body: unknown) {
	const res = await pl.fetchAs("PUT", path, body);
	return { status: res.status, body: (await res.json()) as unknown };
}

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
	it("Given a draft, When a second device saves over a stale rev, Then it gets 409; and When the draft is sent, Then a late autosave cannot bring it back", async () => {
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
		const phone = await pl.api<ComposerDraft>(`/drafts/${scope}`, {
			method: "PUT",
			body: { ...body, text: "phone", baseRev: 1, generation: 0 },
		});
		await expect(
			pl.api(`/drafts/${scope}`, {
				method: "PUT",
				body: { ...body, text: "desktop", baseRev: 1, generation: 0 },
			}),
		).rejects.toThrow(/409.*phone/s);
		// The real send, naming the draft it came from.
		const started = await pl.api<{ investigationId: string; queued: boolean }>(
			"/threads",
			{
				method: "POST",
				body: {
					subject: { kind: "none" },
					text: "phone",
					draftScope: scope,
					draftRev: phone.rev,
				},
			},
		);
		expect(started.queued).toBe(true);
		const tomb = await pl.api<ComposerDraft>(`/drafts/${scope}`);
		expect(tomb).toMatchObject({ text: "", generation: 1 });
		// An autosave in flight from before the send carries the old generation.
		await expect(
			pl.api(`/drafts/${scope}`, {
				method: "PUT",
				body: { ...body, text: "phone", baseRev: phone.rev, generation: 0 },
			}),
		).rejects.toThrow(/409/);
		expect((await pl.api<ComposerDraft>(`/drafts/${scope}`)).text).toBe("");
	}, 60_000);

	it("Given a new scope, When two first saves race on real SQLite, Then one is stored and the other gets 409 carrying it", async () => {
		const scope = `new:project:${randomUUID()}`;
		const save = (text: string) =>
			fetchJson(`/drafts/${scope}`, {
				text,
				draftKey: null,
				attachments: [],
				quotes: [],
				references: [],
				choice: {},
				baseRev: 0,
				generation: 0,
			});
		const results = await Promise.all([save("phone"), save("laptop")]);
		const ok = results.filter((r) => r.status === 200);
		const lost = results.filter((r) => r.status === 409);
		expect(ok).toHaveLength(1);
		expect(lost).toHaveLength(1);
		const winner = ok[0]?.body as ComposerDraft;
		expect(winner.rev).toBe(1);
		expect(lost[0]?.body).toMatchObject({
			code: "CONFLICT",
			data: { current: { text: winner.text, rev: 1 } },
		});
		expect((await pl.api<ComposerDraft>(`/drafts/${scope}`)).text).toBe(winner.text);
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

	it.each([
		{ path: "prismalens://attachment", folder: false },
		{ path: "the run's own folder", folder: true },
	])(
		"Given a PDF on an incident, When the run starts, Then its text reaches the agent through $path",
		async ({ folder }) => {
			const name = folder ? "pdfdir" : "pdflink";
			setFakeCapability("additionalDirectories", folder, pl.fakeState);
			try {
				await pl.serviceWithRepo(name);
				const alert = am.fire({
					labels: { alertname: `${name}Slow fake-session:attach-link`, service: name, severity: "medium" },
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
					new File([pdfWith(PDF_TEXT)], "runbook.pdf", { type: "application/pdf" }),
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
				if (folder) {
					// The agent read the copy in its own folder, straight from disk.
					expect(said).toMatch(/Read runbook\.pdf: .*PrismaLens runbook 42/s);
					return;
				}
				const uri = `prismalens://attachment/${file.id}`;
				expect(said).toContain(`Link runbook.pdf: ${uri}`);
				const g = await pl.gateway();
				const read = g.tools.find((t) => t.name === "pl_attachment_read");
				if (!read) throw new Error("no pl_attachment_read");
				const own = await read.run(read.input.parse({ id: uri }), {
					runId: run.id,
					signal: new AbortController().signal,
				});
				expect(JSON.stringify(own)).toContain(PDF_TEXT);
				const other = await read.run(read.input.parse({ id: uri }), {
					runId: "00000000-0000-4000-8000-000000000000",
					signal: new AbortController().signal,
				});
				expect(JSON.stringify(other)).toContain("not_found");
			} finally {
				setFakeCapability("additionalDirectories", false, pl.fakeState);
			}
		},
		60_000,
	);

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

