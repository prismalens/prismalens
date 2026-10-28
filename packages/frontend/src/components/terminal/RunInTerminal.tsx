// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { runnableCommand } from "@prismalens/contracts";
import { Button } from "@/components/ui/button";
import { terminalStore, useTerminalState } from "@/lib/terminal/store";
import { useTerminalAvailability } from "@/lib/terminal/use-terminal-availability";

/**
 * Stages a command in the terminal; the user's Enter runs it (#931). Shown only
 * where a terminal can open: on the host, with a mounted panel, for text with
 * no control characters. Everywhere else the command keeps Copy alone.
 */
export function RunInTerminal({ command }: { command: string }) {
	const hasPanel = useTerminalState((s) => s.hosts > 0);
	const availability = useTerminalAvailability();
	if (!hasPanel || !availability?.available || !runnableCommand(command))
		return null;
	return (
		<Button
			type="button"
			variant="secondary"
			size="sm"
			data-testid="run-in-terminal"
			onClick={() => terminalStore.stage(command)}
		>
			Run in terminal
		</Button>
	);
}
