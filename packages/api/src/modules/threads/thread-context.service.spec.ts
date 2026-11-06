// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThreadContextSchema } from "@prismalens/contracts";
import { afterAll, describe, expect, it, vi } from "vitest";
import { osName, ThreadContextService } from "./thread-context.service.js";

const RUN = "11111111-1111-4111-8111-111111111111";
const folder = mkdtempSync(join(tmpdir(), "pl-context-"));
writeFileSync(
	join(folder, "package.json"),
	JSON.stringify({ scripts: { test: "vitest" } }),
);
afterAll(() => rmSync(folder, { recursive: true, force: true }));

const run = (over: Record<string, unknown> = {}) => ({
	id: RUN,
	title: "Why is cart slow",
	status: "completed",
	kind: "chat",
	harness: "claude-code",
	model: "opus",
	effort: "high",
	report: null,
	agentPlan: JSON.stringify([{ content: "Read logs", status: "completed" }]),
	workspace: null,
	incidentId: null,
	scheduleId: null,
	repositoryId: null,
	serviceId: null,
	helperPlace: null,
	incident: null,
	repository: null,
	service: null,
	...over,
});

function service(row: ReturnType<typeof run>, opts: { schedule?: unknown } = {}) {
	const prisma = {
		investigation: {
			findUnique: vi.fn(async () => row),
			findMany: vi.fn(async () => [
				{
					id: RUN,
					kind: "chat",
					harness: "claude-code",
					model: "opus",
					status: "completed",
					lastTurnOutcome: "answered",
					endReason: null,
					createdAt: new Date("2026-11-06T00:00:00Z"),
				},
			]),
		},
		schedule: { findUnique: vi.fn(async () => opts.schedule ?? null) },
		investigationEvent: {
			findMany: vi.fn(async () => [
				{
					event: JSON.stringify({
						kind: "finding_recorded",
						runId: RUN,
						branchId: "root",
						path: [],
						seq: 3,
						label: null,
						ts: "2026-11-06T00:00:00.000Z",
						finding: {
							type: "hypothesis",
							id: "h1",
							statement: "The deploy dropped an index",
							status: "supported",
							evidenceIds: [],
							at: "2026-11-06T00:00:00.000Z",
						},
					}),
				},
				{ event: "{" },
			]),
		},
	};
	const prs = { stored: vi.fn(async () => []) };
	const workspaces = { listForRun: vi.fn(async () => [{ dir: "/w/kept" }]) };
	return {
		prisma,
		workspaces,
		svc: new ThreadContextService(prisma as never, prs as never, workspaces as never),
	};
}

const parse = (ctx: unknown) => ThreadContextSchema.parse(ctx);

