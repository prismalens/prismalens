// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The shell's left bar, one for every page (#811): three doors, the incidents
 * under their services (the Alerts and Services areas keep their own lists),
 * and Settings beside the theme toggle at the foot. Below 1280 it folds to an
 * icon rail; on the phone the doors are a strip of icons across the top.
 * Settings swaps the bar for its sections with Back above them. Hidden on
 * pairing, where nothing leads away.
 */
import { Link, useLocation, useMatch, useSearch } from "@tanstack/react-router";
import {
	Bell,
	Boxes,
	ChevronLeft,
	Inbox,
	SlidersHorizontal,
} from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { AlertListPane } from "@/components/alerts/AlertListPane";
import { PrismaLensMark } from "@/components/icons/prismalens-mark";
import { useNeedsYouCount } from "@/components/inbox/use-inbox-data";
import { tierWord } from "@/components/services/service-detail.utils";
import { useAbout } from "@/components/settings";
import {
	type SettingsTab,
	useSettingsSections,
} from "@/components/settings/SettingsFrame";
import { Hint } from "@/components/shared/Hint";
import { IncidentTree } from "@/components/shell/IncidentTree";
import { ThemeToggle } from "@/components/ThemeToggle";
import { inSettings, useBack } from "@/hooks/use-back";
import { useBreathePhase } from "@/hooks/use-breathe-phase";
import { GO_SHORTCUTS } from "@/hooks/use-global-shortcuts";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { PHONE, SIDEBAR_FULL, useMediaQuery } from "@/hooks/use-media-query";
import { useOperator } from "@/hooks/use-operator";
import { useServices } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

type DoorTo = "/incidents" | "/alerts" | "/services" | "/settings";

interface Door {
	to: DoorTo;
	label: string;
	icon: ReactNode;
	count?: number;
	/** Read with the count by assistive tech: `Incidents, 7 need you`. */
	countLabel?: string;
	/** A newer release is out (#717). */
	dot?: boolean;
}

const ICON = "size-4 shrink-0 stroke-[1.5]";

function useDoors(signedIn: boolean): Door[] {
	const needs = useNeedsYouCount(signedIn);
	const about = useAbout(signedIn);
	return [
		{
			to: "/incidents",
			label: "Incidents",
			icon: <Inbox className={ICON} />,
			count: needs || undefined,
			countLabel: needs ? `${needs} need you` : undefined,
		},
		{ to: "/alerts", label: "Alerts", icon: <Bell className={ICON} /> },
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
				className="fixed inset-y-0 left-0 z-40 hidden w-(--sidebar-w) flex-col bg-surface-1 md:flex"
				data-testid="sidebar"
			>
				{/* macOS draws its traffic lights here (x14 y13). */}
				<div
					aria-hidden
					className="hidden h-[30px] shrink-0 app-drag mac:block"
				/>
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
	const settingsDoor = doors.find((d) => d.to === "/settings");
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
				{doors
					.filter((d) => d.to !== "/settings")
					.map((door) => (
						<DoorLink
							key={door.to}
							door={door}
							on={isOn(pathname, door.to)}
							labelled={full}
						/>
					))}
			</nav>
			<div className="mt-3.5 min-h-0 flex-1 overflow-y-auto pb-2">
				{signedIn && full && <AreaList pathname={pathname} />}
			</div>
			<div className="flex shrink-0 flex-wrap items-center gap-0.5 px-2 py-2 max-xl:justify-center [[data-sidebar-folded]_&]:justify-center">
				{settingsDoor && <SettingsIcon door={settingsDoor} />}
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
				aria-label={
					door.countLabel ? `${door.label}, ${door.countLabel}` : door.label
				}
				data-testid={`nav-${door.label.toLowerCase()}`}
				className={cn(
					"relative flex h-8 items-center gap-2.5 rounded-control px-2.5 text-body text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1 max-xl:justify-center max-xl:px-0 [[data-sidebar-folded]_&]:justify-center [[data-sidebar-folded]_&]:px-0",
					on && "bg-surface-3 font-medium text-text-1",
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
							"ml-auto text-meta font-normal text-warn tabular-nums",
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
	const alert = useMatch({
		from: "/_authenticated/alerts/$id/",
		shouldThrow: false,
	});
	if (isOn(pathname, "/alerts")) {
		return (
			<AlertListPane variant="sidebar" selectedId={alert?.params.id ?? null} />
		);
	}
	if (isOn(pathname, "/services")) return <ServiceList />;
	return <IncidentTree />;
}

/** Settings at the foot, an icon beside the theme toggle (spec §1). */
function SettingsIcon({ door }: { door: Door }) {
	return (
		<Hint
			label="Settings"
			keys={
				goKey("Settings")
					? ["G", (goKey("Settings") ?? "").toUpperCase()]
					: undefined
			}
			side="right"
		>
			<Link
				to="/settings"
				aria-label={door.dot ? "Settings, update available" : "Settings"}
				className="relative flex size-8 items-center justify-center rounded-control text-text-3 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1"
				data-testid="nav-settings"
			>
				{door.icon}
				{door.dot && (
					<span
						aria-hidden
						className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-accent"
						data-testid="nav-settings-dot"
					/>
				)}
			</Link>
		</Hint>
	);
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
								{tierWord(s.tier)}
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
							<span className="truncate font-medium text-text-1">
								{s.label}
							</span>
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
 * The phone's doors: four icons across the top, the one you are in on
 * `surface-2` with the accent bar; the page header below carries New (#673).
 * It stays on Settings; its Settings door returns a section to the list.
 */
function PhoneStrip({ pathname, doors }: { pathname: string; doors: Door[] }) {
	return (
		<nav
			className="sticky top-0 z-40 flex h-(--header-h) items-center gap-1 bg-canvas px-2 md:hidden"
			aria-label="Areas"
			data-testid="topbar"
		>
			{doors.map((door) => {
				const on = isOn(pathname, door.to);
				return (
					<Link
						key={door.to}
						to={door.to}
						aria-current={on ? "page" : undefined}
						aria-label={
							door.count !== undefined
								? `${door.label}, ${door.count}`
								: door.label
						}
						data-testid={`strip-${door.label.toLowerCase()}`}
						className={cn(
							"relative flex h-8 items-center gap-1 rounded-control px-2.5 text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-2 hover:text-text-1",
							on &&
								"bg-surface-2 text-text-1 before:absolute before:top-2 before:bottom-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent",
						)}
					>
						{door.icon}
						{door.count !== undefined && (
							<span
								aria-hidden
								className="text-meta text-text-3 tabular-nums"
								data-testid={`strip-${door.label.toLowerCase()}-count`}
							>
								{door.count}
							</span>
						)}
						{door.dot && (
							<span
								aria-hidden
								className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-accent"
							/>
						)}
					</Link>
				);
			})}
		</nav>
	);
}
