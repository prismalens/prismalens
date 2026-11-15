// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).
import type { NotifyPrefs } from "./attention.js";

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
	mode: "notifications",
	events: { needsYou: true, finished: true, failed: true },
	when: "unfocused",
};
