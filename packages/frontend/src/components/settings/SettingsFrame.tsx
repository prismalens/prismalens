// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
	agentModelLabel,
	useAgentChoice,
} from "@/components/agent/AgentPicker";
import { useAbout } from "@/components/settings/AboutSettings";
import { useDevices } from "@/components/settings/DevicesTab";
import { useTelemetrySettings } from "@/components/settings/TelemetrySettings";
import { PageHeader } from "@/components/shell/PageHeader";
import { PHONE, useMediaQuery } from "@/hooks/use-media-query";
import { useOperator } from "@/hooks/use-operator";
import { usePageTitle } from "@/hooks/use-page-title";
import { useConnections, useIntegrations } from "@/lib/api/hooks";
import { useCaseFileSettings } from "@/lib/api/hooks/use-case-files-orpc";
import { useLastDelivery } from "@/lib/api/hooks/use-webhooks-orpc";
import { orpc } from "@/lib/api/orpc-client";

export type SettingsTab =
	| "harness"
	| "sources"
	| "integrations"
	| "devices"
	| "usage"
	| "experiments"
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
 * Settings swaps it in, and the phone's landing page. Every row has its line
 * (look ruling §2); an empty one waits only while its query loads.
 */
export function useSettingsSections(): SettingsSectionItem[] {
	const { effective, model } = useAgentChoice();
	const { data: integrations } = useIntegrations();
	const { data: connections } = useConnections();
	const { data: delivery } = useLastDelivery();
	const { data: reports } = useQuery(orpc.settings.delivery.get.queryOptions());
	const { managesPairing } = useOperator();
	const { data: devices } = useDevices(managesPairing);
	const { data: about } = useAbout();
	const { query: telemetry } = useTelemetrySettings();
	const { data: caseFile, isError: caseFileFailed } = useCaseFileSettings();
	const pulled = (connections ?? []).filter((c) =>
		PULL_TEMPLATES.has(c.templateId ?? ""),
	).length;
	const named = [
		...(reports?.slackConfigured ? ["Slack"] : []),
		...listedIntegrations(integrations ?? [], connections ?? []).map(
			(i) => i.label,
		),
	];
	const agent = agentModelLabel(effective, model);
	const sources = [delivery ? "Webhook" : "", pulled ? `${pulled} pulled` : ""]
		.filter(Boolean)
		.join(", ");
	return [
		{
			tab: "harness",
			label: "Agent",
			line: effective
				? [agent.agent, agent.model]
						.filter((w) => w && w !== "agent default")
						.join(", ")
				: "None found",
		},
		{
			tab: "sources",
			label: "Alert sources",
			line: connections ? sources || "None yet" : "",
		},
		{
			tab: "integrations",
			label: "Integrations",
			line:
				integrations && connections ? named.join(", ") || "None connected" : "",
		},
		{
			tab: "devices",
			label: "Devices",
			line: !managesPairing
				? "Managed on the host"
				: devices
					? `${devices.devices.length} paired`
					: "",
		},
		{
			tab: "usage",
			label: "Usage data",
			line: telemetry.data ? (telemetry.data.enabled ? "On" : "Off") : "",
		},
		{
			tab: "experiments",
			label: "Experiments",
			line:
				caseFile || caseFileFailed
					? caseFile?.enabled
						? "Case File on"
						: "None on"
					: "",
		},
		{
			tab: "about",
			label: "About",
			line: about?.update.available
				? `${about.update.latest} available`
				: (about?.version ?? ""),
		},
		{
			tab: "danger",
			label: "Danger zone",
			line: "Reset or delete this install",
		},
	];
}

/** Templates whose connections are alert sources PrismaLens pulls from. */
export const PULL_TEMPLATES: ReadonlySet<string> = new Set([
	"alertmanager",
	"prometheus",
]);

export const GIT_HOST_TOKEN = "git-host-token";

/** Integrations Settings lists; the token holder with no token left is empty, not a git host (w8-5). */
export function listedIntegrations<
	I extends { id: string; templateId: string },
>(integrations: I[], connections: { integrationId: string }[]): I[] {
	return integrations.filter(
		(i) =>
			!PULL_TEMPLATES.has(i.templateId) &&
			(i.templateId !== GIT_HOST_TOKEN ||
				connections.some((c) => c.integrationId === i.id)),
	);
}

/**
 * The content of a Settings section, or of Services, which keeps this frame
 * while it waits for its own page. The header reads "Settings  Agent"; Back
 * lives at the top of the section list, and on the phone, where the list is a
 * page of its own, at the head of each section (L65 ruling).
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
	const phone = useMediaQuery(PHONE);
	usePageTitle(services ? title : `${title}, Settings`);
	return (
		<div
			className="fixed inset-x-0 bottom-0 top-(--frame-top) flex flex-col bg-canvas md:left-(--sidebar-w)"
			data-testid="settings-frame"
		>
			<PageHeader title={services ? "Services" : "Settings"}>
				{!services && (
					<h2 className="text-body font-normal text-text-3">{title}</h2>
				)}
				{!services && phone && (
					<Link
						to="/settings"
						className="-order-1 flex h-8 items-center rounded-control pr-1 text-body font-medium text-text-1"
						data-testid="settings-back"
					>
						Back
					</Link>
				)}
			</PageHeader>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-[52rem] px-4 pt-4 pb-12">
					{(intro || actions) && (
						<div className="mb-8 flex flex-wrap items-start justify-between gap-3">
							{intro && (
								<p className="min-w-0 text-body text-text-2">{intro}</p>
							)}
							{actions && (
								<div className="flex items-center gap-2">{actions}</div>
							)}
						</div>
					)}
					{children}
				</div>
			</div>
		</div>
	);
}
