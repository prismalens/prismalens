// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessId } from "@prismalens/config/harness";
import { type HarnessStatus, runnableCommand } from "@prismalens/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useContext } from "react";
import { RunInTerminalSent } from "@/components/terminal/RunInTerminal";
import { Button } from "@/components/ui/button";
import { CommandChip } from "@/components/ui/command-chip";
import { harnessKeys } from "@/lib/api/hooks";
import { client } from "@/lib/api/orpc-client";
import { signInCommand } from "@/lib/failure-words";
import { terminalStore, useTerminalState } from "@/lib/terminal/store";
import { useTerminalAvailability } from "@/lib/terminal/use-terminal-availability";
import { cn } from "@/lib/utils";

/**
 * The agent's own login, staged in a new terminal tab; the user's Enter runs it (#931).
 * When that tab ends, the agent is checked again. PrismaLens stores nothing (#1171).
 */
export function SignInButton({
	agent,
	className,
}: {
	agent: HarnessStatus;
	className?: string;
}) {
	if (agent.checked?.outcome !== "sign-in-needed") return null;
	const command = agent.signIn?.command;
	if (command)
		return <SignIn agent={agent} command={command} className={className} />;
	// No command it can stage here: its own hint's command, to copy.
	const hinted = signInCommand(agent.loginHint);
	return hinted ? (
		<CommandChip
			command={hinted}
			className={cn("relative z-10", className)}
			testId={`sign-in-copy-${agent.id}`}
		/>
	) : null;
}

function SignIn({
	agent,
	command,
	className,
}: {
	agent: HarnessStatus;
	command: string;
	className?: string;
}) {
	const hasPanel = useTerminalState((s) => s.hosts > 0);
	const availability = useTerminalAvailability();
	const sent = useContext(RunInTerminalSent);
	const queryClient = useQueryClient();
	const line = `${command}; exit`;
	if (!hasPanel || !availability?.available || !runnableCommand(line))
		return (
			<CommandChip
				command={command}
				className={cn("relative z-10", className)}
				testId={`sign-in-copy-${agent.id}`}
			/>
		);
	const recheck = () =>
		void client.settings.harnesses
			.checkHarness({ id: agent.id as HarnessId })
			.then(() =>
				queryClient.invalidateQueries({ queryKey: harnessKeys.status() }),
			)
			.catch(() => {});
	return (
		<Button
			variant="secondary"
			size="sm"
			className={cn("relative z-10", className)}
			onClick={() => {
				terminalStore.stage(line, { fresh: true, onEnd: recheck });
				sent?.();
			}}
			data-testid={`sign-in-${agent.id}`}
		>
			Sign in
		</Button>
	);
}
