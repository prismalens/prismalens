// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ChipAttrs } from "@prismalens/contracts";
import { type Content, Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	chipDeleteKey,
	chipNode,
	insertChips,
	lineEdge,
	patchFileChip,
	pickInto,
	triggerAt,
} from "./commands";
import { chipAttrs, composerExtensions } from "./extensions";

function createEditor(content?: Content) {
	const el = document.createElement("div");
	document.body.appendChild(el);
	const editor = new Editor({
		element: el,
		extensions: composerExtensions({
			chipView: () => ({ dom: document.createElement("span") }),
			placeholder: () => "",
		}),
		content,
	});
	return editor;
}

describe("composer editor commands", () => {
	let editor: Editor;

	beforeEach(() => {
		editor = createEditor();
	});

	afterEach(() => {
		editor.destroy();
		document.body.innerHTML = "";
	});

	describe("triggerAt", () => {
		it("triggerAt: @sam after a space finds the trigger, and ignores @sam without space", () => {
			editor.commands.setContent("<p>hi @sam</p>");
			editor.commands.setTextSelection(8);
			const t = triggerAt(editor.state);
			expect(t).not.toBeNull();
			expect(t?.trigger).toBe("@");
			expect(t?.query).toBe("sam");
			expect(t?.from).toBe(4);
			expect(t?.to).toBe(8);

			editor.commands.setContent("<p>hi@sam</p>");
			editor.commands.setTextSelection(7);
			expect(triggerAt(editor.state)).toBeNull();
		});

		it("triggerAt: / only at a line start", () => {
			editor.commands.setContent("<p>/help</p>");
			editor.commands.setTextSelection(6);
			const atStart = triggerAt(editor.state);
			expect(atStart).not.toBeNull();
			expect(atStart?.trigger).toBe("/");
			expect(atStart?.query).toBe("help");
			expect(atStart?.from).toBe(1);
			expect(atStart?.to).toBe(6);

			editor.commands.setContent("<p>say /help</p>");
			editor.commands.setTextSelection(10);
			expect(triggerAt(editor.state)).toBeNull();
		});

		it("triggerAt: # after a chip", () => {
			const attrs: ChipAttrs = {
				chip: "ref",
				ref: { kind: "issue", id: "42", label: "42" },
				tone: "issue",
			};
			const chip = chipNode(editor.state, attrs);
			const tr = editor.state.tr
				.insert(1, chip)
				.insertText("#inc-1", 2);
			tr.setSelection(TextSelection.create(tr.doc, 8));
			editor.view.dispatch(tr);

			const t = triggerAt(editor.state);
			expect(t).not.toBeNull();
			expect(t?.trigger).toBe("#");
			expect(t?.query).toBe("inc-1");
			expect(t?.from).toBe(2);
			expect(t?.to).toBe(8);
		});

		it("triggerAt: a space ends the query (null)", () => {
			editor.commands.setContent("<p>hi @sam</p>");
			editor.commands.setTextSelection(8);
			editor.commands.insertContent(" ");
			expect(editor.state.selection.from).toBe(9);
			expect(triggerAt(editor.state)).toBeNull();
		});
	});

	describe("pickInto", () => {
		it("pickInto: replaces the @sam range with the chip and a space in one step; undo restores hi @sam with the caret at the end of @sam; redo re-adds the chip", () => {
			editor.commands.setContent("<p>hi @sam</p>");
			editor.commands.setTextSelection(8);
			const t = triggerAt(editor.state);
			expect(t).not.toBeNull();
			const attrs: ChipAttrs = {
				chip: "ref",
				ref: { kind: "service", id: "codex", label: "Codex" },
				tone: "agent",
			};

			pickInto(editor.view, t!, attrs);
			expect(editor.getText()).toBe("hi @Codex ");
			expect(editor.state.doc.nodeAt(4)?.type.name).toBe("chip");
			expect(editor.state.doc.nodeAt(4)?.attrs.ref.label).toBe("Codex");
			expect(editor.state.selection.from).toBe(6);

			editor.commands.undo();
			expect(editor.getText()).toBe("hi @sam");
			expect(editor.state.selection.from).toBe(8);
			expect(editor.state.selection.to).toBe(8);

			editor.commands.redo();
			expect(editor.getText()).toBe("hi @Codex ");
			expect(editor.state.doc.nodeAt(4)?.type.name).toBe("chip");
			expect(editor.state.doc.nodeAt(4)?.attrs.ref.label).toBe("Codex");
			expect(editor.state.selection.from).toBe(6);
		});
	});

	describe("chipDeleteKey", () => {
		it("chipDeleteKey: Backspace after a chip selects it (NodeSelection) then deletes it; undo restores it", () => {
			const attrs: ChipAttrs = {
				chip: "ref",
				ref: { kind: "issue", id: "1", label: "1" },
				tone: "issue",
			};
			const chip = chipNode(editor.state, attrs);
			const tr = editor.state.tr.insert(1, chip);
			tr.setSelection(TextSelection.create(tr.doc, 2));
			editor.view.dispatch(tr);
			expect(editor.getText()).toBe("#1");

			const handled1 = chipDeleteKey(editor.view, "Backspace");
			expect(handled1).toBe(true);
			expect(editor.state.selection instanceof NodeSelection).toBe(true);
			expect((editor.state.selection as NodeSelection).from).toBe(1);

			const handled2 = chipDeleteKey(editor.view, "Backspace");
			expect(handled2).toBe(true);
			expect(editor.getText()).toBe("");

			editor.commands.undo();
			expect(editor.getText()).toBe("#1");
			expect(editor.state.doc.nodeAt(1)?.type.name).toBe("chip");
			expect(editor.state.doc.nodeAt(1)?.attrs.ref.label).toBe("1");
		});

		it("chipDeleteKey: Delete before a chip does the same forward; undo restores it", () => {
			const attrs: ChipAttrs = {
				chip: "ref",
				ref: { kind: "issue", id: "1", label: "1" },
				tone: "issue",
			};
			const chip = chipNode(editor.state, attrs);
			const tr = editor.state.tr.insert(1, chip);
			tr.setSelection(TextSelection.create(tr.doc, 1));
			editor.view.dispatch(tr);
			expect(editor.getText()).toBe("#1");

			const handled1 = chipDeleteKey(editor.view, "Delete");
			expect(handled1).toBe(true);
			expect(editor.state.selection instanceof NodeSelection).toBe(true);
			expect((editor.state.selection as NodeSelection).from).toBe(1);

			const handled2 = chipDeleteKey(editor.view, "Delete");
			expect(handled2).toBe(true);
			expect(editor.getText()).toBe("");

			editor.commands.undo();
			expect(editor.getText()).toBe("#1");
			expect(editor.state.doc.nodeAt(1)?.type.name).toBe("chip");
			expect(editor.state.doc.nodeAt(1)?.attrs.ref.label).toBe("1");
		});

		it("chipDeleteKey: a ref chip with url turns back into the URL text; undo restores the chip in place", () => {
			const attrs: ChipAttrs = {
				chip: "ref",
				ref: { kind: "file", id: "link-1", label: "example.com" },
				url: "https://example.com",
				tone: "link",
			};
			const chip = chipNode(editor.state, attrs);
			const tr = editor.state.tr.insert(1, chip);
			tr.setSelection(NodeSelection.create(tr.doc, 1));
			editor.view.dispatch(tr);

			const handled = chipDeleteKey(editor.view, "Backspace");
			expect(handled).toBe(true);
			expect(editor.getText()).toBe("https://example.com");
			expect(editor.state.doc.nodeAt(1)?.isText).toBe(true);

			editor.commands.undo();
			expect(editor.getText()).toBe("https://example.com");
			expect(editor.state.doc.nodeAt(1)?.type.name).toBe("chip");
			expect(editor.state.doc.nodeAt(1)?.attrs.url).toBe("https://example.com");
		});
	});

	describe("lineEdge", () => {
		it("lineEdge: Home/End go to the paragraph ends and to the hardBreak boundaries; with extend=true the anchor stays", () => {
			editor.commands.setContent("<p>hello<br>world</p>");
			// hello (pos 1..6), br (pos 6..7), world (pos 7..12)
			editor.commands.setTextSelection(9); // "wo|rld"

			// Home without extend -> moves to start of line 2 (pos 7)
			const atStart = lineEdge(editor.view, "start", false);
			expect(atStart).toBe(true);
			expect(editor.state.selection.from).toBe(7);
			expect(editor.state.selection.to).toBe(7);

			// End without extend -> moves to end of paragraph (pos 12)
			const atEnd = lineEdge(editor.view, "end", false);
			expect(atEnd).toBe(true);
			expect(editor.state.selection.from).toBe(12);
			expect(editor.state.selection.to).toBe(12);

			// Move to first line (pos 3, "he|llo")
			editor.commands.setTextSelection(3);

			// End on first line -> moves to before hardBreak (pos 6)
			const atFirstEnd = lineEdge(editor.view, "end", false);
			expect(atFirstEnd).toBe(true);
			expect(editor.state.selection.from).toBe(6);
			expect(editor.state.selection.to).toBe(6);

			// Home on first line -> moves to start of paragraph (pos 1)
			const atFirstStart = lineEdge(editor.view, "start", false);
			expect(atFirstStart).toBe(true);
			expect(editor.state.selection.from).toBe(1);
			expect(editor.state.selection.to).toBe(1);

			// With extend=true: anchor stays, head moves
			editor.commands.setTextSelection(9);
			const extendStart = lineEdge(editor.view, "start", true);
			expect(extendStart).toBe(true);
			expect(editor.state.selection.anchor).toBe(9);
			expect(editor.state.selection.head).toBe(7);

			const extendEnd = lineEdge(editor.view, "end", true);
			expect(extendEnd).toBe(true);
			expect(editor.state.selection.anchor).toBe(9);
			expect(editor.state.selection.head).toBe(12);
		});
	});

	describe("UndoGroups", () => {
		it("UndoGroups: a typing run is one undo step; a pick, a chip delete and a transaction with meta uiEvent: 'paste' are each their own step, and so is the typing right after them", () => {
			// 1. Typing run is one undo step
			editor.commands.insertContent("hello");
			editor.commands.insertContent(" world");
			expect(editor.getText()).toBe("hello world");
			editor.commands.undo();
			expect(editor.getText()).toBe("");
			editor.commands.redo();
			expect(editor.getText()).toBe("hello world");

			// 2. uiEvent: "paste" is its own step and typing after it is its own step
			const trPaste = editor.state.tr.insertText(" pasted");
			trPaste.setMeta("uiEvent", "paste");
			editor.view.dispatch(trPaste);
			expect(editor.getText()).toBe("hello world pasted");

			editor.commands.insertContent(" more");
			expect(editor.getText()).toBe("hello world pasted more");

			editor.commands.undo();
			expect(editor.getText()).toBe("hello world pasted");

			editor.commands.undo();
			expect(editor.getText()).toBe("hello world");

			// 3. Pick is its own step and typing after it is its own step
			editor.commands.insertContent(" @sam");
			expect(editor.getText()).toBe("hello world @sam");
			const t = triggerAt(editor.state);
			expect(t).not.toBeNull();
			pickInto(editor.view, t!, {
				chip: "ref",
				ref: { kind: "service", id: "sam", label: "@sam" },
				tone: "user",
			});
			expect(editor.getText()).toBe("hello world @sam ");

			editor.commands.insertContent("after-pick");
			expect(editor.getText()).toBe("hello world @sam after-pick");

			editor.commands.undo();
			expect(editor.getText()).toBe("hello world @sam ");

			editor.commands.undo();
			expect(editor.getText()).toBe("hello world @sam");

			// 4. Chip delete is its own step and typing after it is its own step
			editor.commands.setContent({
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [{ type: "text", text: "start " }],
					},
				],
			});
			editor.commands.setTextSelection(7);
			insertChips(editor.view, [
				{
					chip: "ref",
					ref: { kind: "file", id: "f1", label: "@f.ts" },
					tone: "file",
				},
			]);
			expect(editor.getText()).toBe("start @f.ts ");

			// Caret right after chip (pos 8)
			editor.commands.setTextSelection(8);
			chipDeleteKey(editor.view, "Backspace"); // selects
			chipDeleteKey(editor.view, "Backspace"); // deletes
			expect(editor.getText()).toBe("start  ");

			editor.commands.insertContent("after-delete");
			expect(editor.getText()).toBe("start after-delete ");

			editor.commands.undo();
			expect(editor.getText()).toBe("start  ");

			editor.commands.undo();
			expect(editor.getText()).toBe("start @f.ts ");
		});
	});

	describe("Clipboard", () => {
		it("Clipboard: editor.view.serializeForClipboard(selectAll content) gives text x @f.ts  and HTML with data-chip; inserting that HTML into a second editor yields a chip node with the same attrs", () => {
			const chipAttrs: ChipAttrs = {
				chip: "ref",
				ref: { kind: "file", id: "file:1", label: "@f.ts" },
				tone: "file",
			};
			editor.commands.setContent({
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{ type: "text", text: "x " },
							{ type: "chip", attrs: chipAttrs },
							{ type: "text", text: " " },
						],
					},
				],
			});
			expect(editor.getText()).toBe("x @f.ts ");

			editor.commands.selectAll();
			const slice = editor.state.selection.content();
			const clipboard = editor.view.serializeForClipboard(slice);

			expect(clipboard.text).toBe("x @f.ts ");
			const html = clipboard.dom.innerHTML;
			expect(html).toContain("data-chip");
			expect(html).toContain("@f.ts");

			const editor2 = createEditor();
			editor2.commands.insertContent(html);
			expect(editor2.getText()).toBe("x @f.ts ");

			let restoredChip: ChipAttrs | null = null;
			editor2.state.doc.descendants((node) => {
				if (node.type.name === "chip") {
					restoredChip = node.attrs as ChipAttrs;
					return false;
				}
				return true;
			});
			expect(restoredChip).toEqual(
				expect.objectContaining({
					chip: "ref",
					ref: { kind: "file", id: "file:1", label: "@f.ts" },
					tone: "file",
				}),
			);
			editor2.destroy();
		});
	});

	describe("CommandGhost", () => {
		it("CommandGhost: a doc holding only a command chip with inputHint renders a .composer-ghost widget with that hint; typing text after it removes the widget", () => {
			const cmdAttrs: ChipAttrs = {
				chip: "command",
				name: "ask",
				source: "app",
				group: "General",
				inputHint: "<question>",
			};
			editor.commands.setContent({
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{
								type: "chip",
								attrs: cmdAttrs,
							},
						],
					},
				],
			});

			const ghost = editor.view.dom.querySelector(".composer-ghost");
			expect(ghost).not.toBeNull();
			expect(ghost?.textContent).toBe(" <question>");
			expect(ghost?.getAttribute("data-testid")).toBe("composer-ghost");

			editor.commands.insertContent("what went wrong?");
			const ghostAfter = editor.view.dom.querySelector(".composer-ghost");
			expect(ghostAfter).toBeNull();
		});
	});

	describe("patchFileChip", () => {
		it("patchFileChip sets id on the matching chip only, returns false for an unknown key, and an undo right after does not remove the id", () => {
			const chip1Attrs: ChipAttrs = {
				chip: "file",
				key: "k1",
				name: "file1.txt",
				type: "text/plain",
				size: 100,
			};
			const chip2Attrs: ChipAttrs = {
				chip: "file",
				key: "k2",
				name: "file2.txt",
				type: "text/plain",
				size: 200,
			};

			const ed = createEditor({
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{ type: "chip", attrs: chip1Attrs },
							{ type: "text", text: " " },
							{ type: "chip", attrs: chip2Attrs },
							{ type: "text", text: " " },
						],
					},
				],
			});

			const fileId = "11111111-1111-4111-8111-000000000001";
			const unknownId = "99999999-9999-4999-8999-000000000009";

			const unknownHandled = patchFileChip(ed.view, "unknown-key", {
				id: unknownId,
			});
			expect(unknownHandled).toBe(false);

			const handled = patchFileChip(ed.view, "k1", { id: fileId });
			expect(handled).toBe(true);

			const findAttrs = (key: string): ChipAttrs | null => {
				let found: ChipAttrs | null = null;
				ed.state.doc.descendants((node) => {
					if (node.type.name === "chip" && node.attrs.key === key) {
						found = chipAttrs(node.attrs);
						return false;
					}
					return true;
				});
				return found;
			};

			const chip1After = findAttrs("k1");
			expect(chip1After).toEqual({
				chip: "file",
				key: "k1",
				name: "file1.txt",
				type: "text/plain",
				size: 100,
				id: fileId,
			});

			const chip2After = findAttrs("k2");
			expect(chip2After).toEqual({
				chip: "file",
				key: "k2",
				name: "file2.txt",
				type: "text/plain",
				size: 200,
			});

			ed.commands.undo();

			const chip1AfterUndo = findAttrs("k1");
			expect(chip1AfterUndo).toEqual({
				chip: "file",
				key: "k1",
				name: "file1.txt",
				type: "text/plain",
				size: 100,
				id: fileId,
			});

			ed.destroy();
		});
	});
});
