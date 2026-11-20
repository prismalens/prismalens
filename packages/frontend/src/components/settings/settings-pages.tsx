// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessId } from "@prismalens/config/harness";
import type { ComponentType } from "react";
import { lazyPart } from "@/lib/lazy";
import type { SettingsTab } from "./settings-sections";

export interface SettingsPageProps {
	agent?: HarnessId;
	source?: string;
}

const page = (
	load: () => Promise<ComponentType<SettingsPageProps>>,
): ComponentType<SettingsPageProps> & {
	preload: (now?: boolean) => Promise<unknown>;
} => lazyPart(load, null, { now: true });

/**
 * Each settings page's code, loaded when it opens: a cold Settings load fetches one page,
 * not all fifteen with the charts (#1130). The route's loader starts the open one's code.
 */
export const SETTINGS_PAGES: Record<SettingsTab, ReturnType<typeof page>> = {
	general: page(() =>
		import("./GeneralSettings").then((m) => () => <m.GeneralSettings />),
	),
	models: page(() =>
		import("./ModelsSettings").then((m) => () => <m.ModelsSettings />),
	),
	permissions: page(() =>
		import("./PermissionsSettings").then((m) => () => (
			<m.PermissionsSettings />
		)),
	),
	organizer: page(() =>
		import("./AgentThreadsSettings").then((m) => () => <m.OrganizerSettings />),
	),
	shortcuts: page(() =>
		import("./ShortcutsSettings").then((m) => () => <m.ShortcutsSettings />),
	),
	appearance: page(() =>
		import("./AppearanceSettings").then((m) => () => <m.AppearanceSettings />),
	),
	agent: page(() =>
		Promise.all([import("./AgentDetail"), import("./HarnessSettings")]).then(
			([d, h]) =>
				({ agent }: SettingsPageProps) =>
					agent ? <d.AgentDetail id={agent} /> : <h.HarnessSettings />,
		),
	),
	runs: page(() =>
		import("./RunWorkspaceSettings").then((m) => () => (
			<m.RunWorkspaceSettings />
		)),
	),
	"alert-intake": page(() =>
		import("./AlertIntakeSettings").then((m) => () => (
			<m.AlertIntakeSettings />
		)),
	),
	sources: page(() =>
		import("./SourcesSettings").then((m) => ({ source }: SettingsPageProps) => (
			<m.SourcesSettings source={source} />
		)),
	),
	notifications: page(() =>
		import("./NotificationsSettings").then((m) => () => (
			<m.NotificationsSettings />
		)),
	),
	devices: page(() =>
		import("./DevicesTab").then((m) => () => <m.DevicesTab />),
	),
	usage: page(() =>
		import("@/components/usage/UsageView").then((m) => () => <m.UsageView />),
	),
	telemetry: page(() =>
		import("./TelemetrySettings").then((m) => () => <m.TelemetrySettings />),
	),
	about: page(() =>
		import("./AboutSettings").then((m) => () => <m.AboutSettings />),
	),
};

/** Sources' header button, from the same lazy module as its page. */
export const AddSourceButton = lazyPart(
	() => import("./SourcesSettings").then((m) => m.AddSourceButton),
	null,
	{ now: true },
);

// A cold load starts the open page's code with the route's, not after its first render (#1130).
if (typeof window !== "undefined" && location.pathname === "/settings") {
	const tab = new URLSearchParams(location.search)
		.get("tab")
		?.replace(/"/g, "");
	void SETTINGS_PAGES[(tab ?? "general") as SettingsTab]
		?.preload(true)
		.catch(() => {});
}
