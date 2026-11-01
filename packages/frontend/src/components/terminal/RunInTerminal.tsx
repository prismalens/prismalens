// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { runnableCommand } from "@prismalens/contracts";
import { createContext, useContext } from "react";
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
}: {
	command: string;
	onSent?: () => void;
}) {
	const hasPanel = useTerminalState((s) => s.hosts > 0);
	const sentFromContext = useContext(RunInTerminalSent);
	if (!hasPanel || !runnableCommand(command)) return null;
	return <WhenAvailable command={command} onSent={onSent ?? sentFromContext} />;
}

/** Asks the API only once a panel exists, so a page with no terminal makes no request. */
function WhenAvailable({
	command,
	onSent,
}: {
	command: string;
	onSent?: () => void;
}) {
	const availability = useTerminalAvailability();
	if (!availability?.available) return null;
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
			Run in terminal
		</Button>
	);
}
