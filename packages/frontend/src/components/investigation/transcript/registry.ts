// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createElement } from "react";
import { appNodes } from "./nodes.app";
import { composerNodes } from "./nodes.composer";
import { contextNodes } from "./nodes.context";
import { panelNodes } from "./nodes.panel";
import type { TranscriptNodeProps, TranscriptNodes } from "./types";

export type { TranscriptNodeProps } from "./types";

/**
 * Event kinds Transcript.tsx's own branches leave unhandled, one file per lane so
 * three lanes never edit one line (#1024). An existing branch always wins.
 */
export const TRANSCRIPT_NODES: TranscriptNodes = {
	...composerNodes,
	...panelNodes,
	...appNodes,
	...contextNodes,
};

/** What `deriveTranscript`'s `nodes` option takes: a kind some lane draws. */
export function hasTranscriptNode(
	kind: string,
	nodes: TranscriptNodes = TRANSCRIPT_NODES,
): boolean {
	return Object.hasOwn(nodes, kind);
}

const warned = new Set<string>();

/** Draws a registered event; an unregistered one draws nothing and warns once per kind. */
export function TranscriptNode({
	nodes = TRANSCRIPT_NODES,
	...props
}: TranscriptNodeProps & { nodes?: TranscriptNodes }) {
	const kind = props.event.kind;
	const entry = Object.hasOwn(nodes, kind) ? nodes[kind] : undefined;
	if (!entry) {
		if (!warned.has(kind)) {
			warned.add(kind);
			console.warn(`No transcript node for "${kind}"`);
		}
		return null;
	}
	return createElement(
		"li",
		{ "data-testid": "transcript-node", "data-kind": kind },
		createElement(entry.Node, props),
	);
}
