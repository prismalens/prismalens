// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export type EditorKit = typeof import("./kit");

let kit: EditorKit | null = null;
let loading: Promise<EditorKit> | null = null;

/** Starts loading the editor's code; the box paints first and the editor attaches when it lands. */
export function loadEditorKit(): Promise<EditorKit> {
	loading ??= import("./kit").then((m) => {
		kit = m;
		return m;
	});
	return loading;
}

/** True once the kit has loaded: a composer mounted after that starts with its editor. */
export const isEditorKitLoaded = () => kit !== null;

/** The loaded kit, for code that only runs with an editor in hand, which means it has loaded. */
export function editorKit(): EditorKit {
	if (!kit) throw new Error("The composer's editor code has not loaded.");
	return kit;
}
