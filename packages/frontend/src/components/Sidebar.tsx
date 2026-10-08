// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The shell's left bar (study-v3 §2, study-v2 §2.5 rule 1): four doors, the
 * one you are in lit by a 2-px accent bar, and under them the list of that
 * area. Below 1280 it folds to a 56-px icon rail; on the phone the doors are
 * a labelled strip across the top. Settings swaps the whole bar for its
 * sections with Back above them. Hidden on pairing, where nothing leads away.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useMatch, useSearch } from "@tanstack/react-router";
import {
	Bell,
	Boxes,
	ChevronLeft,
	Inbox,
	Plus,
	SlidersHorizontal,
} from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { AlertListPane } from "@/components/alerts/AlertListPane";
import { PrismaLensMark } from "@/components/icons/prismalens-mark";
import { IncidentListPane } from "@/components/incidents/IncidentListPane";
import { kindWord } from "@/components/services/service-detail.utils";
import { TelemetryConsent, useAbout } from "@/components/settings";
import {
	type SettingsTab,
	useSettingsSections,
} from "@/components/settings/SettingsFrame";
import { Hint } from "@/components/shared/Hint";
import { useNewIncident } from "@/components/shell/NewIncident";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { inSettings, useBack } from "@/hooks/use-back";
import { useBreathePhase } from "@/hooks/use-breathe-phase";
import { GO_SHORTCUTS } from "@/hooks/use-global-shortcuts";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { PHONE, SIDEBAR_FULL, useMediaQuery } from "@/hooks/use-media-query";
import { useOperator } from "@/hooks/use-operator";
import { useServices } from "@/lib/api/hooks";
import { useLiveRefreshInterval } from "@/lib/api/live-refresh";
import { orpc } from "@/lib/api/orpc-client";
import { cn } from "@/lib/utils";

type DoorTo = "/incidents" | "/alerts" | "/services" | "/settings";

interface Door {
	to: DoorTo;
	label: string;
	icon: ReactNode;
	count?: number;
	/** A newer release is out (#717). */
	dot?: boolean;
}

const ICON = "size-4 shrink-0 stroke-[1.5]";

function useDoors(signedIn: boolean): Door[] {
	const interval = useLiveRefreshInterval();
	const incidents = useQuery({
		...orpc.incidents.getStats.queryOptions({ input: {} }),
		enabled: signedIn,
		refetchInterval: interval,
	});
	const alerts = useQuery({
		...orpc.alerts.getStats.queryOptions({ input: {} }),
		enabled: signedIn,
		refetchInterval: interval,
	});
	const about = useAbout(signedIn);
	return [
		{
			to: "/incidents",
			label: "Incidents",
			icon: <Inbox className={ICON} />,
			count: incidents.data?.open || undefined,
		},
		{
			to: "/alerts",
			label: "Alerts",
			icon: <Bell className={ICON} />,
			count: alerts.data?.byStatus.triggered || undefined,
		},
		{ to: "/services", label: "Services", icon: <Boxes className={ICON} /> },
		{
			to: "/settings",
			label: "Settings",
			icon: <SlidersHorizontal className={ICON} />,
			dot: about.data?.update.available === true,
		},
	];
}

const goKey = (label: string) =>
	GO_SHORTCUTS.find((s) => s.label === label)?.key;

export function Sidebar() {
	const { pathname } = useLocation();
	if (pathname.startsWith("/pair")) return null;
	return <Shell pathname={pathname} />;
}

function Shell({ pathname }: { pathname: string }) {
	const { via } = useOperator();
	const signedIn = via !== null;
	const doors = useDoors(signedIn);
	const settings = inSettings(pathname);
	const back = useBack(inSettings, "/incidents");
	useBreathePhase();
	useEffect(() => {
		document.documentElement.toggleAttribute("data-settings", settings);
	}, [settings]);
	return (
		<>
			<aside
				className="fixed inset-y-0 left-0 z-40 hidden w-(--sidebar-w) flex-col bg-canvas pt-(--titlebar-h) md:flex"
				data-testid="sidebar"
			>
				{settings ? (
					<SettingsBar onBack={back} />
				) : (
					<MainBar pathname={pathname} doors={doors} signedIn={signedIn} />
				)}
			</aside>
			<PhoneStrip pathname={pathname} doors={doors} />
		</>
	);
}

const isOn = (pathname: string, to: DoorTo) =>
	pathname === to || pathname.startsWith(`${to}/`);

/** The labels and the list show only at full width; the rail keeps icons. */
const FULL_ONLY = "max-xl:hidden [[data-sidebar-folded]_&]:hidden";

