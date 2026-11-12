// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Pure reads of the composer's editor document (#1101): its readable text, what a send
 * carries, the legacy-draft conversion, and the whole-document comparison a conflict uses.
 */
import type {
	ChipAttrs,
	ComposerDoc,
	ComposerInline,
	DraftBody,
	Quote,
	ReferenceRef,
} from "./composer.js";

const HASH_KINDS = new Set<ReferenceRef["kind"]>([
	"pull_request",
	"issue",
	"thread",
	"incident",
]);

/** How a chip reads as plain text: on the clipboard, in a recalled line, in `text`. */
export function chipText(a: ChipAttrs): string {
	switch (a.chip) {
		case "command":
			return `/${a.name}`;
		case "ref": {
			if (a.url) return a.url;
			const label = a.ref.label;
			if (/^[#@/]/.test(label)) return label;
			return `${HASH_KINDS.has(a.ref.kind) ? "#" : "@"}${label}`;
		}
		case "quote":
			return `> ${a.quote.text.split("\n")[0]?.slice(0, 120) ?? ""}`;
		case "file":
			return a.pasted ?? `[${a.name}]`;
	}
}

export const emptyDoc = (): ComposerDoc => ({
	type: "doc",
	content: [{ type: "paragraph" }],
});

const paragraphs = (text: string) =>
	text.split("\n").map((line) => ({
		type: "paragraph" as const,
		...(line ? { content: [{ type: "text" as const, text: line }] } : {}),
	}));

/** A document holding plain text, one paragraph per line. */
export function textDoc(text: string): ComposerDoc {
	return { type: "doc", content: paragraphs(text) };
}

/**
 * A version-1 draft (text beside quote and reference lists) as a document: its chips
 * lead the first line, where the old box showed them above the text.
 */
export function legacyDoc(body: {
	text: string;
	quotes: readonly Quote[];
	references: readonly ReferenceRef[];
}): ComposerDoc {
	const chips: ComposerInline[] = [
		...body.quotes.map((quote) => ({
			type: "chip" as const,
			attrs: { chip: "quote" as const, quote, cut: false },
		})),
		...body.references.map((ref) => ({
			type: "chip" as const,
			attrs: { chip: "ref" as const, ref },
		})),
	];
	const [first, ...rest] = paragraphs(body.text);
	if (!chips.length)
		return { type: "doc", content: [first ?? { type: "paragraph" }, ...rest] };
	const head = [
		...chips,
		...(first?.content
			? [{ type: "text" as const, text: " " }, ...first.content]
			: []),
	];
	return {
		type: "doc",
		content: [{ type: "paragraph", content: head }, ...rest],
	};
}

/** The draft's document: version 2 stores it, a legacy draft converts on read. */
export function draftDoc(
	body: Pick<DraftBody, "doc" | "text" | "quotes" | "references">,
): ComposerDoc {
	return body.doc ?? legacyDoc(body);
}

const chipsOf = (doc: ComposerDoc): ChipAttrs[] =>
	doc.content.flatMap((p) =>
		(p.content ?? []).flatMap((n) => (n.type === "chip" ? [n.attrs] : [])),
	);

/** The document as one string, every chip in its readable form. */
export function docText(doc: ComposerDoc): string {
	return doc.content
		.map((p) =>
			(p.content ?? [])
				.map((n) =>
					n.type === "text"
						? n.text
						: n.type === "chip"
							? chipText(n.attrs)
							: "\n",
				)
				.join(""),
		)
		.join("\n");
}

export interface DocParts {
	/** The message: text with reference chips in place; quotes and files ride beside it. */
	text: string;
	/** A command chip that leads the document. */
	command: Extract<ChipAttrs, { chip: "command" }> | null;
	references: ReferenceRef[];
	quotes: Quote[];
	files: Extract<ChipAttrs, { chip: "file" }>[];
}

/** What a send carries, read off the document. */
export function docParts(doc: ComposerDoc): DocParts {
	let command: DocParts["command"] = null;
	const first = doc.content[0]?.content?.[0];
	if (first?.type === "chip" && first.attrs.chip === "command")
		command = first.attrs;
	const lines = doc.content.map((p) =>
		(p.content ?? [])
			.map((n) => {
				if (n.type === "text") return n.text;
				if (n.type === "hardBreak") return "\n";
				if (command && n === first) return "";
				const a = n.attrs;
				return a.chip === "ref" || a.chip === "command" ? chipText(a) : "";
			})
			.join(""),
	);
	const references: ReferenceRef[] = [];
	const quotes: Quote[] = [];
	const files: DocParts["files"] = [];
	for (const a of chipsOf(doc)) {
		if (
			a.chip === "ref" &&
			!references.some((r) => r.kind === a.ref.kind && r.id === a.ref.id)
		)
			references.push(a.ref);
		if (a.chip === "quote") quotes.push(a.quote);
		if (a.chip === "file") files.push(a);
	}
	return {
		text: lines
			.join("\n")
			.replace(/[ \t]+$/gm, "")
			.trim(),
		command,
		references,
		quotes,
		files,
	};
}

export function isEmptyDoc(doc: ComposerDoc): boolean {
	return doc.content.every((p) =>
		(p.content ?? []).every(
			(n) => n.type === "hardBreak" || (n.type === "text" && !n.text.trim()),
		),
	);
}

/** Drops absent and null attributes, so two editors' JSON for one document compares equal. */
function normal(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normal);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, v]) => v !== null && v !== undefined)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, v]) => [k, normal(v)]),
		);
	return value;
}

/** Whole-document equality: a conflict is real only when the documents differ. */
export function sameDoc(a: ComposerDoc, b: ComposerDoc): boolean {
	return JSON.stringify(normal(a)) === JSON.stringify(normal(b));
}
