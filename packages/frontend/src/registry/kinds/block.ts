// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineKind, entry } from "@prismalens/registry";
import type { MarkId } from "@/components/kit/marks";
import { galleryStates, labelled, renderedThroughBlock } from "../guards";
import { fn, plainId, states, text, z } from "./schema";

/** Where a block's text came from: Add to composer quotes it into the open thread's message. */
export type BlockSource =
	/** A file at a path, the lines it shows (a whole file has none). */
	| { kind: "file"; path: string; line?: number; end?: number }
	/** Something the thread said or ran. */
	| {
			kind: "thread";
			item: "transcript" | "report" | "tool_output";
			seq?: number;
	  }
	/** A log that is not the thread's own, named, such as a CI check. */
	| { kind: "log"; name: string };

/** A copyable block: its exact copy text, where it came from, and the marks it shows. */
export interface BlockSpec<D> {
	/** The block kind, e.g. `tool.output`. */
	id: string;
	/** The block's accessible name, e.g. "Tool output". */
	label: string;
	/** The copy control's hint, e.g. "Copy output". */
	copyLabel: string;
	/** Exactly what Copy writes: the block's text, no UI chrome. */
	text: (data: D) => string;
	/** Command kinds only: what Send to terminal stages, or null when this one is not a command. */
	command?: (data: D) => string | null;
	/** Kinds with a source only: Add to composer quotes from it. */
	source?: (data: D) => BlockSource | null;
	/** The metadata marks it shows, from `kit/marks.ts`. */
	marks: readonly MarkId[];
	/** Named states → the gallery ids that draw them, at least `default` and `phone`. */
	states: { readonly default: string; readonly phone: string } & Readonly<
		Record<string, string>
	>;
}

export type BlockDef<D> = BlockSpec<D> & { readonly kind: "block" };

/** `define.block`: `D` is inferred from `text`'s parameter. */
export function defineBlock<D>(spec: BlockSpec<D>): BlockDef<D> {
	return entry("block", spec);
}

export const block = defineKind({
	name: "block",
	suffix: ".blocks.ts",
	about:
		"A copyable block (code, a command, a log, a file excerpt): Copy, Send to terminal and Add to composer derive from it.",
	schema: z.object({
		kind: z.literal("block"),
		id: plainId,
		label: text,
		copyLabel: text,
		text: fn,
		command: z.optional(fn),
		source: z.optional(fn),
		marks: z.array(z.string()),
		states,
	}),
	refs: {},
	guards: [labelled, galleryStates, renderedThroughBlock],
	uses: { components: ["Block"], prop: "spec" },
	define: defineBlock,
	keywords: [
		"copy",
		"copyable",
		"code",
		"snippet",
		"output",
		"log",
		"excerpt",
		"quote",
		"composer",
		"terminal",
	],
	scaffold: {
		dir: "src/components/{{object}}",
		imports: ['import { define } from "@/registry/define";'],
		entry: `export const {{name}} = define.block({
	id: "{{id}}",
	label: "{{label}}",
	copyLabel: "Copy {{lower}}",
	text: (d: { text: string }) => d.text,
	marks: [],
	states: { default: "{{slug}}", phone: "{{slug}}" },
});`,
	},
});
