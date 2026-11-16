// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type ChipAttrs, ChipAttrsSchema } from "@prismalens/contracts";

/** The attributes a chip node carries, read back into the contract's shape. */
export function chipAttrs(attrs: Record<string, unknown>): ChipAttrs | null {
	const parsed = ChipAttrsSchema.safeParse(
		Object.fromEntries(
			Object.entries(attrs).filter(([, v]) => v !== null && v !== undefined),
		),
	);
	return parsed.success ? parsed.data : null;
}
