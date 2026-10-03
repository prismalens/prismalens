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

export const Route = createFileRoute("/_authenticated/settings")({
	validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab } =>
		TABS.includes(search.tab as SettingsTab)
			? { tab: search.tab as SettingsTab }
			: {},
	component: () => <Outlet />,
});
