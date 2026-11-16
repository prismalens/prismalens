// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { STOP_REASONS, type ThreadStopReason } from "@prismalens/contracts";
import { defineClosed } from "@prismalens/registry";

/**
 * Why a started thread stopped, from the contracts (#1125). The ids are listed so
 * the generator can read them: typecheck rejects one outside the union, and
 * defineClosed throws at startup on a reason STOP_REASONS has but this list lacks.
 */
export const stopReasons = defineClosed(
	"stopReason",
	[
		"interrupted",
		"crashed",
		"error",
		"provider_failure",
		"user_stop",
		"usage_limit",
		"disk_full",
	] as const satisfies readonly ThreadStopReason[],
	STOP_REASONS,
);
