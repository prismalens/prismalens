// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The custom type scale (`tokens.css`) must merge as font sizes; unknown
// `text-*` classes default to colours, so `text-record text-muted-foreground`
// used to drop the size.
const twMerge = extendTailwindMerge({
	extend: {
		classGroups: { "font-size": ["text-record", "text-meta", "text-slot"] },
	},
});

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
