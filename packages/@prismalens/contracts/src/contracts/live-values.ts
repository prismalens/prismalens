// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).

/**
 * Every stream the server holds open beats this often, and a client counts it down after
 * this long without a frame (#1101 category 12): a link that dies sends no close, so silence
 * is the only sign. The slow-link bar is the connection word within 2 s of a drop, in a tab
 * the leader relays to; a 250 ms beat lets one lost packet recover inside 1.2 s (#1181).
 */
export const STREAM_BEAT_MS = 250;
export const STREAM_SILENT_MS = 1_200;
