// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { NEW_INCIDENT_KEY } from "@/components/shell/NewIncident";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { GO_SHORTCUTS } from "@/hooks/use-global-shortcuts";
import { Row } from "./Row";

const ROWS: { keys: string[]; label: string }[] = [
	{ keys: [NEW_INCIDENT_KEY.toUpperCase()], label: "New incident" },
	...GO_SHORTCUTS.map((s) => ({
		keys: ["G", s.key.toUpperCase()],
		label: `Go to ${s.label}`,
	})),
	{ keys: ["J", "K"], label: "Move down or up a row" },
	{ keys: ["Enter"], label: "Open the highlighted row" },
	{ keys: ["1", "4"], label: "Jump to a column on the board" },
	{ keys: ["["], label: "Fold the sidebar to its icons" },
	{ keys: ["Esc"], label: "Go back" },
	{ keys: ["Enter"], label: "Send, at the agent's next pause" },
	{ keys: ["Ctrl", "Enter"], label: "Send now, ending the agent's step" },
	{ keys: ["Shift", "Enter"], label: "New line in the box" },
	{ keys: ["Esc"], label: "Stop the agent, from the box while it works" },
	{ keys: ["?"], label: "This sheet" },
];

/** The keyboard map, opened with `?`; the only place keys are listed (decision 9). */
export function ShortcutSheet({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="sm" data-testid="shortcut-sheet">
				<DialogHeader>
					<DialogTitle>Keyboard</DialogTitle>
					<DialogDescription>
						Keys work anywhere you are not typing.
					</DialogDescription>
				</DialogHeader>
				<div>
					{ROWS.map((row) => (
						<Row
							key={row.label}
							label={row.label}
							className="py-1"
							trailing={row.keys.map((k) => (
								<kbd
									key={k}
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