describe("ThreadContextService (#1024 decision 1)", () => {
	it("serves a project thread: machine, agent, plan, lineage and its folder's scripts", async () => {
		const { svc } = service(
			run({
				repositoryId: "r1",
				repository: {
					id: "r1",
					sourceKind: "folder",
					url: folder,
					fullName: "cart",
				},
			}),
		);
		const ctx = parse(await svc.context(RUN, true));
		expect(ctx.kind).toBe("project");
		expect(ctx.machine).toMatchObject({ isHost: true, os: osName() });
		expect(ctx.agent).toEqual({ harness: "claude-code", model: "opus", effort: "high" });
		expect(ctx.plan).toEqual([{ content: "Read logs", status: "completed" }]);
		expect(ctx.lineage[0]).toMatchObject({ outcome: "answered" });
		if (ctx.kind !== "project") throw new Error("kind");
		expect(ctx.project.id).toBe("r1");
		expect(ctx.scripts).toEqual([{ runner: "npm", name: "test", command: "npm run test" }]);
	});

	it("serves an incident thread with its suspects and report state", async () => {
		const { svc } = service(
			run({
				status: "running",
				incidentId: "i1",
				incident: {
					id: "i1",
					number: 4,
					title: "500s",
					severity: "odd",
					status: "investigating",
					alertCount: 3,
					customerImpact: "Checkout fails",
				},
			}),
		);
		const ctx = parse(await svc.context(RUN, false));
		if (ctx.kind !== "incident") throw new Error("kind");
		expect(ctx.incident).toMatchObject({ number: 4, severity: "medium", alertCount: 3 });
		expect(ctx.suspects).toEqual([
			{ id: "h1", statement: "The deploy dropped an index", status: "supported" },
		]);
		expect(ctx.report).toBe("running");
		expect(ctx.machine.isHost).toBe(false);
	});

	it.each([
		[{ status: "completed", report: "{}" }, "ready"],
		[{ status: "failed" }, "failed"],
		[{ status: "completed" }, "none"],
	])("reads the report state of %j as %s", async (over, want) => {
		const { svc } = service(
			run({
				...over,
				incidentId: "i1",
				incident: {
					id: "i1",
					number: 4,
					title: "x",
					severity: "high",
					status: "x",
					alertCount: 0,
					customerImpact: null,
				},
			}),
		);
		const ctx = await svc.context(RUN, false);
		expect(ctx.kind === "incident" && ctx.report).toBe(want);
	});

	it("serves a service thread with tier, owner and dependencies", async () => {
		const { svc } = service(
			run({
				serviceId: "s1",
				service: {
					id: "s1",
					name: "cart",
					displayName: "Cart",
					tier: "tier_1",
					team: "payments",
					dependencies: [
						{ dependency: { id: "s2", name: "db", displayName: null } },
					],
				},
			}),
		);
		const ctx = parse(await svc.context(RUN, false));
		if (ctx.kind !== "service") throw new Error("kind");
		expect(ctx.service).toEqual({
			id: "s1",
			name: "Cart",
			tier: "tier_1",
			owner: "payments",
			dependencies: [{ id: "s2", name: "db" }],
		});
	});

	it("serves a schedule thread with its recurrence, next run and last runs", async () => {
		const { svc } = service(run({ scheduleId: "c1" }), {
			schedule: {
				name: "Daily",
				enabled: true,
				nextRunAt: new Date("2026-11-07T09:00:00Z"),
				recurrence: JSON.stringify({
					type: "cron",
					expr: "0 9 * * *",
					timezone: "UTC",
				}),
			},
		});
		const ctx = parse(await svc.context(RUN, false));
		if (ctx.kind !== "schedule") throw new Error("kind");
		expect(ctx.schedule).toMatchObject({
			name: "Daily",
			nextRunAt: "2026-11-07T09:00:00.000Z",
			recurrence: { type: "cron" },
		});
		expect(ctx.schedule.lastRuns).toHaveLength(1);
	});

	it("serves a schedule whose row is gone", async () => {
		const { svc } = service(run({ scheduleId: "c1" }));
		const ctx = parse(await svc.context(RUN, false));
		expect(ctx.kind === "schedule" && ctx.schedule.name).toBe("Deleted schedule");
	});

	it("serves a no-subject thread with its helper place, and a bad plan as none", async () => {
		const { svc } = service(run({ helperPlace: "alerts", agentPlan: "{" }));
		const ctx = parse(await svc.context(RUN, false));
		expect(ctx).toMatchObject({ kind: "none", helperPlace: "alerts", plan: null });
	});

	it("offers Undo only for the thread's own worktree, never a folder run's", async () => {
		const repo = (dir: string) => ({
			name: "repo",
			dir,
			sourceKind: "url",
			url: "https://github.com/a/b.git",
			subPath: null,
			connectionId: null,
			head: "abc",
			branch: "fix",
			services: [],
		});
		const own = service(
			run({ workspace: JSON.stringify({ layout: "single", cwd: "/w/r", repos: [repo("/w/r")] }) }),
		);
		const ctx = parse(await own.svc.context(RUN, true));
		expect(ctx.workspace).toMatchObject({
			layout: "single",
			kept: [{ dir: "/w/kept" }],
			repos: [{ branch: "fix", head: "abc", additions: null }],
		});
		const inFolder = service(
			run({ workspace: JSON.stringify({ layout: "folder", cwd: folder, repos: [] }) }),
		);
		const f = parse(await inFolder.svc.context(RUN, true));
		expect(f.workspace?.kept).toEqual([]);
		expect(inFolder.workspaces.listForRun).not.toHaveBeenCalled();
	});

	it("404s a thread that does not exist", async () => {
		const { svc, prisma } = service(run());
		prisma.investigation.findUnique.mockResolvedValueOnce(null as never);
		await expect(svc.context(RUN, false)).rejects.toThrow(/Thread not found/);
	});

	it("names each OS", () => {
		expect(osName("win32")).toBe("windows");
		expect(osName("darwin")).toBe("macos");
		expect(osName("linux")).toBe("linux");
		expect(osName("aix")).toBe("other");
	});
});
