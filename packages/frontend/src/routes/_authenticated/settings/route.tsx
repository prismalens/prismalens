// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Settings (#523, study-v3 §2): the sidebar swaps to the pages with Back
 * at its foot (#848); the chosen page's rows fill the frame. `tab` names it.
 */
import { HARNESS_IDS, type HarnessId } from "@prismalens/config/harness";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import {
	SETTINGS_SECTIONS,
	type SettingsTab,
} from "@/components/settings/settings-sections";
import { PageHeader } from "@/components/shell/PageHeader";

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

/**
 * The router spreads this over the raw search, so an unknown tab is overwritten, not omitted (w8-2).
 * `agent` opens one agent's page under Agent (#907); `source` one connection on Sources (#848).
 * `repositoryId` is the project the person came from, for that page's What loads (#1180).
 */
export const validateSettingsSearch = (
	search: Record<string, unknown>,
): {
	tab?: SettingsTab;
	agent?: HarnessId;
	source?: string;
	repositoryId?: string;
	legacy?: string;
	legacyAgent?: string;
	q?: string;
} => {
	const tab = TABS.includes(search.tab as SettingsTab)
		? (search.tab as SettingsTab)
		: undefined;
	const agent =
		tab === "agent" && HARNESS_IDS.includes(search.agent as HarnessId)
			? (search.agent as HarnessId)
			: undefined;
	const text = (on: boolean, v: unknown) =>
		on && typeof v === "string" && v ? v : undefined;
	const source = text(tab === "sources", search.source);
	const repositoryId = text(tab === "agent", search.repositoryId);
	// An old tab survives validation under its own key, so beforeLoad can still move it.
	const old =
		typeof search.tab === "string" ? search.tab.replace(/"/g, "") : "";
	const legacy = !tab && (old === "schedules" || old in LEGACY_SETTINGS_TABS);
	const q =
		typeof search.q === "string" && search.q.trim()
			? search.q.slice(0, 100)
			: undefined;
	return {
		tab,
		agent,
		source,
		// Always set, so the router's merge over the raw search drops a bad value.
		repositoryId,
		...(q ? { q } : {}),
		...(legacy ? { legacy: old } : {}),
		...(legacy && typeof search.agent === "string"
			? { legacyAgent: search.agent }
			: {}),
	};
};

/** The new home of an old `?tab=`, read from the raw query (validation drops it); `?tab=harness&agent=` keeps its agent. */
export function legacySettingsTarget(
	searchStr: string,
): { tab: SettingsTab; hash?: string; agent?: HarnessId } | undefined {
	const query = new URLSearchParams(searchStr);
	const read = (key: string) => query.get(key)?.replace(/^"|"$/g, "");
	const raw = read("tab");
	const to = raw ? LEGACY_SETTINGS_TABS[raw] : undefined;
	if (!to) return undefined;
	const { agent } = validateSettingsSearch({
		tab: to.tab,
		agent: read("agent"),
	});
	return agent ? { ...to, agent } : to;
}

export const Route = createFileRoute("/_authenticated/settings")({
	validateSearch: validateSettingsSearch,
	beforeLoad: ({ location, search }) => {
		// A page load has already stripped the old tab from the URL; validation kept it (#1020).
		const raw = search?.legacy
			? `?${new URLSearchParams({
					tab: search.legacy,
					...(search.legacyAgent ? { agent: search.legacyAgent } : {}),
				})}`
			: location.searchStr;
		// Schedules moved to Automation (#1020); old links still land there.
		if (new URLSearchParams(raw).get("tab")?.replace(/"/g, "") === "schedules")
			throw redirect({ to: "/automation", replace: true });
		const to = legacySettingsTarget(raw);
		if (to)
			throw redirect({
				to: "/settings",
				search: { tab: to.tab, agent: to.agent },
				hash: to.hash,
				replace: true,
			});
	},
	component: () => <Outlet />,
	// A cold load draws the frame's outline while the page's code arrives, never a blank page (#1101 cat 4).
	pendingMs: 200,
	pendingComponent: SettingsPending,
});

function SettingsPending() {
	return (
		<div
			className="flex h-full flex-col bg-canvas"
			aria-busy
			data-testid="settings-pending"
		>
			<PageHeader title="Settings" />
			<div className="flex min-h-0 flex-1">
				<div className="hidden w-52 shrink-0 flex-col gap-2 px-4 pt-4 md:flex">
					{[0, 1, 2, 3, 4, 5, 6].map((i) => (
						<div key={i} className="shimmer h-5 rounded-[4px]" />
					))}
				</div>
				<div className="mx-auto flex w-full max-w-[42rem] flex-col gap-3 px-4 pt-6">
					<div className="shimmer h-8 w-1/3 rounded-[4px]" />
					<div className="shimmer h-40 rounded-pool" />
					<div className="shimmer h-24 rounded-pool" />
				</div>
			</div>
		</div>
	);
}
