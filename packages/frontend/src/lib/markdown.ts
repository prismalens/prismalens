// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Markdown in and out of the clipboard (#1101): pasted HTML becomes markdown, a copied
 * message carries its markdown and its rendered HTML, and a transcript selection
 * copies as clean markdown. One parser (micromark with GFM) for every direction.
 */
import type { Element, Nodes as HastNodes, Root as HastRoot } from "hast";
import { fromDom } from "hast-util-from-dom";
import { toHtml } from "hast-util-to-html";
import { toMdast } from "hast-util-to-mdast";
import { toText } from "hast-util-to-text";
import type { Root as MdastRoot } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { toHast } from "mdast-util-to-hast";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";

/** The message's markdown as a syntax tree, with each node's source offsets. */
export function parseMarkdown(md: string): MdastRoot {
	return fromMarkdown(md, {
		extensions: [gfm()],
		mdastExtensions: [gfmFromMarkdown()],
	});
}

function stringify(tree: MdastRoot): string {
	return toMarkdown(tree, {
		extensions: [gfmToMarkdown()],
		bullet: "-",
		fences: true,
		rule: "-",
		emphasis: "_",
	}).trim();
}

const htmlTree = (md: string): HastNodes => toHast(parseMarkdown(md));

/** The rendered message as HTML, for a rich paste target. */
export function markdownToHtml(md: string): string {
	return toHtml(htmlTree(md));
}

/** The rendered message's words, with no markdown marks. */
export function markdownToText(md: string): string {
	return toText(htmlTree(md) as HastRoot).trim();
}

/** Controls and labels the transcript draws inside its prose; never part of a copy. */
const CHROME = "button, [data-copy-skip], [aria-hidden='true'], svg";

/** A DOM fragment as markdown: a transcript selection, or a pasted page. */
export function fragmentToMarkdown(node: Node): string {
	const holder = document.createElement("div");
	holder.append(node.cloneNode(true));
	for (const el of Array.from(holder.querySelectorAll(CHROME))) el.remove();
	const tree = fromDom(holder) as Element;
	return stringify(
		toMdast({ type: "root", children: tree.children }) as MdastRoot,
	);
}

/** True when the HTML is an editor's styled code, not a document. */
function codeLike(doc: Document): boolean {
	if (doc.body.querySelector("p, li, h1, h2, h3, h4, h5, h6, table, pre"))
		return false;
	const first = doc.body.firstElementChild as HTMLElement | null;
	const style = `${first?.getAttribute("style") ?? ""} ${doc.body.getAttribute("style") ?? ""}`;
	return /white-space:\s*pre|monospace|consolas|menlo|courier|\bmono\b/i.test(
		style,
	);
}

/** A fenced block for code: the fence grows past any backtick run inside it. */
export function fence(code: string, lang = ""): string {
	const longest = Math.max(
		2,
		...(code.match(/`+/g) ?? []).map((m) => m.length),
	);
	const bar = "`".repeat(longest + 1);
	return `${bar}${lang}\n${code.replace(/\n$/, "")}\n${bar}`;
}

/**
 * Pasted HTML as markdown: a web page keeps its code, lists and links; an editor's
 * styled code (no document structure, a monospace style) becomes one fenced block.
 */
export function htmlToMarkdown(
	html: string,
	plain: string,
	lang?: string,
): string {
	const doc = new DOMParser().parseFromString(html, "text/html");
	if (lang !== undefined || codeLike(doc)) return fence(plain, lang ?? "");
	return fragmentToMarkdown(doc.body);
}

/** Markdown marks a plain paste already carries: keep it as it is. */
export function looksLikeMarkdown(text: string): boolean {
	return /(^|\n)(```|~~~|#{1,6} |\s*[-*+] |\s*\d+[.)] |> )|`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)/.test(
		text,
	);
}

/**
 * A copy inside `[data-copy-markdown]` writes the selection as markdown, and its HTML
 * for a rich target (#1101). A selection inside one code block copies as it reads.
 */
export function copySelectionAsMarkdown(e: ClipboardEvent): void {
	const sel = document.getSelection();
	if (!sel?.rangeCount || sel.isCollapsed || !e.clipboardData) return;
	const range = sel.getRangeAt(0);
	const at = range.commonAncestorContainer;
	const el = at instanceof Element ? at : at.parentElement;
	if (
		!el?.closest("[data-copy-markdown]") ||
		el.closest("pre, code, [contenteditable]")
	)
		return;
	const fragment = range.cloneContents();
	const md = fragmentToMarkdown(fragment);
	if (!md) return;
	const holder = document.createElement("div");
	holder.append(fragment);
	e.clipboardData.setData("text/plain", md);
	e.clipboardData.setData("text/html", holder.innerHTML);
	e.preventDefault();
}

const unescaped = (md: string) =>
	md
		.replace(/\\([!-/:-@[-`{-~])/g, "$1")
		.replace(/\s+/g, " ")
		.trim();

/**
 * What a paste puts in the composer (#1101): markdown stays markdown; HTML becomes
 * markdown when that keeps structure the plain text lacks; an editor's multi-line code
 * (its `vscode-editor-data`, or styled monospace HTML) becomes a fenced block.
 */
export function pastedMarkdown(
	plain: string,
	html: string,
	editorData: string,
): string {
	if (editorData) {
		if (!plain.includes("\n")) return plain;
		let mode = "";
		try {
			mode = String(JSON.parse(editorData)?.mode ?? "");
		} catch {}
		return fence(plain, mode === "plaintext" ? "" : mode);
	}
	if (!html || looksLikeMarkdown(plain)) return plain;
	const md = htmlToMarkdown(html, plain);
	if (md.startsWith("```") && !plain.includes("\n")) return plain;
	return unescaped(md) === unescaped(plain) || !md ? plain : md;
}
