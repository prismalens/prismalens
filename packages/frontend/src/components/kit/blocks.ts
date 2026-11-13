// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createContext } from "react";
import type { MarkId } from "./marks";

/** The thread whose message Add to composer writes into; none means no block is quotable. */
export const BlockThread = createContext<string | null>(null);

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

/**
 * A special block's spec (#1101): its kind, its exact copy text, its source and
 * marks. The kit `Block` draws the chrome and derives the actions (Copy, Send to
 * terminal, Add to composer) from it. Specs live in co-located `*.blocks.ts`.
 */
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
