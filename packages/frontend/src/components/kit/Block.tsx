// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { runnableCommand } from "@prismalens/contracts";
import { Check, Copy, MessageSquareQuote } from "lucide-react";
import {
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Hint } from "@/components/shared/Hint";
import { RunInTerminal } from "@/components/terminal/RunInTerminal";
import { copyText } from "@/lib/clipboard";
import { terminalStore, useTerminalState } from "@/lib/terminal/store";
import { cn } from "@/lib/utils";
import type { BlockCtx } from "./block.actions";
import {
	addToComposer,
	type BlockSelection,
	selectionIn,
} from "./block-composer";
import { type BlockSpec, BlockThread } from "./blocks";
import { Surface } from "./Surface";

const BTN =
	"flex size-6 items-center justify-center rounded-control text-text-3 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent";

// One selectionchange listener for every block; each re-reads its own selection on a tick.
let tick = 0;
const ticks = new Set<() => void>();
let frame = 0;
const onSelection = () => {
	cancelAnimationFrame(frame);
	frame = requestAnimationFrame(() => {
		tick++;
		for (const l of Array.from(ticks)) l();
	});
};
function subscribe(l: () => void) {
	if (!ticks.size) document.addEventListener("selectionchange", onSelection);
	ticks.add(l);
	return () => {
		ticks.delete(l);
		if (!ticks.size)
			document.removeEventListener("selectionchange", onSelection);
	};
}
const noSubscribe = () => () => {};

/**
 * A special block (its spec in a `*.blocks.ts`) with its chrome: Copy, Send to terminal for a
 * command, and Add to composer while a selection sits inside a block with a
 * source. The chrome shows on hover or focus, always on touch; right-click,
 * Shift+F10 and the keys run the same actions through the `block` surface.
 */
export function Block<D>({
	spec: def,
	data,
	children,
	className,
	testId,
	reveal = "hover",
	shadow = false,
	linesText,
	copyWith,
}: {
	spec: BlockSpec<D>;
	data: D;
	/** The block's body; as a function it places the chrome itself, else the chrome sits in the top-right corner. */
	children: ReactNode | ((chrome: ReactNode) => ReactNode);
	className?: string;
	testId?: string;
	/** "always" in a bar whose other controls already show. */
	reveal?: "hover" | "always";
	/** The body draws in an open shadow root (a code viewer). */
	shadow?: boolean;
	/** A file's own text for a line span, so a quote never carries a viewer's gutter. */
	linesText?: (start: number, end: number) => string | null;
	/** A copy the page also records, such as a fix step's; true when it copied. */
	copyWith?: (text: string) => Promise<boolean>;
}) {
	const root = useRef<HTMLDivElement>(null);
	const pointed = useRef<number | null>(null);
	const [copied, setCopied] = useState(false);
	const [selected, setSelected] = useState<BlockSelection | null>(null);
	const threadId = useContext(BlockThread);
	const source = threadId ? (def.source?.(data) ?? null) : null;
	const now = useSyncExternalStore(
		source ? subscribe : noSubscribe,
		() => tick,
		() => 0,
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-read on each selection tick.
	useEffect(() => {
		if (source) setSelected(selectionIn(root.current, shadow));
	}, [now, shadow, !!source]);
	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(t);
	}, [copied]);
	const hasTerminal = useTerminalState((s) => s.hosts > 0);
	const command = def.command?.(data) ?? null;
	const runnable = !!command && hasTerminal && runnableCommand(command);
	const ctx: BlockCtx = {
		copyLabel: def.copyLabel,
		copy: () =>
			void (copyWith ?? copyText)(def.text(data)).then(
				(ok) => ok && setCopied(true),
			),
		run: () => command && terminalStore.stage(command),
		addToComposer: () =>
			!!source &&
			!!threadId &&
			addToComposer(
				threadId,
				source,
				def.text(data),
				selectionIn(root.current, shadow),
				pointed.current,
				linesText,
			),
		facts: { is: { runnable, quotable: !!source } },
	};
	const chrome = (
		<span
			className={cn(
				"flex shrink-0 items-center gap-0.5",
				typeof children !== "function" && "absolute top-1 right-1 z-10",
				reveal === "hover" &&
					"opacity-0 group-focus-within/block:opacity-100 group-hover/block:opacity-100 [@media(hover:none)]:opacity-100",
				(copied || selected) && "opacity-100",
			)}
			data-copy-skip
			data-testid="block-chrome"
		>
			{source && selected && (
				<Hint label="Add to composer">
					<button
						type="button"
						aria-label="Add to composer"
						className={BTN}
						// Keep the selection the button acts on.
						onMouseDown={(e) => e.preventDefault()}
						onClick={ctx.addToComposer}
						data-testid="block-add"
					>
						<MessageSquareQuote className="size-3.5" aria-hidden />
					</button>
				</Hint>
			)}
			{command && def.command && <RunInTerminal command={command} compact />}
			<Hint label={copied ? "Copied" : def.copyLabel}>
				<button
					type="button"
					aria-label={def.copyLabel}
					className={cn(BTN, copied && "text-ok")}
					onClick={ctx.copy}
					data-testid="block-copy"
				>
					{copied ? (
						<Check className="size-3.5" aria-hidden />
					) : (
						<Copy className="size-3.5" aria-hidden />
					)}
				</button>
			</Hint>
		</span>
	);
	return (
		<Surface id="block" ctx={ctx}>
			<div
				ref={root}
				className={cn("group/block relative min-w-0", className)}
				data-block={def.id}
				data-testid={testId}
				onContextMenuCapture={(e) => {
					const at = e.nativeEvent
						.composedPath()
						.find(
							(el): el is HTMLElement =>
								el instanceof HTMLElement && !!el.dataset.line,
						);
					pointed.current = at ? Number(at.dataset.line) || null : null;
				}}
			>
				{typeof children === "function" ? (
					children(chrome)
				) : (
					<>
						{children}
						{chrome}
					</>
				)}
			</div>
		</Surface>
	);
}
