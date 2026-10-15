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
	Capture,
	CaptureArtifact,
	ManifestEntry,
	Prisma,
} from "@prismalens/database";
import canonicalize from "canonicalize";
// biome-ignore lint/style/useImportType: Nest injects by the runtime class
import { PrismaService } from "../../../core/prisma/prisma.service.js";
// biome-ignore lint/style/useImportType: Nest injects by the runtime class
import { ArtifactStore, sha256Hex } from "./artifact-store.js";

type Target = { kubeContext: string; cluster: string; namespace: string };

export type ArtifactEntryBody = {
	v: 1;
	kind: "artifact";
	captureId: string;
	artifactId: string;
	seq: number;
	purpose: string;
	subject: string | null;
	command: string[];
	target: Target;
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
	target: Target;
	identity: CaptureIdentity | null;
	identityMatches: boolean | null;
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
	"purpose",
	"subject",
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

/** Body fields a capture row's own columns hold: what the case view shows of a capture. */
const CAPTURE_FIELDS = [
	"captureId",
	"state",
	"stateReason",
	"target",
	"identity",
	"identityMatches",
	"missedFrom",
	"missedTo",
	"dueAt",
	"startedAt",
	"finishedAt",
] as const;

/** Ended states: each has exactly one capture entry. */
const FINISHED = new Set<string>(["complete", "partial", "skipped", "blocked"]);

function canonical(value: unknown): string {
	const text = canonicalize(value);
	if (text === undefined) throw new Error("manifest body is not serialisable");
	return text;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

const targetOf = (row: Capture): Target => ({
	kubeContext: row.kubeContext,
	cluster: row.cluster,
	namespace: row.namespace,
});

function rowFields(
	row: CaptureArtifact,
): Record<(typeof ROW_FIELDS)[number], unknown> {
	return {
		captureId: row.captureId,
		artifactId: row.id,
		seq: row.seq,
		purpose: row.purpose,
		subject: row.subject,
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

function captureFields(
	row: Capture,
): Record<(typeof CAPTURE_FIELDS)[number], unknown> {
	return {
		captureId: row.id,
		state: row.state,
		stateReason: row.stateReason,
		target: targetOf(row),
		identity: row.identity === null ? null : JSON.parse(row.identity),
		identityMatches: row.identityMatches,
		missedFrom: iso(row.missedFrom),
		missedTo: iso(row.missedTo),
		dueAt: row.dueAt.toISOString(),
		startedAt: iso(row.startedAt),
		finishedAt: iso(row.finishedAt),
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
		purpose: row.purpose,
		subject: row.subject,
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

/** The capture-level entry for an ended capture row, so what is appended is what verify re-derives. */
export function captureEntryBody(
	row: Capture,
	context: { recordedAt: Date; notRun: string[][]; artifactDigests: string[] },
): CaptureEntryBody {
	if (!row.finishedAt) throw new Error(`capture ${row.id} has not ended`);
	return {
		v: 1,
		kind: "capture",
		captureId: row.id,
		state: row.state as CaptureState,
		stateReason: row.stateReason,
		target: targetOf(row),
		identity: captureFields(row).identity as CaptureIdentity | null,
		identityMatches: row.identityMatches,
		missedFrom: iso(row.missedFrom),
		missedTo: iso(row.missedTo),
		dueAt: row.dueAt.toISOString(),
		startedAt: iso(row.startedAt),
		finishedAt: row.finishedAt.toISOString(),
		recordedAt: context.recordedAt.toISOString(),
		notRun: context.notRun,
		artifactDigests: context.artifactDigests,
	};
}

/** The first of `keys` where a row's derived fields and an entry body differ, as a detail. */
function fieldsError(
	what: string,
	fields: () => Record<string, unknown>,
	keys: readonly string[],
	body: Record<string, unknown>,
): string | null {
	let fromRow: Record<string, unknown>;
	try {
		fromRow = fields();
	} catch {
		return `${what} columns do not parse`;
	}
	for (const key of keys) {
		if (canonical(fromRow[key] ?? null) !== canonical(body[key] ?? null))
			return `${what} ${key} differs from the entry`;
	}
	return null;
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
		const [entries, rows, captures] = await Promise.all([
			this.prisma.manifestEntry.findMany({
				where: { captureId: { in: captureIds } },
				orderBy: { seq: "asc" },
			}),
			this.prisma.captureArtifact.findMany({
				where: { captureId: { in: captureIds } },
			}),
			this.prisma.capture.findMany({ where: { id: { in: captureIds } } }),
		]);
		const rowById = new Map(rows.map((r) => [r.id, r]));
		const captureById = new Map(captures.map((c) => [c.id, c]));
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
		// An entry deleted after `e` leaves its successor linking past it.
		for (const e of entries) {
			const next = await this.prisma.manifestEntry.findFirst({
				where: { seq: { gt: e.seq } },
				orderBy: { seq: "asc" },
				select: { prevDigest: true },
			});
			if (next && next.prevDigest !== e.digest)
				return broken({
					seq: e.seq,
					check: "chain",
					detail: "the entry after it does not link to it",
				});
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
			const detail = this.entryError(
				e,
				bodies.get(e.seq) ?? {},
				captureById.get(e.captureId),
				rowById,
			);
			if (detail) return broken({ seq: e.seq, check: "metadata", detail });
		}

		for (const capture of captures) {
			const own = entries.filter((e) => e.captureId === capture.id);
			const gap = this.coverageError(capture, own, rows, bodies);
			if (gap) return broken({ seq: own.at(-1)?.seq ?? 0, ...gap });
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

	/** One entry against the rows it describes: its artifact row and capture target, or its capture row. */
	private entryError(
		e: ManifestEntry,
		body: Record<string, unknown>,
		capture: Capture | undefined,
		rowById: Map<string, CaptureArtifact>,
	): string | null {
		if (!capture) return "capture row is missing";
		if (body.kind === "capture")
			return fieldsError(
				"capture row",
				() => captureFields(capture),
				CAPTURE_FIELDS,
				body,
			);
		const row = e.artifactId ? rowById.get(e.artifactId) : undefined;
		if (!row) return "artifact row is missing";
		return (
			fieldsError("artifact row", () => rowFields(row), ROW_FIELDS, body) ??
			fieldsError("capture row", () => captureFields(capture), ["target"], body)
		);
	}

	/**
	 * Every artifact has an entry, and an ended capture has one capture entry naming every artifact
	 * entry. A capture not yet ended must show the identity its latest artifact entry recorded.
	 */
	private coverageError(
		capture: Capture,
		own: ManifestEntry[],
		rows: CaptureArtifact[],
		bodies: Map<number, Record<string, unknown>>,
	): Pick<BrokenAt, "check" | "detail"> | null {
		const artifactEntries = own.filter((e) => e.artifactId !== null);
		const entered = new Set(artifactEntries.map((e) => e.artifactId));
		const missing = rows.find(
			(r) => r.captureId === capture.id && !entered.has(r.id),
		);
		if (missing)
			return {
				check: "chain",
				detail: `artifact ${missing.id} has no manifest entry`,
			};
		const ends = own.filter((e) => e.artifactId === null);
		const end = ends[0];
		if (ends.length > 1)
			return {
				check: "chain",
				detail: "capture has more than one capture entry",
			};
		if (!end) {
			if (FINISHED.has(capture.state))
				return {
					check: "chain",
					detail: `capture is ${capture.state} but has no capture entry`,
				};
			const latest = artifactEntries.at(-1);
			const detail =
				latest &&
				fieldsError(
					"capture row",
					() => captureFields(capture),
					["identity"],
					bodies.get(latest.seq) ?? {},
				);
			return detail ? { check: "metadata", detail } : null;
		}
		const named = bodies.get(end.seq)?.artifactDigests ?? null;
		if (canonical(named) !== canonical(artifactEntries.map((e) => e.digest)))
			return {
				check: "chain",
				detail:
					"the capture entry's artifactDigests differ from its artifact entries",
			};
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
