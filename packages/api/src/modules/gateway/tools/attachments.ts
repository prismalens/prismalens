// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	defineHarnessTool,
	fail,
	type HarnessTool,
	RESULT_CHARS,
} from "@prismalens/integrations/harness";
import { z } from "zod";

export interface AttachmentItem {
	id: string;
	name: string;
	mimeType: string;
	size: number;
	at: string;
}

/** The files the operator attached to the run's incident. */
export interface AttachmentsData {
	/** Null when the run has no incident. */
	list(
		runId: string,
	): Promise<{ incident: number; attachments: AttachmentItem[] } | null>;
	/** Null unless the attachment is on the run's incident; `text` is null when its file is gone. */
	read(
		runId: string,
		id: string,
	): Promise<{
		name: string;
		mimeType: string;
		size: number;
		text(): Promise<string | null>;
	} | null>;
}

/** The most of a file `attachment_read` returns. */
export const ATTACHMENT_READ_CHARS = 32_000;

type FileHead = { id: string; name: string; mimeType: string; size: number };

/** The text cut at ATTACHMENT_READ_CHARS, and shorter if the whole result would pass RESULT_CHARS and be cut mid-JSON. */
function fitted(head: FileHead, text: string) {
	const shown = (n: number) => ({
		...head,
		text: text.slice(0, n),
		truncated: n < text.length,
		...(n < text.length
			? { note: `Cut at ${n} of ${text.length} characters.` }
			: {}),
	});
	const fits = (n: number) =>
		JSON.stringify(shown(n), null, 1).length <= RESULT_CHARS;
	let hi = Math.min(text.length, ATTACHMENT_READ_CHARS);
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

export function attachmentTools(data: AttachmentsData): HarnessTool[] {
	return [
		defineHarnessTool({
			name: "attachments_list",
			title: "Files attached to this incident",
			description:
				"The files the operator attached to this run's incident, newest first: id, name, mime type, size in bytes and when. Read a text one with attachment_read.",
			group: "knowledge",
			effect: "read",
			input: z.object({}),
			run: async (_input, ctx) => {
				const r = await data.list(ctx.runId);
				return r
					? { value: r }
					: fail(
							"not_found",
							"This run has no incident recorded, so no files are attached.",
							"Continue from the alerts in your prompt.",
						);
			},
		}),
		defineHarnessTool({
			name: "attachment_read",
			title: "Read an attached text file",
			description: `The text of one file attachments_list returned, by id. Text, JSON, YAML, XML and CSV only, cut at ${ATTACHMENT_READ_CHARS} characters. Images are not readable here; the operator's prompt carries them.`,
			group: "knowledge",
			effect: "read",
			input: z.object({ id: z.string().trim().min(1).max(100) }),
			run: async ({ id }, ctx) => {
				const found = await data.read(ctx.runId, id);
				if (!found)
					return fail(
						"not_found",
						`No attachment "${id}" on this run's incident.`,
						"Call attachments_list and pass an id exactly as it returned it.",
					);
				if (!isText(found.mimeType))
					return fail(
						"invalid_input",
						`"${found.name}" is ${found.mimeType}, not text.`,
						"This file is not text, so it cannot be read here; choose a text attachment from attachments_list.",
					);
				const text = await found.text();
				if (text === null)
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
						text,
					),
				};
			},
		}),
	];
}
