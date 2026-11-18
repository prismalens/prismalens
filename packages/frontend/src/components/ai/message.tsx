// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Vercel AI Elements' Message (registry.ai-sdk.dev/message.json), owned and
 * restyled (decision 14): the agent's prose is markdown with the system's
 * type and code, the operator's message a raised block. Agent prose is the
 * only Markdown the app renders (study-v3 §3.4).
 */
import type { LinkTarget } from "@prismalens/contracts";
import { FileDiff } from "lucide-react";
import type { HTMLAttributes, MouseEvent, ReactNode } from "react";
import {
	Children,
	cloneElement,
	createContext,
	isValidElement,
	memo,
	useContext,
	useRef,
	useState,
} from "react";
import { codeBlock } from "@/components/ai/code.blocks";
import { tableBlock } from "@/components/ai/table.blocks";
import { Block } from "@/components/kit/Block";
import { appFacts, runAppCommand } from "@/lib/app-commands";
import { READ_BLOCK_HEAD, READ_BLOCK_OVER } from "@/lib/fold";
import { LAYOUT } from "@/lib/layout";
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

const HEADING = "mt-3 mb-1 max-w-(--prose-w) text-read font-semibold";

/** A table: sideways at the lane's width, copied as Markdown from what it shows (#1101). */
function TableBlock({ children }: { children: ReactNode }) {
	const table = useRef<HTMLTableElement>(null);
	return (
		<Block
			spec={tableBlock}
			data={{ markdown: () => tableMarkdown(table.current) }}
			className="my-2"
			testId="table-block"
		>
			<div data-scroll-x className="overflow-x-auto">
				<table
					ref={table}
					className="w-full text-meta [&_tbody]:divide-y [&_tbody]:divide-hairline"
				>
					{children}
				</table>
			</div>
		</Block>
	);
}

/** A drawn table as Markdown: a header row, its rule, then each body row. */
export function tableMarkdown(table: HTMLTableElement | null): string {
	if (!table) return "";
	const cell = (c: Element) =>
		(c.textContent ?? "").trim().replace(/\|/g, "\\|").replace(/\s+/g, " ");
	const rows = Array.from(table.rows, (r) => Array.from(r.cells, cell));
	const [head, ...body] = rows;
	if (!head) return "";
	const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
	return [line(head), line(head.map(() => "---")), ...body.map(line)].join(
		"\n",
	);
}

const components: MarkdownComponents = {
	h1: ({ children }) => <h4 className={HEADING}>{children}</h4>,
	h2: ({ children }) => <h4 className={HEADING}>{children}</h4>,
	h3: ({ children }) => <h4 className={HEADING}>{children}</h4>,
	h4: ({ children }) => <h4 className={HEADING}>{children}</h4>,
	// Prose stops at a readable measure; code, tables and diffs keep the lane (#1101).
	p: ({ children }) => (
		<p className="my-1.5 max-w-(--prose-w) first:mt-0 last:mb-0">{children}</p>
	),
	ul: ({ children }) => (
		<ul className="my-1.5 max-w-(--prose-w) list-disc space-y-0.5 pl-5 marker:text-text-3">
			{children}
		</ul>
	),
	// `start` keeps "800. I'm…" reading 800, not 1; the gutter widens to the longest number.
	ol: ({ children, start }) => {
		const first = typeof start === "number" ? start : 1;
		const items = Children.toArray(children).filter(isValidElement).length;
		const digits = String(first + Math.max(items - 1, 0)).length;
		return (
			<ol
				start={first}
				style={
					digits > 2 ? { paddingInlineStart: `${digits + 1}ch` } : undefined
				}
				className="my-1.5 max-w-(--prose-w) list-decimal space-y-0.5 pl-5 marker:text-text-3"
			>
				{children}
			</ol>
		);
	},
	a: ({ children, href }) => <ProseLink href={href}>{children}</ProseLink>,
	strong: ({ children }) => (
		<strong className="font-semibold text-text-1">{children}</strong>
	),
	blockquote: ({ children }) => (
		<blockquote className="my-1.5 max-w-(--prose-w) rounded-control bg-surface-1 px-3 py-1.5 text-text-2">
			{children}
		</blockquote>
	),
	pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
	table: ({ children }) => <TableBlock>{children}</TableBlock>,
	th: ({ children }) => (
		<th className="bg-surface-1 px-2 py-1 text-left font-medium text-text-2">
			{children}
		</th>
	),
	td: ({ children }) => <td className="px-2 py-1">{children}</td>,
};

/**
 * A long read block's head (#1101 cat 12 item 6): past `READ_BLOCK_OVER` lines a code
 * block shows its first `READ_BLOCK_HEAD` and Show all; Copy still takes the whole code.
 */
