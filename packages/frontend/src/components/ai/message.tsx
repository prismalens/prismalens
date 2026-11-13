// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Vercel AI Elements' Message (registry.ai-sdk.dev/message.json), owned and
 * restyled (decision 14): the agent's prose is markdown with the system's
 * type and code, the operator's message a raised block. Agent prose is the
 * only Markdown the app renders (study-v3 §3.4).
 */
import type { LinkTarget } from "@prismalens/contracts";
import type { HTMLAttributes, MouseEvent, ReactNode } from "react";
import { createContext, isValidElement, memo, useContext, useRef } from "react";
import { codeBlock } from "@/components/ai/code.blocks";
import { Block } from "@/components/kit/Block";
import { linkKey } from "@/lib/link-candidates";
import { Markdown, type MarkdownComponents } from "@/lib/markdown-render";
import { cn } from "@/lib/utils";

/** A message's resolved links and where each opens (#1024). */
export interface MessageLinks {
	targets: ReadonlyMap<string, LinkTarget>;
	/** The address Ctrl or Cmd click opens in a new tab. */
	href: (target: LinkTarget) => string;
	open: (target: LinkTarget) => void;
}

const LinksContext = createContext<MessageLinks | null>(null);

const LINK = "text-accent hover:underline";

/** A link in agent prose: a resolved one opens in place, an unresolved candidate stays text. */
function ProseLink({
	children,
	href,
}: {
	children?: ReactNode;
	href?: string;
}) {
	const links = useContext(LinksContext);
	const key = linkKey(href);
	const target = links?.targets.get(key ?? href ?? "");
	if (links && target) {
		const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
			if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
			e.preventDefault();
			links.open(target);
		};
		return (
			<a
				href={links.href(target)}
				onClick={onClick}
				className={LINK}
				data-link-type={target.type}
				{...(target.type === "url"
					? { target: "_blank", rel: "noreferrer" }
					: {})}
			>
				{children}
			</a>
		);
	}
	if (key !== null) return <>{children}</>;
	return (
		<a href={href} target="_blank" rel="noreferrer" className={LINK}>
			{children}
		</a>
	);
}

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
	from: "agent" | "you";
};

export const Message = ({ className, from, ...props }: MessageProps) => (
	<div
		className={cn(
			"group min-w-0",
			from === "you" && "raised rounded-[var(--radius-surface)] px-3 py-2",
			className,
		)}
		data-from={from}
		{...props}
	/>
);

/** Who said it and when; `aside` sits at the right end (a delivery word). */
export const MessageHeader = ({
	who,
	at,
	aside,
}: {
	who: string;
	at?: string;
	aside?: ReactNode;
}) => (
	<div className="mb-1 flex min-w-0 items-baseline gap-2 text-meta text-text-3">
		<span className="font-medium text-text-2">{who}</span>
		{at && <span className="tabular-nums">{at}</span>}
		{aside && <span className="ml-auto min-w-0 truncate">{aside}</span>}
	</div>
);

const components: MarkdownComponents = {
	h1: ({ children }) => <h4 className="mt-3 mb-1 text-heading">{children}</h4>,
	h2: ({ children }) => <h4 className="mt-3 mb-1 text-heading">{children}</h4>,
	h3: ({ children }) => <h4 className="mt-3 mb-1 text-heading">{children}</h4>,
	h4: ({ children }) => <h4 className="mt-3 mb-1 text-heading">{children}</h4>,
	p: ({ children }) => (
		<p className="my-1.5 first:mt-0 last:mb-0">{children}</p>
	),
	ul: ({ children }) => (
		<ul className="my-1.5 list-disc space-y-0.5 pl-5 marker:text-text-3">
			{children}
		</ul>
	),
	ol: ({ children }) => (
		<ol className="my-1.5 list-decimal space-y-0.5 pl-5 marker:text-text-3">
			{children}
		</ol>
	),
	a: ({ children, href }) => <ProseLink href={href}>{children}</ProseLink>,
	strong: ({ children }) => (
		<strong className="font-semibold text-text-1">{children}</strong>
	),
	blockquote: ({ children }) => (
		<blockquote className="my-1.5 rounded-control bg-surface-1 px-3 py-1.5 text-text-2">
			{children}
		</blockquote>
	),
	pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
	table: ({ children }) => (
		<div data-scroll-x className="my-2 overflow-x-auto">
			<table className="w-full text-meta [&_tbody]:divide-y [&_tbody]:divide-hairline">
				{children}
			</table>
		</div>
	),
	th: ({ children }) => (
		<th className="bg-surface-1 px-2 py-1 text-left font-medium text-text-2">
			{children}
		</th>
	),
	td: ({ children }) => <td className="px-2 py-1">{children}</td>,
};

/** A fenced block: the kit `Block` copies the code alone (#1101); a shell line also runs. */
function CodeBlock({ children }: { children: ReactNode }) {
	const command = shellLine(children);
	const pre = useRef<HTMLPreElement>(null);
	return (
		<Block
			spec={codeBlock}
			data={{
				code: () => pre.current?.textContent?.replace(/\n$/, "") ?? "",
				command,
			}}
			className="my-2"
			testId="code-block"
		>
			<pre
				ref={pre}
				data-scroll-x
				className={cn(
					// A phone wraps long lines: a sideways scroller inside a scrolling page is unreachable by keyboard.
					"overflow-x-auto rounded-[var(--radius-control)] bg-surface-1 py-2 pr-10 pl-3 text-mono text-text-2 max-sm:overflow-x-visible max-sm:whitespace-pre-wrap max-sm:[overflow-wrap:anywhere]",
					command && "pr-16",
				)}
			>
				{children}
			</pre>
		</Block>
	);
}

const SHELL = new Set([
	"bash",
	"sh",
	"shell",
	"zsh",
	"console",
	"powershell",
	"ps1",
]);

/** A one-line shell block's command: the agent asks you to run it, so it can go to the terminal. */
export function shellLine(children: ReactNode): string | null {
	if (!isValidElement<{ className?: string; children?: ReactNode }>(children))
		return null;
	const lang = /language-([\w-]+)/.exec(children.props.className ?? "")?.[1];
	const text = children.props.children;
	if (!lang || !SHELL.has(lang) || typeof text !== "string") return null;
	const line = text.trim().replace(/^\$\s+/, "");
	return line && !line.includes("\n") ? line : null;
}

export interface MessageResponseProps {
	children: string;
	className?: string;
	links?: MessageLinks;
}

export const MessageResponse = memo(
	({ className, links, children }: MessageResponseProps) => (
		<LinksContext.Provider value={links ?? null}>
			<Markdown
				className={cn(
					"min-w-0 text-body text-text-1 [overflow-wrap:anywhere]",
					className,
				)}
				components={components}
			>
				{children}
			</Markdown>
		</LinksContext.Provider>
	),
	(prev, next) =>
		prev.children === next.children &&
		prev.links?.targets === next.links?.targets,
);
MessageResponse.displayName = "MessageResponse";
