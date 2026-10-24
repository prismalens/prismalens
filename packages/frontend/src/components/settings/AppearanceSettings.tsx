// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { SettingGroup } from "@/components/shared/SettingRow";
import { useTheme } from "@/lib/providers/theme-provider";
import type { ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";

const SCHEMES: { value: ThemeChoice; label: string }[] = [
	{ value: "system", label: "System" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
];

const LIGHT = "oklch(0.975 0.002 285)";
const DARK = "oklch(0.15 0.004 285)";
const PREVIEW_BG: Record<ThemeChoice, string> = {
	light: LIGHT,
	dark: DARK,
	system: `linear-gradient(90deg, ${LIGHT} 50%, ${DARK} 50%)`,
};

/**
 * Settings, Appearance (#848): how PrismaLens looks in this browser. The
 * color scheme moved here from the sidebar toggle, which stays.
 */
export function AppearanceSettings() {
	const { choice, setTheme } = useTheme();
	return (
		<SettingGroup title="Color scheme" testId="appearance-scheme">
			<RadioGroupPrimitive.Root
				value={choice}
				onValueChange={(v) => setTheme(v as ThemeChoice)}
				aria-label="Color scheme"
				className="grid grid-cols-3 gap-3 max-sm:gap-2"
			>
				{SCHEMES.map((s) => (
					<RadioGroupPrimitive.Item
						key={s.value}
						value={s.value}
						className={cn(
							"raised grid min-h-12 gap-2 rounded-dialog px-2 pt-2 pb-2.5 text-center font-medium text-text-1",
							"data-[state=checked]:outline-2 data-[state=checked]:outline-offset-0 data-[state=checked]:outline-accent",
						)}
						data-testid={`scheme-${s.value}`}
					>
						<SchemePreview scheme={s.value} />
						<span>{s.label}</span>
					</RadioGroupPrimitive.Item>
				))}
			</RadioGroupPrimitive.Root>
		</SettingGroup>
	);
}

/** A sidebar and three lines in the scheme's ground, drawn at the card's size. */
function SchemePreview({ scheme }: { scheme: ThemeChoice }) {
	return (
		<span
			aria-hidden
			className="relative block h-[72px] overflow-hidden rounded-surface"
			style={{ background: PREVIEW_BG[scheme] }}
		>
			<i className="absolute inset-y-0 left-0 w-[26%] bg-[oklch(0.5_0_0/0.12)]" />
			<b className="absolute top-3.5 right-[40%] left-[34%] h-2 rounded bg-[oklch(0.5_0_0/0.25)]" />
			<b className="absolute top-8 right-[10%] left-[34%] h-2 rounded bg-[oklch(0.5_0_0/0.25)]" />
			<b className="absolute top-[50px] right-1/4 left-[34%] h-2 rounded bg-[oklch(0.5_0_0/0.25)]" />
		</span>
	);
}
