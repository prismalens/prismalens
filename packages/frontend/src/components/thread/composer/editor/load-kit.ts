// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export type EditorKit = typeof import("./kit");

let kit: EditorKit | null = null;
let loading: Promise<EditorKit> | null = null;
let asked = false;

/** Fetches the editor's code when the page is idle; no editor starts from it (#1101 category 12). */
export function preloadEditorKit(): Promise<EditorKit> {
	loading ??= import("./kit").then((m) => {
		kit = m;
		return m;
	});
	return loading;
}

/** Asks for the editor: the box was used. Its code loads if it has not, and editors start. */
export function loadEditorKit(): Promise<EditorKit> {
	asked = true;
	return preloadEditorKit();
}

/** True once an editor was asked for and its code has loaded: a composer mounted then starts with its editor. */
export const isEditorKitLoaded = () => kit !== null && asked;

/** The loaded kit, for code that only runs with an editor in hand, which means it has loaded. */
export function editorKit(): EditorKit {
	if (!kit) throw new Error("The composer's editor code has not loaded.");
	return kit;
}
