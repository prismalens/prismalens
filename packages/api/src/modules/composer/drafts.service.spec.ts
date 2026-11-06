// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PutDraftInput } from "@prismalens/contracts";
import { DraftsService } from "./drafts.service.js";

type Row = { scope: string; rev: number; generation: number; body: string; updatedAt: Date };

/** composerDraft over a Map, with the conditional update the service relies on. */
function fakePrisma(now = () => new Date("2026-11-07T10:00:00Z")) {
	const rows = new Map<string, Row>();
	let createFails: Error | null = null;
	const attachments: { id: string; draftKey: string | null; investigationId: string | null }[] = [];
	const composerDraft = {
		// Yields first, so two saves can both read "no row" as they do on SQLite.
		findUnique: async ({ where }: { where: { scope: string } }) => {
			await new Promise((r) => setTimeout(r, 0));
			const row = rows.get(where.scope);
			return row ? { ...row } : null;
		},
		findMany: async ({ where }: { where: { updatedAt?: { lt: Date }; scope?: { in: string[] } } }) =>
			[...rows.values()].filter(
				(r) =>
					(!where.updatedAt || r.updatedAt < where.updatedAt.lt) &&
					(!where.scope || where.scope.in.includes(r.scope)),
			),
		create: async ({ data }: { data: Omit<Row, "updatedAt"> }) => {
			if (createFails) throw createFails;
			if (rows.has(data.scope))
				throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
			const row = { ...data, updatedAt: now() };
			rows.set(data.scope, row);
			return row;
		},
		updateMany: async ({
			where,
			data,
		}: {
			where: { scope: string; rev: number; generation?: number };
			data: Partial<Row>;
		}) => {
			const r = rows.get(where.scope);
			if (!r || r.rev !== where.rev || (where.generation !== undefined && r.generation !== where.generation))
				return { count: 0 };
			Object.assign(r, data, { updatedAt: now() });
			return { count: 1 };
		},
		deleteMany: async ({ where }: { where: { scope: string | { in: string[] } } }) => {
			const scopes = typeof where.scope === "string" ? [where.scope] : where.scope.in;
			let count = 0;
			for (const s of scopes) if (rows.delete(s)) count++;
			return { count };
		},
	};
	const prisma = {
		composerDraft,
		attachment: {
			findMany: async ({ where }: { where: { draftKey: { in: string[] } } }) =>
				attachments.filter((a) => a.draftKey && where.draftKey.in.includes(a.draftKey) && !a.investigationId),
			deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
				for (const id of where.id.in) {
					const i = attachments.findIndex((a) => a.id === id);
					if (i >= 0) attachments.splice(i, 1);
				}
				return { count: where.id.in.length };
			},
		},
		$transaction: async (arg: unknown) =>
			typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[]),
	};
	return {
		prisma,
		rows,
		attachments,
		failCreate: (e: Error | null) => {
			createFails = e;
		},
	};
}

const SCOPE = "thread:6a3b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const KEY = "0b3c2f1e-1111-4222-8333-444455556666";
const put = (over: Partial<PutDraftInput> = {}): PutDraftInput => ({
	scope: SCOPE,
	baseRev: 0,
	generation: 0,
	text: "why is p99 up",
	draftKey: KEY,
	attachments: [],
	quotes: [],
	references: [],
	choice: { harness: "claude-code" },
	...over,
});

