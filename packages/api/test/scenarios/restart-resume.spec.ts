// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, rmSync } from "node:fs";
import type { CanonicalEvent, RestartSummary } from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type FakeAlertmanager,
	startFakeAlertmanager,
} from "../../../../scripts/fakes/fake-alertmanager.mjs";
import {
	eventually,
	type Investigation,
	ScenarioApp,
} from "./support/scenario-app.js";

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

interface Run extends Investigation {
	endReason?: string | null;
	acpSessionId?: string | null;
	workspace?: { cwd: string; repos: Array<{ dir: string }> } | null;
}
type OperatorMessage = Extract<CanonicalEvent, { kind: "operator_message" }>;

const ended = <T extends Investigation>(r: T) => !["pending", "running"].includes(r.status);
const run = (id: string) => pl.api<Run>(`/investigations/${id}`);

async function eventsOf(id: string): Promise<CanonicalEvent[]> {
	const all: CanonicalEvent[] = [];
	let cursor: number | undefined;
	do {
		const page = await pl.api<{
			events: CanonicalEvent[];
			nextCursor: number | null;
		}>(`/investigations/${id}/events?limit=200${cursor === undefined ? "" : `&cursor=${cursor}`}`);
		all.push(...page.events);
		cursor = page.nextCursor ?? undefined;
	} while (cursor !== undefined);
	return all;
}

const restartMessages = (events: CanonicalEvent[]): OperatorMessage[] =>
	events.filter(
		(e): e is OperatorMessage =>
			e.kind === "operator_message" && Boolean(e.via?.restart),
	);

/** The alert starts a run on its own at critical; `session` picks the scripted agent. */
async function work(service: string, session: string) {
	await pl.serviceWithRepo(service);
	const alert = am.fire({
		labels: {
			alertname: `${service} fake-session:${session}`,
			service,
			severity: "critical",
		},
		annotations: { summary: `${service} is slow` },
	});
	expect(
		(await am.post(pl.webhookUrl, pl.webhookToken, { only: [alert.fingerprint] }))
			.status,
	).toBeLessThan(300);
	const [incident] = await eventually(
		() => pl.incidentFor(alert.fingerprint),
		(found) => found.length === 1,
		`the ${service} incident`,
	);
	const [started] = await eventually(
		() => pl.investigations(incident.id),
		(runs) => runs.length === 1,
		`the ${service} run`,
	);
	await heldAtTool(started.id);
	return started.id;
}

/** The scripted agent has run its first tool and now waits for a release. */
const heldAtTool = (id: string) =>
	eventually(
		() => eventsOf(id),
		(events) =>
			events.some(
				(e) => e.kind === "tool_result" && e.result.toolCallId === "toolu_live",
			),
		"the run to reach its held step",
		30_000,
	);

/** Stop and start PrismaLens as a crash would leave it; it ran long enough not to read as a boot loop. */
async function restart(): Promise<void> {
	await pl.ranSince(new Date(Date.now() - 10 * 60_000));
	await pl.stop();
	await pl.boot();
}

/** The 30 s wait for the alert catch-up is not what a scenario is about (#981). */
async function pullIn(id: string): Promise<void> {
	const db = await pl.prisma();
	await db.job.updateMany({
		where: { investigationId: id, status: "pending" },
		data: { runAt: new Date() },
	});
	await pl.tick();
}

const summary = () => pl.api<NonNullable<RestartSummary>>("/restart");

