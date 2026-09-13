// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { claudeAcp, claudeNative } from "./drivers.js";
import { opencodeAcp, opencodeNative } from "./opencode.js";
import type { Driver } from "./session.js";

export const DRIVERS: Record<string, Driver> = Object.fromEntries(
	[claudeNative, claudeAcp, opencodeNative, opencodeAcp].map((d) => [d.id, d]),
);
