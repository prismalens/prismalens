// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { GO_SHORTCUTS } from "@/hooks/use-global-shortcuts";

function Kbd({ children }: { children: string }) {
	return (
		<kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-mono text-meta text-foreground">
			{children}
		</kbd>
	);
}

const ROWS: { keys: string[]; label: string }[] = [
	...GO_SHORTCUTS.map((s) => ({
		keys: ["g", s.key],
		label: `Go to ${s.label}`,
	})),
	{ keys: ["j", "k"], label: "Move down / up a row" },
	{ keys: ["Enter"], label: "Open the highlighted row" },
	{ keys: ["/"], label: "Focus the composer on a record" },
	{ keys: ["Esc"], label: "Clear the highlight or the composer" },
	{ keys: ["?"], label: "This sheet" },
];

/** The keyboard map, opened with `?`. */
export function ShortcutSheet({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-sm" data-testid="shortcut-sheet">
				<DialogHeader>
					<DialogTitle>Keyboard</DialogTitle>
					<DialogDescription>
						Keys work anywhere you are not typing.
					</DialogDescription>
				</DialogHeader>
				<dl className="space-y-2">
					{ROWS.map((row) => (
						<div
							key={row.label}
							className="flex items-center justify-between gap-4"
						>
							<dt className="text-record">{row.label}</dt>
							<dd className="flex items-center gap-1">
								{row.keys.map((k) => (
									<Kbd key={k}>{k}</Kbd>
								))}
							</dd>
						</div>
					))}
				</dl>
			</DialogContent>
		</Dialog>
	);
}
