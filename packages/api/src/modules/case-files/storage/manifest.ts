// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The append-only hash chain over every capture (§2.1): digest =
 * sha256(prevDigest + canonical body). One process-wide mutex keeps it one chain.
 */
import { Injectable } from "@nestjs/common";
import type {
	CaptureIdentity,
	CaptureState,
	ManifestVerify,
	Redactions,
	RetrievalReason,
} from "@prismalens/contracts";
import type {
	CaptureArtifact,
	ManifestEntry,
	Prisma,
} from "@prismalens/database";
import canonicalize from "canonicalize";
// biome-ignore lint/style/useImportType: Nest injects by the runtime class
import { PrismaService } from "../../../core/prisma/prisma.service.js";
// biome-ignore lint/style/useImportType: Nest injects by the runtime class
import { ArtifactStore, sha256Hex } from "./artifact-store.js";

export type ArtifactEntryBody = {
	v: 1;
	kind: "artifact";
	captureId: string;
	artifactId: string;
	seq: number;
	command: string[];
	target: { kubeContext: string; cluster: string; namespace: string };
	identity: CaptureIdentity;
	sourceFrom: string | null;
	sourceTo: string | null;
	collectedAt: string;
	recordedAt: string;
	retrieval: "complete" | "partial";
	retrievalReason: RetrievalReason | null;
	exitCode: number | null;
	rawSha256: string;
	rawBytes: number;
	redactedSha256: string;
	redactedBytes: number;
	redactions: Redactions;
};

export type CaptureEntryBody = {
	v: 1;
	kind: "capture";
	captureId: string;
	state: CaptureState;
	stateReason: string | null;
	missedFrom: string | null;
	missedTo: string | null;
	dueAt: string;
	startedAt: string | null;
	finishedAt: string;
	recordedAt: string;
	notRun: string[][];
	artifactDigests: string[];
};

export type ManifestBody = ArtifactEntryBody | CaptureEntryBody;

declare const chainBrand: unique symbol;
/** A transaction opened by `ManifestService.transaction`, so `append` always runs under the mutex. */
export type ChainTx = Prisma.TransactionClient & {
	readonly [chainBrand]: true;
};

type BrokenAt = NonNullable<ManifestVerify["brokenAt"]>;

/** Body fields an artifact row's own columns hold: verify check 3 compares exactly these. */
const ROW_FIELDS = [
	"captureId",
	"artifactId",
	"seq",
	"command",
	"sourceFrom",
	"sourceTo",
	"collectedAt",
	"retrieval",
	"retrievalReason",
	"exitCode",
	"rawSha256",
	"rawBytes",
	"redactedSha256",
	"redactedBytes",
	"redactions",
] as const;

