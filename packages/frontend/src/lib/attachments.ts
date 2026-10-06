// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ATTACHMENT_IMAGE_MAX_BYTES,
	ATTACHMENT_TEXT_MAX_BYTES,
	type Attachment,
	attachmentKind,
	MAX_ATTACHMENTS_PER_MESSAGE,
} from "@prismalens/contracts";

/**
 * Why the box will not take `file` for this agent (R4.3), or null. `images` is
 * what the agent's last check recorded: true, false, or null when unchecked.
 */
export function attachRefusal(
	file: { name: string; type: string; size: number },
	agent: { label: string; images: boolean | null },
	already: number,
): string | null {
	if (already >= MAX_ATTACHMENTS_PER_MESSAGE)
		return `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`;
	const kind = attachmentKind(file);
	if (!kind)
		return `${file.name}: attach an image or a text file (.log, .json, .csv, .md, .txt, .yaml)`;
	if (kind === "image") {
		if (agent.images === false) return `${agent.label} can't take images`;
		if (agent.images === null)
			return `Images: not checked yet for ${agent.label}. Run its check in Settings, Agent.`;
		if (file.size > ATTACHMENT_IMAGE_MAX_BYTES) return "Images up to 4 MB";
	} else if (file.size > ATTACHMENT_TEXT_MAX_BYTES) {
		return "Text files up to 256 KB";
	}
	return null;
}

/** Multipart, so the shared client's JSON content type stays off this one call. */
export async function uploadAttachment(
	incidentId: string,
	file: File,
): Promise<Attachment> {
	const body = new FormData();
	body.append("file", file, file.name);
	const res = await fetch(`/api/incidents/${incidentId}/attachments`, {
		method: "POST",
		body,
		credentials: "include",
	});
	const data = (await res.json().catch(() => ({}))) as
		| Attachment
		| { message?: string };
	if (!res.ok)
		throw new Error(
			("message" in data && data.message) || `Upload failed (${res.status})`,
		);
	return data as Attachment;
}
