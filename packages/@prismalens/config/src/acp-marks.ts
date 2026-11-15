// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Each ACP registry agent's mark, written by `scripts/acp-registry-snapshot.mjs` from
 * `acp-mark-terms.json`: letters, with the line or ruling that keeps its icon out (#1101).
 */
import bundled from "./acp-marks.json" with { type: "json" };

export type AcpMark = { letters: string; withheld: string; terms?: string };

export const ACP_MARKS: Readonly<Record<string, AcpMark>> = bundled;
