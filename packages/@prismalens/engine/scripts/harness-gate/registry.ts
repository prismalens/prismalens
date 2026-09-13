// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { claudeAcp, claudeNative, type Driver } from "./drivers.js";
import { opencodeAcp, opencodeNative } from "./opencode.js";

export const DRIVERS: Record<string, Driver> = Object.fromEntries(
	[claudeNative, claudeAcp, opencodeNative, opencodeAcp].map((d) => [d.id, d]),
);
