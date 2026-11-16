// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Preloaded into the runtime the npm launcher starts (#717). A signal sent to the whole group
// (systemd's control-group stop, a terminal's Ctrl-C) reaches this process and the launcher;
// the launcher's forward of that same signal is dropped here, so the app sees it once.
const SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"];
const WINDOW_MS = 2000;
const seen = new Map();

for (const signal of SIGNALS) {
	const mark = () => {
		seen.set(signal, Date.now());
		// Alone, this listener would swallow the signal; restore the default instead.
		if (process.listenerCount(signal) === 1) {
			process.removeListener(signal, mark);
			process.kill(process.pid, signal);
		}
	};
	process.on(signal, mark);
}

if (process.channel) {
	process.on("message", (message) => {
		const signal = message?.prismalensSignal;
		if (!SIGNALS.includes(signal)) return;
		if (Date.now() - (seen.get(signal) ?? 0) < WINDOW_MS) return;
		process.kill(process.pid, signal);
	});
	process.channel.unref();
}
