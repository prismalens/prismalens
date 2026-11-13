// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect } from "react";
import { BottomPanel } from "@/components/shell/PanelShell";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { useAppCommand } from "@/lib/app-commands";
import { terminalStore } from "@/lib/terminal/store";
import { TerminalPanel } from "./TerminalPanel";

/**
 * The terminal in the layout's bottom panel (#931). Mounted once by the
 * authenticated layout; Ctrl+`, the sidebar's Terminal door and Run in
 * terminal open it. Hidden, it stays mounted, so its shells keep running.
 */
export function TerminalDock() {
	const { bottomPanel, setBottomPanel } = useLayoutPrefs();
	useAppCommand("terminal", () => setBottomPanel(!bottomPanel));

	useEffect(() => {
		const off = terminalStore.onOpenRequest(() => setBottomPanel(true));
		return () => {
			off();
		};
	}, [setBottomPanel]);

	return (
		<BottomPanel label="Terminal" open={bottomPanel}>
			<TerminalPanel open={bottomPanel} onHide={() => setBottomPanel(false)} />
		</BottomPanel>
	);
}
