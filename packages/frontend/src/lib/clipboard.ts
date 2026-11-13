// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { toast } from "@/hooks/use-toast";

/** Copies to the clipboard; a blocked clipboard toasts and returns false. */
export async function copyText(text: string): Promise<boolean> {
	return copyWith(() => navigator.clipboard.writeText(text));
}

/**
 * Copies `text/plain` and `text/html` together, so a rich editor keeps the formatting
 * and a plain box gets the markdown. A browser without `ClipboardItem` gets the text.
 */
export async function copyRich(text: string, html: string): Promise<boolean> {
	if (typeof ClipboardItem === "undefined") return copyText(text);
	return copyWith(() =>
		navigator.clipboard.write([
			new ClipboardItem({
				"text/plain": new Blob([text], { type: "text/plain" }),
				"text/html": new Blob([html], { type: "text/html" }),
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
