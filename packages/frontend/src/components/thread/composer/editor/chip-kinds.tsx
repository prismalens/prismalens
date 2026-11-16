// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ChipAttrs } from "@prismalens/contracts";
import { defineClosed } from "@prismalens/registry";
import {
	AtSign,
	FileText,
	Hash,
	Link2,
	type LucideIcon,
	Quote as QuoteIcon,
	SquareSlash,
} from "lucide-react";

export type ChipKind = ChipAttrs["chip"];
type ChipOf<K extends ChipKind> = Extract<ChipAttrs, { chip: K }>;

/** How one chip kind draws: its words, its test id, its icon, and whether its name is code. */
export interface ChipKindView<K extends ChipKind = ChipKind> {
	label: (a: ChipOf<K>) => string;
	testId: (a: ChipOf<K>) => string;
	/** null: the chip shows its file's own thumbnail instead. */
	icon: (a: ChipOf<K>, preview?: string) => LucideIcon | null;
	mono?: true;
}

const lines = (t: string) => t.split("\n").length;
const HASH = new Set(["pull_request", "issue", "thread", "incident"]);

const CHIP_VIEWS: { [K in ChipKind]: ChipKindView<K> } = {
	command: {
		label: (a) => `/${a.name}`,
		testId: () => "composer-command",
		icon: () => SquareSlash,
		mono: true,
	},
	ref: {
		label: (a) => a.ref.label,
		testId: (a) => (a.url ? "composer-link" : "composer-ref"),
		icon: (a) => (a.url ? Link2 : HASH.has(a.ref.kind) ? Hash : AtSign),
	},
	quote: {
		label: ({ quote: q }) =>
			// A diff line comment reads as where it sits and what it says (#1101 category 16).
			q.source.kind === "diff" && q.comment
				? `${(q.source.path ?? "").split(":").pop()}${q.source.line ? `:${q.source.line}` : ""} · ${q.comment}`
				: (q.text.split("\n")[0]?.slice(0, 80) ?? ""),
		testId: () => "composer-quote",
		icon: () => QuoteIcon,
	},
	file: {
		label: (a) =>
			a.pasted
				? `Pasted text, ${lines(a.pasted)} ${lines(a.pasted) === 1 ? "line" : "lines"}`
				: a.name,
		testId: () => "composer-file",
		icon: (_a, preview) => (preview ? null : FileText),
	},
};

/** The composer's chip kinds (#1101 category 7): a new member of `ChipAttrs` fails typecheck here. */
export const chipKinds = defineClosed(
	"chipKind",
	["command", "ref", "quote", "file"] as const satisfies readonly ChipKind[],
	CHIP_VIEWS,
);

/** The view for `a`'s kind, typed to take `a`. */
export const chipView = (a: ChipAttrs): ChipKindView =>
	chipKinds.get(a.chip) as ChipKindView;
