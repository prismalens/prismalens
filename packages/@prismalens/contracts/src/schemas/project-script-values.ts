// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the script dialog checks a script without loading a schema (#1130).

/** A project's own scripts (#1176): stored in its metadata, beside the ones its folder declares. */
export const PROJECT_SCRIPTS_MAX = 50;
export const PROJECT_SCRIPT_NAME_MAX = 60;
export const PROJECT_SCRIPT_COMMAND_MAX = 1000;
