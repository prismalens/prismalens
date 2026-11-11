// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Button } from "@/components/ui/button";
import { tokenCount } from "./session-words";

export type ColdChoice = "compact" | "send" | "fresh";

/** The send body each choice adds: `compact: true`, nothing, or `fresh: true`. */
export function coldSendFields(
	choice: ColdChoice,
): { compact: true } | { fresh: true } | Record<string, never> {
	if (choice === "compact") return { compact: true };
	if (choice === "fresh") return { fresh: true };
	return {};
}

/**
 * Sending into a conversation that has gone cold: three ways on. The draft
 * stays in the composer until one is chosen.
 */
export function ColdDock({
	tokens,
	canCompact,
	onChoose,
	onCancel,
	pending = false,
}: {
	tokens: number;
	canCompact: boolean;
	onChoose: (choice: ColdChoice) => void;
	onCancel?: () => void;
	pending?: boolean;
}) {
	return (
		<section
			aria-label="This conversation has gone cold"
			className="grid gap-2 rounded-surface bg-surface-2 px-3 py-2.5"
			data-testid="cold-dock"
		>
			<p className="text-body text-text-1">This conversation has gone cold</p>
			<div className="flex flex-wrap gap-2">
				{canCompact && (
					<Button
						size="sm"
						disabled={pending}
						onClick={() => onChoose("compact")}
						data-testid="cold-dock-compact"
					>
						Compact, then send
					</Button>
				)}
				<Button
					size="sm"
					variant="secondary"
					disabled={pending}
					onClick={() => onChoose("send")}
					data-testid="cold-dock-send"
				>
					Send as is
				</Button>
				<Button
					size="sm"
					variant="secondary"
					disabled={pending}
					onClick={() => onChoose("fresh")}
					data-testid="cold-dock-fresh"
				>
					Start fresh with a summary
				</Button>
				{onCancel && (
					<Button
						size="sm"
						variant="text"
						onClick={onCancel}
						data-testid="cold-dock-cancel"
					>
						Cancel
					</Button>
				)}
			</div>
			<p className="text-meta text-text-3" data-testid="cold-dock-cost">
				Send as is re-reads about {tokenCount(tokens)} tokens
			</p>
		</section>
	);
}
