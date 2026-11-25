// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { toast } from "@/hooks/use-toast";

/** Copies to the clipboard; a blocked clipboard tries the older copy, then offers a file. */
export async function copyText(text: string, file?: string): Promise<boolean> {
	return copyWith(
		() => navigator.clipboard.writeText(text),
		Promise.resolve(text),
		file,
	);
}

/**
 * Copies text (and HTML) still being made, such as from a module loaded on click:
 * a ClipboardItem of promises keeps the click's permission while they resolve.
 */
export async function copyPending(
	text: Promise<string>,
	html?: Promise<string>,
	file?: string,
): Promise<boolean> {
	if (typeof ClipboardItem === "undefined")
		return copyWith(
			async () => navigator.clipboard.writeText(await text),
			text,
			file,
		);
	const blob = (type: string) => (s: string) => new Blob([s], { type });
	return copyWith(
		() =>
			navigator.clipboard.write([
				new ClipboardItem({
					"text/plain": text.then(blob("text/plain")),
					...(html ? { "text/html": html.then(blob("text/html")) } : {}),
				}),
			]),
		text,
		file,
	);
}

/** The pre-async copy: a hidden selection and `copy`; true when the browser took it. */
function legacyCopy(text: string): boolean {
	const area = document.createElement("textarea");
	area.value = text;
	area.setAttribute("readonly", "");
	area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
	const back = document.activeElement as HTMLElement | null;
	document.body.append(area);
	area.select();
	let ok = false;
	try {
		ok = document.execCommand("copy");
	} catch {
		ok = false;
	}
	area.remove();
	back?.focus?.();
	return ok;
}

function saveFile(text: string, name: string) {
	const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A browser error never reaches the toast; it says what happened and offers the text as a file (#1101 23.4). */
async function copyWith(
	write: () => Promise<void>,
	text: Promise<string>,
	file = "prismalens-copy.txt",
): Promise<boolean> {
	try {
		if (!navigator.clipboard) throw new Error("no clipboard");
		await write();
		return true;
	} catch {
		const got = await text.then(
			(t) => t,
			() => null,
		);
		if (got !== null && legacyCopy(got)) return true;
		// The toast's code loads with the first failed copy, not with every page that copies;
		// when it cannot load either, a plain toast says so and the text is saved as a file.
		await import("./clipboard-toast").then(
			({ notCopied }) =>
				notCopied(got, got === null ? null : () => saveFile(got, file)),
			() => {
				if (got !== null) saveFile(got, file);
				toast({
					title: "Not copied",
					description:
						got === null
							? "PrismaLens couldn't load the text to copy. Try again."
							: "The browser kept the clipboard closed, so PrismaLens saved the text as a file.",
					variant: "destructive",
				});
			},
		);
		return false;
	}
}
