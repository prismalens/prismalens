// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ATTACHMENT_IMAGE_MAX_BYTES,
	ATTACHMENT_MAX_BYTES,
	ATTACHMENT_TOTAL_MAX_BYTES,
	type Attachment,
	attachmentKind,
	MAX_ATTACHMENTS_PER_MESSAGE,
} from "@prismalens/contracts";

const MB = 1024 * 1024;

/**
 * Why the box will not take `file` (#1024), shown on its chip, or null. Any file is
 * taken to the contract limits; an image goes inline only to an agent that takes
 * images, else it goes as a file like any other. `already` is the files before it.
 */
export function attachRefusal(
	file: { name: string; type: string; size: number },
	already: { count: number; bytes: number },
	agent?: { label: string; images: boolean | null },
): string | null {
	if (already.count >= MAX_ATTACHMENTS_PER_MESSAGE)
		return `${ordinal(already.count + 1)} file: ${MAX_ATTACHMENTS_PER_MESSAGE} per message`;
	if (file.size > ATTACHMENT_MAX_BYTES)
		return `Over ${ATTACHMENT_MAX_BYTES / MB} MB`;
	if (already.bytes + file.size > ATTACHMENT_TOTAL_MAX_BYTES)
		return `Over ${ATTACHMENT_TOTAL_MAX_BYTES / MB} MB in all`;
	// An image goes inline, so it needs an agent whose check recorded that it takes images.
	if (agent && attachmentKind(file) === "image") {
		if (agent.images === false) return `${agent.label} can't take images`;
		if (agent.images === null)
			return `Images: not checked yet for ${agent.label}. Run its check in Settings, Agent.`;
	}
	return null;
}

function ordinal(n: number): string {
	const s =
		n % 100 >= 11 && n % 100 <= 13
			? "th"
			: (["th", "st", "nd", "rd"][n % 10] ?? "th");
	return `${n}${s}`;
}

/** An image the browser can shrink: over 4 MB and of a type a canvas can encode. */
export const needsDownscale = (file: { type: string; size: number }) =>
	attachmentKind({ name: "", type: file.type }) === "image" &&
	file.type !== "image/gif" &&
	file.size > ATTACHMENT_IMAGE_MAX_BYTES;

/**
 * An image over 4 MB, scaled down in the browser until it fits (#1024). Returns the
 * file unchanged where the browser cannot decode it; the server then takes it as a file.
 */
export async function downscaleImage(file: File): Promise<File> {
	if (!needsDownscale(file) || typeof createImageBitmap === "undefined")
		return file;
	try {
		const bitmap = await createImageBitmap(file);
		let scale = Math.sqrt(ATTACHMENT_IMAGE_MAX_BYTES / file.size);
		for (let i = 0; i < 4; i++) {
			const w = Math.max(1, Math.round(bitmap.width * scale));
			const h = Math.max(1, Math.round(bitmap.height * scale));
			const canvas = new OffscreenCanvas(w, h);
			canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
			const blob = await canvas.convertToBlob({
				type: "image/jpeg",
				quality: 0.85,
			});
			if (blob.size <= ATTACHMENT_IMAGE_MAX_BYTES)
				return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
					type: "image/jpeg",
				});
			scale *= 0.75;
		}
	} catch {
		// Undecodable: it goes as a plain file.
	}
	return file;
}

/** Multipart, so the shared client's JSON content type stays off this one call. */
export function uploadAttachment(
	incidentId: string,
	file: File,
): Promise<Attachment> {
	return uploadTo(`/api/incidents/${incidentId}/attachments`, file);
}

/** A thread's file: owned by its run, or by the draft key before the run exists (#1020). */
export function uploadThreadAttachment(
	owner: { runId: string } | { draftKey: string },
	file: File,
): Promise<Attachment> {
	return uploadTo(
		"runId" in owner
			? `/api/threads/${owner.runId}/attachments`
			: `/api/threads/drafts/${owner.draftKey}/attachments`,
		file,
	);
}

async function uploadTo(url: string, file: File): Promise<Attachment> {
	const body = new FormData();
	body.append("file", file, file.name);
	const res = await fetch(url, {
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
