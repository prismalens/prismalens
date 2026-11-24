// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** `shell: true` takes `command` as one string, which npm's .cmd shim on Windows needs. */
export function installWithRetry(
	command: string,
	args: string[],
	options?: {
		stdout?: "inherit" | "ignore";
		delays?: number[];
		shell?: boolean;
	},
): string;
