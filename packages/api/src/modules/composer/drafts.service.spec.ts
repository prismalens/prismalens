// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ComposerDoc,
	DRAFT_FILE_ORPHAN_AFTER_MS,
	legacyDoc,
	type PutDraftInput,
} from "@prismalens/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftsService } from "./drafts.service.js";

type Row = { scope: string; rev: number; generation: number; body: string; updatedAt: Date };
type FakeAttachment = {
	id: string;
	draftKey: string | null;
	investigationId: string | null;
	incidentId?: string | null;
	createdAt?: Date;
};

/** composerDraft over a Map, with the conditional update the service relies on. */
function fakePrisma(now = () => new Date("2026-11-07T10:00:00Z")) {
	const rows = new Map<string, Row>();
	let createFails: Error | null = null;
	const attachments: FakeAttachment[] = [];
	const composerDraft = {
		// Yields first, so two saves can both read "no row" as they do on SQLite.
		findUnique: async ({ where }: { where: { scope: string } }) => {
			await new Promise((r) => setTimeout(r, 0));
			const row = rows.get(where.scope);
			return row ? { ...row } : null;
		},
		findMany: async (args?: { where?: { updatedAt?: { lt: Date }; scope?: { in: string[] } } }) => {
			const where = args?.where;
			return [...rows.values()].filter(
				(r) =>
					(!where?.updatedAt || r.updatedAt < where.updatedAt.lt) &&
					(!where?.scope || where.scope.in.includes(r.scope)),
			);
		},
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
			findMany: async ({
				where,
			}: {
				where: {
					id?: { in: string[] };
					draftKey?: string | { in: string[] } | { not: null };
					investigationId?: string | null;
					incidentId?: string | null;
					createdAt?: { lt: Date };
				};
			}) =>
				attachments.filter((a) => {
					if (where.draftKey !== undefined) {
						if (typeof where.draftKey === "string" && a.draftKey !== where.draftKey) return false;
						if (where.draftKey && typeof where.draftKey === "object") {
							if ("in" in where.draftKey && (!a.draftKey || !where.draftKey.in.includes(a.draftKey))) return false;
							if ("not" in where.draftKey && where.draftKey.not === null && a.draftKey === null) return false;
						}
					}
					if (where.id?.in && !where.id.in.includes(a.id)) return false;
					if (where.investigationId !== undefined && a.investigationId !== where.investigationId) return false;
					if (where.incidentId !== undefined && (a.incidentId ?? null) !== where.incidentId) return false;
					if (where.createdAt?.lt && (!a.createdAt || !(a.createdAt < where.createdAt.lt))) return false;
					return true;
				}),
			deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
				let count = 0;
				for (const id of where.id.in) {
					const i = attachments.findIndex((a) => a.id === id);
					if (i >= 0) {
						attachments.splice(i, 1);
						count++;
					}
				}
				return { count };
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
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pl-drafts-service-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", dir);
		mkdirSync(join(dir, "attachments"), { recursive: true });
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(dir, { recursive: true, force: true });
	});

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

	it("two first saves racing: the loser hits P2002 and gets 409 carrying the winner's draft (#1024)", async () => {
		const { prisma } = fakePrisma();
		// A barrier: neither save gets past its first read until both have read "no row".
		const read = prisma.composerDraft.findUnique;
		let waiting = 0;
		let release!: () => void;
		const both = new Promise<void>((r) => {
			release = r;
		});
		prisma.composerDraft.findUnique = async (args) => {
			const row = await read(args);
			if (waiting < 2) {
				waiting++;
				if (waiting === 2) release();
				await both;
			}
			return row;
		};
		const create = prisma.composerDraft.create;
		const creates: string[] = [];
		prisma.composerDraft.create = async (args) => {
			try {
				const row = await create(args);
				creates.push("ok");
				return row;
			} catch (e) {
				creates.push((e as { code?: string }).code ?? "error");
				throw e;
			}
		};
		const drafts = new DraftsService(prisma as never);
		const [first, second] = await Promise.allSettled([
			drafts.put(put({ text: "phone" })),
			drafts.put(put({ text: "laptop" })),
		]);
		expect(creates).toEqual(["ok", "P2002"]);
		expect(first).toMatchObject({ status: "fulfilled", value: { text: "phone", rev: 1 } });
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

	it("a stored legacy body (no doc) reads back with version: 2 and the converted doc", async () => {
		const { prisma, rows } = fakePrisma();
		const drafts = new DraftsService(prisma as never);
		const legacyQuotes = [
			{ source: { threadId: KEY, kind: "report" as const }, text: "q1" },
		];
		const legacyRefs = [{ kind: "issue" as const, id: "1", label: "1" }];
		rows.set(SCOPE, {
			scope: SCOPE,
			rev: 1,
			generation: 0,
			body: JSON.stringify({
				text: "legacy text",
				quotes: legacyQuotes,
				references: legacyRefs,
				draftKey: null,
				attachments: [],
				choice: {},
			}),
			updatedAt: new Date("2026-11-07T10:00:00Z"),
		});

		const loaded = await drafts.get(SCOPE);
		expect(loaded?.version).toBe(2);
		expect(loaded?.text).toBe("legacy text");
		expect(loaded?.doc).toEqual(
			legacyDoc({
				text: "legacy text",
				quotes: legacyQuotes,
				references: legacyRefs,
			}),
		);
	});

	it("a v2 put stores text, quotes, references derived from its doc", async () => {
		const { prisma, rows } = fakePrisma();
		const drafts = new DraftsService(prisma as never);
		const v2Doc: ComposerDoc = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "chip",
							attrs: {
								chip: "command",
								name: "ask",
								source: "app",
								group: "General",
							},
						},
						{ type: "text", text: " hello " },
						{
							type: "chip",
							attrs: {
								chip: "ref",
								ref: { kind: "issue", id: "55", label: "55" },
							},
						},
						{ type: "text", text: " " },
						{
							type: "chip",
							attrs: {
								chip: "quote",
								quote: {
									source: { threadId: KEY, kind: "transcript" },
									text: "a quote",
								},
								cut: false,
							},
						},
					],
				},
			],
		};

		const saved = await drafts.put(
			put({
				version: 2,
				doc: v2Doc,
				text: "stale text",
				quotes: [],
				references: [],
			}),
		);

		const expectedQuotes = [
			{ source: { threadId: KEY, kind: "transcript" }, text: "a quote" },
		];
		const expectedRefs = [{ kind: "issue", id: "55", label: "55" }];
		const expectedText = "/ask hello #55 > a quote";

		expect(saved.version).toBe(2);
		expect(saved.text).toBe(expectedText);
		expect(saved.quotes).toEqual(expectedQuotes);
		expect(saved.references).toEqual(expectedRefs);

		const storedRow = rows.get(SCOPE);
		const parsedBody = JSON.parse(storedRow?.body ?? "{}");
		expect(parsedBody.version).toBe(2);
		expect(parsedBody.text).toBe(expectedText);
		expect(parsedBody.quotes).toEqual(expectedQuotes);
		expect(parsedBody.references).toEqual(expectedRefs);
	});

	it("withDrafts counts a doc holding only a chip as a draft and an empty doc as none", async () => {
		const { prisma } = fakePrisma();
		const drafts = new DraftsService(prisma as never);
		const chipScope = "thread:11111111-1111-4111-8111-111111111111";
		const emptyScope = "thread:22222222-2222-4222-8222-222222222222";

		await drafts.put(
			put({
				scope: chipScope,
				version: 2,
				doc: {
					type: "doc",
					content: [
						{
							type: "paragraph",
							content: [
								{
									type: "chip",
									attrs: {
										chip: "ref",
										ref: { kind: "file", id: "f1", label: "f.ts" },
									},
								},
							],
						},
					],
				},
				text: "",
				attachments: [],
			}),
		);

		await drafts.put(
			put({
				scope: emptyScope,
				version: 2,
				doc: {
					type: "doc",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "   " }],
						},
					],
				},
				text: "",
				attachments: [],
			}),
		);

		const result = await drafts.withDrafts([chipScope, emptyScope]);
		expect(result).toEqual(new Set([chipScope]));
	});

	it("delete(scope) also deletes the draft's unclaimed files (rows with its draftKey, investigationId null, incidentId null) and their bytes on disk", async () => {
		const { prisma, attachments } = fakePrisma();
		const drafts = new DraftsService(prisma as never);
		await drafts.put(put({ scope: SCOPE, draftKey: KEY }));

		const unclaimedId = "11111111-1111-4111-8111-000000000001";
		const claimedId = "11111111-1111-4111-8111-000000000002";
		attachments.push(
			{ id: unclaimedId, draftKey: KEY, investigationId: null, incidentId: null },
			{ id: claimedId, draftKey: KEY, investigationId: "inv-42", incidentId: null },
		);

		const unclaimedFile = join(dir, "attachments", unclaimedId);
		const claimedFile = join(dir, "attachments", claimedId);
		writeFileSync(unclaimedFile, Buffer.from("unclaimed bytes"));
		writeFileSync(claimedFile, Buffer.from("claimed bytes"));
		expect(existsSync(unclaimedFile)).toBe(true);
		expect(existsSync(claimedFile)).toBe(true);

		const result = await drafts.delete(SCOPE);
		expect(result).toEqual({ deleted: true });
		expect(await drafts.get(SCOPE)).toBeNull();
		expect(attachments.map((a) => a.id)).toEqual([claimedId]);
		expect(existsSync(unclaimedFile)).toBe(false);
		expect(existsSync(claimedFile)).toBe(true);
	});

	it("consume(scope, rev) returning \"sent\" deletes the same files; \"kept\" deletes none", async () => {
		const { prisma, attachments } = fakePrisma();
		const drafts = new DraftsService(prisma as never);
		await drafts.put(put({ scope: SCOPE, draftKey: KEY }));

		const unclaimedId = "22222222-2222-4222-8222-000000000001";
		const claimedId = "22222222-2222-4222-8222-000000000002";
		attachments.push(
			{ id: unclaimedId, draftKey: KEY, investigationId: null, incidentId: null },
			{ id: claimedId, draftKey: KEY, investigationId: "inv-99", incidentId: null },
		);

		const unclaimedFile = join(dir, "attachments", unclaimedId);
		const claimedFile = join(dir, "attachments", claimedId);
		writeFileSync(unclaimedFile, Buffer.from("unclaimed bytes"));
		writeFileSync(claimedFile, Buffer.from("claimed bytes"));
		expect(existsSync(unclaimedFile)).toBe(true);
		expect(existsSync(claimedFile)).toBe(true);

		const kept = await drafts.consume(SCOPE, 2);
		expect(kept).toBe("kept");
		expect(attachments.map((a) => a.id)).toEqual([unclaimedId, claimedId]);
		expect(existsSync(unclaimedFile)).toBe(true);
		expect(existsSync(claimedFile)).toBe(true);

		const sent = await drafts.consume(SCOPE, 1);
		expect(sent).toBe("sent");
		expect(attachments.map((a) => a.id)).toEqual([claimedId]);
		expect(existsSync(unclaimedFile)).toBe(false);
		expect(existsSync(claimedFile)).toBe(true);
	});

	it("sweepOrphanFiles(now) deletes draft files older than DRAFT_FILE_ORPHAN_AFTER_MS (7 days) that no draft's attachments lists and no run claimed; newer ones, listed ones and claimed ones stay", async () => {
		const now = new Date("2026-11-15T12:00:00Z");
		const oldDate = new Date(now.getTime() - DRAFT_FILE_ORPHAN_AFTER_MS - 1000);
		const newDate = new Date(now.getTime() - 1000);

		const { prisma, attachments } = fakePrisma(() => now);
		const drafts = new DraftsService(prisma as never);

		const listedScope = "thread:listed-scope";
		const listedKey = "33333333-3333-4333-8333-555555555555";
		const oldListedId = "33333333-3333-4333-8333-000000000003";
		await drafts.put(
			put({
				scope: listedScope,
				draftKey: listedKey,
				attachments: [oldListedId],
			}),
		);

		const oldUnlistedId = "33333333-3333-4333-8333-000000000001";
		const newUnlistedId = "33333333-3333-4333-8333-000000000002";
		const oldClaimedId = "33333333-3333-4333-8333-000000000004";

		attachments.push(
			{ id: oldUnlistedId, draftKey: "key-orphan", investigationId: null, incidentId: null, createdAt: oldDate },
			{ id: newUnlistedId, draftKey: "key-orphan", investigationId: null, incidentId: null, createdAt: newDate },
			{ id: oldListedId, draftKey: listedKey, investigationId: null, incidentId: null, createdAt: oldDate },
			{ id: oldClaimedId, draftKey: "key-orphan", investigationId: "inv-1", incidentId: null, createdAt: oldDate },
		);

		const oldUnlistedFile = join(dir, "attachments", oldUnlistedId);
		const newUnlistedFile = join(dir, "attachments", newUnlistedId);
		const oldListedFile = join(dir, "attachments", oldListedId);
		const oldClaimedFile = join(dir, "attachments", oldClaimedId);

		writeFileSync(oldUnlistedFile, Buffer.from("old unlisted"));
		writeFileSync(newUnlistedFile, Buffer.from("new unlisted"));
		writeFileSync(oldListedFile, Buffer.from("old listed"));
		writeFileSync(oldClaimedFile, Buffer.from("old claimed"));

		expect(existsSync(oldUnlistedFile)).toBe(true);
		expect(existsSync(newUnlistedFile)).toBe(true);
		expect(existsSync(oldListedFile)).toBe(true);
		expect(existsSync(oldClaimedFile)).toBe(true);

		const swept = await drafts.sweepOrphanFiles(now);
		expect(swept).toBe(1);

		expect(attachments.map((a) => a.id)).toEqual([newUnlistedId, oldListedId, oldClaimedId]);
		expect(existsSync(oldUnlistedFile)).toBe(false);
		expect(existsSync(newUnlistedFile)).toBe(true);
		expect(existsSync(oldListedFile)).toBe(true);
		expect(existsSync(oldClaimedFile)).toBe(true);
	});
});
