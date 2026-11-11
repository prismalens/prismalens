// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Editor } from "@tiptap/core";
import { act } from "react";

/** Reads the TipTap Editor attached to the element by TipTap/Composer. */
export function getEditor(el: Element): Editor {
	const editor = (el as HTMLElement & { editor?: Editor }).editor;
	if (!editor) {
		throw new Error("No TipTap editor instance found on element");
	}
	return editor;
}

/** Types text into the editor. If charByChar is true, dispatches insertText character by character. */
export async function typeIn(
	el: Element,
	text: string,
	options?: { charByChar?: boolean },
) {
	const editor = getEditor(el);
	await act(async () => {
		if (options?.charByChar) {
			for (const ch of text) {
				editor.view.dispatch(editor.state.tr.insertText(ch));
			}
		} else {
			editor.commands.insertContent(text);
		}
	});
}

/** Dispatches a KeyboardEvent on the element inside act(). */
export async function pressKey(
	el: Element,
	key: string,
	init: Partial<KeyboardEventInit> = {},
) {
	await act(async () => {
		el.dispatchEvent(
			new KeyboardEvent("keydown", {
				key,
				code: init.code ?? key,
				bubbles: true,
				cancelable: true,
				shiftKey: init.shiftKey ?? false,
				ctrlKey: init.ctrlKey ?? false,
				metaKey: init.metaKey ?? false,
				altKey: init.altKey ?? false,
				...init,
			}),
		);
	});
}

export interface PasteData {
	text?: string;
	html?: string;
	files?: File[];
}

/** Creates a DataTransfer object compatible with happy-dom and browser clipboard events. */
export function createDataTransfer(data: PasteData): DataTransfer {
	let dt: DataTransfer;
	try {
		dt = new DataTransfer();
	} catch {
		dt = {} as DataTransfer;
	}
	const store = new Map<string, string>();
	if (data.text !== undefined) store.set("text/plain", data.text);
	if (data.html !== undefined) store.set("text/html", data.html);

	const files = data.files ?? [];
	try {
		for (const file of files) {
			dt.items?.add(file);
		}
	} catch {
		// happy-dom items fallback
	}

	Object.defineProperty(dt, "files", {
		value: files,
		configurable: true,
	});
	Object.defineProperty(dt, "getData", {
		value: (format: string) => store.get(format) ?? "",
		configurable: true,
	});
	Object.defineProperty(dt, "setData", {
		value: (format: string, val: string) => store.set(format, val),
		configurable: true,
	});

	return dt;
}

/** Dispatches a ClipboardEvent with the given text/files on the element inside act(). */
export async function pasteInto(el: Element, data: PasteData | DataTransfer) {
	const dt =
		typeof DataTransfer !== "undefined" && data instanceof DataTransfer
			? data
			: createDataTransfer(data as PasteData);
	await act(async () => {
		el.dispatchEvent(
			new ClipboardEvent("paste", {
				clipboardData: dt,
				bubbles: true,
				cancelable: true,
			}),
		);
	});
}

/** Reads the plain text of the editor on the element, with '\n' as paragraph separator. */
export function getText(el: Element): string {
	return getEditor(el).getText({ blockSeparator: "\n" });
}

/** Reads the JSON of the editor on the element. */
export function getJSON(el: Element) {
	return getEditor(el).getJSON();
}

/** Waits for an immediatelyRender: false editor to mount and be ready. */
export async function settleEditor() {
	await act(async () => {});
}
