// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Root as HastRoot } from "hast";
import { defaultSchema, sanitize } from "hast-util-sanitize";
import { type Components, toJsxRuntime } from "hast-util-to-jsx-runtime";
import type { Nodes as MdastNodes } from "mdast";
import { toHast } from "mdast-util-to-hast";
import type { ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { parseMarkdown } from "@/lib/markdown-parse";

/** Raw HTML in the markdown reads as the text it is; it never renders. */
function htmlAsText(node: MdastNodes): void {
	if (!("children" in node)) return;
	node.children = node.children.map((c) =>
		c.type === "html" ? { type: "text", value: c.value } : c,
	) as typeof node.children;
	for (const c of node.children) htmlAsText(c as MdastNodes);
}

/**
 * Markdown as React through the app's one parser (`lib/markdown`, micromark with GFM),
 * sanitized with the GitHub schema, so the transcript's first paint carries no second
 * markdown stack (#1101 category 12).
 */
export function renderMarkdown(md: string, components: Components): ReactNode {
	const tree = parseMarkdown(md);
	htmlAsText(tree);
	const hast = sanitize(toHast(tree), defaultSchema) as HastRoot;
	return toJsxRuntime(hast, { Fragment, jsx, jsxs, components });
}