function MainBar({
	pathname,
	doors,
	signedIn,
}: {
	pathname: string;
	doors: Door[];
	signedIn: boolean;
}) {
	const { sidebarFolded, toggleSidebar } = useLayoutPrefs();
	const full = useMediaQuery(SIDEBAR_FULL) && !sidebarFolded;
	useFoldKey(toggleSidebar);
	return (
		<>
			<div className="flex h-(--header-h) shrink-0 items-center gap-2.5 px-4 max-xl:justify-center max-xl:px-0 [[data-sidebar-folded]_&]:justify-center [[data-sidebar-folded]_&]:px-0 desktop:app-drag">
				<Link
					to="/incidents"
					className="flex items-center gap-2.5 rounded-control text-body font-semibold desktop:app-no-drag"
					aria-label="PrismaLens"
				>
					<PrismaLensMark className="size-[18px] shrink-0" />
					<span className={FULL_ONLY}>PrismaLens</span>
				</Link>
			</div>
			<nav className="grid gap-0.5 px-2" aria-label="Areas">
				{doors.map((door) => (
					<DoorLink
						key={door.to}
						door={door}
						on={isOn(pathname, door.to)}
						labelled={full}
					/>
				))}
			</nav>
			{/* The list scrolls under a 28 px fade; the theme toggle is a fixed foot. */}
			<div className="mt-2.5 min-h-0 flex-1 overflow-y-auto pb-2 [mask-image:linear-gradient(to_bottom,#000_calc(100%-28px),transparent)]">
				{signedIn && full && <AreaList pathname={pathname} />}
			</div>
			{full && <TelemetryConsent variant="strip" />}
			<div className="flex shrink-0 items-center px-2 py-2 max-xl:justify-center [[data-sidebar-folded]_&]:justify-center">
				<ThemeToggle />
			</div>
		</>
	);
}

/** `[` folds the bar to its rail, unless the operator is typing. */
function useFoldKey(toggle: () => void) {
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
			toggle();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [toggle]);
}

function DoorLink({
	door,
	on,
	labelled,
}: {
	door: Door;
	on: boolean;
	labelled: boolean;
}) {
	const key = goKey(door.label);
	return (
		<Hint
			label={door.label}
			keys={key ? ["G", key.toUpperCase()] : undefined}
			side="right"
			when={!labelled}
		>
			<Link
				to={door.to}
				aria-current={on ? "page" : undefined}
				aria-label={door.label}
				data-testid={`nav-${door.label.toLowerCase()}`}
				className={cn(
					"relative flex h-8 items-center gap-2.5 rounded-control px-2.5 text-body text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-2 hover:text-text-1 max-xl:justify-center max-xl:px-0 [[data-sidebar-folded]_&]:justify-center [[data-sidebar-folded]_&]:px-0",
					on &&
						"bg-surface-2 font-medium text-text-1 before:absolute before:top-2 before:bottom-2 before:-left-2 before:w-0.5 before:rounded-full before:bg-accent",
				)}
			>
				<span className="relative">
					{door.icon}
					{door.dot && (
						<span
							aria-hidden
							className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-accent"
							data-testid={`nav-${door.label.toLowerCase()}-dot`}
						/>
					)}
				</span>
				<span className={FULL_ONLY}>{door.label}</span>
				{door.dot && <span className="sr-only">, update available</span>}
				{door.count !== undefined && (
					<span
						className={cn(
							"ml-auto text-meta font-normal text-text-3 tabular-nums",
							FULL_ONLY,
						)}
						data-testid={`nav-${door.label.toLowerCase()}-count`}
					>
						{door.count}
					</span>
				)}
			</Link>
		</Hint>
	);
}

/** Under the doors, the list of the area you are in. */
function AreaList({ pathname }: { pathname: string }) {
	const incident = useMatch({
		from: "/_authenticated/incidents/$id",
		shouldThrow: false,
	});
	const alert = useMatch({
		from: "/_authenticated/alerts/$id/",
		shouldThrow: false,
	});
	if (isOn(pathname, "/incidents")) {
		return (
			<IncidentListPane
				variant="sidebar"
				selectedId={incident?.params.id ?? null}
				keyboard
			/>
		);
	}
	if (isOn(pathname, "/alerts")) {
		return (
			<AlertListPane variant="sidebar" selectedId={alert?.params.id ?? null} />
		);
	}
	if (isOn(pathname, "/services")) return <ServiceList />;
	return null;
}

function ServiceList() {
	const { data } = useServices();
	const services = data?.data ?? [];
	const service = useMatch({
		from: "/_authenticated/services/$id/",
		shouldThrow: false,
	});
	if (services.length === 0) return null;
	return (
		<div className="pool mx-2 mt-2.5 p-1.5" data-testid="sidebar-services">
			<SideLane label="Services" count={services.length} />
			{services.map((s) => {
				const on = service?.params.id === s.id;
				return (
					<Link
						key={s.id}
						to="/services/$id"
						params={{ id: s.id }}
						className={cn(
							"group/row flex h-7 min-w-0 items-center gap-2.5 rounded-control px-2 text-body text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1",
							on && "bg-surface-4 text-text-1 hover:bg-surface-4",
						)}
					>
						<span className="min-w-0 truncate">
							{s.name}
							<span
								className={cn(
									"ml-1.5 text-meta text-text-3 group-hover/row:text-text-2",
									on && "text-text-2",
								)}
							>
								{kindWord(s.type)}
							</span>
						</span>
					</Link>
				);
			})}
		</div>
	);
}

