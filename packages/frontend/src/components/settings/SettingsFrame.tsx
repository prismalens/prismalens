// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { PHONE, useMediaQuery } from "@/hooks/use-media-query";
import { usePageTitle } from "@/hooks/use-page-title";
import { cn } from "@/lib/utils";

export type SettingsTab =
	| "general"
	| "appearance"
	| "agent"
	| "runs"
	| "alert-intake"
	| "sources"
	| "notifications"
	| "devices"
	| "usage"
	| "about";

export type SettingsSection = SettingsTab | "services";

export interface SettingsSectionItem {
	tab: SettingsTab;
	label: string;
}

/**
 * The settings pages, flat and in this order (#848): the sidebar's list once
 * Settings swaps it in, and the phone's landing page. No headings, no lines.
 */
export const SETTINGS_SECTIONS: readonly SettingsSectionItem[] = [
	{ tab: "general", label: "General" },
	{ tab: "appearance", label: "Appearance" },
	{ tab: "agent", label: "Agent" },
	{ tab: "runs", label: "Runs" },
	{ tab: "alert-intake", label: "Alert intake" },
	{ tab: "sources", label: "Sources" },
	{ tab: "notifications", label: "Notifications" },
	{ tab: "devices", label: "Devices" },
	{ tab: "usage", label: "Usage data" },
	{ tab: "about", label: "About" },
];

/** The page Settings opens on. */
export const FIRST_SETTINGS_TAB: SettingsTab = "general";

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
 * lives at the foot of the section list (#848), and on the phone, where the
 * list is a page of its own, at the head of each section (L65 ruling).
 */
export function SettingsFrame({
	section,
	title,
	intro,
	actions,
	wide,
	children,
}: {
	section: SettingsSection;
	title: string;
	intro?: ReactNode;
	actions?: ReactNode;
	/** Master-detail pages take the room beside the list (#848). */
	wide?: boolean;
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
					<span className="text-body text-text-3" aria-hidden>
						{title}
					</span>
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
				<div
					className={cn(
						"mx-auto w-full px-4 pt-6 pb-12",
						wide ? "max-w-[64rem]" : "max-w-[42rem]",
					)}
				>
					<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
						<div className="min-w-0">
							{!services && (
								<h2 className="text-display" data-testid="settings-title">
									{title}
								</h2>
							)}
							{intro && (
								<p className="mt-1 min-w-0 text-body text-text-2">{intro}</p>
							)}
						</div>
						{actions && (
							<div className="flex items-center gap-2">{actions}</div>
						)}
					</div>
					{children}
				</div>
			</div>
		</div>
	);
}
