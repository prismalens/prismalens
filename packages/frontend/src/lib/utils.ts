// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The custom type scale (`tailwind-preset.css`) must merge as font sizes;
// unknown `text-*` classes default to colours, so `text-body text-text-2`
// would drop the size.
const twMerge = extendTailwindMerge({
	extend: {
		classGroups: {
			"font-size": [
				"text-display",
				"text-title",
				"text-heading",
				"text-body",
				"text-meta",
				"text-mono",
			],
		},
	},
});

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
