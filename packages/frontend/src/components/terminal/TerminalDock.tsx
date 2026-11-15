// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Ring } from "@/components/shared/Ring";
import { BottomPanel } from "@/components/shell/PanelShell";
import { Button } from "@/components/ui/button";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { useAppCommand } from "@/lib/app-commands";
import { lazyPart } from "@/lib/lazy";
import { terminalStore } from "@/lib/terminal/store";

/** The terminal's code loads on its first open, not with every page (#1101 category 12). */
const TerminalPanel = lazyPart(
	() => import("./TerminalPanel").then((m) => m.TerminalPanel),
	(p: { onHide?: () => void }) => <TerminalLoading onHide={p.onHide} />,
	{ now: true },
);

/** The panel's place while its code loads on a slow link: a word and the close, never a blank strip. */
function TerminalLoading({ onHide }: { onHide?: () => void }) {
	return (
		<section
			aria-label="Terminal"
			className="flex h-full min-h-0 flex-col bg-surface-1"
			data-testid="terminal-loading"
		>
			<div className="flex h-9 flex-none items-center justify-end pr-1.5">
				<Button
					type="button"
					variant="text"
					size="icon-sm"
					aria-label="Hide the terminal"
					onClick={onHide}
				>
					<X aria-hidden />
				</Button>
			</div>
			<p
				role="status"
				className="m-0 flex flex-1 items-center justify-center gap-2 text-body text-text-2"
			>
				<Ring className="size-3.5" />
				Opening the terminal
			</p>
		</section>
	);
}

/**
 * The terminal in the layout's bottom panel (#931). Mounted once by the
 * authenticated layout; Ctrl+`, the sidebar's Terminal door and Run in
 * terminal open it. Hidden, it stays mounted, so its shells keep running.
 */
export function TerminalDock() {
	const { bottomPanel, setBottomPanel } = useLayoutPrefs();
	const [opened, setOpened] = useState(bottomPanel);
	if (bottomPanel && !opened) setOpened(true);
	// The dock is the host before its panel's code loads, so Run in terminal shows from the start.
	useEffect(() => terminalStore.registerHost(), []);
	useAppCommand("terminal", () => setBottomPanel(!bottomPanel));

	useEffect(() => {
		const off = terminalStore.onOpenRequest(() => setBottomPanel(true));
		return () => {
			off();
		};
	}, [setBottomPanel]);

	return (
		<BottomPanel label="Terminal" open={bottomPanel}>
			{opened && (
				<TerminalPanel
					open={bottomPanel}
					onHide={() => setBottomPanel(false)}
				/>
			)}
		</BottomPanel>
	);
}
