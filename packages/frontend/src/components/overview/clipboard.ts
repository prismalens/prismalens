// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Copies `text`; when the browser has no clipboard (plain http from another
 * device) or refuses, selects `el`'s text so Ctrl+C works, and says false.
 */
export async function copyOrSelect(
	text: string,
	el: HTMLElement | null,
): Promise<boolean> {
	try {
		if (!navigator.clipboard) throw new Error("no clipboard");
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		if (el) {
			const range = document.createRange();
			range.selectNodeContents(el);
			const sel = window.getSelection();
			sel?.removeAllRanges();
			sel?.addRange(range);
			el.focus();
		}
		return false;
	}
}
