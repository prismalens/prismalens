// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Vercel AI Elements' Message (registry.ai-sdk.dev/message.json), owned and
 * restyled (decision 14): the agent's prose is Streamdown with the system's
 * type and code, the operator's message a raised block. Agent prose is the
 * only Markdown the app renders (study-v3 §3.4).
 */
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { isValidElement, memo } from "react";
import { type Components, Streamdown } from "streamdown";
import { RunInTerminal } from "@/components/terminal/RunInTerminal";
import { cn } from "@/lib/utils";

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

const components: Components = {
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
	a: ({ children, href }) => (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className="text-accent hover:underline"
		>
			{children}
		</a>
	),
	strong: ({ children }) => (
		<strong className="font-semibold text-text-1">{children}</strong>
	),
	blockquote: ({ children }) => (
		<blockquote className="my-1.5 rounded-control bg-surface-1 px-3 py-1.5 text-text-2">
			{children}
		</blockquote>
	),
	pre: ({ children }) => {
		const command = shellLine(children);
		return (
			<div className="relative my-2">
				<pre
					data-scroll-x
					className={cn(
						"overflow-x-auto rounded-[var(--radius-control)] bg-surface-1 px-3 py-2 text-mono text-text-2",
						command && "pr-10",
					)}
				>
					{children}
				</pre>
				{command && (
					<span className="absolute top-1.5 right-1.5">
						<RunInTerminal command={command} compact />
					</span>
				)}
			</div>
		);
	},
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

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

export const MessageResponse = memo(
	({ className, ...props }: MessageResponseProps) => (
		<Streamdown
			className={cn(
				"min-w-0 text-body text-text-1 [overflow-wrap:anywhere]",
				className,
			)}
			components={components}
			controls={false}
			mode="static"
			{...props}
		/>
	),
	(prev, next) => prev.children === next.children,
);
MessageResponse.displayName = "MessageResponse";
