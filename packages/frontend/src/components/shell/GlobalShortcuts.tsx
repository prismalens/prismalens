// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useGlobalShortcuts } from "@/hooks/app-keys";
import { useShortcutRemapsLoader } from "@/hooks/use-shortcuts";
import { useNewIncident } from "./NewIncident";

/**
 * The app's keys, and the operator's remaps of them. The layout mounts this after the first
 * content, since the keymap reads every action in the registry; keys pressed before then
 * wait in the page's early-key buffer (`lib/early-keys`, #1101 category 12).
 */
export function GlobalShortcuts({ onHelp }: { onHelp: () => void }) {
	useGlobalShortcuts(onHelp, useNewIncident());
	useShortcutRemapsLoader();
	return null;
}
