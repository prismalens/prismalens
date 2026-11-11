// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ChipAttrs } from "@prismalens/contracts";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
	type EditorState,
	NodeSelection,
	TextSelection,
} from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { type ActiveTrigger, activeTrigger } from "../trigger";
import { chipAttrs, DISCRETE } from "./extensions";

/** A chip reads as one space to the trigger rules, so `@` right after a chip opens the menu. */
const CHIP_CHAR = " ";

/** The trigger at the caret, with its range in document positions. */
export interface DocTrigger extends ActiveTrigger {
	from: number;
	to: number;
}

export function triggerAt(state: EditorState): DocTrigger | null {
	const { selection } = state;
	if (!selection.empty) return null;
	const $at = selection.$from;
	if (!$at.parent.isTextblock) return null;
	const before = $at.parent.textBetween(
		0,
		$at.parentOffset,
		undefined,
		CHIP_CHAR,
	);
	const t = activeTrigger(before, before.length);
	if (!t) return null;
	const base = $at.start();
	return { ...t, from: base + t.start, to: base + t.end };
}

export const chipNode = (state: EditorState, attrs: ChipAttrs) =>
	state.schema.nodes.chip?.create(attrs) as PMNode;

/**
 * A menu pick (#1101 category 7 row 3): the typed `@sam` is replaced by the chip in
 * one transaction that starts its own undo step, so undo brings back the text and caret.
 */
export function pickInto(
	view: EditorView,
	t: Pick<DocTrigger, "from" | "to">,
	attrs: ChipAttrs | null,
) {
	const { state } = view;
	const tr = closeHistory(state.tr);
	tr.setMeta(DISCRETE, true);
	if (attrs) {
		const node = chipNode(state, attrs);
		tr.replaceWith(t.from, t.to, [node, state.schema.text(" ")]);
		tr.setSelection(TextSelection.create(tr.doc, t.from + node.nodeSize + 1));
	} else tr.delete(t.from, t.to);
	view.dispatch(tr.scrollIntoView());
}

/** Puts chips at the caret, each followed by a space; one undo step. */
export function insertChips(view: EditorView, list: ChipAttrs[], at?: number) {
	if (!list.length) return;
	const { state } = view;
	const tr = closeHistory(state.tr);
	tr.setMeta(DISCRETE, true);
	let pos = at ?? state.selection.from;
	if (at === undefined && !state.selection.empty) {
		tr.deleteSelection();
		pos = tr.selection.from;
	}
	for (const a of list) {
		const nodes = [chipNode(state, a), state.schema.text(" ")];
		tr.insert(pos, nodes);
		pos += nodes[0].nodeSize + 1;
	}
	tr.setSelection(TextSelection.create(tr.doc, pos));
	view.dispatch(tr.scrollIntoView());
}

/** The chip a NodeSelection holds, with its position. */
export function selectedChip(
	state: EditorState,
): { pos: number; node: PMNode; attrs: ChipAttrs } | null {
	const sel = state.selection;
	if (!(sel instanceof NodeSelection) || sel.node.type.name !== "chip")
		return null;
	const attrs = chipAttrs(sel.node.attrs);
	return attrs ? { pos: sel.from, node: sel.node, attrs } : null;
}

/**
 * Backspace and Delete next to a chip (#1101 category 7 rows 1-2): the first press
 * selects it, the second deletes it as its own undo step; a pasted link's chip turns
 * back into its URL. Returns false when the key is not about a chip.
 */
export function chipDeleteKey(
	view: EditorView,
	key: "Backspace" | "Delete",
): boolean {
	const { state } = view;
	const chosen = selectedChip(state);
	if (chosen) {
		const tr = closeHistory(state.tr);
		tr.setMeta(DISCRETE, true);
		const { pos, node, attrs } = chosen;
		if (attrs.chip === "ref" && attrs.url) {
			tr.replaceWith(pos, pos + node.nodeSize, state.schema.text(attrs.url));
			tr.setSelection(TextSelection.create(tr.doc, pos + attrs.url.length));
		} else tr.delete(pos, pos + node.nodeSize);
		view.dispatch(tr.scrollIntoView());
		return true;
	}
	if (!state.selection.empty) return false;
	const $at = state.selection.$from;
	const next = key === "Backspace" ? $at.nodeBefore : $at.nodeAfter;
	if (next?.type.name !== "chip") return false;
	const pos = key === "Backspace" ? $at.pos - next.nodeSize : $at.pos;
	view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
	return true;
}

/** Replaces one chip, found by a predicate, with plain text or other content; one undo step. */
export function replaceChip(
	view: EditorView,
	match: (a: ChipAttrs) => boolean,
	make: (state: EditorState) => PMNode | PMNode[] | null,
	history = true,
): boolean {
	const { state } = view;
	let found: { pos: number; size: number } | null = null;
	state.doc.descendants((node, pos) => {
		if (found) return false;
		if (node.type.name !== "chip") return true;
		const a = chipAttrs(node.attrs);
		if (a && match(a)) found = { pos, size: node.nodeSize };
		return false;
	});
	if (!found) return false;
	const { pos, size } = found as { pos: number; size: number };
	const tr = state.tr;
	if (history) closeHistory(tr).setMeta(DISCRETE, true);
	else tr.setMeta("addToHistory", false);
	const made = make(state);
	if (made) tr.replaceWith(pos, pos + size, made);
	else tr.delete(pos, pos + size);
	view.dispatch(tr);
	return true;
}

/** The first occurrence of `text` in the document, as a range. */
export function findText(
	doc: PMNode,
	text: string,
): { from: number; to: number } | null {
	let hit: { from: number; to: number } | null = null;
	doc.descendants((node, pos) => {
		if (hit) return false;
		if (!node.isText || !node.text) return true;
		const i = node.text.indexOf(text);
		if (i >= 0) hit = { from: pos + i, to: pos + i + text.length };
		return false;
	});
	return hit;
}

/**
 * Home and End (#1101 category 7 row 6): to the start or end of the logical line, a
 * paragraph or the span between line breaks. Native caret movement stops at a chip
 * that leads a line, so the editor moves the caret itself; Shift extends.
 */
export function lineEdge(
	view: EditorView,
	edge: "start" | "end",
	extend: boolean,
): boolean {
	const { state } = view;
	const sel = state.selection;
	const $head = state.doc.resolve(sel.head);
	const block = $head.parent;
	if (!block.isTextblock) return false;
	const base = $head.start();
	let from = 0;
	let to = block.content.size;
	block.forEach((child, offset) => {
		if (child.type.name !== "hardBreak") return;
		if (offset < $head.parentOffset) from = offset + 1;
		else if (to === block.content.size) to = offset;
	});
	const target = base + (edge === "start" ? from : to);
	const anchor = extend ? sel.anchor : target;
	view.dispatch(
		state.tr
			.setSelection(TextSelection.create(state.doc, anchor, target))
			.scrollIntoView(),
	);
	return true;
}