describe("DraftsService (#1024)", () => {
	it("saves and loads a draft; each save bumps rev", async () => {
		const { prisma } = fakePrisma();
		const drafts = new DraftsService(prisma as never);
		const first = await drafts.put(put());
		expect(first).toMatchObject({ rev: 1, generation: 0, text: "why is p99 up" });
		const second = await drafts.put(put({ baseRev: 1, text: "why is p99 up?" }));
		expect(second.rev).toBe(2);
		expect((await drafts.get(SCOPE))?.text).toBe("why is p99 up?");
	});

	it("a write from a stale rev gets 409 with the current draft", async () => {
		const { prisma } = fakePrisma();
		const drafts = new DraftsService(prisma as never);
		await drafts.put(put());
		await drafts.put(put({ baseRev: 1, text: "phone" }));
		await expect(drafts.put(put({ baseRev: 1, text: "desktop" }))).rejects.toMatchObject({
			code: "CONFLICT",
			data: { current: { text: "phone", rev: 2 } },
		});
	});

	it("sending compare-and-deletes: a tombstone keeps the choices, and a late autosave cannot resurrect the draft", async () => {
		const { prisma } = fakePrisma();
		const drafts = new DraftsService(prisma as never);
		await drafts.put(put());
		expect(await drafts.consume(SCOPE, 1)).toBe("sent");
		const tomb = await drafts.get(SCOPE);
		expect(tomb).toMatchObject({ text: "", generation: 1, choice: { harness: "claude-code" } });
		await expect(drafts.put(put({ baseRev: 1, text: "late" }))).rejects.toMatchObject({
			code: "CONFLICT",
		});
		const fresh = await drafts.put(put({ baseRev: tomb?.rev ?? 0, generation: 1, text: "next" }));
		expect(fresh.text).toBe("next");
	});

	it("a send that beats the first autosave still leaves a tombstone, so the late first save is refused (#1024)", async () => {
		const { prisma } = fakePrisma();
		const drafts = new DraftsService(prisma as never);
		expect(await drafts.consume(SCOPE, undefined)).toBe("sent");
		expect(await drafts.get(SCOPE)).toMatchObject({ text: "", generation: 1 });
		await expect(drafts.put(put({ baseRev: 0, generation: 0 }))).rejects.toMatchObject({
			code: "CONFLICT",
		});
	});

	it("two first saves racing: the loser gets 409 carrying the winner's draft (#1024)", async () => {
		const { prisma } = fakePrisma();
		const drafts = new DraftsService(prisma as never);
		const [first, second] = await Promise.allSettled([
			drafts.put(put({ text: "phone" })),
			drafts.put(put({ text: "laptop" })),
		]);
		expect(first).toMatchObject({ status: "fulfilled", value: { text: "phone" } });
		expect(second).toMatchObject({
			status: "rejected",
			reason: { code: "CONFLICT", data: { current: { text: "phone", rev: 1 } } },
		});
	});

	it("a create that fails for any other reason is not a 409 (#1024)", async () => {
		const { prisma, failCreate } = fakePrisma();
		const drafts = new DraftsService(prisma as never);
		failCreate(new Error("disk full"));
		await expect(drafts.put(put())).rejects.toThrow("disk full");
		await expect(drafts.consume(SCOPE, undefined)).rejects.toThrow("disk full");
	});

	it("a newer draft from another device survives the send", async () => {
		const { prisma } = fakePrisma();
		const drafts = new DraftsService(prisma as never);
		await drafts.put(put());
		await drafts.put(put({ baseRev: 1, text: "typed on the phone" }));
		expect(await drafts.consume(SCOPE, 1)).toBe("kept");
		expect((await drafts.get(SCOPE))?.text).toBe("typed on the phone");
		expect(await drafts.consume(undefined, undefined)).toBe("none");
	});

	it("sweeps drafts untouched for 30 days, with the files uploaded to them", async () => {
		let at = new Date("2026-10-01T00:00:00Z");
		const { prisma, attachments } = fakePrisma(() => at);
		const drafts = new DraftsService(prisma as never);
		await drafts.put(put());
		attachments.push({ id: "a1", draftKey: KEY, investigationId: null });
		at = new Date("2026-11-07T00:00:00Z");
		await drafts.put(put({ scope: "new:home", draftKey: null }));
		expect(await drafts.sweep(at)).toBe(1);
		expect(await drafts.get(SCOPE)).toBeNull();
		expect(await drafts.get("new:home")).not.toBeNull();
		expect(attachments).toEqual([]);
	});

	it("names the scopes that keep words or files, for the thread list's Draft mark", async () => {
		const { prisma } = fakePrisma();
		const drafts = new DraftsService(prisma as never);
		await drafts.put(put());
		await drafts.put(put({ scope: "new:home", text: "" }));
		expect(await drafts.withDrafts([SCOPE, "new:home", "thread:none"])).toEqual(
			new Set([SCOPE]),
		);
	});
});
