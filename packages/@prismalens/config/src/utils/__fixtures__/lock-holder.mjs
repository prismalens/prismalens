// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A stand-in for `pl up` for the signal tests: takes the workspace lock, then
 * releases it from a signal handler the way the API's Nest shutdown hook does.
 *
 * It is a real child process because that is the only way to observe what Node
 * actually does with `exit` listeners on a signal — the behaviour this guards
 * against cannot be reproduced in-process.
 *
 * argv: <dist-entry> <workspaceDir> [--hang]
 *   --hang never finishes its shutdown, so the test can send a second signal
 *   and watch the forced exit pre-empt it.
 */
import { argv, exit, kill, pid, stdout } from "node:process";

const [, , entry, workspaceDir, ...flags] = argv;
const hang = flags.includes("--hang");

const {
	acquireWorkspaceLock,
	armForcedExitOnSecondSignal,
	disarmForcedExit,
	releaseWorkspaceLock,
} = await import(entry);

acquireWorkspaceLock(workspaceDir, { port: 3999 });

const signals = ["SIGTERM", "SIGINT"];
armForcedExitOnSecondSignal(signals);

let shuttingDown = false;
for (const signal of signals) {
	process.on(signal, () => {
		if (shuttingDown) return; // exactly what Nest does: ignore the second
		shuttingDown = true;
		if (hang) return; // never completes; the forced-exit path takes over
		// What `WorkspaceLockShutdownService.onApplicationShutdown` does, in the
		// same order, followed by Nest's re-raise with no listener left.
		disarmForcedExit();
		releaseWorkspaceLock();
		for (const s of signals) process.removeAllListeners(s);
		kill(pid, signal);
	});
}

stdout.write(`ready ${pid}\n`);
// Keep the event loop alive the way a listening server would.
setInterval(() => {}, 1_000);
