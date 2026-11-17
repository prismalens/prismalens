// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { TurnInputPart } from "@prismalens/contracts";
import { useEffect, useState } from "react";
import { TOOL_LINE, ToolLineChevron } from "@/components/kit/ToolLine";
import { useTurnInput } from "@/lib/api/hooks/use-investigations-orpc";
import type { TurnInputRef } from "@/lib/investigation-events";

/** The file a handoff or summary seed points the agent to; the engine's HANDOFF_TRANSCRIPT_PATH. */
const SEED_FILE = ".prismalens-handoff/transcript.md";
const OPEN_EVENT = "pl:turn-input-open";

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

function partLabel(p: TurnInputPart): string {
	switch (p.type) {
		case "system":
			return "Added to its system prompt";
		case "text":
			return p.text.includes(SEED_FILE)
				? `Sent, with the full transcript in ${SEED_FILE}, which it can read`
				: "Sent";
		case "image":
			return `Image · ${p.mimeType} · ${Math.ceil(p.bytes / 1024)} KB`;
		case "link":
			return `File link · ${p.name}`;
	}
}

const PRE =
	"m-0 mt-1 max-h-96 overflow-auto rounded-control bg-surface-1 px-3 py-2 font-mono text-mono whitespace-pre-wrap text-text-2 [overflow-wrap:anywhere]";

/** The stored body, part by part, and what the agent got that PrismaLens never sees. */
export function TurnInputBody({
	input,
	agent,
}: {
	input: TurnInputRef;
	agent: string;
}) {
	const body = useTurnInput(input.runId, input.inputId, input.recorded);
	return (
		<div
			className="mt-1 flex flex-col gap-2 border-border border-l-2 pl-3 text-meta text-text-2"
			data-testid="turn-input-body"
		>
			{!input.recorded || body.isError ? (
				<p>Not recorded.</p>
			) : body.isPending ? (
				<p>Loading…</p>
			) : (
				body.data.parts.map((p, i) => (
					<div
						key={`${p.type}-${i}`}
						data-testid="turn-input-part"
						data-type={p.type}
					>
						<span className="text-text-3">{partLabel(p)}</span>
						{p.type === "text" || p.type === "system" ? (
							<pre className={PRE}>{p.text}</pre>
						) : p.type === "link" ? (
							<pre className={PRE}>{p.uri}</pre>
						) : null}
					</div>
				))
			)}
			<p className="text-text-3" data-testid="turn-input-not-shown">
				Not shown: what {agent} adds itself (its own system prompt and tool
				definitions, instruction files it reads such as AGENTS.md, CLAUDE.md,
				GEMINI.md, its memory and skills) and the mode, model and effort set
				over session config.
			</p>
		</div>
	);
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
