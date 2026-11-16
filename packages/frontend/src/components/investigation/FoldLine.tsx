// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { PlMark } from "@/components/run/PlMark";

/**
 * A folded turn's one line: its own work, then PrismaLens's actions behind the PL mark,
 * so the two halves read apart at a glance (#1101 cat 9.1).
 */
export function FoldLine({ work, pl }: { work: string; pl?: string | null }) {
	return (
		<span className="flex min-w-0 items-center gap-1.5">
			<span className="min-w-0 truncate">{work}</span>
			{pl && (
				<span
					className="flex min-w-0 shrink items-center gap-1 text-text-2"
					data-testid="fold-pl"
				>
					<span aria-hidden className="text-text-3">
						·
					</span>
					<PlMark />
					<span className="min-w-0 truncate">PrismaLens: {pl}</span>
				</span>
			)}
		</span>
	);
}
