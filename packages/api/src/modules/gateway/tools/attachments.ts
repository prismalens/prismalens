// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	defineHarnessTool,
	fail,
	type HarnessTool,
	RESULT_CHARS,
} from "@prismalens/integrations/harness";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";

export interface AttachmentItem {
	id: string;
	name: string;
	mimeType: string;
	size: number;
	at: string;
}

/** The files on the run's incident, or on the thread itself when it has none (#1020). */
export interface AttachmentsData {
	/** Null when the run has nothing to read. */
	list(
		runId: string,
	): Promise<{ incident?: number; attachments: AttachmentItem[] } | null>;
	/** Null unless the attachment is the run's to read; `text` is null when its file is gone. */
	read(
		runId: string,
		id: string,
	): Promise<{
		name: string;
		mimeType: string;
		size: number;
		text(): Promise<string | null>;
		/** The raw bytes, for a PDF's text; null when the file is gone. */
		bytes?(): Promise<Uint8Array | null>;
	} | null>;
}

/** Every subject a file can reach: a scheduled check takes no uploads, so it gets no file tools (#1024). */
const FILE_SUBJECTS = {
	subjects: ["incident", "project", "service", "none"],
} as const;

/** The most of a file `attachment_read` returns. */
export const ATTACHMENT_READ_CHARS = 32_000;
/** The most bytes of a binary file one call returns; base64 keeps the result under RESULT_CHARS. */
export const ATTACHMENT_READ_BYTES = 18_000;

type FileHead = { id: string; name: string; mimeType: string; size: number };

/**
 * The chunk from `offset`, at most `length` (and ATTACHMENT_READ_CHARS) long, shorter if
 * the whole result would pass RESULT_CHARS and be cut mid-JSON (#1024).
 */
function fitted(
	head: FileHead,
	whole: string,
	offset = 0,
	length = ATTACHMENT_READ_CHARS,
) {
	const text = whole.slice(offset);
	const shown = (n: number) => {
		const end = offset + n;
		return {
			...head,
			offset,
			text: text.slice(0, n),
			total: whole.length,
			truncated: end < whole.length,
			...(end < whole.length
				? {
						note: `Characters ${offset} to ${end} of ${whole.length}; call again with offset ${end} for more.`,
					}
				: {}),
		};
	};
	const fits = (n: number) =>
		JSON.stringify(shown(n), null, 1).length <= RESULT_CHARS;
	let hi = Math.min(text.length, length, ATTACHMENT_READ_CHARS);
	if (fits(hi)) return shown(hi);
	let lo = 0;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (fits(mid)) lo = mid;
		else hi = mid - 1;
	}
	return shown(lo);
}

const isText = (mime: string) =>
	mime.startsWith("text/") || /[/+-](json|ya?ml|xml|csv)$/.test(mime);

const PDF = "application/pdf";

/** A binary file's bytes from `offset`, at most ATTACHMENT_READ_BYTES, base64-encoded (#1024). */
function byteChunk(
	head: { name: string; mimeType: string; size: number },
	id: string,
	bytes: Uint8Array,
	offset = 0,
	length = ATTACHMENT_READ_BYTES,
) {
	const end = Math.min(
		bytes.length,
		offset + Math.min(length, ATTACHMENT_READ_BYTES),
	);
	const truncated = end < bytes.length;
	return {
		id,
		name: head.name,
		mimeType: head.mimeType,
		size: head.size,
		encoding: "base64" as const,
		offset,
		total: bytes.length,
		data: Buffer.from(bytes.subarray(offset, end)).toString("base64"),
		truncated,
		...(truncated
			? {
					note: `Bytes ${offset} to ${end} of ${bytes.length}; call again with offset ${end} for more.`,
				}
			: {}),
	};
}

/** A PDF's text, page by page, through a maintained parser; null when it has none. */
export async function pdfText(bytes: Uint8Array): Promise<string | null> {
	const pdf = await getDocumentProxy(new Uint8Array(bytes));
	const { text } = await extractText(pdf, { mergePages: true });
	return text.trim() ? text : null;
}

export function attachmentTools(data: AttachmentsData): HarnessTool[] {
	return [
		defineHarnessTool({
			name: "attachments_list",
			title: "Files attached to this thread",
			description:
				"The files the operator attached to this run's incident, or to this thread when it has no incident, newest first: id, name, mime type, size in bytes and when. Read a text one with attachment_read.",
			group: "knowledge",
			effect: "read",
			serves: FILE_SUBJECTS,
			input: z.object({}),
			run: async (_input, ctx) => {
				const r = await data.list(ctx.runId);
				return r
					? { value: r }
					: fail(
							"not_found",
							"This thread has no files to list.",
							"Answer from the message and its files.",
						);
			},
		}),
		defineHarnessTool({
			name: "attachment_read",
			title: "Read an attached file",
			description: `One file attachments_list returned, by id (a prismalens://attachment/<id> link names the same id). Text, JSON, YAML, XML and CSV come back as text, and a PDF as its text, at most ${ATTACHMENT_READ_CHARS} characters per call. Any other file comes back as base64 bytes, at most ${ATTACHMENT_READ_BYTES} per call. Pass offset (and length) to read the next chunk.`,
			group: "knowledge",
			effect: "read",
			serves: FILE_SUBJECTS,
			input: z.object({
				id: z.string().trim().min(1).max(200),
				offset: z.number().int().min(0).optional(),
				length: z.number().int().min(1).max(ATTACHMENT_READ_CHARS).optional(),
			}),
			run: async ({ id: given, offset, length }, ctx) => {
				const id = given.replace(/^prismalens:\/\/attachment\//, "");
				const found = await data.read(ctx.runId, id);
				if (!found)
					return fail(
						"not_found",
						`No attachment "${id}" on this thread.`,
						"Call attachments_list and pass an id exactly as it returned it.",
					);
				const pdf = found.mimeType === PDF && !!found.bytes;
				if (!isText(found.mimeType) && !pdf) {
					const bytes = await found.bytes?.();
					if (!bytes)
						return fail(
							"not_found",
							`The file for "${found.name}" is no longer stored.`,
							"Continue without it, or choose another attachment from attachments_list.",
						);
					return { value: byteChunk(found, id, bytes, offset, length) };
				}
				const text = pdf
					? await found
							.bytes?.()
							.then((b) => (b ? pdfText(b).catch(() => null) : null))
					: await found.text();
				if (text == null)
					return fail(
						"not_found",
						`The file for "${found.name}" is no longer stored.`,
						"Continue without it, or choose another attachment from attachments_list.",
					);
				return {
					value: fitted(
						{
							id,
							name: found.name,
							mimeType: found.mimeType,
							size: found.size,
						},
						text ?? "",
						offset,
						length,
					),
				};
			},
		}),
	];
}
