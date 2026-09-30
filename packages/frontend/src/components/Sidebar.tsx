// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The shell's left bar (#743): the incident list grouped by service, with
 * Alerts, Settings and the theme in its foot. `[` folds it away entirely.
 * Hidden on setup, auth and pairing routes so nothing leads away from a step
 * that must finish. On narrow screens it is a top strip of the three doors.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useMatch } from "@tanstack/react-router";
import { Bell, PanelLeft, Settings, Siren } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { PrismaLensMark } from "@/components/icons/prismalens-mark";
import { IncidentListPane } from "@/components/incidents/IncidentListPane";
import { TelemetryConsent, useAbout } from "@/components/settings";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { SIDEBAR_BESIDE, useMediaQuery } from "@/hooks/use-media-query";
import { useOperator } from "@/hooks/use-operator";
import { orpc } from "@/lib/api/orpc-client";
import { cn } from "@/lib/utils";

export function Sidebar() {
	const location = useLocation();
	if (
		location.pathname.startsWith("/setup") ||
		location.pathname.startsWith("/auth") ||
		location.pathname.startsWith("/pair")
	) {
		return null;
	}
	return <SidebarBody pathname={location.pathname} />;
}

function SidebarBody({ pathname }: { pathname: string }) {
	const { via } = useOperator();
	const signedIn = via !== null;
	const { sidebarFolded, toggleSidebar } = useLayoutPrefs();

	// `[` folds the bar away, unless the operator is typing.
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
	const about = useAbout(signedIn);
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
	const wide = useMediaQuery(SIDEBAR_BESIDE);
	const record = useMatch({
		from: "/_authenticated/incidents/$id",
		shouldThrow: false,
	});
	// Services live inside the settings frame, so Settings stays lit there.
	const isActive = (to: NavItem["to"]) =>
		pathname.startsWith(to) ||
		(to === "/settings" && pathname.startsWith("/services"));

	const items: NavItem[] = [
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
			dot: about.data?.update.available === true,
		},
	];

	const nav = (compact: boolean) =>
		items.map((item) => (
			<Link
				key={item.to}
				to={item.to}
				aria-current={isActive(item.to) ? "page" : undefined}
				title={compact ? item.label : undefined}
				className={cn(
					"flex items-center gap-2.5 rounded-md px-2 py-1 text-record text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary",
					isActive(item.to) && "bg-muted text-foreground",
				)}
				data-testid={`nav-${item.label.toLowerCase()}`}
			>
				<NavIcon item={item} />
				<span className="sr-only sm:not-sr-only">{item.label}</span>
				<NavCount item={item} />
			</Link>
		));

	// Incidents is the list itself; the other front doors are icons in the foot.
	const footer = items
		.filter((item) => item.to !== "/incidents")
		.map((item) => (
			<Link
				key={item.to}
				to={item.to}
				aria-current={isActive(item.to) ? "page" : undefined}
				aria-label={item.label}
				title={item.label}
				className={cn(
					"flex h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary",
					isActive(item.to) && "bg-muted text-foreground",
				)}
				data-testid={`nav-${item.label.toLowerCase()}`}
			>
				<NavIcon item={item} />
				<NavCount item={item} />
			</Link>
		));

	return (
		<>
			{/* One place for the toggle, open or folded: the top-left corner. */}
			<div
				className="fixed left-0 top-0 z-50 hidden h-10 items-center gap-1 px-2 md:flex desktop:h-(--titlebar-h) mac:pl-20"
				data-testid="sidebar-head"
			>
				<Button
					variant="ghost"
					size="sm"
					className="app-no-drag h-7 w-7 p-0"
					aria-label={sidebarFolded ? "Show the sidebar" : "Hide the sidebar"}
					aria-expanded={!sidebarFolded}
					title={sidebarFolded ? "Show the sidebar  [" : "Hide the sidebar  ["}
					onClick={toggleSidebar}
					data-testid="sidebar-toggle"
				>
					<PanelLeft className="h-4 w-4" />
				</Button>
				<Link
					to="/incidents"
					className="app-no-drag flex items-center gap-2 px-1 text-sm font-semibold tracking-tight"
				>
					<PrismaLensMark className="h-5 w-5 shrink-0" />
					<span>PrismaLens</span>
				</Link>
			</div>

			{!sidebarFolded && (
				<aside
					className="fixed inset-y-0 left-0 z-40 hidden w-(--sidebar-w) flex-col border-r bg-card md:flex"
					data-testid="sidebar"
				>
					<div
						aria-hidden="true"
						className="app-drag h-10 shrink-0 desktop:h-(--titlebar-h)"
					/>
					{signedIn && wide ? (
						<IncidentListPane
							selectedId={record?.params.id ?? null}
							keyboard={pathname.startsWith("/incidents")}
							className="min-h-0 flex-1"
						/>
					) : (
						<div className="flex-1" />
					)}
					<TelemetryConsent variant="strip" />
					<div className="flex items-center gap-0.5 border-t px-2 py-1.5">
						{footer}
						<div className="ml-auto">
							<ThemeToggle />
						</div>
					</div>
				</aside>
			)}

			<div
				className="flex h-10 items-center gap-1 border-b bg-card px-2 md:hidden"
				data-testid="topbar"
			>
				<Link
					to="/incidents"
					className="flex shrink-0 items-center gap-1.5 px-1.5 text-sm font-semibold tracking-tight"
					aria-label="PrismaLens"
				>
					<PrismaLensMark className="h-6 w-6" />
					<span className="hidden sm:inline">PrismaLens</span>
				</Link>
				<nav className="flex min-w-0 flex-1 items-center justify-end gap-0.5 sm:justify-start">
					{nav(true)}
				</nav>
				<ThemeToggle />
			</div>
		</>
	);
}

interface NavItem {
	to: "/incidents" | "/alerts" | "/settings";
	label: string;
	icon: ReactNode;
	count?: number;
	countTone?: "critical" | "neutral";
	/** A newer release is out (#717). */
	dot?: boolean;
}

function NavIcon({ item }: { item: NavItem }) {
	return (
		<span className="relative">
			{item.icon}
			{item.dot && (
				<>
					<span
						className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary"
						aria-hidden="true"
						data-testid={`nav-${item.label.toLowerCase()}-dot`}
					/>
					<span className="sr-only">, update available</span>
				</>
			)}
		</span>
	);
}

function NavCount({ item }: { item: NavItem }) {
	if (item.count === undefined) return null;
	return (
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
