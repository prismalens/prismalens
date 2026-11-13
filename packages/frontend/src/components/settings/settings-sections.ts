// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The settings pages as data, apart from the frame that draws them: the settings route
// validates its search with them on every page's first paint (#1101 category 12).

export type SettingsTab =
	| "general"
	| "models"
	| "permissions"
	| "organizer"
	| "agent"
	| "appearance"
	| "notifications"
	| "shortcuts"
	| "usage"
	| "runs"
	| "alert-intake"
	| "sources"
	| "devices"
	| "telemetry"
	| "about";

export type SettingsSection = SettingsTab | "services";

export interface SettingsSectionItem {
	tab: SettingsTab;
	label: string;
}

/**
 * The settings pages, flat and in this order (#848, #1101 cat 18): the list
 * beside each page, and the phone's landing page. No headings, no lines.
 */
export const SETTINGS_SECTIONS: readonly SettingsSectionItem[] = [
	{ tab: "general", label: "General" },
	{ tab: "models", label: "Models" },
	{ tab: "permissions", label: "Permissions" },
	{ tab: "organizer", label: "Agent-started threads" },
	{ tab: "agent", label: "Agents" },
	{ tab: "appearance", label: "Appearance" },
	{ tab: "notifications", label: "Notifications" },
	{ tab: "shortcuts", label: "Keyboard shortcuts" },
	{ tab: "usage", label: "Usage" },
	{ tab: "runs", label: "Runs" },
	{ tab: "alert-intake", label: "Alert intake" },
	{ tab: "sources", label: "Sources" },
	{ tab: "devices", label: "Devices" },
	{ tab: "telemetry", label: "Usage data" },
	{ tab: "about", label: "About" },
];
