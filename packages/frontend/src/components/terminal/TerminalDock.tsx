// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect, useState } from "react";
import { BottomPanel } from "@/components/shell/PanelShell";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { lazyPart } from "@/lib/lazy";
import { matches } from "@/lib/shortcuts";
import { terminalStore } from "@/lib/terminal/store";

/** The terminal's code loads on its first open, not with every page (#1101 category 12). */
const TerminalPanel = lazyPart(() =>
	import("./TerminalPanel").then((m) => m.TerminalPanel),
);

const isToggleKey = (e: KeyboardEvent) => matches(e, "terminal");

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
			{opened && (
				<TerminalPanel
					open={bottomPanel}
					onHide={() => setBottomPanel(false)}
				/>
			)}
		</BottomPanel>
	);
}