/** A group heading in the sidebar list: a name and a count, in the tertiary colour. */
export function SideLane({
	label,
	count,
	children,
}: {
	label: ReactNode;
	count?: number;
	children?: ReactNode;
}) {
	return (
		<div className="flex h-6 items-center gap-1.5 px-2 text-meta text-text-3">
			<span className="truncate">{label}</span>
			{children}
			{count !== undefined && (
				<span className="ml-auto tabular-nums">{count}</span>
			)}
		</div>
	);
}

/** Settings' bar: Back above the sections; Esc is Back too. */
function SettingsBar({ onBack }: { onBack: () => void }) {
	const sections = useSettingsSections();
	// The bar renders before the settings route matches, so read the search loosely.
	const { tab } = useSearch({ strict: false }) as { tab?: SettingsTab };
	const phone = useMediaQuery(PHONE);
	const current: SettingsTab | undefined = tab ?? "harness";
	useEscape(onBack, !phone);
	return (
		<>
			<button
				type="button"
				onClick={onBack}
				className="flex h-(--header-h) shrink-0 items-center gap-2 px-4 text-body font-medium text-text-1 desktop:app-no-drag"
				data-testid="settings-back"
			>
				<ChevronLeft className="size-4 text-text-2" />
				Back
			</button>
			<nav
				className="grid gap-0.5 px-2"
				aria-label="Settings sections"
				data-testid="settings-sections"
			>
				{sections.map((s) => {
					const on = s.tab === current;
					return (
						<Link
							key={s.tab}
							to="/settings"
							search={{ tab: s.tab }}
							aria-current={on ? "page" : undefined}
							data-testid={`settings-nav-${s.tab}`}
							className={cn(
								"relative flex min-h-11 min-w-0 flex-col justify-center rounded-control px-2.5 text-body text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-2 hover:text-text-1",
								on &&
									"bg-surface-2 font-medium text-text-1 before:absolute before:top-3 before:bottom-3 before:-left-2 before:w-0.5 before:rounded-full before:bg-accent",
							)}
						>
							<span className="truncate">{s.label}</span>
							{s.line && (
								<small className="truncate text-meta font-normal text-text-3">
									{s.line}
								</small>
							)}
						</Link>
					);
				})}
			</nav>
			<div className="mt-auto flex shrink-0 items-center px-2 py-2">
				<ThemeToggle />
			</div>
		</>
	);
}

function useEscape(handler: () => void, enabled: boolean) {
	useEffect(() => {
		if (!enabled) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.defaultPrevented) return;
			const t = e.target as HTMLElement | null;
			if (
				t?.tagName === "INPUT" ||
				t?.tagName === "TEXTAREA" ||
				t?.tagName === "SELECT" ||
				t?.isContentEditable
			)
				return;
			if (document.querySelector("[role=dialog], [role=alertdialog]")) return;
			handler();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [handler, enabled]);
}

/**
 * The phone's doors: a strip across the top with a 10-px label under each, and
 * New. It stays on Settings; its Settings door returns a section to the list.
 */
function PhoneStrip({ pathname, doors }: { pathname: string; doors: Door[] }) {
	const newIncident = useNewIncident();
	return (
		<div
			className="sticky top-0 z-40 flex h-(--header-h) items-center gap-1 bg-canvas px-4 md:hidden"
			data-testid="topbar"
		>
			<Link
				to="/incidents"
				aria-label="PrismaLens"
				className="mr-auto flex items-center rounded-control"
			>
				<PrismaLensMark className="size-[22px]" />
			</Link>
			<nav className="flex items-center" aria-label="Areas">
				{doors.map((door) => {
					const on = isOn(pathname, door.to);
					return (
						<Link
							key={door.to}
							to={door.to}
							aria-current={on ? "page" : undefined}
							data-testid={`strip-${door.label.toLowerCase()}`}
							className={cn(
								"relative flex h-10 min-w-12 flex-col items-center justify-center gap-0.5 rounded-control px-1.5 text-[10px] leading-3 text-text-2 transition-colors duration-(--dur-instant)",
								on &&
									"font-medium text-text-1 after:absolute after:inset-x-2 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-accent",
							)}
						>
							{door.icon}
							<span>{door.label}</span>
						</Link>
					);
				})}
			</nav>
			<Button
				size="icon"
				className="ml-1 size-8"
				onClick={newIncident}
				aria-label="New incident"
				data-testid="strip-new"
			>
				<Plus className="size-4" />
			</Button>
		</div>
	);
}
