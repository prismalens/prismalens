// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).
import {
	type AccessLevel,
	DEFAULT_ACCESS_LEVEL,
	type HarnessId,
} from "@prismalens/config/harness";
import type { LocalDefault } from "./settings.js";

/** Where a run's level came from, for the default row's tag. */
export type AxisSource = "settings" | "agent" | "prismalens";

type AxisSettings<K extends string, V> = Partial<
	Record<K, Partial<Record<HarnessId, V>> | undefined>
>;

/**
 * A run an alert starts has nobody to answer an ask: the agent runs its Auto mode and
 * PrismaLens refuses whatever it still asks, as headless agent runs do (#818 w5-29).
 */
export const AUTO_START_ACCESS_LEVEL: AccessLevel = "auto";

/** An alert-started run: Auto. A run you start: Settings, then the agent's own default, then PrismaLens's. */
export function effectiveAccess(
	s: AxisSettings<"accessLevels", AccessLevel>,
	harness: HarnessId,
	local: LocalDefault["permission"] | undefined,
	autoStart = false,
): { level: AccessLevel; from: AxisSource } {
	if (autoStart) return { level: AUTO_START_ACCESS_LEVEL, from: "prismalens" };
	const set = s.accessLevels?.[harness];
	if (set) return { level: set, from: "settings" };
	if (local?.level) return { level: local.level, from: "agent" };
	return { level: DEFAULT_ACCESS_LEVEL, from: "prismalens" };
}