describe("Walk #981: runs a restart cut off are taken up again", () => {
	it("Given a run working, When PrismaLens stops and starts, Then it resumes in the same session with one message from PrismaLens", async () => {
		const id = await work("resumed", "live-resume");
		const before = await run(id);
		expect(before.acpSessionId).toBeTruthy();

		await restart();

		const cut = await run(id);
		expect(cut.status).toBe("pending");
		// The API shows endReason on a failed run only; the pending row holds it (#981).
		expect(
			(await (await pl.prisma()).investigation.findUnique({ where: { id } }))
				?.endReason,
		).toBe("interrupted");

		await pullIn(id);
		const done = await eventually(() => run(id), ended, "the resumed run to end", 60_000);
		expect(done.status).toBe("completed");
		expect(done.acpSessionId).toBe(before.acpSessionId);

		const messages = restartMessages(await eventsOf(id));
		expect(messages).toHaveLength(1);
		expect(messages[0].via?.restart?.by).toBe("auto");
		expect(messages[0].text.startsWith("PrismaLens stopped at")).toBe(true);
		expect(messages[0].text).toContain(
			"Your last command may or may not have completed",
		);

		const listed = await summary();
		expect(listed.resumed.map((r) => r.investigationId)).toContain(id);
	}, 120_000);

	it("Given a run the operator stopped, When PrismaLens restarts, Then it stays cancelled and nothing runs", async () => {
		const id = await work("stopped", "live-resume");
		await pl.api(`/investigations/${id}/cancel`, { method: "POST" });
		await eventually(() => run(id), (r) => r.status === "cancelled", "the run to cancel");

		await restart();
		await pullIn(id);
		await new Promise((r) => setTimeout(r, 3_000));

		expect((await run(id)).status).toBe("cancelled");
		const job = await (await pl.prisma()).job.findUnique({
			where: { investigationId: id },
		});
		expect(job?.status).toBe("cancelled");
		expect(restartMessages(await eventsOf(id))).toEqual([]);
		expect((await summary()).resumed.map((r) => r.investigationId)).not.toContain(id);
	}, 60_000);

	it("Given a run waiting for an answer, When PrismaLens restarts, Then the ask is closed as restarted and the run resumes", async () => {
		await pl.serviceWithRepo("asking");
		const alert = am.fire({
			labels: {
				alertname: "asking fake-session:ask",
				service: "asking",
				severity: "medium",
			},
		});
		await am.post(pl.webhookUrl, pl.webhookToken, { only: [alert.fingerprint] });
		const [incident] = await eventually(
			() => pl.incidentFor(alert.fingerprint),
			(found) => found.length === 1,
			"the asking incident",
		);
		await pl.api(`/incidents/${incident.id}/investigate`, {
			method: "POST",
			body: { accessLevel: "supervised" },
		});
		const [started] = await eventually(
			() => pl.investigations(incident.id),
			(runs) => runs.length === 1,
			"the asking run",
		);
		const id = started.id;
		await eventually(
			() => eventsOf(id),
			(events) => events.some((e) => e.kind === "permission_ask"),
			"the ask to be raised",
			30_000,
		);

		await restart();

		const events = await eventually(
			() => eventsOf(id),
			(all) => all.some((e) => e.kind === "permission_answer"),
			"the ask to be answered",
		);
		const answer = events.find((e) => e.kind === "permission_answer");
		expect(answer?.kind === "permission_answer" && answer.outcome).toBe(
			"restarted",
		);

		await pullIn(id);
		const [message] = await eventually(
			async () => restartMessages(await eventsOf(id)),
			(found) => found.length === 1,
			"the restart message",
			60_000,
		);
		expect(message.text).toContain("was closed unanswered");
		await eventually(() => run(id), ended, "the run to end", 60_000);
	}, 120_000);

	it("Given a run whose workspace was deleted, When PrismaLens restarts, Then the run resumes in a rebuilt one", async () => {
		const id = await work("gone", "live-resume");
		const { workspace } = await run(id);
		const dirs = [workspace?.cwd, ...(workspace?.repos.map((r) => r.dir) ?? [])];
		expect(dirs.some(Boolean)).toBe(true);

		await pl.ranSince(new Date(Date.now() - 10 * 60_000));
		await pl.stop();
		for (const dir of new Set(dirs))
			if (dir) rmSync(dir, { recursive: true, force: true });
		expect(dirs.some((d) => d && existsSync(d))).toBe(false);
		await pl.boot();

		await pullIn(id);

		const [message] = await eventually(
			async () => restartMessages(await eventsOf(id)),
			(found) => found.length === 1,
			"the restart message",
			60_000,
		);
		expect(message.text).toContain(
			"was removed while PrismaLens was stopped and has been rebuilt",
		);
		const done = await eventually(() => run(id), ended, "the run to end", 60_000);
		expect(done.status).toBe("completed");
	}, 120_000);

	it("Given a run with history, When it resumes, Then nothing from before the stop is replayed", async () => {
		const id = await work("history", "live-resume");
		const before = await eventsOf(id);
		const ids = (events: CanonicalEvent[]) =>
			events.flatMap((e) =>
				e.kind === "tool_result"
					? [`result:${e.result.toolCallId}`]
					: e.kind === "agent_step"
						? e.toolCalls.map((c) => `step:${c.toolCallId}`)
						: [],
			);
		expect(ids(before)).toContain("result:toolu_live");

		await restart();
		await pullIn(id);
		await eventually(() => run(id), ended, "the run to end", 60_000);

		const after = await eventsOf(id);
		const key = (e: CanonicalEvent) => `${e.kind}:${"seq" in e ? e.seq : ""}`;
		expect(after.slice(0, before.length).map(key)).toEqual(before.map(key));
		const added = after.slice(before.length);
		expect(added.length).toBeGreaterThan(0);
		expect(ids(added)).toEqual([]);
	}, 120_000);

	it("Given three incidents each with a working run, When PrismaLens restarts once, Then all three resume within the dispatch cap", async () => {
		const cap = 3;
		const ids = [
			await work("many-a", "live-resume"),
			await work("many-b", "live-resume"),
			await work("many-c", "live-resume"),
		];

		await restart();
		const rows = await Promise.all(ids.map(run));
		expect(rows.map((r) => r.status)).toEqual(["pending", "pending", "pending"]);
		expect((await summary()).resumed.map((r) => r.investigationId).sort()).toEqual(
			[...ids].sort(),
		);

		await Promise.all(ids.map(pullIn));
		let peak = 0;
		await eventually(
			async () => {
				const now = await Promise.all(ids.map(run));
				peak = Math.max(peak, now.filter((r) => r.status === "running").length);
				return now;
			},
			(now) => now.every((r) => r.status === "completed"),
			"all three runs to finish",
			90_000,
		);
		expect(peak).toBeLessThanOrEqual(cap);
	}, 150_000);

	it("Given a run PrismaLens stops during every resume, When it starts a fourth time, Then the run is failed as not resumed", async () => {
		const id = await work("looping", "live-stuck");

		for (let boot = 1; boot <= 3; boot++) {
			await restart();
			expect((await run(id)).status).toBe("pending");
			await pullIn(id);
			await eventually(
				async () => restartMessages(await eventsOf(id)),
				(found) => found.length === boot,
				`resume ${boot} to start`,
				60_000,
			);
		}
		await restart();

		const stopped = await run(id);
		expect(stopped.status).toBe("failed");
		expect(stopped.endReason).toBe("interrupted");
		expect(stopped.error).toMatch(
			/^Not resumed: PrismaLens stopped again during each of the last 3 resumes/,
		);
	}, 240_000);

	it("Given Resume after a restart is off, When PrismaLens restarts, Then the run is failed until the operator resumes it", async () => {
		const id = await work("switched", "live-resume");
		await pl.api("/settings/harness", {
			method: "PATCH",
			body: { resumeAfterRestart: false },
		});

		await restart();
		const left = await run(id);
		expect(left.status).toBe("failed");
		expect(left.endReason).toBe("interrupted");
		expect(left.error).toBe("Not resumed: Resume after a restart is off in Settings.");

		await pl.api(`/investigations/${id}/resume`, { method: "POST" });
		const done = await eventually(() => run(id), (r) => r.status === "completed", "the resumed run to end", 60_000);
		expect(done.status).toBe("completed");
		const [message] = restartMessages(await eventsOf(id));
		expect(message.via?.restart?.by).toBe("operator");

		await pl.api("/settings/harness", {
			method: "PATCH",
			body: { resumeAfterRestart: true },
		});
	}, 120_000);
});
