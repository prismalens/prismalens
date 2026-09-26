// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import {
	BarChart3,
	Boxes,
	Info,
	KeyRound,
	Plug,
	Smartphone,
	Sparkles,
	TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { useAbout } from "@/components/settings/AboutSettings";
import { useDevices } from "@/components/settings/DevicesTab";
import { StateWord } from "@/components/shared/StateChip";
import { useOperator } from "@/hooks/use-operator";
import {
	useConnections,
	useIntegrations,
	useInvestigationReadiness,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

export type SettingsSection =
	| "harness"
	| "integrations"
	| "connections"
	| "devices"
	| "services"
	| "usage"
	| "about"
	| "danger";

interface Item {
	section: SettingsSection;
	label: string;
	icon: ReactNode;
	line: ReactNode;
	to: "/settings" | "/services";
	tab?: Exclude<SettingsSection, "services">;
}

/**
 * The settings frame: sections on the left, each with one line of its state
 * (like a mail list), the section's rows on the right. Services live here too;
 * they keep their URL but never leave the frame.
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
	const readiness = useInvestigationReadiness();
	const { data: integrations } = useIntegrations();
	const { data: connections } = useConnections();
	const { managesPairing } = useOperator();
	const { data: devices } = useDevices(managesPairing);
	const { data: about } = useAbout();
	const items: Item[] = [
		{
			section: "harness",
			label: "Agent",
			icon: <Sparkles className="h-4 w-4" />,
			tab: "harness",
			to: "/settings",
			line: readiness.isReady ? (
				<StateWord tone="done">ready</StateWord>
			) : (
				<StateWord tone="failed">not ready</StateWord>
			),
		},
		{
			section: "integrations",
			label: "Integrations",
			icon: <Plug className="h-4 w-4" />,
			tab: "integrations",
			to: "/settings",
			line: integrations
				? `${integrations.length} configured`
				: "webhooks, git, Slack",
		},
		{
			section: "connections",
			label: "Connections",
			icon: <KeyRound className="h-4 w-4" />,
			tab: "connections",
			to: "/settings",
			line: connections
				? `${connections.length} connected`
				: "accounts and tokens",
		},
		{
			section: "devices",
			label: "Devices",
			icon: <Smartphone className="h-4 w-4" />,
			tab: "devices",
			to: "/settings",
			line: devices
				? `${devices.devices.length} paired`
				: "phones and computers",
		},
		{
			section: "services",
			label: "Services",
			icon: <Boxes className="h-4 w-4" />,
			to: "/services",
			line: "what a run may read",
		},
		{
			section: "usage",
			label: "Usage data",
			icon: <BarChart3 className="h-4 w-4" />,
			tab: "usage",
			to: "/settings",
			line: "usage counts, off by default",
		},
		{
			section: "about",
			label: "About",
			icon: <Info className="h-4 w-4" />,
			tab: "about",
			to: "/settings",
			line: about?.update.available ? (
				<StateWord tone="primary">{`${about.update.latest} available`}</StateWord>
			) : about ? (
				`version ${about.version}`
			) : (
				"version and updates"
			),
		},
		{
			section: "danger",
			label: "Danger zone",
			icon: <TriangleAlert className="h-4 w-4" />,
			tab: "danger",
			to: "/settings",
			line: "reset and factory reset",
		},
	];

	return (
		<div
			className="fixed inset-y-0 left-0 right-0 top-10 grid grid-cols-1 bg-background md:top-0 md:left-(--sidebar-w) lg:grid-cols-[15rem_minmax(0,1fr)]"
			data-testid="settings-frame"
		>
			<aside
				className="hidden min-h-0 flex-col border-r lg:flex"
				data-testid="settings-pane"
			>
				<h1 className="border-b px-3 py-2 text-record font-semibold">
					Settings
				</h1>
				<nav className="min-h-0 flex-1 overflow-y-auto">
					{items.map((item) => {
						const active = item.section === section;
						return (
							<Link
								key={item.section}
								to={item.to}
								search={item.tab ? { tab: item.tab } : undefined}
								aria-current={active ? "page" : undefined}
								data-testid={`settings-nav-${item.section}`}
								className={cn(
									"block border-b px-3 py-2 outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary",
									active &&
										"bg-primary/8 shadow-[inset_2px_0_0_var(--primary)]",
								)}
							>
								<div className="flex items-center gap-2">
									<span className="text-muted-foreground">{item.icon}</span>
									<div className="min-w-0">
										<div className="text-record font-medium">{item.label}</div>
										<div className="truncate text-meta text-muted-foreground">
											{item.line}
										</div>
									</div>
								</div>
							</Link>
						);
					})}
				</nav>
			</aside>
			<div className="min-h-0 min-w-0 overflow-y-auto">
				<div className="mx-auto max-w-3xl space-y-6 px-4 py-4 sm:px-6">
					{/* Below `lg` the section list folds into a strip that scrolls itself. */}
					<nav
						className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 pb-3 sm:-mx-6 sm:px-6 lg:hidden"
						data-testid="settings-strip"
					>
						{items.map((item) => {
							const active = item.section === section;
							return (
								<Link
									key={item.section}
									to={item.to}
									search={item.tab ? { tab: item.tab } : undefined}
									aria-current={active ? "page" : undefined}
									className={cn(
										"flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-record text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary",
										active && "border-primary/40 bg-primary/8 text-foreground",
									)}
								>
									{item.icon}
									{item.label}
								</Link>
							);
						})}
					</nav>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<p className="text-meta text-muted-foreground">
								Settings <span className="mx-1">/</span>
								{items.find((i) => i.section === section)?.label}
							</p>
							<h2 className="text-sm font-semibold tracking-tight tracking-tight">
								{title}
							</h2>
							{intro && (
								<p className="mt-0.5 text-record text-muted-foreground">
									{intro}
								</p>
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