function canonical(value: unknown): string {
	const text = canonicalize(value);
	if (text === undefined) throw new Error("manifest body is not serialisable");
	return text;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function rowFields(
	row: CaptureArtifact,
): Record<(typeof ROW_FIELDS)[number], unknown> {
	return {
		captureId: row.captureId,
		artifactId: row.id,
		seq: row.seq,
		command: JSON.parse(row.command),
		sourceFrom: iso(row.sourceFrom),
		sourceTo: iso(row.sourceTo),
		collectedAt: row.endedAt.toISOString(),
		retrieval: row.retrieval,
		retrievalReason: row.retrievalReason,
		exitCode: row.exitCode,
		rawSha256: row.rawSha256,
		rawBytes: row.rawBytes,
		redactedSha256: row.redactedSha256,
		redactedBytes: row.redactedBytes,
		redactions: JSON.parse(row.redactions),
	};
}

/** The entry body for an artifact row, so what is appended is what verify re-derives. */
export function artifactEntryBody(
	row: CaptureArtifact,
	context: {
		target: ArtifactEntryBody["target"];
		identity: CaptureIdentity;
		recordedAt: Date;
	},
): ArtifactEntryBody {
	const f = rowFields(row);
	return {
		v: 1,
		kind: "artifact",
		captureId: row.captureId,
		artifactId: row.id,
		seq: row.seq,
		command: f.command as string[],
		target: context.target,
		identity: context.identity,
		sourceFrom: iso(row.sourceFrom),
		sourceTo: iso(row.sourceTo),
		collectedAt: row.endedAt.toISOString(),
		recordedAt: context.recordedAt.toISOString(),
		retrieval: row.retrieval as ArtifactEntryBody["retrieval"],
		retrievalReason: row.retrievalReason as RetrievalReason | null,
		exitCode: row.exitCode,
		rawSha256: row.rawSha256,
		rawBytes: row.rawBytes,
		redactedSha256: row.redactedSha256,
		redactedBytes: row.redactedBytes,
		redactions: f.redactions as Redactions,
	};
}

function parseBody(text: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(text);
		return typeof parsed === "object" &&
			parsed !== null &&
			!Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

@Injectable()
export class ManifestService {
	private tail: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly prisma: PrismaService,
		private readonly store: ArtifactStore,
	) {}

	/** Runs `fn` in one Prisma transaction, after every earlier one in this process has settled. */
	transaction<T>(fn: (tx: ChainTx) => Promise<T>): Promise<T> {
		const run = this.tail.then(() =>
			this.prisma.$transaction((tx) => fn(tx as ChainTx)),
		);
		this.tail = run.catch(() => undefined);
		return run;
	}

	async append(tx: ChainTx, body: ManifestBody): Promise<ManifestEntry> {
		const text = canonical(body);
		const last = await tx.manifestEntry.findFirst({
			orderBy: { seq: "desc" },
			select: { digest: true },
		});
		const prevDigest = last?.digest ?? "";
		return tx.manifestEntry.create({
			data: {
				captureId: body.captureId,
				artifactId: body.kind === "artifact" ? body.artifactId : null,
				body: text,
				prevDigest,
				digest: sha256Hex(prevDigest + text),
			},
		});
	}

	async verify(captureIds: string[]): Promise<ManifestVerify> {
		const entries = await this.prisma.manifestEntry.findMany({
			where: { captureId: { in: captureIds } },
			orderBy: { seq: "asc" },
		});
		const rows = await this.prisma.captureArtifact.findMany({
			where: { captureId: { in: captureIds } },
		});
		const rowById = new Map(rows.map((r) => [r.id, r]));
		let expired = 0;
		const broken = (b: BrokenAt): ManifestVerify => ({
			ok: false,
			entries: entries.length,
			expired,
			brokenAt: b,
		});

		for (const e of entries) {
			const chainError = await this.chainError(e);
			if (chainError)
				return broken({ seq: e.seq, check: "chain", detail: chainError });
		}

		const bodies = new Map<number, Record<string, unknown>>();
		for (const e of entries) {
			const body = parseBody(e.body);
			if (!body)
				return broken({
					seq: e.seq,
					check: "columns",
					detail: "body is not a JSON object",
				});
			bodies.set(e.seq, body);
			const wantArtifact = body.kind === "artifact" ? body.artifactId : null;
			if (body.captureId !== e.captureId || wantArtifact !== e.artifactId)
				return broken({
					seq: e.seq,
					check: "columns",
					detail: "captureId/artifactId columns differ from the body",
				});
		}

		for (const e of entries) {
			if (!e.artifactId) continue;
			const row = rowById.get(e.artifactId);
			const detail = row
				? this.metadataError(row, bodies.get(e.seq) ?? {})
				: "artifact row is missing";
			if (detail) return broken({ seq: e.seq, check: "metadata", detail });
		}

		for (const e of entries) {
			const row = e.artifactId ? rowById.get(e.artifactId) : undefined;
			if (!row) continue;
			if (row.expiredAt) {
				expired++;
				continue;
			}
			const detail = await this.fileError(row);
			if (detail) return broken({ seq: e.seq, check: "file", detail });
		}

		return { ok: true, entries: entries.length, expired };
	}

	private async chainError(e: ManifestEntry): Promise<string | null> {
		const prev = await this.prisma.manifestEntry.findFirst({
			where: { seq: { lt: e.seq } },
			orderBy: { seq: "desc" },
			select: { digest: true },
		});
		if (e.prevDigest !== (prev?.digest ?? ""))
			return "prevDigest does not match the entry before it";
		if (sha256Hex(e.prevDigest + e.body) !== e.digest)
			return "digest does not re-hash";
		return null;
	}

	private metadataError(
		row: CaptureArtifact,
		body: Record<string, unknown>,
	): string | null {
		let fromRow: Record<string, unknown>;
		try {
			fromRow = rowFields(row);
		} catch {
			return "artifact row columns do not parse";
		}
		for (const key of ROW_FIELDS) {
			if (canonical(fromRow[key] ?? null) !== canonical(body[key] ?? null))
				return `artifact row ${key} differs from the entry`;
		}
		return null;
	}

	private async fileError(row: CaptureArtifact): Promise<string | null> {
		const redacted =
			(await this.store.readRedactedBytes(row)) ?? Buffer.alloc(0);
		if (sha256Hex(redacted) !== row.redactedSha256)
			return "redacted file does not re-hash";
		try {
			if (sha256Hex(await this.store.readRaw(row)) !== row.rawSha256)
				return "raw file does not re-hash";
		} catch (err) {
			return `raw file unreadable: ${err instanceof Error ? err.message : String(err)}`;
		}
		return null;
	}
}
