// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Components } from "hast-util-to-jsx-runtime";
import { memo, useSyncExternalStore } from "react";

export type { Components as MarkdownComponents };

type Renderer = typeof import("./markdown-render-impl");
let renderer: Renderer | null = null;
let pending: Promise<Renderer> | null = null;
const waiting = new Set<() => void>();

/**
 * Loads the markdown renderer. Until it arrives a message draws as its plain text, so the
 * parser stays off a page's first paint (#1101 category 12).
 */
export function loadMarkdown(): Promise<Renderer> {
	pending ??= import("./markdown-render-impl").then((m) => {
		renderer = m;
		waiting.forEach((wake) => {
			wake();
		});
		return m;
	});
	return pending;
}

/** Unit tests render markdown in one pass: their setup hands the renderer over first. */
export function primeMarkdown(m: Renderer): void {
	renderer = m;
}

const subscribe = (wake: () => void) => {
	waiting.add(wake);
	return () => {
		waiting.delete(wake);
	};
};
const current = () => renderer;

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
	const ready = useSyncExternalStore(subscribe, current, current);
	if (!ready) void loadMarkdown();
	return (
		<div className={className}>
			{ready ? (
				ready.renderMarkdown(children, components)
			) : (
				<p className="whitespace-pre-wrap">{children}</p>
			)}
		</div>
	);
});
