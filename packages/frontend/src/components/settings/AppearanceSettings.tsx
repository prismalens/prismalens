// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { type InterfaceFont, useInterfaceFont } from "@/lib/appearance";
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
 * color scheme moved here from the sidebar toggle, which stays; the
 * interface font is IBM Plex Sans or the system's. Sizes and the monospace
 * font wait for #932.
 */
export function AppearanceSettings() {
	const { choice, setTheme } = useTheme();
	const [font, setFont] = useInterfaceFont();
	return (
		<>
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
			<SettingGroup title="Typography" testId="appearance-typography">
				<Pool>
					<SettingRow
						label="Interface font"
						description="Everything except code, addresses and commands."
						below={<FontPreview />}
					>
						<Select
							value={font}
							onValueChange={(v) => setFont(v as InterfaceFont)}
						>
							<SelectTrigger
								aria-label="Interface font"
								className="w-44"
								data-testid="appearance-font"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="plex">IBM Plex Sans</SelectItem>
								<SelectItem value="system">System font</SelectItem>
							</SelectContent>
						</Select>
					</SettingRow>
				</Pool>
			</SettingGroup>
		</>
	);
}

/** A run's header line in the chosen face, beside a selector in the mono one. */
function FontPreview() {
	return (
		<div
			className="grid gap-1 rounded-surface bg-well-in-pool px-4 py-3.5"
			data-testid="appearance-font-preview"
		>
			<div className="text-title">Checkout 5xx above 2% in staging</div>
			<div className="text-text-2">
				2 sources read before the run · 1 skipped · started 12:04
			</div>
			<code className="mt-1 justify-self-start rounded-[4px] bg-surface-3 px-1.5 font-mono text-mono">
				{'{namespace="checkout"}'}
			</code>
		</div>
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
