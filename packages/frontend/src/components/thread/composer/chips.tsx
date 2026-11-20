// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronDown } from "lucide-react";
import { markLook } from "@/components/kit/marks";
import { SurfaceMore } from "@/components/kit/Surface";
import { Hint } from "@/components/shared/Hint";
import { formatClock } from "@/lib/format-time";
import { cn } from "@/lib/utils";

/** The server's draft moved past this browser's journal (#1024). */
export function ConflictLine({
	onKeepMine,
	onUseTheirs,
	at,
	open,
}: {
	onKeepMine: () => void;
	onUseTheirs: () => void;
	/** When the other device saved its draft. */
	at?: string;
	/** Open on first draw: the design gallery's frame. */
	open?: boolean;
}) {
	return (
		<div
			className="flex flex-wrap items-center gap-2 px-3 text-meta text-text-2"
			data-testid="composer-conflict"
		>
			<span>
				Draft edited on another device
				{at ? ` at ${formatClock(at)}` : ""}
			</span>
			{/* A rare choice: one control, both copies in its menu (#1101). */}
			<SurfaceMore
				id="draft.conflict"
				ctx={{ keepMine: onKeepMine, useTheirs: onUseTheirs, facts: {} }}
				open={open}
				trigger={
					<button
						type="button"
						aria-label="Choose which draft to keep"
						className="inline-flex min-h-6 items-center gap-1 rounded-control px-1.5 text-meta font-medium text-text-1 outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent"
						data-testid="composer-conflict-choose"
					>
						Choose
						<ChevronDown aria-hidden className="size-3 text-text-3" />
					</button>
				}
			/>
		</div>
	);
}

const KEYCAP =
	"inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-surface-4 px-1 font-mono text-[11px] text-text-1";

/** The queue's Enter (shortcut sheet: "Send, at the agent's next pause"). */
export const QUEUE_HINT = "Enter queues it for the agent's next pause";
/** No agent takes words mid-turn, so steering stops the step and sends at once (#1101). */
export const STEER_HINT =
	"Ctrl+Enter steers now: stops the agent's step and sends";

/**
 * While the agent works, what Enter and Ctrl+Enter do with the box's words:
 * keycaps beside Send, never buttons. Phones have no keys, so they hide there.
 */
export function SendKeys() {
	const caps: { id: string; state: string; hint: string; keys: string[] }[] = [
		{ id: "queue", state: "queued", hint: QUEUE_HINT, keys: ["↵"] },
		{ id: "steer", state: "steered", hint: STEER_HINT, keys: ["Ctrl", "↵"] },
	];
	return (
		<span
			className="inline-flex items-center gap-2 max-md:hidden"
			data-testid="composer-send-keys"
		>
			{caps.map((c) => {
				const look = markLook("delivery", c.state);
				return (
					<Hint key={c.id} label={c.hint} side="top">
						<span
							role="img"
							aria-label={c.hint}
							className="inline-flex items-center gap-1"
							data-mark="delivery"
							data-state={c.state}
							data-testid={`composer-key-${c.id}`}
						>
							<look.icon
								aria-hidden
								className={cn(
									"size-3.5 shrink-0 stroke-[1.75]",
									look.className,
								)}
							/>
							{c.keys.map((k) => (
								<kbd key={k} className={KEYCAP}>
									{k}
								</kbd>
							))}
						</span>
					</Hint>
				);
			})}
		</span>
	);
}
