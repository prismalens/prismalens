// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).

/**
 * What goes inline (R4.3): images to 4 MB, text files to 256 KB. Any file to
 * ATTACHMENT_MAX_BYTES is accepted; the rest reach the agent as a link (#1024).
 */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** All files one thread, draft or incident holds together. */
export const ATTACHMENT_TOTAL_MAX_BYTES = 200 * 1024 * 1024;

export const ATTACHMENT_IMAGE_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
] as const;
export const ATTACHMENT_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const ATTACHMENT_TEXT_EXTENSIONS = [
	".log",
	".json",
	".csv",
	".md",
	".txt",
	".yaml",
	".yml",
] as const;

/** An image, a text file, or null when the box refuses it (pure, so the box and the API agree). */
export function attachmentKind(file: {
	name: string;
	type: string;
}): "image" | "text" | null {
	if ((ATTACHMENT_IMAGE_TYPES as readonly string[]).includes(file.type))
		return "image";
	if (file.type.startsWith("text/")) return "text";
	const name = file.name.toLowerCase();
	return ATTACHMENT_TEXT_EXTENSIONS.some((ext) => name.endsWith(ext))
		? "text"
		: null;
}
