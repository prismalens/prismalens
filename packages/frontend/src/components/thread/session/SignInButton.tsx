// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactElement } from "react";
import { KitPopover } from "@/components/kit/Popover";
import { CommandChip } from "@/components/ui/command-chip";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { useTerminalAvailability } from "@/lib/terminal/use-terminal-availability";

/**
 * Sign in for a signed-out agent (#1101 cat 23). On the host it opens the terminal to run
 * the command; a paired device can't open one, so it shows the command to run on the host.
 */
export function SignInButton({
	command,
	trigger,
}: {
	command: string;
	/** The button, from the surface it sits on (a dock strip or the run header). */
	trigger: (onClick?: () => void) => ReactElement;
}) {
	const { setBottomPanel } = useLayoutPrefs();
	const terminal = useTerminalAvailability();
	const paired =
		terminal?.available === false && terminal.reason === "not-host";
	if (!paired) return trigger(() => setBottomPanel(true));
	return (
		<KitPopover
			trigger={trigger()}
			family="card"
			side="top"
			align="end"
			label="Sign in on the host"
		>
			<div className="flex flex-col gap-2 p-2.5" data-testid="sign-in-on-host">
				<p className="text-body text-text-2">
					Run this on the machine PrismaLens runs on. Once it is signed in,
					Retry picks the thread up where it stopped.
				</p>
				<CommandChip command={command} wrap testId="sign-in-command" />
			</div>
		</KitPopover>
	);
}
