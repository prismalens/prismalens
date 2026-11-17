// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { TurnInputPart } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/api/orpc-client";
import type { TurnInputRef } from "@/lib/investigation-events";

/** The file a handoff or summary seed points the agent to; the engine's HANDOFF_TRANSCRIPT_PATH. */
const SEED_FILE = ".prismalens-handoff/transcript.md";

/** What one prompt sent the agent (#1166); a body never changes once stored. */
function useTurnInput(id: string, inputId: string, enabled: boolean) {
	return useQuery({
		...orpc.investigations.turnInput.queryOptions({ input: { id, inputId } }),
		enabled,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
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
