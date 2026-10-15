// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export type KubectlScenario =
	| "crashloop"
	| "rollout-before-alert"
	| "forbidden"
	| "slow"
	| "huge-logs";

export const KUBECTL_FIXTURES_DIR: string;
export const FAKE_KUBECTL_PATH: string;
export const KUBECTL_SCENARIOS: KubectlScenario[];
export function argvLogPath(binDir: string): string;
export function installFakeKubectl(
	binDir: string,
	scenario: KubectlScenario,
): string;
/** Every argv the fake answered since the log was last removed, oldest first. */
export function readArgvLog(binDir: string): string[][];
