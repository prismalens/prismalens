// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import { CommandChip } from "@/components/ui/command-chip";
import { signInCommand } from "@/lib/failure-words";
import { cn } from "@/lib/utils";
import { StagedCommand } from "./StagedCommand";

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
		return (
			<StagedCommand
				agents={[agent.id]}
				command={command}
				label="Sign in"
				testId={`sign-in-${agent.id}`}
				copyTestId={`sign-in-copy-${agent.id}`}
				className={className}
			/>
		);
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
