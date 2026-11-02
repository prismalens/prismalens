// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** `TerminalClientFrameSchema`'s cap on one `in` frame; the server drops a larger one. */
const INPUT_LIMIT = 16384;

/** A paste as frames the socket accepts, never splitting a surrogate pair. */
export function chunkTerminalInput(data: string): string[] {
	const chunks: string[] = [];
	for (let start = 0; start < data.length; ) {
		let end = Math.min(start + INPUT_LIMIT, data.length);
		const last = data.charCodeAt(end - 1);
		if (end < data.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
		chunks.push(data.slice(start, end));
		start = end;
	}
	return chunks;
}
