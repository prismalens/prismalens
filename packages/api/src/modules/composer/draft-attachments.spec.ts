// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PutDraftInput, ServedAttachment } from "@prismalens/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	draftAttachmentRows,
	servedDraftAttachment,
} from "../investigations/attachments.service.js";
import { DraftsController } from "./composer.controller.js";
import { DraftsService } from "./drafts.service.js";

type Row = { scope: string; rev: number; generation: number; body: string; updatedAt: Date };
type StoredAttachment = {
	id: string;
	name: string;
	mimeType: string;
	size: number;
	sha256: string;
	createdAt: Date;
	draftKey: string | null;
	investigationId: string | null;
	incidentId: string | null;
};

const ATT_1 = "11111111-1111-4111-8111-111111111111";
const ATT_2 = "22222222-2222-4222-8222-222222222222";
const ATT_UNLISTED = "33333333-3333-4333-8333-333333333333";
const ATT_FOREIGN = "44444444-4444-4444-8444-444444444444";
const OTHER_KEY = "55555555-5555-4555-8555-555555555555";
const SCOPE = "new:home";
const KEY = "0b3c2f1e-1111-4222-8333-444455556666";

/** composerDraft over a Map, following drafts.service.spec.ts for the Prisma test setup. */
function fakePrisma(now = () => new Date("2026-11-07T10:00:00Z")) {
	const rows = new Map<string, Row>();
	const attachments: StoredAttachment[] = [];
	const investigations = new Map<string, { incidentId: string | null }>();

	const composerDraft = {
		findUnique: async ({ where }: { where: { scope: string } }) => {
			const row = rows.get(where.scope);
			return row ? { ...row } : null;
		},
		create: async ({ data }: { data: Omit<Row, "updatedAt"> }) => {
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

	const attachment = {
		findMany: async ({
			where,
		}: {
			where: {
				id?: { in: string[] };
				draftKey?: { in: string[] };
				OR?: Record<string, unknown>[];
			};
		}) => {
			if (where.draftKey?.in) {
				return attachments.filter(
					(a) => a.draftKey && where.draftKey?.in.includes(a.draftKey) && !a.investigationId,
				);
			}
			if (where.id?.in) {
				const ids = where.id.in;
				const orConditions = where.OR ?? [];
				return attachments.filter((a) => {
					if (!ids.includes(a.id)) return false;
					if (!orConditions.length) return true;
					return orConditions.some((cond) =>
						Object.entries(cond).every(([k, v]) => (a as Record<string, unknown>)[k] === v),
					);
				});
			}
			return [];
		},
	};

	const investigation = {
		findUnique: async ({ where }: { where: { id: string } }) => {
			const inv = investigations.get(where.id);
			return inv ? { incidentId: inv.incidentId } : null;
		},
	};

	const prisma = {
		composerDraft,
		attachment,
		investigation,
		$transaction: async (arg: unknown) =>
			typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[]),
	};

	return { prisma, rows, attachments, investigations };
}

function callProc<TInput, TOutput>(proc: unknown, input: TInput): Promise<TOutput> {
	const p = proc as {
		"~orpc"?: { handler: (args: { input: TInput }) => Promise<TOutput> };
	};
	if (typeof p === "function") return (p as (args: { input: TInput }) => Promise<TOutput>)({ input });
	if (p?.["~orpc"]?.handler) return p["~orpc"].handler({ input });
	throw new Error("No handler found on procedure");
}

const putDraft = (over: Partial<PutDraftInput> = {}): PutDraftInput => ({
	scope: SCOPE,
	baseRev: 0,
	generation: 0,
	text: "investigate pool latency",
	draftKey: KEY,
	attachments: [],
	quotes: [],
	references: [],
	choice: {},
	...over,
});

describe("composer draft attachments (#1024)", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pl-draft-attach-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", dir);
		mkdirSync(join(dir, "attachments"), { recursive: true });
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(dir, { recursive: true, force: true });
	});

	it("GET /drafts/{scope}/attachments returns exact {id, name, mimeType, size, foldedPaste} for a draft's files in the body's order", async () => {
		const { prisma, attachments } = fakePrisma();
		const drafts = new DraftsService(prisma as never);
		const controller = new DraftsController(drafts);
		const routes = controller.routes();

		attachments.push(
			{
				id: ATT_1,
				name: "query.log",
				mimeType: "text/plain",
				size: 2005,
				sha256: "sha-1",
				createdAt: new Date(),
				draftKey: KEY,
				investigationId: null,
				incidentId: null,
			},
			{
				id: ATT_2,
				name: "topology.png",
				mimeType: "image/png",
				size: 1024,
				sha256: "sha-2",
				createdAt: new Date(),
				draftKey: KEY,
				investigationId: null,
				incidentId: null,
			},
		);

		await drafts.put(
			putDraft({
				attachments: [ATT_2, ATT_1],
				foldedPastes: [ATT_1],
			}),
		);

		const result = await callProc<{ scope: string }, { attachments: unknown[] }>(
			routes.attachments,
			{ scope: SCOPE },
		);

		expect(result).toEqual({
			attachments: [
				{
					id: ATT_2,
					name: "topology.png",
					mimeType: "image/png",
					size: 1024,
					foldedPaste: false,
				},
				{
					id: ATT_1,
					name: "query.log",
					mimeType: "text/plain",
					size: 2005,
					foldedPaste: true,
				},
			],
		});

		const direct = await drafts.attachments(SCOPE);
		expect(direct).toEqual([
			{
				id: ATT_2,
				name: "topology.png",
				mimeType: "image/png",
				size: 1024,
				foldedPaste: false,
			},
			{
				id: ATT_1,
				name: "query.log",
				mimeType: "text/plain",
				size: 2005,
				foldedPaste: true,
			},
		]);
	});

	it("GET /drafts/{scope}/attachments/{id} refuses (NOT_FOUND, 'This draft holds no such file.') an id the draft does not list", async () => {
		const { prisma } = fakePrisma();
		const drafts = new DraftsService(prisma as never);
		const controller = new DraftsController(drafts);
		const routes = controller.routes();

		await drafts.put(
			putDraft({
				attachments: [ATT_1],
			}),
		);

		await expect(
			callProc(routes.attachment, { scope: SCOPE, id: ATT_UNLISTED }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "This draft holds no such file.",
		});

		await expect(drafts.attachment(SCOPE, ATT_UNLISTED)).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "This draft holds no such file.",
		});
	});

	it("GET /drafts/{scope}/attachments/{id} refuses (NOT_FOUND, 'This draft holds no such file.') an id the draft does not own", async () => {
		const { prisma, attachments } = fakePrisma();
		const drafts = new DraftsService(prisma as never);
		const controller = new DraftsController(drafts);
		const routes = controller.routes();

		attachments.push({
			id: ATT_FOREIGN,
			name: "secret.key",
			mimeType: "application/octet-stream",
			size: 256,
			sha256: "sha-foreign",
			createdAt: new Date(),
			draftKey: OTHER_KEY,
			investigationId: null,
			incidentId: null,
		});

		await drafts.put(
			putDraft({
				attachments: [ATT_FOREIGN],
			}),
		);

		await expect(
			callProc(routes.attachment, { scope: SCOPE, id: ATT_FOREIGN }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "This draft holds no such file.",
		});

		await expect(drafts.attachment(SCOPE, ATT_FOREIGN)).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "This draft holds no such file.",
		});
	});

	it("GET /drafts/{scope}/attachments/{id} serves the attachment when listed and owned", async () => {
		const { prisma, attachments } = fakePrisma();
		const drafts = new DraftsService(prisma as never);
		const controller = new DraftsController(drafts);
		const routes = controller.routes();

		attachments.push({
			id: ATT_2,
			name: "topology.png",
			mimeType: "image/png",
			size: 8,
			sha256: "sha-2",
			createdAt: new Date(),
			draftKey: KEY,
			investigationId: null,
			incidentId: null,
		});

		writeFileSync(join(dir, "attachments", ATT_2), Buffer.from("pngbytes"));

		await drafts.put(
			putDraft({
				attachments: [ATT_2],
			}),
		);

		const served = await callProc<{ scope: string; id: string }, ServedAttachment>(
			routes.attachment,
			{ scope: SCOPE, id: ATT_2 },
		);

		expect(served.headers).toEqual({
			"content-disposition": "inline; filename*=UTF-8''topology.png",
			"content-security-policy": "default-src 'none'; sandbox",
			"x-content-type-options": "nosniff",
		});
		expect(served.body.name).toBe("topology.png");
		expect(served.body.type).toBe("image/png");
		expect(served.body.size).toBe(8);

		const rows = await draftAttachmentRows(
			prisma as never,
			{ draftKey: KEY, investigationId: null, incidentId: null },
			[ATT_2],
		);
		expect(rows).toEqual([
			expect.objectContaining({
				id: ATT_2,
				name: "topology.png",
				mimeType: "image/png",
				size: 8,
			}),
		]);
		const directServed = servedDraftAttachment(rows[0] as never);
		expect(directServed.headers).toEqual(served.headers);
		expect(directServed.body.name).toBe("topology.png");
	});
});
