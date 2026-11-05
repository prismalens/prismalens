// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { runnableCommand } from "@prismalens/contracts";
import { SquareTerminal } from "lucide-react";
import { createContext, useContext } from "react";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { terminalStore, useTerminalState } from "@/lib/terminal/store";
import { useTerminalAvailability } from "@/lib/terminal/use-terminal-availability";

/** Called after a command is staged; a dialog provides it to close itself, since its scrim would cover the staged line. */
export const RunInTerminalSent = createContext<(() => void) | undefined>(
	undefined,
);

/**
 * Stages a command in the terminal; the user's Enter runs it (#931). Shown only
 * where a terminal can open: on the host, with a mounted panel, for text with
 * no control characters. Everywhere else the command keeps Copy alone.
 */
export function RunInTerminal({
	command,
	onSent,
	compact,
}: {
	command: string;
	onSent?: () => void;
	/** An icon in a code block's corner, for a command the agent asks you to run. */
	compact?: boolean;
}) {
	const hasPanel = useTerminalState((s) => s.hosts > 0);
	const sentFromContext = useContext(RunInTerminalSent);
	if (!hasPanel || !runnableCommand(command)) return null;
	return (
		<WhenAvailable
			command={command}
			onSent={onSent ?? sentFromContext}
			compact={compact}
		/>
	);
}

/** Asks the API only once a panel exists, so a page with no terminal makes no request. */
function WhenAvailable({
	command,
	onSent,
	compact,
}: {
	command: string;
	onSent?: () => void;
	compact?: boolean;
}) {
	const availability = useTerminalAvailability();
	if (!availability?.available) return null;
	if (compact)
		return (
			<Hint label="Send to terminal. You press Enter to run it.">
				<button
					type="button"
					aria-label="Send to terminal"
					className="flex size-6 items-center justify-center rounded-control text-text-3 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1"
					data-testid="run-in-terminal"
					onClick={() => {
						terminalStore.stage(command);
						onSent?.();
					}}
				>
					<SquareTerminal aria-hidden className="size-3.5" />
				</button>
			</Hint>
		);
	return (
		<Button
			type="button"
			variant="secondary"
			size="sm"
			data-testid="run-in-terminal"
			onClick={() => {
				terminalStore.stage(command);
				onSent?.();
			}}
		>
			Send to terminal
		</Button>
	);
}
