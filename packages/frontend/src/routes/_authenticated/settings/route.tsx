/**
 * Settings (#523, study-v3 §2): the sidebar swaps to the sections with Back
 * above them; the chosen section's rows fill the page. `tab` names it.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";
import type { SettingsTab } from "@/components/settings/SettingsFrame";

export type { SettingsTab };

const TABS: SettingsTab[] = [
	"harness",
	"sources",
	"integrations",
	"devices",
	"usage",
	"about",
	"danger",
];

/** The router spreads this over the raw search, so an unknown tab is overwritten, not omitted (w8-2). */
export const validateSettingsSearch = (
	search: Record<string, unknown>,
): { tab?: SettingsTab } => ({
	tab: TABS.includes(search.tab as SettingsTab)
		? (search.tab as SettingsTab)
		: undefined,
});

export const Route = createFileRoute("/_authenticated/settings")({
	validateSearch: validateSettingsSearch,
	component: () => <Outlet />,
});
