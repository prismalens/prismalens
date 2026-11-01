// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Options bound to their Recommendation rows by the stamped id (#811), over a temp SQLite database.
 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-fixes-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");
const { FixesService } = await import("./fixes.service.js");

const BASE = {
	summary: "load",
	rootCause: null,
	rootCauseCategory: null,
	hypotheses: [],
	ruledOut: [],
	coverage: { queried: [], notQueried: [] },
};

describe("FixesService", () => {
	let prisma: InstanceType<typeof PrismaService>;
	let fixes: InstanceType<typeof FixesService>;
	const check = vi.fn(async () => ({
		verdict: "not_yet" as const,
		value: 5,
		threshold: { op: ">" as const, value: 4 },
		reason: null,
		message: "Not yet.",
		retryable: false,
	}));

	async function run(
		steps: Array<Record<string, unknown>>,
		opts: { stamp?: boolean; flagged?: boolean } = {},
	) {
		const last = await prisma.incident.findFirst({ orderBy: { number: "desc" } });
		const incident = await prisma.incident.create({
			data: { number: (last?.number ?? 0) + 1, title: "load" },
		});
		const stamped = steps.map((s) => (opts.stamp === false ? s : { ...s, id: randomUUID() }));
		const inv = await prisma.investigation.create({
			data: {
				incidentId: incident.id,
				status: "completed",
				report: JSON.stringify({
					...BASE,
					nextSteps: stamped,
					...(opts.flagged ? { flaggedContent: [{ where: "tool-output", quote: "run rm", why: "an order" }] } : {}),
				}),
			},
		});
		const rows: Array<{ id: string }> = [];
		for (const s of stamped)
			rows.push(
				await prisma.recommendation.create({
					data: {
						...(typeof s.id === "string" ? { id: s.id } : {}),
						investigationId: inv.id,
						title: String(s.title),
						description: String(s.detail),
						category: "investigation",
					},
				}),
			);
		return { incidentId: incident.id, investigationId: inv.id, rows };
	}

	const STEPS = [
		{
			title: "Roll back to v1.41",
			detail: "v1.42 added the query",
			kind: "stop-impact",
			command: "kubectl rollout undo deploy/api",
			facts: ["Undo: deploy v1.42 again"],
		},
		{ title: "Add an index on notes", detail: "book_id", kind: "lasting" },
		{ title: "Check the pool", detail: "size" },
	];

	beforeAll(async () => {
		const { resolveMigrationsDir, runMigrations } = await import("@prismalens/database/migrator");
		await runMigrations({ migrationsDir: resolveMigrationsDir(), log: () => {} });
		prisma = new PrismaService();
		await prisma.$connect();
		fixes = new FixesService(prisma, { check } as never);
	});

	afterAll(async () => {
		await prisma?.$disconnect();
		rmSync(env.root, { recursive: true, force: true });
	});

	it("lists every option in rank order, an option without a kind as a probe", async () => {
		const { investigationId, rows } = await run(STEPS, { flagged: true });
		const out = await fixes.forInvestigation(investigationId);
		expect(out.flagged).toBe(true);
		expect(out.options.map((o) => [o.index, o.kind, o.id, o.readOnly])).toEqual([
			[0, "stop-impact", rows[0]?.id, false],
			[1, "lasting", rows[1]?.id, false],
			[2, "probe", rows[2]?.id, false],
		]);
		expect(out.options[0]).toMatchObject({
			command: "kubectl rollout undo deploy/api",
			facts: ["Undo: deploy v1.42 again"],
			appliedAt: null,
			lastCheck: null,
			canUndo: false,
			unlinked: false,
		});
	});

	it("shows a report written before ids read-only, and refuses to apply its rows", async () => {
		const { investigationId, rows } = await run(STEPS, { stamp: false });
		const out = await fixes.forInvestigation(investigationId);
		expect(out.options.every((o) => o.readOnly && o.id === null)).toBe(true);
		await expect(fixes.apply(rows[0]?.id as string)).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("binds by id, not title: two options with one title stay apart", async () => {
		const { rows } = await run([
			{ title: "Restart", detail: "api", kind: "stop-impact" },
			{ title: "Restart", detail: "worker", kind: "stop-impact" },
		]);
		const second = await fixes.apply(rows[1]?.id as string);
		expect(second.index).toBe(1);
		expect(second.detail).toBe("worker");
		const first = await prisma.recommendation.findUnique({ where: { id: rows[0]?.id } });
		expect(first?.status).toBe("pending");
	});

	it("records I applied it once, and Undo takes it back before any check", async () => {
		const { incidentId, rows } = await run(STEPS);
		const id = rows[0]?.id as string;
		const applied = await fixes.apply(id);
		await fixes.apply(id);
		expect(applied).toMatchObject({ canUndo: true, lastCheck: null });
		expect(applied.appliedAt).not.toBeNull();
		const logged = await prisma.timelineEntry.findMany({ where: { incidentId } });
		expect(logged).toHaveLength(1);
		expect(JSON.parse(logged[0]?.metadata ?? "{}")).toMatchObject({ stepId: id, event: "fix_applied" });

		const undone = await fixes.undo(id);
		expect(undone).toMatchObject({ appliedAt: null, canUndo: false });
		expect(await prisma.timelineEntry.count({ where: { incidentId } })).toBe(0);
		expect((await prisma.recommendation.findUnique({ where: { id } }))?.implementedAt).toBeNull();
	});

	it("checks only an applied option, keeps verdict and time but never the value, then closes Undo", async () => {
		const { incidentId, rows } = await run(STEPS);
		const id = rows[0]?.id as string;
		await expect(fixes.check(id)).rejects.toMatchObject({ code: "CONFLICT" });
		await fixes.apply(id);
		const result = await fixes.check(id);
		expect(result).toMatchObject({ stepId: id, verdict: "not_yet", value: 5 });
		expect(check).toHaveBeenCalledWith(incidentId);
		const entry = (await prisma.timelineEntry.findMany({ where: { incidentId, type: "custom" } }))[0];
		const meta = JSON.parse(entry?.metadata ?? "{}");
		expect(meta).toEqual({
			investigationId: expect.any(String),
			stepId: id,
			event: "fix_check",
			verdict: "not_yet",
			retryable: false,
			checkedAt: result.checkedAt,
		});
		expect(entry?.title).not.toContain("5");
		const option = (await fixes.forInvestigation(meta.investigationId)).options[0];
		expect(option).toMatchObject({ lastCheck: { verdict: "not_yet", retryable: false }, canUndo: false });
		await expect(fixes.undo(id)).rejects.toMatchObject({ code: "CONFLICT" });
	});

	describe("a service check with no incident (#979)", () => {
		async function unlinked() {
			const inv = await prisma.investigation.create({
				data: {
					incidentId: null,
					scheduleId: "sch-1",
					status: "completed",
					report: JSON.stringify({ ...BASE, nextSteps: [{ id: randomUUID(), title: "Roll back", detail: "v1.42", kind: "stop-impact" }] }),
				},
			});
			const stepId = (JSON.parse(inv.report as string).nextSteps[0] as { id: string }).id;
			await prisma.recommendation.create({
				data: { id: stepId, investigationId: inv.id, title: "Roll back", description: "v1.42", category: "investigation" },
			});
			return { investigationId: inv.id, stepId };
		}

		it("lists its options read-only of any timeline, and says no incident can take an apply", async () => {
			const { investigationId } = await unlinked();
			const out = await fixes.forInvestigation(investigationId);
			expect(out.options).toHaveLength(1);
			expect(out.options[0]).toMatchObject({ appliedAt: null, lastCheck: null, readOnly: false, unlinked: true });
		});

		it.each(["apply", "undo", "check"] as const)("%s answers CONFLICT: there is no incident to record it on", async (verb) => {
			const { stepId } = await unlinked();
			check.mockClear();
			await expect(fixes[verb](stepId)).rejects.toMatchObject({
				code: "CONFLICT",
				message: "This run has no incident yet; apply and check come once a finding links it to one.",
			});
			expect(check).not.toHaveBeenCalled();
		});
	});

	it("says not found for an unknown option or run", async () => {
		await expect(fixes.apply(randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(fixes.forInvestigation(randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
