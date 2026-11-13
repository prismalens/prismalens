// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Quote, ReferenceRef } from "@prismalens/contracts";
import { defineClosed } from "@prismalens/registry";
import type { BlockSource } from "./blocks";

type Kind = BlockSource["kind"];
type Of<K extends Kind> = Extract<BlockSource, { kind: K }>;

/** How Add to composer reads one kind of block source (#1101). */
export interface BlockSourceView<K extends Kind = Kind> {
	/** With nothing selected, the reference chip it adds instead of quoting the whole block. */
	reference?: (s: Of<K>, pointed: number | null) => ReferenceRef;
	/** Where a quote from it came from; `span` is the file lines a selection covers. */
	from: (
		s: Of<K>,
		threadId: string,
		span: [number, number] | null,
	) => Quote["source"];
	/** A selection's lines are re-read from the file, so a quote never carries a viewer's gutter. */
	exactLines?: true;
}

const name = (path: string) => path.split("/").pop() ?? path;

const BLOCK_SOURCES: { [K in Kind]: BlockSourceView<K> } = {
	file: {
		reference: (s, pointed) => {
			const line = pointed ?? s.line;
			return {
				kind: "file",
				id: s.path,
				label: line ? `${name(s.path)}:${line}` : name(s.path),
			};
		},
		from: (s, threadId, span) => ({
			threadId,
			kind: "file",
			path: s.path,
			...(span
				? { line: span[0], ...(span[1] > span[0] ? { end: span[1] } : {}) }
				: s.line
					? { line: s.line, ...(s.end ? { end: s.end } : {}) }
					: {}),
		}),
		exactLines: true,
	},
	thread: {
		from: (s, threadId) => ({
			threadId,
			kind: s.item,
			...(s.seq !== undefined ? { seq: s.seq } : {}),
		}),
	},
	log: {
		from: (s, threadId) => ({ threadId, kind: "log", path: s.name }),
	},
};

/** Each block source kind, with how Add to composer quotes or references it. */
export const blockSources = defineClosed(
	"blockSource",
	Object.keys(BLOCK_SOURCES) as Kind[],
	BLOCK_SOURCES,
);

/** A source's view, typed for that source; the record above pairs each kind with its own view. */
export function blockSourceView<S extends BlockSource>(
	s: S,
): BlockSourceView<S["kind"]> {
	return BLOCK_SOURCES[s.kind] as BlockSourceView<S["kind"]>;
}
