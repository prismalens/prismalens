// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Files the operator attaches for the agent (R4.3). The bytes sit under
 * `<workspace>/attachments/<id>`, outside every run's snapshot, so the gate's
 * path rule never admits them; a run reads only what its prompt carried.
 */
import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { getAppDataDir } from "@prismalens/config";
import {
	ATTACHMENT_IMAGE_TYPES,
	ATTACHMENT_MAX_BYTES,
	type Attachment,
	attachmentKind,
	type JobAttachment,
	type ServedAttachment,
} from "@prismalens/contracts";
import type { Prisma } from "@prismalens/database";
import { fileTypeFromBuffer } from "file-type";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { TimelineService } from "../timeline/timeline.service.js";

export function attachmentsDir(): string {
	return join(getAppDataDir(), "attachments");
}

/** Every stored file goes with a Danger zone reset. */
export function removeAllAttachmentFiles(): void {
	rmSync(attachmentsDir(), { recursive: true, force: true });
}

/**
 * The type the bytes are, never the type the client sent: an image must carry a
 * supported image's magic bytes and text must decode as UTF-8 (R4.3).
 */
async function sniffedType(
	kind: "image" | "text",
	bytes: Buffer,
): Promise<string | null> {
	if (kind === "text") return isUtf8(bytes) ? "text/plain" : null;
	const found = await fileTypeFromBuffer(bytes);
	return found &&
		(ATTACHMENT_IMAGE_TYPES as readonly string[]).includes(found.mime)
		? found.mime
		: null;
}

/** A file that is neither an inline image nor text: the type its bytes show, else UTF-8 text or binary. */
async function otherType(bytes: Buffer): Promise<string> {
	const found = await fileTypeFromBuffer(bytes);
	if (found) return found.mime;
	return isUtf8(bytes) ? "text/plain" : "application/octet-stream";
}

function writeAttachment(id: string, bytes: Buffer): void {
	const path = join(attachmentsDir(), id);
	if (existsSync(path)) return;
	mkdirSync(attachmentsDir(), { recursive: true });
	writeFileSync(path, bytes);
}

type Row = {
	id: string;
	incidentId: string | null;
	name: string;
	mimeType: string;
	size: number;
	sha256: string;
	createdAt: Date;
};

const toAttachment = (r: Row): Attachment => ({
	id: r.id,
	incidentId: r.incidentId,
	name: r.name,
	mimeType: r.mimeType,
	size: r.size,
	sha256: r.sha256,
	createdAt: r.createdAt.toISOString(),
});

/** Who a thread's file belongs to: its run, or a draft key before the run exists (#1020). */
type ThreadOwner =
	| { investigationId: string }
	| { draftKey: string; investigationId: null };

