// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();
// The fake agent's echo session says its whole prompt back, so the prompt lands in the transcript.
const ASK = "fake-session:echo How do I send alerts here?";
let token: string;
let runId: string;
let streamed: string;

/** Reads the run's live stream until its done marker, or what arrived within the time. */
async function readStream(id: string, ms: number): Promise<string> {
	const stop = new AbortController();
	const timer = setTimeout(() => stop.abort(), ms);
	let text = "";
	try {
		const res = await pl.fetchRaw(`/investigations/${id}/stream`, stop.signal);
		const reader = res.body?.getReader();
		const decoder = new TextDecoder();
		while (reader) {
			const { done, value } = await reader.read();
			if (done) break;
			text += decoder.decode(value, { stream: true });
			if (text.includes('"type":"done"')) break;
		}
	} catch {
		// Aborted at the deadline: keep what arrived.
	} finally {
		clearTimeout(timer);
	}
	return text;
}

beforeAll(async () => {
	await pl.boot();
	token = pl.webhookToken;
	const started = await pl.api<{ investigationId: string }>("/threads", {
		method: "POST",
		body: { subject: { kind: "none" }, text: ASK, place: "alerts" },
	});
	runId = started.investigationId;
	streamed = await readStream(runId, 30_000);
	await eventually(
		() => pl.api<{ status: string }>(`/investigations/${runId}`),
		(i) => !["pending", "running"].includes(i.status),
		"the helper's run to finish",
		30_000,
	);
}, 90_000);
afterAll(async () => {
	await pl.dispose();
});

describe("A helper thread started from the empty Alerts page (#1020, OBJ-001)", () => {
	it("Given a paired device reading the thread, Then its messages carry the page's placeholders and never the webhook token", async () => {
		expect(token.length).toBeGreaterThan(8);
		const replay = JSON.stringify(await pl.api(`/investigations/${runId}/events`));
		expect(replay).toContain("How do I send alerts here?");
		expect(replay).toContain("Copy URL / Copy token");
		expect(replay).toContain("<webhook-token>");
		expect(replay).not.toContain(token);
		const run = JSON.stringify(await pl.api(`/investigations/${runId}`));
		expect(run).not.toContain(token);
		const feed = JSON.stringify(await pl.api("/threads/feed?limit=100"));
		expect(feed).toContain(runId);
		expect(feed).not.toContain(token);
	});

	it("Then the live stream never carries the token", () => {
		expect(streamed).not.toContain(token);
	});

	it("Then the export has nothing to give, and no token in its answer", async () => {
		const res = await pl.fetchRaw(`/investigations/${runId}/report.md`);
		expect(res.status).toBe(404);
		expect(await res.text()).not.toContain(token);
	});

	it("Then the job the run was queued with holds the page, not the token", async () => {
		const prisma = await pl.prisma();
		const jobs = await prisma.job.findMany({ where: { investigationId: runId } });
		expect(jobs.length).toBeGreaterThan(0);
		for (const job of jobs) {
			expect(job.payload).toContain('"place":"alerts"');
			expect(job.payload).not.toContain(token);
		}
		const row = await prisma.investigation.findUnique({ where: { id: runId } });
		expect(row?.helperPlace).toBe("alerts");
	});
});
