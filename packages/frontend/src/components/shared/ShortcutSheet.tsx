// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useShortcutRows } from "@/hooks/use-shortcuts";
import { keyCaps } from "@/lib/shortcuts";
import { Row } from "./Row";

/** The keyboard map, opened with `?`; it lists the registry Settings → Keyboard shortcuts remaps. */
export function ShortcutSheet({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const rows = useShortcutRows();
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="sm" data-testid="shortcut-sheet">
				<DialogHeader>
					<DialogTitle>Keyboard</DialogTitle>
					<DialogDescription>
						Keys work anywhere you are not typing. J/K works in the active
						thread or alert list.
					</DialogDescription>
				</DialogHeader>
				<div>
					{rows.map((row) => (
						<Row
							key={row.id}
							label={row.label}
							className="py-1"
							trailing={keyCaps(row.current)
								.flat()
								.map((k, i) => (
									<kbd
										// biome-ignore lint/suspicious/noArrayIndexKey: a binding may repeat a key.
										key={`${k}-${i}`}
										className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-surface-3 px-1 font-mono text-meta text-text-2"
									>
										{k}
									</kbd>
								))}
						/>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
