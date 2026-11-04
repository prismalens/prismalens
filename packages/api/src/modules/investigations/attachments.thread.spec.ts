// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentsService } from "./attachments.service.js";

const DRAFT = "d1111111-1111-4111-8111-111111111111";
const OTHER_DRAFT = "d2222222-2222-4222-8222-222222222222";
const RUN = "r1111111-1111-4111-8111-111111111111";
const OTHER_RUN = "r2222222-2222-4222-8222-222222222222";
const INCIDENT_RUN = "r3333333-3333-4333-8333-333333333333";
const SCHEDULED_RUN = "r4444444-4444-4444-8444-444444444444";

type Row = Record<string, unknown>;

/** A where clause as the service writes it: plain values, null, and `{ in: [...] }`. */
function matches(row: Row, where: Record<string, unknown>): boolean {
	return Object.entries(where).every(([k, v]) => {
		if (v && typeof v === "object" && "in" in v)
			return (v as { in: unknown[] }).in.includes(row[k]);
		return (row[k] ?? null) === v;
	});
}

describe("AttachmentsService: a thread's files are its run's (#1020)", () => {
	let dir: string;
	let rows: Row[];
	const prisma = {
		investigation: {
			findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
				where.id === RUN || where.id === OTHER_RUN
					? { incidentId: null }
					: where.id === INCIDENT_RUN
						? { incidentId: "i1" }
						: where.id === SCHEDULED_RUN
							? { incidentId: null, scheduleId: "s1" }
							: null,
			),
		},
		attachment: {
			findFirst: vi.fn(
				async ({ where }: { where: Record<string, unknown> }) =>
					rows.find((r) => matches(r, where)) ?? null,
			),
			findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
				rows.filter((r) => matches(r, where)),
			),
			updateMany: vi.fn(
				async ({
					where,
					data,
				}: {
					where: Record<string, unknown>;
					data: Row;
				}) => {
					const hit = rows.filter((r) => matches(r, where));
					for (const r of hit) Object.assign(r, data);
					return { count: hit.length };
				},
			),
			create: vi.fn(async ({ data }: { data: Row }) => {
				const row = {
					id: `a000000${rows.length}-0000-4000-8000-000000000000`,
					createdAt: new Date(),
					incidentId: null,
					investigationId: null,
					draftKey: null,
					...data,
				};
				rows.push(row);
				return row;
			}),
			delete: vi.fn(),
		},
	};
	const service = () =>
		new AttachmentsService(prisma as never, { create: vi.fn() } as never);
	const text = (body: string, name = "notes.txt") =>
		new File([body], name, { type: "text/plain" });

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pl-attach-thread-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", dir);
		rows = [];
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(dir, { recursive: true, force: true });
	});

	it("keeps a draft's file under its key with no incident, then hands it to the run that starts with it", async () => {
		const made = await service().uploadDraft(DRAFT, text("todo"));
		expect(made.incidentId).toBeNull();
		expect(rows[0]).toMatchObject({ draftKey: DRAFT, incidentId: null });
		await service().checkDraft(DRAFT, [made.id]);
		const [job] = await service().claimDraft(DRAFT, [made.id], RUN);
		expect(readFileSync(job?.path ?? "", "utf8")).toBe("todo");
		expect(rows[0]).toMatchObject({ investigationId: RUN });
		// Claimed once: the same draft key no longer reaches it, the run does.
		await expect(service().checkDraft(DRAFT, [made.id])).rejects.toThrow(
			/not on this draft/,
		);
		await expect(service().forRun(RUN, [made.id])).resolves.toHaveLength(1);
	});

	it("never lets another draft or another run use a file it does not own", async () => {
		const mine = await service().uploadDraft(DRAFT, text("a"));
		await expect(service().checkDraft(OTHER_DRAFT, [mine.id])).rejects.toThrow(
			/not on this draft/,
		);
		await expect(
			service().claimDraft(OTHER_DRAFT, [mine.id], OTHER_RUN),
		).rejects.toThrow(/not on this thread/);
		const owned = await service().uploadForRun(RUN, text("b", "b.txt"));
		await expect(service().forRun(OTHER_RUN, [owned.id])).rejects.toThrow(
			/not on this thread/,
		);
		await expect(service().readForRun(OTHER_RUN, owned.id)).rejects.toThrow(
			/No such attachment/,
		);
		const file = await service().readForRun(RUN, owned.id);
		expect(await file.text()).toBe("b");
	});

	it("refuses a run that is gone, and points an incident's run at its incident", async () => {
		await expect(service().uploadForRun("nope", text("x"))).rejects.toThrow(
			/not found/,
		);
		await expect(
			service().uploadForRun(INCIDENT_RUN, text("x")),
		).rejects.toThrow(/on its incident/);
	});

	it("refuses a scheduled check with no incident yet, whose message route takes no files", async () => {
		await expect(
			service().uploadForRun(SCHEDULED_RUN, text("x")),
		).rejects.toThrow(/no incident yet/);
		expect(rows).toHaveLength(0);
	});

	it("keeps one row for the same bytes from one owner, and takes nothing for an empty list", async () => {
		const a = await service().uploadForRun(RUN, text("same"));
		const b = await service().uploadForRun(RUN, text("same", "again.txt"));
		expect(b.id).toBe(a.id);
		expect(rows).toHaveLength(1);
		await expect(service().forRun(RUN, [])).resolves.toEqual([]);
		await expect(service().claimDraft(DRAFT, [], RUN)).resolves.toEqual([]);
		await expect(service().checkDraft(DRAFT, [])).resolves.toBeUndefined();
	});
});
