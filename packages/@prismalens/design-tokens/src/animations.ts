/**
 * PrismaLens Design Tokens - Animation
 */

export const durations = {
	instant: "100ms",
	fast: "150ms",
	default: "200ms",
	slow: "300ms",
} as const;

export const easings = {
	ui: "cubic-bezier(0.4, 0, 0.2, 1)",
	enter: "cubic-bezier(0, 0, 0.2, 1)",
	exit: "cubic-bezier(0.4, 0, 1, 1)",
} as const;
