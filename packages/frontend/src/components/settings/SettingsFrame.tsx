// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Help } from "@/components/kit/Help";
import { Tabs } from "@/components/kit/Tabs";
import { PageHeader } from "@/components/shell/PageHeader";
import { PHONE, useMediaQuery } from "@/hooks/use-media-query";
import { usePageTitle } from "@/hooks/use-page-title";
import { cn } from "@/lib/utils";
import {
	SettingsResults,
	SettingsSearchBox,
	useSettingsQuery,
} from "./SettingsSearch";

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

export interface SettingsNavItem {
	tab: SettingsTab;
	label: string;
	/** Pages folded into this entry, drawn as a tab row above the page. */
	pages?: readonly SettingsTab[];
}

/**
 * The list beside each page and the phone's landing page: each thing has its
 * own entry (#1101 navigation); only close kin fold into a tab row.
 */
export const SETTINGS_NAV: readonly SettingsNavItem[] = [
	// Look sits with layout, and alert intake with the other things PrismaLens reads (ui-budget).
	{ tab: "general", label: "General", pages: ["general", "appearance"] },
	{
		tab: "agent",
		label: "Agents",
		pages: ["agent", "permissions", "organizer", "runs"],
	},
	{ tab: "models", label: "Models" },
	{ tab: "shortcuts", label: "Shortcuts" },
	{ tab: "notifications", label: "Notifications" },
	{ tab: "usage", label: "Usage" },
	{ tab: "sources", label: "Sources", pages: ["sources", "alert-intake"] },
	{ tab: "devices", label: "Devices" },
	{ tab: "about", label: "About", pages: ["about", "telemetry"] },
];

/** A folded page's word in its tab row, where the page's own title is longer. */
const TAB_WORD: Partial<Record<SettingsTab, string>> = {
	organizer: "Limits",
	shortcuts: "Shortcuts",
};

/** The nav entry a page sits under. */
export function navOf(tab: SettingsSection): SettingsNavItem | undefined {
	return SETTINGS_NAV.find(
		(n) => n.tab === tab || n.pages?.includes(tab as SettingsTab),
	);
}

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
	const query = useSettingsQuery();
	usePageTitle(services ? title : `${title}, Settings`);
	useLandOnHash();
	return (
		<div
			className="flex h-full flex-col bg-canvas"
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
			<div className="flex min-h-0 flex-1">
				{!services && !phone && <SectionList current={section} query={query} />}
				<div className="min-h-0 flex-1 overflow-y-auto">
					<div
						className={cn(
							"mx-auto w-full px-4 pt-6 pb-12",
							wide ? "max-w-[64rem]" : "max-w-[42rem]",
						)}
					>
						{!services && phone && <SettingsSearchBox query={query} />}
						{!services && query ? (
							<SettingsResults query={query} />
						) : (
							<>
								{!services && <PageTabs section={section} />}
								<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
									{/* The section's intro is opt-in behind one ? beside its title (sheet §0.3). */}
									<div className="flex min-w-0 items-center gap-1.5">
										{!services && (
											<h2 className="text-display" data-testid="settings-title">
												{title}
											</h2>
										)}
										{typeof intro === "string" && !services ? (
											<Help about={title} text={intro} />
										) : (
											intro && (
												<p className="mt-1 min-w-0 text-body text-text-2">
													{intro}
												</p>
											)
										)}
									</div>
									<span className="ml-auto flex items-center gap-2">
										{!services && <SavedMark />}
										{actions}
									</span>
								</div>
								{children}
							</>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

/** How long the saved mark stays after a change lands. */
const SAVED_MS = 2500;

/**
 * A tick and "Saved" for a moment after any change on the page lands, so a
 * toggle or a picker confirms itself (#1101 cold start).
 */
function SavedMark() {
	const client = useQueryClient();
	const [at, setAt] = useState(0);
	useEffect(
		() =>
			client.getMutationCache().subscribe((e) => {
				if (e.type === "updated" && e.mutation.state.status === "success")
					setAt(Date.now());
			}),
		[client],
	);
	useEffect(() => {
		if (!at) return;
		const t = window.setTimeout(() => setAt(0), SAVED_MS);
		return () => window.clearTimeout(t);
	}, [at]);
	return (
		<span
			role="status"
			className={cn(
				"inline-flex items-center gap-1 text-meta text-text-2 transition-opacity duration-(--dur-fast)",
				at ? "opacity-100" : "opacity-0",
			)}
			data-testid="settings-saved"
		>
			{at ? (
				<>
					<Check aria-hidden className="size-3.5 text-ok" />
					Saved
				</>
			) : null}
		</span>
	);
}

/** The sections beside the page, so the app's own sidebar stays put in Settings. */
function SectionList({
	current,
	query,
}: {
	current: SettingsSection;
	query: string;
}) {
	return (
		<nav
			className="relative grid w-52 shrink-0 content-start gap-0.5 overflow-y-auto px-2 pt-4 after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-hairline"
			aria-label="Settings sections"
			data-testid="settings-sections"
		>
			<SettingsSearchBox query={query} />
			{SETTINGS_NAV.map((s) => {
				const on = navOf(current)?.tab === s.tab;
				return (
					<Link
						key={s.tab}
						to="/settings"
						search={{ tab: s.tab }}
						aria-current={on ? "page" : undefined}
						data-testid={`settings-nav-${s.tab}`}
						className={cn(
							"flex min-h-8 min-w-0 items-center rounded-control px-3 text-body text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-2 hover:text-text-1",
							on && "bg-surface-3 font-medium text-text-1 hover:bg-surface-3",
						)}
					>
						<span className="truncate">{s.label}</span>
					</Link>
				);
			})}
		</nav>
	);
}

/** A folded entry's pages as one tab row over the page; a single page draws none. */
function PageTabs({ section }: { section: SettingsSection }) {
	const navigate = useNavigate();
	const nav = navOf(section);
	if (!nav?.pages) return null;
	const label = new Map(SETTINGS_SECTIONS.map((s) => [s.tab, s.label]));
	return (
		<div className="mb-5" data-testid="settings-page-tabs">
			<Tabs
				label={nav.label}
				value={section}
				onValueChange={(tab) =>
					void navigate({
						to: "/settings",
						search: { tab: tab as SettingsTab },
					})
				}
				items={nav.pages.map((tab) => ({
					value: tab,
					label: TAB_WORD[tab] ?? label.get(tab) ?? tab,
					testId: `settings-tab-${tab}`,
				}))}
			/>
		</div>
	);
}

/** A search result's link lands on its row: scroll to it once the page has drawn it. */
function useLandOnHash() {
	const hash = useLocation({ select: (l) => l.hash });
	useEffect(() => {
		if (!hash) return;
		const id = window.setTimeout(() => {
			const el = document.getElementById(hash);
			el?.scrollIntoView({ block: "center" });
			el?.setAttribute("data-landed", "");
			off = window.setTimeout(() => el?.removeAttribute("data-landed"), 2000);
		}, 50);
		let off = 0;
		return () => {
			window.clearTimeout(id);
			window.clearTimeout(off);
		};
	}, [hash]);
}
