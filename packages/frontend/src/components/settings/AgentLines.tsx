// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type HarnessStatus, runnableCommand } from "@prismalens/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useContext } from "react";
import { RunInTerminalSent } from "@/components/terminal/RunInTerminal";
import { CommandChip } from "@/components/ui/command-chip";
import { terminalStore, useTerminalState } from "@/lib/terminal/store";
import { useTerminalAvailability } from "@/lib/terminal/use-terminal-availability";
import type { AgentCtx } from "./agent.actions";
import { recheckWith, StagedCommand } from "./StagedCommand";

/** The agent's update shows as a button only when it is older than tested or a newer release is out (#1180). */
export function updateDue(h: HarnessStatus): boolean {
	return !!h.update && (h.versionVsTested === "older" || !!h.newerRelease);
}

/** The command an update stages; null when the update is a line to read. */
const updateCommandOf = (h: HarnessStatus) =>
	h.update && "command" in h.update ? h.update.command : null;

/** Update all's one line: every due update command joined by `; `, valid in PowerShell 5.1 and POSIX shells; null under two. */
export function updateAllLine(
	agents: readonly HarnessStatus[],
): { command: string; ids: string[] } | null {
	const due = agents.flatMap((h) => {
		const command = updateDue(h) ? updateCommandOf(h) : null;
		return command ? [{ id: h.id, command }] : [];
	});
	if (due.length < 2) return null;
	return {
		command: due.map((d) => d.command).join("; "),
		ids: due.map((d) => d.id),
	};
}

/**
 * Stages a command in a fresh terminal and checks `ids` again when it ends. `can` is false
 * without a terminal here; the menu rows then hide, and the buttons offer a copy instead.
 */
export function useStager() {
	const hasPanel = useTerminalState((s) => s.hosts > 0);
	const availability = useTerminalAvailability();
	const sent = useContext(RunInTerminalSent);
	const queryClient = useQueryClient();
	const can = (command: string | null | undefined): command is string =>
		!!command &&
		hasPanel &&
		!!availability?.available &&
		!!runnableCommand(`${command}; exit`);
	const stage = (ids: readonly string[], command: string) => {
		terminalStore.stage(`${command}; exit`, {
			fresh: true,
			onEnd: recheckWith(queryClient, ids),
		});
		sent?.();
	};
	return { can, stage };
}

/** The ⋯ menu's context for one agent: each row present only while its line can be staged. */
export function useAgentCtx(h: HarnessStatus): AgentCtx {
	const { can, stage } = useStager();
	const update = updateCommandOf(h);
	const signOut = h.signOut?.command;
	const account = h.switchAccount?.command;
	return {
		update: () => can(update) && stage([h.id], update),
		signOut: () => can(signOut) && stage([h.id], signOut),
		changeAccount: () => can(account) && stage([h.id], account),
		updateAll: () => {},
		facts: {
			is: {
				canUpdate: can(update),
				canSignOut: can(signOut),
				canChangeAccount: can(account),
			},
		},
	};
}

/** The Agents list's context: Update all only. */
export function useAgentListCtx(list: readonly HarnessStatus[]): AgentCtx {
	const { can, stage } = useStager();
	const all = updateAllLine(list);
	const none = () => {};
	return {
		update: none,
		signOut: none,
		changeAccount: none,
		updateAll: () => all && can(all.command) && stage(all.ids, all.command),
		facts: { is: { canUpdateAll: can(all?.command) } },
	};
}

/** Update beside Sign in when it is due: the staged command and a copy, or the agent's own line to copy. */
export function UpdateButton({ agent }: { agent: HarnessStatus }) {
	if (!updateDue(agent) || !agent.update) return null;
	if ("line" in agent.update)
		return (
			<CommandChip
				command={agent.update.line}
				path
				className="relative z-10"
				testId={`update-line-${agent.id}`}
			/>
		);
	return (
		<StagedCommand
			agents={[agent.id]}
			command={agent.update.command}
			label="Update"
			testId={`update-${agent.id}`}
			copyToo
		/>
	);
}

/** Sign out and Change account under the account line, staged like Sign in. */
export function AccountButtons({ agent }: { agent: HarnessStatus }) {
	return (
		<>
			{agent.switchAccount && (
				<StagedCommand
					agents={[agent.id]}
					command={agent.switchAccount.command}
					label="Change account"
					testId={`change-account-${agent.id}`}
				/>
			)}
			{agent.signOut && (
				<StagedCommand
					agents={[agent.id]}
					command={agent.signOut.command}
					label="Sign out"
					testId={`sign-out-${agent.id}`}
				/>
			)}
		</>
	);
}

/** The Agents list's Update all: one fresh terminal for every due update. */
export function UpdateAllButton({
	agents,
}: {
	agents: readonly HarnessStatus[];
}) {
	const all = updateAllLine(agents);
	if (!all) return null;
	return (
		<StagedCommand
			agents={all.ids}
			command={all.command}
			label="Update all"
			testId="agents-update-all"
		/>
	);
}
