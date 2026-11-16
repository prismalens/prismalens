// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Components } from "hast-util-to-jsx-runtime";
import { memo, startTransition, useEffect, useState } from "react";

export type { Components as MarkdownComponents };

type Renderer = typeof import("./markdown-render-impl");
let renderer: Renderer | null = null;
let pending: Promise<Renderer> | null = null;

/**
 * Loads the markdown renderer. Until it arrives a message draws as its plain text, so the
 * parser stays off a page's first paint (#1101 category 12).
 */
export function loadMarkdown(): Promise<Renderer> {
	pending ??= import("./markdown-render-impl").then((m) => {
		renderer = m;
		return m;
	});
	return pending;
}

/** Unit tests render markdown in one pass: their setup hands the renderer over first. */
export function primeMarkdown(m: Renderer): void {
	renderer = m;
}

/**
 * The text a message renders, without its markup, while the renderer loads: a slow link
 * never shows `**bold**` or backticks (#1101 cat 12). Line breaks and list marks stay.
 */
export function bareMarkdown(md: string): string {
	return md
		.replace(/^\s{0,3}(```|~~~).*$/gm, "")
		.replace(/(\*\*|__|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
		.replace(/(^|[^\w*])[*_](?=\S)([^*_\n]*?\S)[*_](?![\w*])/g, "$1$2")
		.replace(/`+([^`\n]+?)`+/g, "$1")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^\s{0,3}#{1,6}\s+/gm, "")
		.replace(/^\s{0,3}>\s?/gm, "");
}

/** A block of rendered markdown; re-parses only when the text changes. */
export const Markdown = memo(function Markdown({
	children,
	components,
	className,
}: {
	children: string;
	components: Components;
	className?: string;
}) {
	// The renderer swaps in from a transition: a long transcript re-renders its prose in
	// slices that yield, not in one task.
	const [ready, setReady] = useState(() => renderer);
	useEffect(() => {
		if (ready) return;
		let live = true;
		loadMarkdown().then(
			(r) => {
				if (live) startTransition(() => setReady(r));
			},
			() => {},
		);
		return () => {
			live = false;
		};
	}, [ready]);
	return (
		<div className={className}>
			{ready ? (
				ready.renderMarkdown(children, components)
			) : (
				<p className="whitespace-pre-wrap">{bareMarkdown(children)}</p>
			)}
		</div>
	);
});
