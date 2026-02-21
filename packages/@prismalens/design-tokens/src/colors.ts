/**
 * PrismaLens Design Tokens - Colors
 *
 * Base: Zinc (neutral gray)
 * Primary: Indigo
 * Color space: OKLCH (Tailwind v4 / shadcn v4 standard)
 */

// ---------------------------------------------------------------------------
// Brand palette (supplementary - used alongside shadcn semantic tokens)
// ---------------------------------------------------------------------------

export const brandColors = {
	/** Investigation flow accent (gradient use) */
	investigationPurple: {
		oklch: "oklch(0.627 0.265 303.9)",
		hex: "#8B5CF6",
		hsl: "258 90% 66%",
	},
	/** Status: success */
	successGreen: {
		oklch: "oklch(0.696 0.17 162.48)",
		hex: "#10B981",
		hsl: "160 84% 39%",
	},
	/** Status: warning */
	warningAmber: {
		oklch: "oklch(0.769 0.188 70.08)",
		hex: "#F59E0B",
		hsl: "38 92% 50%",
	},
	/** Status: critical / destructive */
	criticalRed: {
		oklch: "oklch(0.577 0.245 27.325)",
		hex: "#EF4444",
		hsl: "0 84% 60%",
	},
} as const;

// ---------------------------------------------------------------------------
// Zinc grayscale (OKLCH)
// ---------------------------------------------------------------------------

export const zinc = {
	50: "oklch(0.985 0 0)",
	100: "oklch(0.967 0.001 286.375)",
	200: "oklch(0.92 0.004 286.32)",
	300: "oklch(0.871 0.006 286.286)",
	400: "oklch(0.705 0.015 286.067)",
	500: "oklch(0.552 0.016 285.938)",
	600: "oklch(0.442 0.017 285.786)",
	700: "oklch(0.371 0.013 285.805)",
	800: "oklch(0.274 0.006 286.033)",
	900: "oklch(0.21 0.006 285.885)",
	950: "oklch(0.141 0.005 285.823)",
} as const;

// ---------------------------------------------------------------------------
// Indigo primary (OKLCH)
// ---------------------------------------------------------------------------

export const indigo = {
	50: "oklch(0.962 0.018 272.314)",
	100: "oklch(0.93 0.034 272.788)",
	200: "oklch(0.87 0.065 274.039)",
	300: "oklch(0.785 0.115 274.713)",
	400: "oklch(0.673 0.182 276.935)",
	500: "oklch(0.585 0.233 277.117)",
	600: "oklch(0.511 0.262 276.966)",
	700: "oklch(0.457 0.24 277.023)",
	800: "oklch(0.398 0.195 277.366)",
	900: "oklch(0.359 0.144 278.697)",
	950: "oklch(0.257 0.09 281.288)",
} as const;

// ---------------------------------------------------------------------------
// Semantic tokens (light / dark) - shadcn v4 zinc+indigo
// ---------------------------------------------------------------------------

export const semanticColors = {
	light: {
		background: zinc[50], // oklch(0.985 0 0)
		foreground: zinc[950], // oklch(0.141 0.005 285.823)
		card: zinc[50], // oklch(0.985 0 0)
		cardForeground: zinc[950],
		popover: zinc[50],
		popoverForeground: zinc[950],
		primary: indigo[500], // oklch(0.585 0.233 277.117)
		primaryForeground: zinc[50],
		secondary: zinc[200], // oklch(0.92 0.004 286.32)
		secondaryForeground: zinc[950],
		muted: zinc[200],
		mutedForeground: zinc[500], // oklch(0.552 0.016 285.938)
		accent: zinc[200],
		accentForeground: zinc[950],
		destructive: "oklch(0.577 0.245 27.325)",
		destructiveForeground: zinc[50],
		success: "oklch(0.696 0.17 162.48)",
		successForeground: zinc[50],
		warning: "oklch(0.769 0.188 70.08)",
		warningForeground: zinc[950],
		border: zinc[300], // oklch(0.871 0.006 286.286)
		input: zinc[300],
		ring: indigo[500],
		chart1: indigo[500],
		chart2: "oklch(0.627 0.265 303.9)",
		chart3: "oklch(0.696 0.17 162.48)",
		chart4: "oklch(0.769 0.188 70.08)",
		chart5: "oklch(0.577 0.245 27.325)",
	},
	dark: {
		background: zinc[950], // oklch(0.141 0.005 285.823)
		foreground: zinc[50],
		card: zinc[900], // oklch(0.21 0.006 285.885)
		cardForeground: zinc[50],
		popover: zinc[900],
		popoverForeground: zinc[50],
		primary: indigo[500],
		primaryForeground: zinc[50],
		secondary: zinc[800], // oklch(0.274 0.006 286.033)
		secondaryForeground: zinc[50],
		muted: zinc[800],
		mutedForeground: zinc[400], // oklch(0.705 0.015 286.067)
		accent: zinc[800],
		accentForeground: zinc[50],
		destructive: "oklch(0.577 0.245 27.325)",
		destructiveForeground: zinc[50],
		success: "oklch(0.696 0.17 162.48)",
		successForeground: zinc[50],
		warning: "oklch(0.769 0.188 70.08)",
		warningForeground: zinc[950],
		border: zinc[800],
		input: zinc[800],
		ring: indigo[400], // oklch(0.673 0.182 276.935)
		chart1: indigo[400],
		chart2: "oklch(0.627 0.265 303.9)",
		chart3: "oklch(0.696 0.17 162.48)",
		chart4: "oklch(0.769 0.188 70.08)",
		chart5: "oklch(0.577 0.245 27.325)",
	},
} as const;

// ---------------------------------------------------------------------------
// Chart colors (JS object for Recharts / ReactFlow consumers)
// ---------------------------------------------------------------------------

export const chartColors = {
	/** Primary chart color (indigo-500) */
	primary: "#6366F1",
	/** Secondary / investigation purple */
	secondary: "#8B5CF6",
	/** Success / resolved */
	success: "#10B981",
	/** Warning / amber */
	warning: "#F59E0B",
	/** Critical / destructive red */
	critical: "#EF4444",
	/** Muted / inactive (zinc-400) */
	muted: "#A1A1AA",
	/** Card background light (zinc-100) */
	cardLight: "#F4F4F5",
	/** Card background dark (zinc-900) */
	cardDark: "#18181B",
	/** Border light (zinc-300) */
	borderLight: "#D4D4D8",
	/** Border dark (zinc-800) */
	borderDark: "#27272A",

	/** Node status colors for ReactFlow graphs */
	node: {
		default: "#D4D4D8", // zinc-300
		active: "#818CF8", // indigo-400
		success: "#6EE7B7", // emerald-300
		error: "#FCA5A5", // red-300
		idle: "#D4D4D8", // zinc-300
	},

	/** Severity color map for incident analytics */
	severity: {
		critical: "#EF4444",
		high: "#F97316",
		medium: "#EAB308",
		low: "#10B981",
		info: "#6366F1",
	},
} as const;
