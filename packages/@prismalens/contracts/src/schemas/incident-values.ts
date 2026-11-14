// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).

/**
 * What goes inline (R4.3): images to 4 MB, text files to 256 KB. Any file to
 * ATTACHMENT_MAX_BYTES is accepted; the rest reach the agent as a link (#1024).
 */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
