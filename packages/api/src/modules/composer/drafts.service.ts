// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { rmSync } from "node:fs";
import { join } from "node:path";
import {
	Injectable,
	Logger,
	type OnApplicationBootstrap,
} from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import {
	type ComposerDraft,
	DRAFT_SWEEP_AFTER_MS,
	type DraftBody,
	DraftBodySchema,
	type PutDraftInput,
} from "@prismalens/contracts";
import type { Prisma } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { attachmentsDir } from "../investigations/attachments.service.js";

type Tx = Prisma.TransactionClient;
type Row = {
	scope: string;
	rev: number;
	generation: number;
	body: string;
	updatedAt: Date;
};

const EMPTY: DraftBody = {
	text: "",
	draftKey: null,
	attachments: [],
	quotes: [],
	references: [],
	choice: {},
};

/** A create another writer beat to the scope (P2002) is a lost race: null. Anything else is thrown. */
function lostRace(e: unknown): null {
	if ((e as { code?: string })?.code === "P2002") return null;
	throw e;
}

function toDraft(row: Row): ComposerDraft {
	const parsed = DraftBodySchema.safeParse(JSON.parse(row.body));
	return {
		...(parsed.success ? parsed.data : EMPTY),
		scope: row.scope,
		rev: row.rev,
		generation: row.generation,
		updatedAt: row.updatedAt.toISOString(),
	};
}

/**
 * One composer draft per scope (#1024). A save names the rev it was edited from and
 * the generation it belongs to: a stale rev, or a generation a send has ended, gets
 * 409 with the current draft. A send leaves a tombstone (generation bumped, body
 * cleared but its run choices), so a late autosave cannot resurrect what was sent.
 */
@Injectable()
export class DraftsService implements OnApplicationBootstrap {
	private readonly logger = new Logger(DraftsService.name);

	constructor(private readonly prisma: PrismaService) {}

	async onApplicationBootstrap(): Promise<void> {
		await this.sweep().catch((e) =>
			this.logger.warn(`Could not sweep old drafts: ${String(e)}`),
		);
	}

	async get(scope: string): Promise<ComposerDraft | null> {
		const row = await this.prisma.composerDraft.findUnique({
			where: { scope },
		});
		return row ? toDraft(row) : null;
	}

	async put(input: PutDraftInput): Promise<ComposerDraft> {
		const { scope, baseRev, generation, ...rest } = input;
		const body = JSON.stringify(DraftBodySchema.parse(rest));
		const saved = await this.prisma.$transaction(async (tx) => {
			const row = await tx.composerDraft.findUnique({ where: { scope } });
			if (!row) {
				// The first save, or one after a delete or a sweep; a racing first save loses with 409.
				return tx.composerDraft
					.create({ data: { scope, rev: 1, generation, body } })
					.catch(lostRace);
			}
			const updated = await tx.composerDraft.updateMany({
				where: { scope, rev: baseRev, generation },
				data: { rev: baseRev + 1, body },
			});
			return updated.count === 1
				? tx.composerDraft.findUnique({ where: { scope } })
				: null;
		});
		if (!saved) {
			const current = await this.get(scope);
			throw new ORPCError("CONFLICT", {
				message: "A newer draft was saved, or this draft was sent.",
				data: { current },
			});
		}
		return toDraft(saved);
	}

	async delete(scope: string): Promise<{ deleted: boolean }> {
		const r = await this.prisma.composerDraft.deleteMany({ where: { scope } });
		return { deleted: r.count > 0 };
	}

	/**
	 * Inside the send's transaction: tombstone the draft when `rev` is the stored one.
	 * A newer rev (another device kept typing) stays; the send still goes through.
	 */
	async consume(
		scope: string | undefined,
		rev: number | undefined,
		tx: Tx | PrismaService = this.prisma,
	): Promise<"sent" | "kept" | "none"> {
		if (!scope) return "none";
		const row = await tx.composerDraft.findUnique({ where: { scope } });
		if (!row) {
			// Sent before its first autosave landed: the tombstone refuses that late save.
			const made = await tx.composerDraft
				.create({
					data: { scope, rev: 1, generation: 1, body: JSON.stringify(EMPTY) },
				})
				.catch(lostRace);
			return made ? "sent" : "kept";
		}
		if (rev !== undefined && row.rev !== rev) return "kept";
		const choice = toDraft(row).choice;
		const updated = await tx.composerDraft.updateMany({
			where: { scope, rev: row.rev },
			data: {
				rev: row.rev + 1,
				generation: row.generation + 1,
				body: JSON.stringify({ ...EMPTY, choice }),
			},
		});
		return updated.count === 1 ? "sent" : "kept";
	}

	/** Drafts untouched for 30 days go, with the files uploaded to them and never sent. */
	async sweep(now = new Date()): Promise<number> {
		const before = new Date(now.getTime() - DRAFT_SWEEP_AFTER_MS);
		const old = await this.prisma.composerDraft.findMany({
			where: { updatedAt: { lt: before } },
		});
		if (old.length === 0) return 0;
		const keys = old
			.map((r) => toDraft(r).draftKey)
			.filter((k): k is string => !!k);
		const files = await this.prisma.attachment.findMany({
			where: { draftKey: { in: keys }, investigationId: null },
			select: { id: true },
		});
		await this.prisma.$transaction([
			this.prisma.attachment.deleteMany({
				where: { id: { in: files.map((f) => f.id) } },
			}),
			this.prisma.composerDraft.deleteMany({
				where: { scope: { in: old.map((r) => r.scope) } },
			}),
		]);
		for (const f of files)
			rmSync(join(attachmentsDir(), f.id), { force: true });
		return old.length;
	}

	/** Which of these scopes keep a draft with words or files in it (the thread list's Draft mark). */
	async withDrafts(scopes: string[]): Promise<Set<string>> {
		if (scopes.length === 0) return new Set();
		const rows = await this.prisma.composerDraft.findMany({
			where: { scope: { in: scopes } },
		});
		return new Set(
			rows
				.filter((r) => {
					const d = toDraft(r);
					return (
						d.text.trim() !== "" ||
						d.attachments.length > 0 ||
						d.quotes.length > 0 ||
						d.references.length > 0
					);
				})
				.map((r) => r.scope),
		);
	}
}
