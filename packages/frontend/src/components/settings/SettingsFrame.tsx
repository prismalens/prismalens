// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { useAbout } from "@/components/settings/AboutSettings";
import { useDevices } from "@/components/settings/DevicesTab";
import { PageHeader } from "@/components/shell/PageHeader";
import { useOperator } from "@/hooks/use-operator";
import { usePageTitle } from "@/hooks/use-page-title";
import {
	useConnections,
	useIntegrations,
	useInvestigationReadiness,
} from "@/lib/api/hooks";

export type SettingsTab =
	| "harness"
	| "integrations"
	| "connections"
	| "devices"
	| "usage"
	| "about"
	| "danger";

export type SettingsSection = SettingsTab | "services";

export interface SettingsSectionItem {
	tab: SettingsTab;
	label: string;
	/** One line of the section's state, under its name. */
	line: string;
}

/**
 * The settings sections with one line of state each: the sidebar's list once
 * Settings swaps it in, and the phone's landing page (study-v3 §2).
 */
export function useSettingsSections(): SettingsSectionItem[] {
	const readiness = useInvestigationReadiness();
	const { data: integrations } = useIntegrations();
	const { data: connections } = useConnections();
	const { managesPairing } = useOperator();
	const { data: devices } = useDevices(managesPairing);
	const { data: about } = useAbout();
	return [
		{
			tab: "harness",
			label: "Agent",
			line: readiness.isReady ? "Ready" : "Not ready",
		},
		{
			tab: "integrations",
			label: "Integrations",
			line: integrations ? `${integrations.length} configured` : "",
		},
		{
			tab: "connections",
			label: "Connections",
			line: connections ? `${connections.length} connected` : "",
		},
		{
			tab: "devices",
			label: "Devices",
			line: devices ? `${devices.devices.length} paired` : "",
		},
		{ tab: "usage", label: "Usage data", line: "Off until you say yes" },
		{
			tab: "about",
			label: "About",
			line: about?.update.available
				? `${about.update.latest} available`
				: (about?.version ?? ""),
		},
		{ tab: "danger", label: "Danger zone", line: "" },
	];
}

/**
 * The content of a Settings section, or of Services, which keeps this frame
 * while it waits for its own page (PR 2). The section list lives in the
 * sidebar; this is the header and a centred reading column.
 */
export function SettingsFrame({
	section,
	title,
	intro,
	actions,
	children,
}: {
	section: SettingsSection;
	title: string;
	intro?: ReactNode;
	actions?: ReactNode;
	children: ReactNode;
}) {
	const services = section === "services";
	usePageTitle(services ? title : `${title}, Settings`);
	return (
		<div
			className="fixed inset-x-0 bottom-0 top-(--frame-top) flex flex-col bg-canvas md:left-(--sidebar-w)"
			data-testid="settings-frame"
		>
			<PageHeader title={services ? "Services" : "Settings"}>
				{!services && (
					<span className="max-md:hidden text-text-3">{title}</span>
				)}
			</PageHeader>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-(--reading-w) px-4 pt-4 pb-12 md:px-6">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="min-w-0">
							<h2 className="text-title">{title}</h2>
							{intro && <p className="mt-1 text-body text-text-2">{intro}</p>}
						</div>
						{actions && (
							<div className="flex items-center gap-2">{actions}</div>
						)}
					</div>
					<div className="mt-6">{children}</div>
				</div>
			</div>
		</div>
	);
}
