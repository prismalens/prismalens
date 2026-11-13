// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Live markdown in the composer (#1101). The document stays plain text, one paragraph
 * per line, so what is sent is exactly what was typed; styling is decorations over a
 * parse of that text. A chip reads as one object character, a paragraph break as `\n`.
 */
import { Extension } from "@tiptap/core";
import { Fragment, type Node as PMNode, Slice } from "@tiptap/pm/model";
import {
	type EditorState,
	Plugin,
	PluginKey,
	TextSelection,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Nodes, Parents } from "mdast";
import { parseMarkdown } from "@/lib/markdown";

const OBJECT = "￼";

/** Above this the box skips styling: a paste this long folds into a chip anyway. */
const MAX_STYLED = 20_000;

interface Line {
	/** Offset of the line in the joined text. */
	off: number;
	/** Document position of the line's first character. */
	pos: number;
	/** Position of the paragraph node itself. */
	node: number;
	len: number;
}

/**
 * The document as one string, with where each line sits in the document. A paragraph
 * and a hard break both end a line; a hard break holds a position, a paragraph end two.
 */
export function docLines(doc: PMNode): { text: string; lines: Line[] } {
	const lines: Line[] = [];
	let text = "";
	doc.forEach((p, at) => {
		if (lines.length) text += "\n";
		let line: Line = { off: text.length, pos: at + 1, node: at, len: 0 };
		p.forEach((n, offset) => {
			if (n.type.name === "hardBreak") {
				lines.push(line);
				text += "\n";
				line = { off: text.length, pos: at + 2 + offset, node: at, len: 0 };
				return;
			}
			const t = n.isText ? (n.text ?? "") : OBJECT;
			text += t;
			line.len += t.length;
		});
		lines.push(line);
	});
	return { text, lines };
}

function lineAt(lines: Line[], off: number): Line {
	let lo = 0;
	let hi = lines.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if ((lines[mid] as Line).off <= off) lo = mid;
		else hi = mid - 1;
	}
	return lines[lo] as Line;
}

const posOf = (lines: Line[], off: number) => {
	const l = lineAt(lines, off);
	return l.pos + Math.min(off - l.off, l.len);
};

const INLINE: Partial<Record<Nodes["type"], string>> = {
	strong: "md-strong",
	emphasis: "md-em",
	delete: "md-del",
	link: "md-link",
	inlineCode: "md-code",
};

