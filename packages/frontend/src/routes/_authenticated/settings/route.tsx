/**
 * The settings frame (#523): sections on the left with one line of their state,
 * the chosen section's rows on the right. `tab` names the section.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";

export type SettingsTab =
	| "harness"
	| "integrations"
	| "connections"
	| "devices"
	| "usage"
	| "about"
	| "danger";
const TABS: SettingsTab[] = [
	"harness",
	"integrations",
	"connections",
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
