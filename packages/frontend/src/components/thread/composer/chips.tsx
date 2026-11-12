// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronDown } from "lucide-react";
import { SurfaceMore } from "@/components/kit/Surface";
import { formatClock } from "@/lib/format-time";

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
