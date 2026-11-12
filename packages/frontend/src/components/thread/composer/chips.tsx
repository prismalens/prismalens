// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Button } from "@/components/ui/button";

/** The server's draft moved past this browser's journal (#1024). */
export function ConflictLine({
	onKeepMine,
	onUseTheirs,
}: {
	onKeepMine: () => void;
	onUseTheirs: () => void;
}) {
	return (
		<div
			className="flex flex-wrap items-center gap-2 px-3 text-meta text-text-2"
			data-testid="composer-conflict"
		>
			Changed on another device
			<Button
				variant="text"
				size="sm"
				onClick={onKeepMine}
				data-testid="composer-keep-mine"
			>
				Keep mine
			</Button>
			<Button
				variant="text"
				size="sm"
				onClick={onUseTheirs}
				data-testid="composer-use-theirs"
			>
				Use theirs
			</Button>
		</div>
	);
}
