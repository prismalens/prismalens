// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentMarkdown, InlineMarkdown } from "./AgentMarkdown";

describe("AgentMarkdown (walk f25)", () => {
	it("renders the agent's emphasis, headings and code instead of the raw markers", () => {
		const html = renderToStaticMarkup(
			createElement(AgentMarkdown, { text: 
					"### Investigation Start\n\nPer the **METHOD** provided, see `books.py`."
				 }),
		);
		expect(html).toContain("<strong>METHOD</strong>");
		expect(html).toContain("books.py</code>");
		expect(html).not.toContain("###");
		expect(html).not.toContain("**");
	});

	it("never renders raw HTML or images from agent text", () => {
		const html = renderToStaticMarkup(
			createElement(AgentMarkdown, { text: 
					'<img src="http://x/beacon"> ![t](http://x/pixel.png) <script>alert(1)</script>'
				 }),
		);
		expect(html).not.toContain("<img");
		expect(html).not.toContain("<script");
	});
});

describe("InlineMarkdown (walk f24)", () => {
	it("renders backticked identifiers in report text as code, without a block wrapper", () => {
		const html = renderToStaticMarkup(
			createElement(InlineMarkdown, { text: "Removal of the composite index `ix_books_owner_lower_title`" }),
		);
		expect(html).toBe(
			'Removal of the composite index <code class="font-mono text-[0.95em]">ix_books_owner_lower_title</code>',
		);
	});
});
