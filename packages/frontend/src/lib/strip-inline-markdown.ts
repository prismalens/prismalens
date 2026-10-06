// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Plain text from a line the agent wrote with inline Markdown: code spans,
 * emphasis and links lose their marks, the words stay. For fields a person
 * edits (the Resolve dialog's cause), where the marks would read as typos.
 */
export function stripInlineMarkdown(text: string): string {
	return text
		.replace(/`([^`]+)`/g, "$1")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/(\*\*|__)(?=\S)([^*_]*?\S)\1/g, "$2")
		.replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, "$1$2")
		.replace(/(^|[^\w_])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1$2");
}
