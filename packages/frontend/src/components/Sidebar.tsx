// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The shell's left rail: the three front doors with what waits behind each,
 * the theme and the account at the bottom. Hidden on setup and auth routes so
 * nothing leads away from a step that must finish. On narrow screens it folds
 * to a top strip.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { Bell, Layers, PanelLeft, Settings, Siren } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { TelemetryConsent } from "@/components/settings";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { useOperator } from "@/hooks/use-operator";
import { orpc } from "@/lib/api/orpc-client";
import { cn } from "@/lib/utils";

export function Sidebar() {
	const location = useLocation();
	if (
		location.pathname.startsWith("/setup") ||
		location.pathname.startsWith("/auth")
	) {
		return null;
	}
	return <SidebarBody pathname={location.pathname} />;
}

function SidebarBody({ pathname }: { pathname: string }) {
	const { via } = useOperator();
	const signedIn = via !== null;
	const { sidebarFolded, toggleSidebar } = useLayoutPrefs();

	// `[` folds the rail to icons, unless the operator is typing.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
			if (
				t?.tagName === "INPUT" ||
				t?.tagName === "TEXTAREA" ||
				t?.isContentEditable
			)
				return;
			e.preventDefault();
			toggleSidebar();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [toggleSidebar]);
	const incidents = useQuery({
		...orpc.incidents.getStats.queryOptions({ input: {} }),
		enabled: signedIn,
		refetchInterval: 30_000,
	});
	const alerts = useQuery({
		...orpc.alerts.getStats.queryOptions({ input: {} }),
		enabled: signedIn,
		refetchInterval: 30_000,
	});
	const needsYou = incidents.data
		? incidents.data.attention.failed_run +
			incidents.data.attention.unacknowledged +
			incidents.data.attention.awaiting_close
		: 0;
	const firing = alerts.data?.byStatus.triggered ?? 0;

	const items: {
		to: "/incidents" | "/alerts" | "/settings";
		label: string;
		icon: ReactNode;
		count?: number;
		countTone?: "critical" | "neutral";
	}[] = [
		{
			to: "/incidents",
			label: "Incidents",
			icon: <Siren className="h-4 w-4" />,
			count: needsYou || undefined,
			countTone: "critical",
		},
		{
			to: "/alerts",
			label: "Alerts",
			icon: <Bell className="h-4 w-4" />,
			count: firing || undefined,
			countTone: "neutral",
		},
		{
			to: "/settings",
			label: "Settings",
			icon: <Settings className="h-4 w-4" />,
		},
	];

	const nav = (compact: boolean) =>
		items.map((item) => {
			const active = pathname.startsWith(item.to);
			return (
				<Link
					key={item.to}
					to={item.to}
					aria-current={active ? "page" : undefined}
					title={sidebarFolded && !compact ? item.label : undefined}
					className={cn(
						"flex items-center gap-2.5 rounded-md px-2 py-1.5 text-record text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary",
						active && "bg-muted text-foreground",
						compact && "py-1",
						sidebarFolded && !compact && "justify-center px-0",
					)}
					data-testid={`nav-${item.label.toLowerCase()}`}
				>
					{item.icon}
					{!(sidebarFolded && !compact) && (
						<span className="flex-1">{item.label}</span>
					)}
					{item.count !== undefined && !(sidebarFolded && !compact) && (
						<span
							className={cn(
								"min-w-5 rounded px-1 text-center text-meta font-medium tabular-nums",
								item.countTone === "critical"
									? "bg-sev-critical/15 text-sev-critical"
									: "bg-muted-foreground/15 text-muted-foreground",
							)}
						>
							{item.count}
						</span>
					)}
				</Link>
			);
		});

	return (
		<>
			<aside
				className="fixed inset-y-0 left-0 z-40 hidden w-(--sidebar-w) flex-col border-r bg-card md:flex"
				data-testid="sidebar"
				data-folded={sidebarFolded ? "true" : undefined}
			>
				<div className="flex items-center gap-1 px-2 py-2">
					<Link
						to="/incidents"
						className="flex min-w-0 flex-1 items-center gap-2 px-1 text-sm font-semibold tracking-tight"
						title="PrismaLens"
					>
						<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary text-primary-foreground">
							<Layers className="h-3.5 w-3.5" />
						</span>
						{!sidebarFolded && <span className="truncate">PrismaLens</span>}
					</Link>
					{!sidebarFolded && (
						<Button
							variant="ghost"
							size="sm"
							className="h-7 w-7 p-0"
							aria-label="Fold the sidebar"
							onClick={toggleSidebar}
							data-testid="sidebar-fold"
						>
							<PanelLeft className="h-4 w-4" />
						</Button>
					)}
				</div>
				<nav className="flex flex-col gap-0.5 px-2">{nav(false)}</nav>
				<div className="mt-auto">
					{!sidebarFolded && <TelemetryConsent variant="strip" />}
					<div
						className={cn(
							"flex items-center border-t px-2 py-2",
							sidebarFolded ? "flex-col gap-2" : "justify-between",
						)}
					>
						{sidebarFolded ? (
							<Button
								variant="ghost"
								size="sm"
								className="h-7 w-7 p-0"
								aria-label="Unfold the sidebar"
								onClick={toggleSidebar}
								data-testid="sidebar-unfold"
							>
								<PanelLeft className="h-4 w-4" />
							</Button>
						) : (
							<ThemeToggle />
						)}
					</div>
				</div>
			</aside>

			<div
				className="flex items-center gap-1 border-b bg-card px-2 py-1 md:hidden"
				data-testid="topbar"
			>
				<Link to="/incidents" className="px-2 text-sm font-semibold">
					PrismaLens
				</Link>
				<nav className="flex flex-1 items-center gap-0.5">{nav(true)}</nav>
				<ThemeToggle />
			</div>
		</>
	);
}

function getInitials(name: string | null | undefined): string {
	if (!name) return "?";
	return name
		.split(" ")
		.map((part) => part[0])
		.filter(Boolean)
		.slice(0, 2)
		.join("")
		.toUpperCase();
}
