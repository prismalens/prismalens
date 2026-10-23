// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** What the window is connected to, for the tray's status lines. */
export interface ServerView {
	ready: boolean;
	/** This app spawned the backend, rather than attaching to a `pl up`. */
	owned: boolean;
	baseUrl: string;
	/** Set when the window uses a `pl` inside WSL; the distro is null when unnamed. */
	wsl: { distro: string | null } | null;
}

function portOf(baseUrl: string): string {
	try {
		const url = new URL(baseUrl);
		return url.port || (url.protocol === "https:" ? "443" : "80");
	} catch {
		return "?";
	}
}

/** The server's state; investigations are counted on their own line. */
export function serverLabel(view: ServerView): string {
	if (!view.ready) return "Server stopped";
	if (view.wsl)
		return `Using the server in WSL (${view.wsl.distro ?? "default distro"})`;
	return view.owned
		? `Server running on port ${portOf(view.baseUrl)}`
		: `Using the server on port ${portOf(view.baseUrl)}`;
}

export function runningLabel(count: number): string {
	return count === 1
		? "1 investigation running"
		: `${count} investigations running`;
}

/** The tray's disabled status lines and its tooltip (#908). */
export function trayStatus(
	view: ServerView,
	running: number,
): { lines: string[]; tooltip: string } {
	const lines = [
		serverLabel(view),
		...(view.ready && running > 0 ? [runningLabel(running)] : []),
	];
	return { lines, tooltip: `PrismaLens: ${lines.join(", ")}` };
}
