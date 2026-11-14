// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).

export const MAX_RUNNABLE_COMMAND_BYTES = 4096;

/**
 * C0, DEL, C1, line and paragraph separators, and bidi controls. Any of them
 * can act on a shell's line editor before Enter (Ctrl-O accepts the line, ESC
 * ends a bracketed paste) or hide what the line really says (#931).
 */
function isControl(cp: number): boolean {
	return (
		cp <= 0x1f ||
		(cp >= 0x7f && cp <= 0x9f) ||
		cp === 0x200e ||
		cp === 0x200f ||
		cp === 0x2028 ||
		cp === 0x2029 ||
		(cp >= 0x202a && cp <= 0x202e) ||
		(cp >= 0x2066 && cp <= 0x2069)
	);
}

/** Text "Run in terminal" may stage; anything else gets Copy only. */
export function runnableCommand(text: string): boolean {
	if (!text.trim()) return false;
	if (new TextEncoder().encode(text).length > MAX_RUNNABLE_COMMAND_BYTES)
		return false;
	for (const ch of text) if (isControl(ch.codePointAt(0) ?? 0)) return false;
	return true;
}
