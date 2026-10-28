// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import "@xterm/xterm/css/xterm.css";
import {
	TERMINAL_SOCKET_PATH,
	TerminalServerFrameSchema,
} from "@prismalens/contracts";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { client } from "@/lib/api/orpc-client";
import { terminalKey } from "@/lib/terminal/key";
import { terminalStore } from "@/lib/terminal/store";

/** Reads the app's tokens so the terminal follows light and dark like every other surface. */
function themeFromTokens(): {
	background: string;
	foreground: string;
	cursor: string;
	selectionBackground: string;
} {
	const css = getComputedStyle(document.documentElement);
	const token = (name: string) => css.getPropertyValue(name).trim();
	return {
		background: token("--surface-1"),
		foreground: token("--text-1"),
		cursor: token("--text-1"),
		selectionBackground: token("--surface-4"),
	};
}

/**
 * One shell on the host (#931). It lives exactly as long as its socket: a
 * reload or a closed tab ends the shell, so there is no replay to sanitise.
 * Output is acknowledged after xterm writes it; the server pauses the shell
 * while too much is unacknowledged.
 */
export function TerminalView({
	tabId,
	active,
}: {
	tabId: number;
	active: boolean;
}) {
	const host = useRef<HTMLDivElement>(null);
	const term = useRef<Terminal | null>(null);
	const fit = useRef<FitAddon | null>(null);
	const [problem, setProblem] = useState<string | null>(null);

	useEffect(() => {
		const el = host.current;
		if (!el) return;
		const xterm = new Terminal({
			fontFamily:
				getComputedStyle(document.documentElement).getPropertyValue(
					"--font-mono",
				) || "monospace",
			fontSize: 13,
			cursorBlink: !matchMedia("(prefers-reduced-motion: reduce)").matches,
			allowProposedApi: true,
			theme: themeFromTokens(),
			scrollback: 5000,
		});
		const fitter = new FitAddon();
		xterm.loadAddon(fitter);
		xterm.loadAddon(new WebLinksAddon());
		xterm.loadAddon(new Unicode11Addon());
		xterm.unicode.activeVersion = "11";
		xterm.open(el);
		fitter.fit();
		term.current = xterm;
		fit.current = fitter;

		let socket: WebSocket | null = null;
		let disposed = false;
		const send = (frame: Parameters<typeof terminalStore.send>[1]) => {
			if (socket?.readyState === WebSocket.OPEN)
				socket.send(JSON.stringify(frame));
		};
		const detach = terminalStore.attachSender(tabId, send);
		const input = xterm.onData((d) => send({ t: "in", d }));
		const resized = xterm.onResize(({ cols, rows }) =>
			send({ t: "resize", cols, rows }),
		);

		void (async () => {
			try {
				const { ticket } = await client.terminal.ticket({ key: terminalKey() });
				if (disposed) return;
				const scheme = location.protocol === "https:" ? "wss" : "ws";
				const query = new URLSearchParams({
					ticket,
					cols: String(xterm.cols),
					rows: String(xterm.rows),
				});
				socket = new WebSocket(
					`${scheme}://${location.host}${TERMINAL_SOCKET_PATH}?${query}`,
				);
				socket.binaryType = "arraybuffer";
				socket.onmessage = (event) => {
					if (typeof event.data === "string") {
						const frame = TerminalServerFrameSchema.safeParse(
							JSON.parse(event.data),
						);
						if (frame.success && frame.data.t === "exit")
							terminalStore.markExited(tabId, frame.data.code);
						return;
					}
					const bytes = new Uint8Array(event.data as ArrayBuffer);
					xterm.write(bytes, () => send({ t: "ack", n: bytes.length }));
				};
				socket.onclose = () => {
					if (
						!disposed &&
						terminalStore.get().tabs.find((t) => t.id === tabId)?.exitCode ===
							undefined
					)
						terminalStore.markExited(tabId, null);
				};
			} catch {
				if (!disposed)
					setProblem(
						"The terminal couldn't start. Close this tab and open a new one.",
					);
			}
		})();

		const observer = new ResizeObserver(() => fitter.fit());
		observer.observe(el);
		const retheme = new MutationObserver(() => {
			xterm.options.theme = themeFromTokens();
		});
		retheme.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});

		return () => {
			disposed = true;
			observer.disconnect();
			retheme.disconnect();
			input.dispose();
			resized.dispose();
			detach();
			socket?.close();
			xterm.dispose();
			term.current = null;
		};
	}, [tabId]);

	useEffect(() => {
		if (!active) return;
		fit.current?.fit();
		term.current?.focus();
	}, [active]);

	return (
		<div className="flex min-h-0 flex-1 flex-col" hidden={!active}>
			{problem ? (
				<p className="p-3 text-text-2 text-body">{problem}</p>
			) : (
				<div
					ref={host}
					className="min-h-0 flex-1 px-2 py-1"
					aria-label="Terminal"
				/>
			)}
		</div>
	);
}
