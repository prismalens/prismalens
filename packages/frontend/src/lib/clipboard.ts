// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { toast } from "@/hooks/use-toast";

/**
 * Copies to the clipboard; a blocked clipboard toasts and returns false. Text still being
 * made goes in as a promise, so the write starts inside the click that allowed it.
 */
export async function copyText(
	text: string | Promise<string>,
): Promise<boolean> {
	if (typeof text === "string")
		return copyWith(() => navigator.clipboard.writeText(text));
	if (typeof ClipboardItem === "undefined") return copyText(await text);
	return copyWith(() =>
		navigator.clipboard.write([
			new ClipboardItem({ "text/plain": blob(text, "text/plain") }),
		]),
	);
}

const blob = (s: string | Promise<string>, type: string) =>
	Promise.resolve(s).then((v) => new Blob([v], { type }));

/**
 * Copies `text/plain` and `text/html` together, so a rich editor keeps the formatting
 * and a plain box gets the markdown. A browser without `ClipboardItem` gets the text.
 */
export async function copyRich(
	text: string,
	html: string | Promise<string>,
): Promise<boolean> {
	if (typeof ClipboardItem === "undefined") return copyText(text);
	return copyWith(() =>
		navigator.clipboard.write([
			new ClipboardItem({
				"text/plain": new Blob([text], { type: "text/plain" }),
				"text/html": blob(html, "text/html"),
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
