// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export interface ReplayFrame {
	dir: "in" | "out";
	at: string;
	frame: Record<string, unknown>;
}

export const REPLAY_MISMATCH_EXIT: number;
export function loadReplayFrames(path: string): ReplayFrame[];
export function runReplay(path: string, options?: { strict?: boolean }): void;
