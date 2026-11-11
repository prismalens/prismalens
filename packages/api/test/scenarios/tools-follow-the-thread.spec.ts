// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Schedule, ScheduleDetail, ThreadSubjectKind } from "@prismalens/contracts";
import { isFailure, servedTo } from "@prismalens/integrations/harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { threadSubject } from "../../src/modules/investigations/run-scope.js";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();
const SERVICE = "cart-api";
const RUNBOOK = "runbooks/restart.md";
/** The latest run of each subject, and an earlier thread it may read. */
type Seeded = { id: string; other?: string; file?: string; runbook?: unknown };
const runs = new Map<ThreadSubjectKind, Seeded>();

const finished = (s: string) => !["pending", "running", "queued"].includes(s);

async function settled(id: string): Promise<void> {
	await eventually(
		() => pl.api<{ status: string }>(`/investigations/${id}`),
		(i) => finished(i.status),
		`run ${id} to finish`,
		30_000,
	);
}

/** Starts a thread through the product, with a text file attached to its first message. */
async function thread(subject: Record<string, string>, text: string, file?: string) {
	const draftKey = randomUUID();
	const attachments = file
		? [(await pl.upload(`/threads/drafts/${draftKey}/attachments`, file, "notes")).id]
		: [];
	const { investigationId } = await pl.api<{ investigationId: string }>("/threads", {
		method: "POST",
		body: {
			subject,
			text,
			...(file ? { attachments, draftKey } : {}),
		},
	});
	await settled(investigationId);
	return { id: investigationId, file: attachments[0] };
}

beforeAll(async () => {
	await pl.boot();
	const repo = join(pl.workspace, "repo-cart");
	mkdirSync(join(repo, "runbooks"), { recursive: true });
	writeFileSync(join(repo, "README.md"), "# cart\n");
	writeFileSync(join(repo, RUNBOOK), "# Restart the cart\n\nRoll the pods.\n");
	const git = (...args: string[]) =>
		execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
	git("init", "-q", "-b", "main");
	git("add", ".");
	git("commit", "-q", "-m", "init");
	const service = await pl.api<{ id: string }>("/services", {
		method: "POST",
		body: { name: SERVICE },
	});
	await pl.api("/repositories/source", {
		method: "POST",
		body: { serviceId: service.id, source: repo },
	});
	const link = await (await pl.prisma()).serviceRepository.findFirstOrThrow({
		where: { serviceId: service.id },
	});
	const project = { kind: "project", repositoryId: link.repositoryId };

	const p1 = await thread(project, "What does the cart do?");
	const p2 = await thread(project, "And how is it restarted?", "pods: 3\n");
	runs.set("project", { id: p2.id, other: p1.id, file: p2.file });

	const s1 = await thread({ kind: "service", serviceId: service.id }, "Is cart healthy?");
	const s2 = await thread({ kind: "service", serviceId: service.id }, "Any deploys today?", "v42\n");
	runs.set("service", { id: s2.id, other: s1.id, file: s2.file });

	// Every subject reads its run's own files (#1024), a no-subject thread included.
	const none = await thread({ kind: "none" }, "hi", "nothing yet\n");
	runs.set("none", { id: none.id, file: none.file });

	const schedule = await pl.api<Schedule>("/schedules", {
		method: "POST",
		body: {
			name: "Cart check",
			serviceId: service.id,
			runbook: null,
			// The echo session finds nothing, so the check stays a schedule thread with no incident.
			brief: "fake-session:echo Check the cart",
			recurrence: { type: "cron", expr: "0 9 * * 1-5", timezone: "UTC" },
			harness: "claude-code",
			model: null,
			effort: null,
			missedPolicy: "run_once",
			catchUpMinutes: 60,
		},
	});
	await pl.api(`/schedules/${schedule.id}/run`, { method: "POST" });
	const detail = await eventually(
		() => pl.api<ScheduleDetail>(`/schedules/${schedule.id}`),
		(d) => d.ticks.some((t) => t.run && finished(t.run.status)),
		"the scheduled run to finish",
		30_000,
	);
	const check = detail.ticks.find((t) => t.run)?.run?.id as string;
runs.set("schedule", { id: check, other: s1.id });

	// An incident made by hand, investigated, then asked a follow-up chat.
	const incident = await pl.api<{ id: string }>("/incidents", {
		method: "POST",
		body: { title: "Cart errors", severity: "high", serviceId: service.id },
	});
	const first = await pl.api<{ investigationId: string }>(
		`/incidents/${incident.id}/investigate`,
		{ method: "POST", body: {} },
	);
	await settled(first.investigationId);
	const file = await pl.upload(`/incidents/${incident.id}/attachments`, "500s at 14:02", "log");
	const again = await pl.api<{ investigationId: string }>(
		`/incidents/${incident.id}/investigate`,
		{ method: "POST", body: { attachments: [file.id] } },
	);
	await settled(again.investigationId);
	runs.set("incident", {
		id: again.investigationId,
		other: first.investigationId,
		file: file.id,
	});
}, 240_000);