@Injectable()
export class AttachmentsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly timeline: TimelineService,
	) {}

	async upload(incidentId: string, file: File): Promise<Attachment> {
		const incident = await this.prisma.incident.findUnique({
			where: { id: incidentId },
			select: { id: true },
		});
		if (!incident)
			throw new ORPCError("NOT_FOUND", {
				message: `Incident ${incidentId} not found`,
			});
		const { bytes, mimeType, sha256 } = await this.accept(file);
		const same = await this.prisma.attachment.findFirst({
			where: { incidentId, sha256 },
		});
		if (same) {
			// A row whose file went missing takes the bytes again rather than answering ENOENT forever.
			writeAttachment(same.id, bytes);
			return toAttachment(same);
		}
		const row = await this.store({ incidentId }, file, bytes, mimeType, sha256);
		await this.timeline.create({
			incidentId,
			type: "custom",
			title: `Attached ${row.name}`,
			source: "user",
			metadata: { attachmentId: row.id },
		});
		return toAttachment(row);
	}

	/** The ids as a job carries them; refuses one that is not this incident's. */
	async forJob(incidentId: string, ids: string[]): Promise<JobAttachment[]> {
		if (ids.length === 0) return [];
		const rows = await this.prisma.attachment.findMany({
			where: { incidentId, id: { in: ids } },
		});
		if (rows.length !== new Set(ids).size)
			throw new ORPCError("BAD_REQUEST", {
				message: "An attachment is not on this incident; attach it again.",
			});
		return asJob(rows, ids);
	}

	async read(incidentId: string, id: string): Promise<ServedAttachment> {
		const row = await this.prisma.attachment.findFirst({
			where: { id, incidentId },
		});
		if (!row)
			throw new ORPCError("NOT_FOUND", { message: "No such attachment" });
		return served(row);
	}

	/** A thread's file before its run exists; the start claims it (#1020). */
	uploadDraft(draftKey: string, file: File): Promise<Attachment> {
		return this.uploadOwned({ draftKey, investigationId: null }, file);
	}

	/** A file for a project, service or no-subject thread's next message (#1020). */
	async uploadForRun(investigationId: string, file: File): Promise<Attachment> {
		const run = await this.prisma.investigation.findUnique({
			where: { id: investigationId },
			select: { incidentId: true, scheduleId: true },
		});
		if (!run)
			throw new ORPCError("NOT_FOUND", {
				message: `Thread ${investigationId} not found`,
			});
		if (run.incidentId)
			throw new ORPCError("BAD_REQUEST", {
				message: "Attach this run's files on its incident.",
			});
		if (run.scheduleId)
			throw new ORPCError("BAD_REQUEST", {
				message:
					"Files attach to an incident, and this run has no incident yet.",
			});
		return this.uploadOwned({ investigationId }, file);
	}

	/** Refuses before the run exists when a draft's file is missing. */
	async checkDraft(draftKey: string, ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		const rows = await this.prisma.attachment.findMany({
			where: { draftKey, investigationId: null, id: { in: ids } },
			select: { id: true },
		});
		if (rows.length !== new Set(ids).size)
			throw new ORPCError("BAD_REQUEST", {
				message: "An attachment is not on this draft; attach it again.",
			});
	}

	/**
	 * The draft's files as a job carries them, now owned by the run that starts with them.
	 * The write is the claim: a racing start sees a short count and throws, so the caller's
	 * transaction rolls its run back (#1020).
	 */
	async claimDraft(
		draftKey: string,
		ids: string[],
		investigationId: string,
		db: Prisma.TransactionClient | PrismaService = this.prisma,
	): Promise<JobAttachment[]> {
		if (ids.length === 0) return [];
		const unique = [...new Set(ids)];
		const claimed = await db.attachment.updateMany({
			where: { draftKey, investigationId: null, id: { in: unique } },
			data: { investigationId },
		});
		if (claimed.count !== unique.length)
			throw new ORPCError("BAD_REQUEST", {
				message: "An attachment is not on this thread; attach it again.",
			});
		const rows = await db.attachment.findMany({
			where: { draftKey, investigationId, id: { in: unique } },
		});
		return asJob(rows, unique);
	}

	/** The ids as a job carries them; refuses one this run does not own. */
	async forRun(
		investigationId: string,
		ids: string[],
	): Promise<JobAttachment[]> {
		if (ids.length === 0) return [];
		const rows = await this.prisma.attachment.findMany({
			where: { investigationId, incidentId: null, id: { in: ids } },
		});
		return asJob(rows, ids);
	}

	async readForRun(
		investigationId: string,
		id: string,
	): Promise<ServedAttachment> {
		const row = await this.prisma.attachment.findFirst({
			where: { id, investigationId, incidentId: null },
		});
		if (!row)
			throw new ORPCError("NOT_FOUND", { message: "No such attachment" });
		return served(row);
	}

	private async uploadOwned(
		owner: ThreadOwner,
		file: File,
	): Promise<Attachment> {
		const { bytes, mimeType, sha256 } = await this.accept(file);
		const same = await this.prisma.attachment.findFirst({
			where: { ...owner, incidentId: null, sha256 },
		});
		if (same) {
			writeAttachment(same.id, bytes);
			return toAttachment(same);
		}
		return toAttachment(await this.store(owner, file, bytes, mimeType, sha256));
	}

	private async store(
		owner: { incidentId: string } | ThreadOwner,
		file: File,
		bytes: Buffer,
		mimeType: string,
		sha256: string,
	): Promise<Row> {
		const row = await this.prisma.attachment.create({
			data: {
				...owner,
				name: file.name.slice(0, 200) || "attachment",
				mimeType,
				size: bytes.length,
				sha256,
			},
		});
		try {
			writeAttachment(row.id, bytes);
		} catch (e) {
			await this.prisma.attachment.delete({ where: { id: row.id } });
			throw e;
		}
		return row;
	}

	/** The checks every upload passes: size, and the type the bytes are (#1024: any file to 25 MB). */
	private async accept(
		file: File,
	): Promise<{ bytes: Buffer; mimeType: string; sha256: string }> {
		if (file.size > ATTACHMENT_MAX_BYTES)
			throw new ORPCError("PAYLOAD_TOO_LARGE", {
				message: "Files up to 25 MB",
			});
		const bytes = Buffer.from(await file.arrayBuffer());
		const kind = attachmentKind(file);
		const mimeType =
			(kind ? await sniffedType(kind, bytes) : null) ??
			(await otherType(bytes));
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		return { bytes, mimeType, sha256 };
	}
}

function asJob(rows: Row[], ids: string[]): JobAttachment[] {
	if (rows.length !== new Set(ids).size)
		throw new ORPCError("BAD_REQUEST", {
			message: "An attachment is not on this thread; attach it again.",
		});
	const byId = new Map(rows.map((r) => [r.id, r]));
	return [...new Set(ids)].map((id) => {
		const r = byId.get(id) as Row;
		return {
			id: r.id,
			name: r.name,
			mimeType: r.mimeType,
			size: r.size,
			path: join(attachmentsDir(), r.id),
		};
	});
}

/** Anything but the four image types downloads: XML or HTML bytes would otherwise run as a page. */
function served(row: Row): ServedAttachment {
	const bytes = readFileSync(join(attachmentsDir(), row.id));
	const inline = (ATTACHMENT_IMAGE_TYPES as readonly string[]).includes(
		row.mimeType,
	);
	return {
		headers: {
			"content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
			"content-security-policy": "default-src 'none'; sandbox",
			"x-content-type-options": "nosniff",
		},
		body: new File([bytes], row.name, { type: row.mimeType }),
	};
}
