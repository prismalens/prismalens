// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect } from "react";
import { BottomPanel } from "@/components/shell/PanelShell";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { terminalStore } from "@/lib/terminal/store";
import { TerminalPanel } from "./TerminalPanel";

const isToggleKey = (e: KeyboardEvent) =>
	e.ctrlKey && !e.altKey && !e.metaKey && e.code === "Backquote";

/**
 * The terminal in the layout's bottom panel (#931). Mounted once by the
 * authenticated layout; Ctrl+`, the sidebar's Terminal door and Run in
 * terminal open it. Hidden, it stays mounted, so its shells keep running.
 */
export function TerminalDock() {
	const { bottomPanel, setBottomPanel } = useLayoutPrefs();

	useEffect(() => {
		const off = terminalStore.onOpenRequest(() => setBottomPanel(true));
		return () => {
			off();
		};
	}, [setBottomPanel]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!isToggleKey(e)) return;
			e.preventDefault();
			e.stopPropagation();
			setBottomPanel(!bottomPanel);
		};
		// Capture, so xterm's own key handling never swallows it.
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [bottomPanel, setBottomPanel]);

	return (
		<BottomPanel label="Terminal" open={bottomPanel}>
			<TerminalPanel open={bottomPanel} onHide={() => setBottomPanel(false)} />
		</BottomPanel>
	);
}
