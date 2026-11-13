// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Define } from "@prismalens/registry";
import { defineAction, defineSurface } from "@/components/kit/actions";
import {
	defineBlock,
	defineCondition,
	defineLens,
	defineSetting,
} from "./defines";
import type { kinds } from "./kinds";

/**
 * `define.<kind>({ id: "…", … })`, exported from a file with the kind's suffix:
 * the only way to add an entry. Typed against the kinds, without loading them
 * (and their schemas and guards) at startup; the kernel self-test checks each
 * function is its kind's.
 */
export const define: Define<typeof kinds> = {
	action: defineAction,
	block: defineBlock,
	condition: defineCondition,
	lens: defineLens,
	setting: defineSetting,
	surface: defineSurface,
};
