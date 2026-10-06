// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Files the operator attaches for the agent (R4.3). The bytes sit under
 * `<workspace>/attachments/<id>`, outside every run's snapshot, so the gate's
 * path rule never admits them; a run reads only what its prompt carried.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { getAppDataDir } from "@prismalens/config";
import {
	ATTACHMENT_IMAGE_MAX_BYTES,
	ATTACHMENT_TEXT_MAX_BYTES,
	type Attachment,
	attachmentKind,
	type JobAttachment,
} from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { TimelineService } from "../timeline/timeline.service.js";

export function attachmentsDir(): string {
	return join(getAppDataDir(), "attachments");
}

/** Every stored file goes with a Danger zone reset. */
export function removeAllAttachmentFiles(): void {
	rmSync(attachmentsDir(), { recursive: true, force: true });
}

type Row = {
	id: string;
	incidentId: string;
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
		const kind = attachmentKind(file);
		if (!kind)
			throw new ORPCError("UNSUPPORTED_MEDIA_TYPE", {
				message:
					"Attach an image (PNG, JPEG, WebP, GIF) or a text file (.log, .json, .csv, .md, .txt, .yaml).",
			});
		const limit =
			kind === "image" ? ATTACHMENT_IMAGE_MAX_BYTES : ATTACHMENT_TEXT_MAX_BYTES;
		if (file.size > limit)
			throw new ORPCError("PAYLOAD_TOO_LARGE", {
				message:
					kind === "image" ? "Images up to 4 MB" : "Text files up to 256 KB",
			});
		const bytes = Buffer.from(await file.arrayBuffer());
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		const same = await this.prisma.attachment.findFirst({
			where: { incidentId, sha256 },
		});
		if (same) return toAttachment(same);
		const row = await this.prisma.attachment.create({
			data: {
				incidentId,
				name: file.name.slice(0, 200) || "attachment",
				mimeType: kind === "text" ? "text/plain" : file.type,
				size: bytes.length,
				sha256,
			},
		});
		mkdirSync(attachmentsDir(), { recursive: true });
		writeFileSync(join(attachmentsDir(), row.id), bytes);
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

	async read(incidentId: string, id: string): Promise<File> {
		const row = await this.prisma.attachment.findFirst({
			where: { id, incidentId },
		});
		if (!row)
			throw new ORPCError("NOT_FOUND", { message: "No such attachment" });
		const bytes = readFileSync(join(attachmentsDir(), row.id));
		return new File([bytes], row.name, { type: row.mimeType });
	}
}
