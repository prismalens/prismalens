// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	type FakeAlertmanager,
	startFakeAlertmanager,
} from "../../../../scripts/fakes/fake-alertmanager.mjs";
import { eventually, type Investigation, ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();
let am: FakeAlertmanager;

beforeAll(async () => {
	am = await startFakeAlertmanager();
	await pl.boot();
	await pl.serviceWithRepo("books");
}, 60_000);
afterAll(async () => {
	await am.close();
	await pl.dispose();
});

type Session = {
	limit?: { resetsAt?: string | null; nextAttemptAt?: string; attempts: number; autoResume: boolean };
};
type Event = { kind: string; [k: string]: unknown };

const finished = (i: Investigation) => !["pending", "running"].includes(i.status);
const NOTE = "The usage limit has reset; continue where you left off.";

async function runOf(session: string, name = "BooksSlow"): Promise<Investigation> {
	const alert = am.fire({
		labels: { alertname: `${name} fake-session:${session}`, service: "books", severity: "critical" },
		annotations: { summary: "p99 of GET /books above 2s" },
	});
	expect((await am.post(pl.webhookUrl, pl.webhookToken)).status).toBeLessThan(300);
	const [incident] = await eventually(
		() => pl.incidentFor(alert.fingerprint),
		(found) => found.length === 1,
		"an incident carrying the alert",
	);
	const [run] = await eventually(
		() => pl.investigations(incident?.id as string),
		(runs) => runs.length === 1,
		"the run the alert started",
	);
	return eventually(() => pl.investigation(run?.id as string), finished, "the run to stop", 30_000);
}

async function events(id: string): Promise<Event[]> {
	return (await pl.api<{ events: Event[] }>(`/investigations/${id}/events?limit=200`)).events;
}

async function session(id: string): Promise<Session> {
	return (await pl.api<{ session: Session }>(`/investigations/${id}`)).session;
}

describe("A usage limit becomes a scheduled resume (#1024)", () => {
	it("Codex: classify, extract and schedule at its reset; the resume fires after a restart and re-sends the interrupted turn", async () => {
		const limited = await runOf("limit-codex");
		expect(limited).toMatchObject({ status: "failed", endReason: "limited" });
		const reset = new Date(2099, 0, 1, 15, 45, 0);
		expect((await session(limited.id)).limit).toMatchObject({
			resetsAt: reset.toISOString(),
			nextAttemptAt: new Date(reset.getTime() + 2 * 60_000).toISOString(),
			autoResume: true,
			attempts: 1,
		});
		const said = await events(limited.id);
		expect(said.find((e) => e.kind === "usage_limit")).toMatchObject({ resetsAt: reset.toISOString() });
		expect(said.find((e) => e.kind === "resume_scheduled")).toMatchObject({ wakeKind: "limit" });

		// The wake outlives a restart: a new process reads it from the table.
		await pl.stop();
		await pl.boot();
		await (await pl.sessions()).process(new Date(reset.getTime() + 3 * 60_000));

		const done = await eventually(
			() => pl.investigation(limited.id),
			(i) => i.status === "completed",
			"the resumed run to reach its report",
			30_000,
		);
		expect(done.report?.rootCause).toContain("d37d888");
		const after = await events(limited.id);
		const resumedAt = after.findIndex((e) => e.kind === "resumed");
		expect(after[resumedAt]).toMatchObject({ reason: "limit_reset" });
		const message = after.slice(resumedAt).find((e) => e.kind === "operator_message");
		expect(message?.text).toBe(NOTE);
		expect((await session(limited.id)).limit).toBeUndefined();
	}, 120_000);

	it("the user's follow-up chose Compact, then send, and the compaction hit the limit: the resume re-sends exactly what they wrote, once", async () => {
		// Claude Code has a compact command; the thread keeps the agent it started with.
		await pl.api("/settings/harness", { method: "PATCH", body: { harness: "claude-code" } });
		const done = await runOf("limit-follow-up");
		await pl.api("/settings/harness", { method: "PATCH", body: { harness: "auto" } });
		expect(done.status).toBe("completed");
		const asked = "DISTINCT-7421: which deploy dropped the books index?";
		await pl.api(`/investigations/${done.id}/messages`, { method: "POST", body: { text: asked, compact: true } });
		await eventually(
			() => pl.api<{ session: Session }>(`/investigations/${done.id}`),
			(t) => !!t.session.limit?.nextAttemptAt,
			"the follow-up to hit the limit",
			30_000,
		);
		const reset = new Date(2099, 0, 1, 15, 45, 0);
		const sessions = await pl.sessions();
		await sessions.process(new Date(reset.getTime() + 3 * 60_000));
		// A second pass right after finds the wake already consumed by the admission.
		await sessions.process(new Date(reset.getTime() + 4 * 60_000));
		await eventually(
			async () => events(done.id),
			(all) => JSON.stringify(all).includes("Picked up after the reset"),
			"the resumed turn's answer",
			30_000,
		);
		const all = await events(done.id);
		expect(all.filter((e) => e.kind === "resumed")).toHaveLength(1);
		// The line waited as queued through the failed compaction, and the resume delivered it.
		expect(all.filter((e) => e.kind === "message_queued").map((e) => e.text)).toEqual([asked]);
		const sent = all.filter((e) => e.kind === "operator_message").map((e) => e.text);
		expect(sent).toEqual([`${NOTE}\n\n${asked}`]);
		const answer = all.filter((e) => e.kind === "agent_step").map((e) => e.text).join("");
		expect(answer).toContain(`Picked up after the reset: ${NOTE}\n\n${asked}`);
	}, 120_000);

	it("a crash right after a wake's admission never admits it a second time", async () => {
		const limited = await runOf("limit-codex", "BooksSlowTwice");
		expect(limited).toMatchObject({ status: "failed", endReason: "limited" });
		const reset = new Date(2099, 0, 1, 15, 45, 0);
		const sessions = await pl.sessions();
		const wakes = (sessions as unknown as { wakes: { finish: (...a: unknown[]) => Promise<boolean> } }).wakes;
		// A crash right after the admission: nothing after it runs, neither the wake's end nor the run's settle hook.
		const crash = vi.spyOn(wakes, "finish").mockRejectedValue(new Error("crashed after admission"));
		const unsettled = vi.spyOn(sessions, "onSettled").mockResolvedValue();
		await sessions.process(new Date(reset.getTime() + 3 * 60_000)).catch(() => {});
		await eventually(() => pl.investigation(limited.id), (i) => i.status === "completed", "the resumed run", 30_000);
		crash.mockRestore();
		unsettled.mockRestore();
		await sessions.process(new Date(reset.getTime() + 60 * 60_000));
		expect((await pl.investigation(limited.id)).status).toBe("completed");
		const resumes = (await events(limited.id)).filter((e) => e.kind === "operator_message" && e.text === NOTE);
		expect(resumes).toHaveLength(1);
	}, 120_000);

	it("Gemini: a terminal quota retries in 30 minutes; the short retry on the resumed turn schedules nothing", async () => {
		const limited = await runOf("limit-gemini");
		expect(limited).toMatchObject({ status: "failed", endReason: "limited" });
		const first = await session(limited.id);
		expect(first.limit).toMatchObject({ resetsAt: null, attempts: 1 });
		const at = Date.parse(first.limit?.nextAttemptAt as string);
		await (await pl.sessions()).process(new Date(at + 60_000));
		const failed = await eventually(
			() => pl.investigation(limited.id),
			(i) => finished(i) && (i.error ?? "").includes("retry in 20s"),
			"the resumed turn to fail on the short retry",
			30_000,
		);
		expect((failed as { endReason?: string | null }).endReason ?? null).not.toBe("limited");
		expect((await session(limited.id)).limit).toBeUndefined();
		const after = await events(limited.id);
		expect(after.filter((e) => e.kind === "usage_limit")).toHaveLength(1);
	}, 120_000);

	it("no time it can read: the resume still comes, and turning it off keeps it waiting", async () => {
		const limited = await runOf("limit-no-time");
		const first = await session(limited.id);
		expect(first.limit).toMatchObject({ resetsAt: null, attempts: 1, autoResume: true });
		await pl.api(`/investigations/${limited.id}/auto-resume`, { method: "PUT", body: { on: false } });
		const at = Date.parse(first.limit?.nextAttemptAt as string);
		const sessions = await pl.sessions();
		await sessions.process(new Date(at + 60_000));
		expect((await pl.investigation(limited.id)).status).toBe("failed");
		expect((await session(limited.id)).limit).toMatchObject({ autoResume: false });
		expect((await session(limited.id)).limit?.nextAttemptAt).toBeUndefined();

		await pl.api(`/investigations/${limited.id}/auto-resume`, {
			method: "PUT",
			body: { on: true, message: "Then check the cache hit rate." },
		});
		await sessions.process(new Date(at + 60_000));
		await eventually(
			() => pl.investigation(limited.id),
			(i) => i.status === "completed",
			"the resumed run",
			30_000,
		);
		const sent = (await events(limited.id)).filter((e) => e.kind === "operator_message").at(-1);
		expect(sent?.text).toBe(`${NOTE}\n\nThen check the cache hit rate.`);
	}, 120_000);
});
