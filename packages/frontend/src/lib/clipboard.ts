// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { toast } from "@/hooks/use-toast";

/** Copies to the clipboard; a blocked clipboard toasts and returns false. */
export async function copyText(text: string): Promise<boolean> {
	return copyWith(() => navigator.clipboard.writeText(text));
}

/**
 * Copies text (and HTML) still being made, such as from a module loaded on click:
 * a ClipboardItem of promises keeps the click's permission while they resolve.
 */
export async function copyPending(
	text: Promise<string>,
	html?: Promise<string>,
): Promise<boolean> {
	if (typeof ClipboardItem === "undefined") return copyText(await text);
	const blob = (type: string) => (s: string) => new Blob([s], { type });
	return copyWith(() =>
		navigator.clipboard.write([
			new ClipboardItem({
				"text/plain": text.then(blob("text/plain")),
				...(html ? { "text/html": html.then(blob("text/html")) } : {}),
			}),
		]),
	);
}

async function copyWith(write: () => Promise<void>): Promise<boolean> {
	try {
		if (!navigator.clipboard) throw new Error("no clipboard");
		await write();
		return true;
	} catch {
		toast({
			title: "Not copied",
			description: "This browser blocked the clipboard.",
			variant: "destructive",
		});
		return false;
	}
}
