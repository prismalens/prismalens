// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect, useState } from "react";
import { TOOL_LINE, ToolLineChevron } from "@/components/kit/ToolLine";
import type { TurnInputRef } from "@/lib/investigation-events";
import { lazyPart } from "@/lib/lazy";

const OPEN_EVENT = "pl:turn-input-open";

/** The opened body loads on demand, off the thread's first paint (entry-budget). */
export const TurnInputBody = lazyPart(() =>
	import("./TurnInputBody").then((m) => m.TurnInputBody),
);

/** Scrolls to a turn input and opens it, from a session divider's "What it got". */
export function openTurnInput(key: string): void {
	window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: key }));
}

/** `What the agent got · about 1.2k tokens · exact`, or that its body was not recorded. */
export function turnInputLabel(input: TurnInputRef): string {
	const head = "What the agent got";
	if (!input.recorded) return `${head} · Not recorded`;
	const tokens = Math.round(input.chars / 4);
	const tries = input.attempt > 1 ? ` · try ${input.attempt}` : "";
	return `${head} · about ${tokens.toLocaleString()} tokens · exact${tries}`;
}

/** One prompt PrismaLens sent, one quiet line until opened (#1166), as a restart's note is. */
export function TurnInput({
	itemKey,
	input,
	agent,
}: {
	itemKey: string;
	input: TurnInputRef;
	agent: string;
}) {
	const [open, setOpen] = useState(false);
	const [row, setRow] = useState<HTMLLIElement | null>(null);
	useEffect(() => {
		const onOpen = (e: Event) => {
			if ((e as CustomEvent<string>).detail !== itemKey) return;
			setOpen(true);
			row?.scrollIntoView({ block: "start", behavior: "smooth" });
		};
		window.addEventListener(OPEN_EVENT, onOpen);
		return () => window.removeEventListener(OPEN_EVENT, onOpen);
	}, [itemKey, row]);
	return (
		<li ref={setRow} data-testid="turn-input" data-input-key={itemKey}>
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				className={TOOL_LINE}
				data-testid="turn-input-label"
			>
				<span className="truncate text-meta text-text-3">
					{turnInputLabel(input)}
				</span>
				<ToolLineChevron open={open} />
			</button>
			{open ? <TurnInputBody input={input} agent={agent} /> : null}
		</li>
	);
}