/** The decorations for one parse of the document's text. */
export function markdownDecorations(doc: PMNode): DecorationSet {
	const { text, lines } = docLines(doc);
	if (!text.trim() || text.length > MAX_STYLED) return DecorationSet.empty;
	const out: Decoration[] = [];
	const span = (from: number, to: number, cls: string) => {
		if (to <= from) return;
		// A span crossing lines is cut per line: a paragraph boundary has no position.
		for (const l of lines) {
			const a = Math.max(from, l.off);
			const b = Math.min(to, l.off + l.len);
			if (b > a)
				out.push(
					Decoration.inline(posOf(lines, a), posOf(lines, b), { class: cls }),
				);
		}
	};
	const within = (from: number, to: number) =>
		lines.filter((l) => l.off + l.len >= from && l.off <= to);
	const block = (from: number, to: number, cls: string) => {
		const seen = new Set<number>();
		for (const l of within(from, to)) {
			const node = doc.nodeAt(l.node);
			if (!node || seen.has(l.node)) continue;
			seen.add(l.node);
			out.push(Decoration.node(l.node, l.node + node.nodeSize, { class: cls }));
		}
	};
	const walk = (node: Nodes) => {
		const s = node.position?.start.offset;
		const e = node.position?.end.offset;
		if (s === undefined || e === undefined) return;
		const cls = INLINE[node.type];
		if (node.type === "code") {
			const hit = within(s, e);
			const first = hit[0];
			const last = hit[hit.length - 1];
			block(s, e, "md-fence");
			if (first) span(first.off, first.off + first.len, "md-fence-mark");
			if (
				last &&
				last !== first &&
				/\n\s*(```+|~~~+)\s*$/.test(text.slice(s, e))
			)
				span(last.off, last.off + last.len, "md-fence-mark");
			return;
		}
		if (node.type === "inlineCode") {
			const ticks = /^`+/.exec(text.slice(s, e))?.[0].length ?? 1;
			span(s, e, "md-code");
			span(s, s + ticks, "md-mark");
			span(e - ticks, e, "md-mark");
			return;
		}
		if (node.type === "heading") block(s, e, "md-heading");
		if (node.type === "blockquote") block(s, e, "md-quote");
		if (node.type === "listItem") {
			const marker = /^\s*([-*+]|\d+[.)])(\s\[[ xX]\])?/.exec(text.slice(s, e));
			if (marker) span(s, s + marker[0].length, "md-list-mark");
		}
		if (cls) span(s, e, cls);
		const kids = "children" in node ? (node as Parents).children : [];
		if (cls && kids.length) {
			const first = kids[0]?.position?.start.offset ?? e;
			const last = kids[kids.length - 1]?.position?.end.offset ?? s;
			span(s, first, "md-mark");
			span(last, e, "md-mark");
		}
		if (node.type === "heading") {
			const first = kids[0]?.position?.start.offset ?? e;
			span(s, first, "md-mark");
		}
		for (const k of kids) walk(k);
	};
	walk(parseMarkdown(text));
	return DecorationSet.create(doc, out);
}

const key = new PluginKey<DecorationSet>("markdownLive");

/** The caret's line is inside an open or unclosed fenced block (not on its closing line). */
export function inFence(
	state: EditorState,
): { closed: boolean; line: string; atEnd: boolean } | null {
	const { $from } = state.selection;
	if ($from.depth < 1) return null;
	const { text, lines } = docLines(state.doc);
	const index = lines.findLastIndex((l) => l.pos <= $from.pos);
	if (index < 0) return null;
	const here = lines[index] as Line;
	const line = text.slice(here.off, here.off + here.len);
	const atEnd = $from.pos === here.pos + here.len;
	let fence: string | null = null;
	let openAt = -1;
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i] as Line;
		const t = text.slice(l.off, l.off + l.len);
		const m = /^\s{0,3}(```+|~~~+)/.exec(t);
		if (!m) continue;
		const bar = m[1] as string;
		if (fence === null) {
			fence = bar;
			openAt = i;
		} else if (
			bar[0] === fence[0] &&
			bar.length >= fence.length &&
			!t.trim().slice(bar.length).trim()
		) {
			if (index >= openAt && index < i) return { closed: true, line, atEnd };
			fence = null;
		}
		if (i >= index && fence === null) break;
	}
	return fence !== null && index >= openAt
		? { closed: false, line, atEnd }
		: null;
}

/** A new line, as Shift+Enter makes it: a paragraph split. */
function newLine(view: EditorView, extra?: string) {
	const tr = view.state.tr.split(view.state.selection.from);
	if (extra !== undefined) {
		const at = tr.selection.from;
		tr.split(at).insertText(extra, at + 2);
		tr.setSelection(TextSelection.create(tr.doc, at));
	}
	view.dispatch(tr.scrollIntoView());
}

/**
 * Enter inside a fenced block makes a new line instead of sending; on a fence's
 * opening line it also closes the block below, with the caret between. Mod+Enter sends.
 */
export function fenceEnter(view: EditorView, e: KeyboardEvent): boolean {
	if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey)
		return false;
	const f = inFence(view.state);
	if (!f) return false;
	const opening = /^\s{0,3}(```+|~~~+)[\w+#.-]*\s*$/.exec(f.line);
	if (opening && f.atEnd && !f.closed) newLine(view, opening[1] as string);
	else newLine(view);
	return true;
}

/** The live styling: decorations recomputed on each document change. */
export const MarkdownLive = Extension.create({
	name: "markdownLive",
	addProseMirrorPlugins() {
		return [
			new Plugin<DecorationSet>({
				key,
				state: {
					init: (_, state) => markdownDecorations(state.doc),
					apply: (tr, old) =>
						tr.docChanged ? markdownDecorations(tr.doc) : old,
				},
				props: {
					decorations: (state) => key.getState(state) ?? null,
				},
			}),
		];
	},
});

/** Text into the box line for line, blank lines kept, as one undo step. */
export function pasteLines(view: EditorView, text: string): void {
	const { schema } = view.state;
	const para = schema.nodes.paragraph;
	if (!para) return;
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	const nodes = lines.map((l) =>
		para.create(null, l ? schema.text(l) : undefined),
	);
	const slice = new Slice(Fragment.from(nodes), 1, 1);
	const tr = view.state.tr.replaceSelection(slice).scrollIntoView();
	view.dispatch(tr.setMeta("uiEvent", "paste"));
}
