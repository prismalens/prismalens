/**
 * Settings (#523, study-v3 §2): the sidebar swaps to the pages with Back
 * at its foot (#848); the chosen page's rows fill the frame. `tab` names it.
 */
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import {
	SETTINGS_SECTIONS,
	type SettingsTab,
} from "@/components/settings/SettingsFrame";

export type { SettingsTab };

const TABS: readonly SettingsTab[] = SETTINGS_SECTIONS.map((s) => s.tab);

/** Tabs from before #848, and where each now lives. */
export const LEGACY_SETTINGS_TABS: Readonly<
	Record<string, { tab: SettingsTab; hash?: string }>
> = {
	harness: { tab: "agent" },
	integrations: { tab: "notifications" },
	danger: { tab: "about", hash: "danger-zone" },
};

/** The router spreads this over the raw search, so an unknown tab is overwritten, not omitted (w8-2). */
export const validateSettingsSearch = (
	search: Record<string, unknown>,
): { tab?: SettingsTab } => ({
	tab: TABS.includes(search.tab as SettingsTab)
		? (search.tab as SettingsTab)
		: undefined,
});

/** The new home of an old `?tab=`, read from the raw query (validation drops it). */
export function legacySettingsTarget(
	searchStr: string,
): { tab: SettingsTab; hash?: string } | undefined {
	const raw = new URLSearchParams(searchStr).get("tab")?.replace(/^"|"$/g, "");
	return raw ? LEGACY_SETTINGS_TABS[raw] : undefined;
}

export const Route = createFileRoute("/_authenticated/settings")({
	validateSearch: validateSettingsSearch,
	beforeLoad: ({ location }) => {
		const to = legacySettingsTarget(location.searchStr);
		if (to)
			throw redirect({
				to: "/settings",
				search: { tab: to.tab },
				hash: to.hash,
				replace: true,
			});
	},
	component: () => <Outlet />,
});
