// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessId } from "@prismalens/config/harness";
import { runnableCommand } from "@prismalens/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useContext } from "react";
import { RunInTerminalSent } from "@/components/terminal/RunInTerminal";
import { Button } from "@/components/ui/button";
import { CommandChip } from "@/components/ui/command-chip";
import { harnessKeys } from "@/lib/api/hooks";
import { client } from "@/lib/api/orpc-client";
import { terminalStore, useTerminalState } from "@/lib/terminal/store";
import { useTerminalAvailability } from "@/lib/terminal/use-terminal-availability";
import { cn } from "@/lib/utils";

/** Each agent checked again once its staged command's tab ends (#1171, #1180). */
export function useRecheck(ids: readonly string[]) {
	return recheckWith(useQueryClient(), ids);
}

export function recheckWith(queryClient: QueryClient, ids: readonly string[]) {
	return () =>
		// One failed check still leaves the others' new status to show.
		void Promise.allSettled(
			ids.map((id) =>
				client.settings.harnesses.checkHarness({ id: id as HarnessId }),
			),
		)
			.then(() =>
				queryClient.invalidateQueries({ queryKey: harnessKeys.status() }),
			)
			.catch(() => {});
}

/** Whether a line can be staged here: a terminal panel, the host's terminal, and a line it runs. */
export function useCanStage(line: string): boolean {
	const hasPanel = useTerminalState((s) => s.hosts > 0);
	const availability = useTerminalAvailability();
	return hasPanel && !!availability?.available && !!runnableCommand(line);
}

/**
 * The agent's own command, staged in a new terminal tab; the user's Enter runs it, and
 * the tab's end checks `agents` again. Without a terminal it is a command to copy.
 */
export function StagedCommand({
	agents,
	command,
	label,
	testId,
	copyTestId = `${testId}-copy`,
	copyToo = false,
	className,
}: {
	agents: readonly string[];
	command: string;
	label: string;
	testId: string;
	copyTestId?: string;
	/** Also offer the command to copy beside the button. */
	copyToo?: boolean;
	className?: string;
}) {
	const sent = useContext(RunInTerminalSent);
	const recheck = useRecheck(agents);
	const line = `${command}; exit`;
	const canStage = useCanStage(line);
	// Beside the button the chip only copies: its own run would skip the recheck.
	const chip = (
		<CommandChip
			command={command}
			path={canStage}
			className={cn("relative z-10", className)}
			testId={copyTestId}
		/>
	);
	if (!canStage) return chip;
	return (
		<>
			<Button
				variant="secondary"
				size="sm"
				className={cn("relative z-10", className)}
				onClick={() => {
					terminalStore.stage(line, { fresh: true, onEnd: recheck });
					sent?.();
				}}
				data-testid={testId}
			>
				{label}
			</Button>
			{copyToo && chip}
		</>
	);
}
