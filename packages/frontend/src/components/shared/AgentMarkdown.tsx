// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Fragment } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// Agent text is untrusted: no raw HTML (react-markdown's default) and no images,
// which would load a URL the agent chose the moment the page renders.
const BLOCK_ELEMENTS = [
	"p",
	"strong",
	"em",
	"del",
	"code",
	"pre",
	"ul",
	"ol",
	"li",
	"blockquote",
	"a",
	"h1",
	"h2",
	"h3",
	"h4",
	"hr",
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
];
const INLINE_ELEMENTS = ["p", "strong", "em", "code"];

const heading: Components["h1"] = ({ children }) => (
	<p className="font-semibold">{children}</p>
);

const blockComponents: Components = {
	h1: heading,
	h2: heading,
	h3: heading,
	h4: heading,
	a: ({ href, children }) => (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer nofollow"
			className="underline underline-offset-2"
		>
			{children}
		</a>
	),
	code: ({ className, children }) => (
		<code className={cn("font-mono text-[0.95em]", className)}>{children}</code>
	),
	pre: ({ children }) => (
		<pre className="overflow-x-auto rounded bg-muted p-2 text-meta">
			{children}
		</pre>
	),
	ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
	ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
};

const inlineComponents: Components = {
	p: ({ children }) => <Fragment>{children}</Fragment>,
	code: ({ children }) => (
		<code className="font-mono text-[0.95em]">{children}</code>
	),
};

/** An agent's message, rendered as the Markdown it was written in (walk f25). */
export function AgentMarkdown({
	text,
	className,
}: {
	text: string;
	className?: string;
}) {
	return (
		<div
			className={cn("flex flex-col gap-2 [overflow-wrap:anywhere]", className)}
		>
			<Markdown
				remarkPlugins={[remarkGfm]}
				allowedElements={BLOCK_ELEMENTS}
				unwrapDisallowed
				components={blockComponents}
			>
				{text}
			</Markdown>
		</div>
	);
}

/** One line of report text: inline code and emphasis only, never a block (walk f24). */
export function InlineMarkdown({ text }: { text: string }) {
	return (
		<Markdown
			allowedElements={INLINE_ELEMENTS}
			unwrapDisallowed
			components={inlineComponents}
		>
			{text}
		</Markdown>
	);
}
