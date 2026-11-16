// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The `auto-resume` bodies the dock's controls send. */
export const autoResumeBody = {
	dontResume: () => ({ on: false }) as const,
	sendAtReset: (message: string) => ({ on: true, message }) as const,
	resumeAtReset: () => ({ on: true }) as const,
	removeQueued: (on: boolean) => ({ on, message: null }) as const,
};