function headOf(
	children: ReactNode,
): { head: ReactNode; lines: number; code: string } | null {
	if (codeBlock.fold !== "read") return null;
	if (!isValidElement<{ className?: string; children?: ReactNode }>(children))
		return null;
	const text = children.props.children;
	if (typeof text !== "string") return null;
	const code = text.replace(/\n$/, "");
	const lines = code.split("\n");
	if (lines.length <= READ_BLOCK_OVER) return null;
	return {
		head: cloneElement(children, {
			children: lines.slice(0, READ_BLOCK_HEAD).join("\n"),
		}),
		lines: lines.length,
		code,
	};
}

/** A diff fence's size: its lines, the files it touches and its added and removed lines. */
export function diffSize(
	children: ReactNode,
): { lines: number; files: number; added: number; removed: number } | null {
	if (!isValidElement<{ className?: string; children?: ReactNode }>(children))
		return null;
	const lang = /language-([\w-]+)/.exec(children.props.className ?? "")?.[1];
	const text = children.props.children;
	if ((lang !== "diff" && lang !== "patch") || typeof text !== "string")
		return null;
	const lines = text.replace(/\n$/, "").split("\n");
	const heads = lines.filter((l) => l.startsWith("diff --git ")).length;
	return {
		lines: lines.length,
		files:
			heads || Math.max(1, lines.filter((l) => l.startsWith("+++ ")).length),
		added: lines.filter((l) => l.startsWith("+") && !l.startsWith("+++"))
			.length,
		removed: lines.filter((l) => l.startsWith("-") && !l.startsWith("---"))
			.length,
	};
}

/**
 * A fenced block: the kit `Block` copies the code alone (#1101); a shell line also runs.
 * A long or many-file diff is a row that opens the Changes pane, not a wall in the lane.
 */
function CodeBlock({ children }: { children: ReactNode }) {
	const diff = diffSize(children);
	const [inline, setInline] = useState(false);
	if (diff && !inline && (diff.lines > LAYOUT.diffRowLines || diff.files > 1))
		return <DiffRow size={diff} onInline={() => setInline(true)} />;
	return <CodeBody>{children}</CodeBody>;
}

function DiffRow({
	size,
	onInline,
}: {
	size: { files: number; added: number; removed: number };
	onInline: () => void;
}) {
	const panel = !!appFacts().is.paneChanges;
	return (
		<div
			className="my-2 flex min-h-8 items-center gap-2 rounded-control bg-surface-1 px-3 text-body"
			data-testid="diff-row"
		>
			<FileDiff className="size-3.5 shrink-0 text-text-3" aria-hidden />
			<span className="text-text-1">
				{size.files === 1 ? "1 file" : `${size.files} files`}
			</span>
			<span className="font-mono text-mono tabular-nums">
				<span className="text-ok">+{size.added}</span>{" "}
				<span className="text-danger">−{size.removed}</span>
			</span>
			<span className="flex-1" />
			<button
				type="button"
				onClick={onInline}
				className="min-h-6 text-meta text-text-2 hover:text-text-1 max-md:min-h-11"
				data-testid="diff-row-inline"
			>
				Show here
			</button>
			{panel && (
				<button
					type="button"
					onClick={() => runAppCommand("paneChanges")}
					className="min-h-6 text-meta text-text-2 hover:text-text-1 max-md:min-h-11"
					data-testid="diff-row-panel"
				>
					Open in panel
				</button>
			)}
		</div>
	);
}

function CodeBody({ children }: { children: ReactNode }) {
	const command = shellLine(children);
	const pre = useRef<HTMLPreElement>(null);
	const long = headOf(children);
	const [all, setAll] = useState(false);
	return (
		<Block
			spec={codeBlock}
			data={{
				code: () =>
					long?.code ?? pre.current?.textContent?.replace(/\n$/, "") ?? "",
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
					// Wrap, and a phone, fold long lines (the block's `data-wrap`, app.css).
					"overflow-x-auto rounded-[var(--radius-control)] bg-surface-1 py-2 pr-16 pl-3 text-read-mono text-text-2",
					command && "pr-16",
				)}
			>
				{long && !all ? long.head : children}
			</pre>
			{long && (
				<button
					type="button"
					onClick={() => setAll(!all)}
					aria-expanded={all}
					className="mt-1 min-h-6 text-meta text-text-3 hover:text-text-1 max-md:min-h-11"
					data-testid="code-show-all"
				>
					{all ? "Show less" : `Show all ${long.lines} lines`}
				</button>
			)}
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
					"min-w-0 text-read text-text-1 [overflow-wrap:anywhere]",
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
