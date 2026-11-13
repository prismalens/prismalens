// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type ChipAttrs,
	ChipAttrsSchema,
	chipText,
} from "@prismalens/contracts";
import { Extension, Node, type NodeViewRenderer } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { MarkdownLive } from "./markdown";

/** Marks a transaction as its own undo step: a pick, a chip delete, a chip revert. */
export const DISCRETE = "plDiscrete";

const CHIP_KEYS = [
	"chip",
	"ref",
	"url",
	"tone",
	"name",
	"source",
	"group",
	"inputHint",
	"quote",
	"cut",
	"key",
	"id",
	"type",
	"size",
	"pasted",
	"refusal",
] as const;

/** The attributes a chip node carries, read back into the contract's shape. */
export function chipAttrs(attrs: Record<string, unknown>): ChipAttrs | null {
	const parsed = ChipAttrsSchema.safeParse(
		Object.fromEntries(
			Object.entries(attrs).filter(([, v]) => v !== null && v !== undefined),
		),
	);
	return parsed.success ? parsed.data : null;
}

/**
 * An inline chip (#1101 category 7): an atom that moves, selects and deletes as one
 * unit. Copy writes its attributes into the HTML so a paste into this box restores
 * it, and its readable text for any other target.
 */
export const Chip = (view: NodeViewRenderer) =>
	Node.create({
		name: "chip",
		group: "inline",
		inline: true,
		atom: true,
		selectable: true,
		draggable: true,
		addAttributes() {
			return Object.fromEntries(
				CHIP_KEYS.map((k) => [k, { default: null, rendered: false }]),
			);
		},
		parseHTML() {
			return [
				{
					tag: "span[data-chip]",
					getAttrs: (el) => {
						try {
							const a = chipAttrs(
								JSON.parse((el as HTMLElement).dataset.chip ?? "null"),
							);
							return a ?? false;
						} catch {
							return false;
						}
					},
				},
			];
		},
		renderHTML({ node }) {
			const a = chipAttrs(node.attrs);
			return ["span", { "data-chip": JSON.stringify(a) }, a ? chipText(a) : ""];
		},
		renderText({ node }) {
			const a = chipAttrs(node.attrs);
			return a ? chipText(a) : "";
		},
		addNodeView() {
			return view;
		},
	});

type Kind = "insert" | "delete" | "discrete";
const lastKind = new WeakMap<object, Kind>();

function kindOf(tr: Transaction): Kind {
	const ui = tr.getMeta("uiEvent");
	if (ui === "paste" || ui === "cut" || ui === "drop" || tr.getMeta(DISCRETE))
		return "discrete";
	return tr.doc.content.size >= tr.before.content.size ? "insert" : "delete";
}

/**
 * Undo steps (#1101 category 7 row 5): a run of typing is one step; a paste, cut,
 * drop, pick or chip delete is its own, and so is the change after it. A switch
 * between typing and deleting also starts a step.
 */
export const UndoGroups = Extension.create({
	name: "undoGroups",
	dispatchTransaction({ transaction: tr, next }) {
		if (!tr.docChanged || tr.getMeta("addToHistory") === false) return next(tr);
		const kind = kindOf(tr);
		const last = lastKind.get(this.editor);
		if (kind === "discrete" || last === "discrete" || (last && last !== kind))
			closeHistory(tr);
		lastKind.set(this.editor, kind);
		next(tr);
	},
});

const ghostKey = new PluginKey("commandGhost");

/** The picked command's argument hint, as ghost text after the chip (#1101 category 6 item 3). */
const CommandGhost = Extension.create({
	name: "commandGhost",
	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: ghostKey,
				props: {
					decorations(state) {
						const doc = state.doc;
						if (doc.childCount !== 1) return null;
						const p = doc.child(0);
						const first = p.firstChild;
						if (first?.type.name !== "chip") return null;
						const a = chipAttrs(first.attrs);
						if (a?.chip !== "command" || !a.inputHint) return null;
						const rest = p.textContent;
						if (p.childCount > 2 || rest.trim()) return null;
						const at = 1 + p.content.size;
						return DecorationSet.create(doc, [
							Decoration.widget(
								at,
								() => {
									const s = document.createElement("span");
									s.className = "composer-ghost";
									s.dataset.testid = "composer-ghost";
									s.textContent = `${rest ? "" : " "}${a.inputHint}`;
									return s;
								},
								{ side: 1, ignoreSelection: true },
							),
						]);
					},
				},
			}),
		];
	},
});

/** The editor's whole schema and behaviour: plain paragraphs, chips, grouped undo, live markdown. */
export function composerExtensions(opts: {
	chipView: NodeViewRenderer;
	placeholder: () => string;
}) {
	return [
		Document,
		Paragraph,
		Text,
		HardBreak,
		UndoRedo.configure({ newGroupDelay: 1000 }),
		UndoGroups,
		Placeholder.configure({ placeholder: opts.placeholder }),
		CommandGhost,
		Chip(opts.chipView),
		MarkdownLive,
	];
}
