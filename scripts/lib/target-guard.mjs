// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One target's teardown across a signal and the normal end, run once. A signal that lands while the
 * target boots finds nothing to stop yet, so `adopt` stops it once boot returns (#1154).
 * @param {(code: number) => void} [setExitCode]
 */
export function targetGuard(
	setExitCode = (code) => {
		process.exitCode = code;
	},
) {
	/** @type {{ cleanup(): Promise<void> } | undefined} */
	let target;
	let cleaned = false;
	return {
		/** Stops the adopted target, if any; the first call's exit code wins. */
		async cleanup(/** @type {number} */ exitCode) {
			if (cleaned) return;
			cleaned = true;
			setExitCode(exitCode);
			await target?.cleanup();
		},
		/**
		 * @template {{ cleanup(): Promise<void> }} T
		 * @param {T} app the booted target
		 * @returns {Promise<T>}
		 */
		async adopt(app) {
			target = app;
			if (cleaned) {
				await app.cleanup();
				throw new Error("cancelled while the target was booting");
			}
			return app;
		},
	};
}
