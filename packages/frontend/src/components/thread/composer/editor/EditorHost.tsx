// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type Editor,
	EditorContent,
	ReactNodeViewRenderer,
	type UseEditorOptions,
	useEditor,
} from "@tiptap/react";
import { useEffect } from "react";
import { ChipView } from "./ChipView";
import { composerExtensions } from "./extensions";

/**
 * The composer's editor, created once its code has loaded; the composer holds the
 * instance it hands back and drew the same box meanwhile (#1101 category 12).
 */
export function EditorHost({
	options,
	placeholder,
	onEditor,
	className,
	testId,
}: {
	options: Omit<UseEditorOptions, "extensions">;
	placeholder: () => string;
	onEditor: (editor: Editor | null) => void;
	className: string;
	testId: string;
}) {
	const editor = useEditor({
		...options,
		extensions: composerExtensions({
			chipView: ReactNodeViewRenderer(ChipView, { as: "span" }),
			placeholder,
		}),
	});
	useEffect(() => {
		onEditor(editor);
		return () => onEditor(null);
	}, [editor, onEditor]);
	return (
		<EditorContent editor={editor} className={className} data-testid={testId} />
	);
}
