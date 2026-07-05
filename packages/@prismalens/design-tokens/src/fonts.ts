// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * PrismaLens Design Tokens - Typography
 */

export const fontFamilies = {
	sans: "'Inter Variable', 'Inter', system-ui, sans-serif",
	mono: "'JetBrains Mono Variable', 'JetBrains Mono', monospace",
} as const;

export const fontSizes = {
	display: {
		size: "3.5rem",
		lineHeight: "1.1",
		letterSpacing: "-0.02em",
		weight: "700",
	},
	h1: {
		size: "2.5rem",
		lineHeight: "1.2",
		letterSpacing: "-0.01em",
		weight: "700",
	},
	h2: { size: "2rem", lineHeight: "1.25", letterSpacing: "0", weight: "600" },
	h3: { size: "1.5rem", lineHeight: "1.3", letterSpacing: "0", weight: "600" },
	h4: { size: "1.25rem", lineHeight: "1.4", letterSpacing: "0", weight: "500" },
} as const;
