// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Each ACP registry agent's mark, written by `scripts/acp-registry-snapshot.mjs` from
 * `acp-mark-terms.json`: its registry icon where its owner's terms allow it, else letters
 * with the line that rules the icon out (#1101).
 */
import bundled from "./acp-marks.json" with { type: "json" };

export type AcpMark =
	| { icon: string; source: string; terms: string }
	| { letters: string; withheld: string; terms?: string };

export const ACP_MARKS: Readonly<Record<string, AcpMark>> = bundled;