afterAll(async () => {
	await pl.dispose();
});

/** A real input for each tool, from what the seeded threads hold. */
function inputFor(tool: string, run: Seeded) {
	switch (tool) {
		case "thread_read":
			return { threadId: run.other };
		case "attachment_read":
			return { id: run.file };
		case "runbooks_read":
			return run.runbook ?? {};
		case "service_get":
			return { name: SERVICE };
		case "investigations_search":
			return { query: "cart" };
		case "thread_title":
			return { title: "Restarting the cart service" };
		case "artifact_publish":
			return { title: "Cart", html: "<p>cart</p>" };
		case "evidence_record":
			return { observation: "Cart pods restarted", source: "kubectl", quote: "restarted" };
		case "hypothesis_record":
			return { statement: "A bad deploy", status: "speculative" };
		case "report_validate":
			return { report: "{}" };
		// Ask each time opens a card for the start; the others answer "not in a tree yet".
		case "thread_start":
			return { title: "Check the cart", role: "cart", brief: "Find why the cart fails and return the cause.", requestId: "cov-start" };
		case "thread_send":
			return { to: "parent", type: "fact", text: "x", requestId: "cov-send" };
		// The start above left a card waiting; a wait on it is registered.
		case "thread_wait":
			return { ids: ["cov-start"] };
		case "thread_cancel":
			return { id: "parent", reason: "coverage", requestId: "cov-cancel" };
		case "propose_action":
			return { change: { kind: "setting", key: "children", value: 3 }, why: "coverage" };
		case "ask_user":
			return { questions: [{ question: "Restart the cart?", options: [{ label: "Yes" }, { label: "No" }] }] };
		case "wakeup_schedule":
			return { delaySeconds: 600, reason: "Check the cart rollout" };
		case "pr_link":
			return { url: "https://github.com/acme/cart/pull/1" };
		case "pr_watch":
		case "pr_unwatch":
			return { prId: "none", until: "merged" };
		case "cron_create":
			return { schedule: "0 9 * * *", prompt: "Check the cart rollout" };
		case "cron_delete":
			return { id: "none" };
		case "secret_request":
			return { name: "CART_TOKEN", reason: "Read the cart admin API" };
		default:
			return {};
	}
}

describe("Tools follow the thread (#1020): no offered tool always fails", () => {
	it("Given a project thread with history, When it lists threads, Then it gets the earlier thread, not not_found", async () => {
		const g = await pl.gateway();
		const project = runs.get("project");
		const tool = g.tools.find((t) => t.name === "thread_list");
		const r = await tool?.run(tool.input.parse({}), {
			runId: project?.id as string,
			signal: new AbortController().signal,
		});
		expect(isFailure(r)).toBe(false);
		expect(JSON.stringify(r)).toContain(project?.other);
	});

	for (const subject of ["incident", "project", "service", "schedule", "none"] as const)
		it(`Given a seeded ${subject} thread, Then every tool its view offers answers something other than not_found`, async () => {
			const g = await pl.gateway();
			const run = runs.get(subject);
			if (!run) throw new Error(`no ${subject} run was seeded`);
			const row = await (await pl.prisma()).investigation.findUniqueOrThrow({
				where: { id: run.id },
			});
			expect(threadSubject(row)).toBe(subject);
			const owes = row.kind === "chat" ? "answer" : "report";
			await g.lease(run.id, "prismalens-coverage", undefined, undefined, { subject, owes });
			const offered = servedTo(g.tools, { subject, owes });
			expect(offered.length).toBeGreaterThan(0);
			const answers: Record<string, string> = {};
			const ctx = { runId: run.id, signal: new AbortController().signal };
			const list = g.tools.find((t) => t.name === "runbooks_list");
			const listed = list ? await list.run({}, ctx) : null;
			// runbooks_read takes a path and service exactly as runbooks_list gave them.
			const first = (listed as { value?: { runbooks?: { path: string; service: string }[] } })
				?.value?.runbooks?.[0];
			if (first) run.runbook = { path: first.path, service: first.service };
			for (const tool of offered) {
				const r = await tool.run(tool.input.parse(inputFor(tool.name, run)), {
					runId: run.id,
					signal: new AbortController().signal,
				});
				answers[tool.name] = isFailure(r) ? r.failure.error : "ok";
			}
			g.revoke(run.id);
			expect(Object.entries(answers).filter(([, a]) => a === "not_found")).toEqual([]);
			// The reads that follow the subject answer with data, not a refusal.
			for (const name of ["thread_list", "thread_read", "attachment_read", "runbooks_read", "fixes_list", "changes_list"])
				if (name in answers) expect(`${name}: ${answers[name]}`).toBe(`${name}: ok`);
		});
});
