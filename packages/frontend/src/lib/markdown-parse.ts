// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Root as MdastRoot } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/**
 * The message's markdown as a syntax tree, with each node's source offsets: all a
 * transcript needs to draw prose, apart from the clipboard's converters in `markdown.ts`.
 */
export function parseMarkdown(md: string): MdastRoot {
	return fromMarkdown(md, {
		extensions: [gfm()],
		mdastExtensions: [gfmFromMarkdown()],
	});
}
