// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * How often the incident and alert lists re-read while the tab is visible, so a new
 * incident arrives without a reload (walk f27). Nothing pushes list changes yet.
 */
export const LIVE_REFRESH_MS = 10_000;
