// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The shell's left bar, the same on every page (#1020): New and Search, the
 * doors, Waiting for you and Recents, Settings at the foot. Below 1280 it folds
 * to a labelled rail; `[` hides it. On the phone the doors are a strip across the top.
 */
import { Link, useLocation } from "@tanstack/react-router";
import {
	Activity,
	Boxes,
	Hourglass,
	Menu,
	MessagesSquare,
	PanelLeft,
	Search,
	SlidersHorizontal,
	SquarePen,
	SquareTerminal,
	Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { PrismaLensMark } from "@/components/icons/prismalens-mark";
import { useActiveIncidents } from "@/components/inbox/use-inbox-data";
import { useAbout } from "@/components/settings";
import { Hint } from "@/components/shared/Hint";
import { SearchHost, useOpenSearch } from "@/components/shell/SearchHost";
import { ThreadList, useWaitingCount } from "@/components/shell/ThreadList";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
	Sheet,
	SheetContent,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { useBreathePhase } from "@/hooks/use-breathe-phase";
import { GO_SHORTCUTS } from "@/hooks/use-global-shortcuts";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { SIDEBAR_FULL, useMediaQuery } from "@/hooks/use-media-query";
import { useOperator } from "@/hooks/use-operator";
import { useLastDelivery } from "@/lib/api/hooks/use-webhooks-orpc";
import { triggerOf } from "@/lib/trigger";
import { cn } from "@/lib/utils";

type DoorTo =
	| "/threads"
	| "/automation"
	| "/incidents"
	| "/alerts"
	| "/services"
	| "/schedules"
	| "/settings";

interface Door {
	to: DoorTo;
	label: string;
	/** Test id stem when it differs from the label: the Threads door keeps `incidents`. */
	slug?: string;
	icon: ReactNode;
	count?: number;
	/** Read with the count by assistive tech: `Incidents, 7 need you`. */
	countLabel?: string;
	/** A newer release is out (#717). */
	dot?: boolean;
	/** Only where the list is folded away: the rail and the phone strip (#1020). */
	narrowOnly?: boolean;
	search?: { state: "waiting" };
}

const ICON = "size-4 shrink-0 stroke-[1.5]";

function useDoors(signedIn: boolean): Door[] {
	const about = useAbout(signedIn);
	const { incidents } = useActiveIncidents();
	const { data: delivery } = useLastDelivery();
	// Operations is earned: it stays once alerts have ever arrived, not only while one is open (#1020).
	const operations =
		!!delivery || incidents.some((i) => triggerOf(i).kind !== "you");
	const waiting = useWaitingCount();
	return [
		...(waiting
			? [
					{
						to: "/threads" as const,
						label: "Waiting",
						slug: "waiting",
						icon: <Hourglass className={ICON} />,
						count: waiting,
						countLabel: `${waiting} waiting for you`,
						narrowOnly: true,
						search: { state: "waiting" as const },
					},
				]
			: []),
		{
			to: "/threads",
			label: "Threads",
			icon: <MessagesSquare className={ICON} />,
		},
		{ to: "/automation", label: "Automation", icon: <Zap className={ICON} /> },
		{ to: "/services", label: "Services", icon: <Boxes className={ICON} /> },
		...(operations
			? [
					{
						to: "/incidents" as const,
						label: "Operations",
						slug: "incidents",
						icon: <Activity className={ICON} />,
					},
				]
			: []),
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
	const { sidebarHidden: hidden, toggleSidebar } = useLayoutPrefs();
	useBreathePhase();
	useFoldKey(toggleSidebar, true);
	return (
		<SearchHost enabled={signedIn}>
			{hidden ? (
				<ShowSidebar onShow={toggleSidebar} />
			) : (
				<aside
					className="fixed bottom-0 left-0 top-0 z-40 hidden w-(--sidebar-w) flex-col bg-surface-1 after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-hairline md:flex"
					data-testid="sidebar"
				>
					<MainBar
						pathname={pathname}
						doors={doors}
						signedIn={signedIn}
						onHide={toggleSidebar}
					/>
				</aside>
			)}
			<PhoneStrip pathname={pathname} doors={doors} signedIn={signedIn} />
		</SearchHost>
	);
}

// A thread's own page sits under /incidents, so only the board itself lights Operations.
const isOn = (pathname: string, to: DoorTo) => {
	if (to === "/incidents") return pathname === to;
	// An open thread or schedule run belongs to Threads, so the folded rail still shows where you are.
	if (to === "/threads")
		return (
			pathname === to ||
			pathname.startsWith("/incidents/") ||
			/^\/schedules\/[^/]+\/runs\//.test(pathname)
		);
	return pathname === to || pathname.startsWith(`${to}/`);
};

/** The labels and the list show only at full width; the rail keeps icons. */
const FULL_ONLY = "max-xl:hidden [[data-sidebar-folded]_&]:hidden";

function MainBar({
	pathname,
	doors,
	signedIn,
	onHide,
}: {
	pathname: string;
	doors: Door[];
	signedIn: boolean;
	onHide: () => void;
}) {
	const { sidebarFolded } = useLayoutPrefs();
	const full = useMediaQuery(SIDEBAR_FULL) && !sidebarFolded;
	const openSearch = useOpenSearch();
	const settingsDoor = doors.find((d) => d.to === "/settings");
	return (
		<>
			<div
				data-title-row
				className="flex h-(--header-h) shrink-0 items-center gap-2.5 pr-2 pl-4 max-xl:justify-center max-xl:px-0 [[data-sidebar-folded]_&]:justify-center [[data-sidebar-folded]_&]:px-0"
			>
				{/* The mark only names the app; Incidents is the way home. */}
				<span className="flex items-center gap-2.5 text-body font-semibold">
					<PrismaLensMark className="size-[18px] shrink-0" aria-hidden />
					<span className={FULL_ONLY}>PrismaLens</span>
				</span>
				<span className={cn("ml-auto", FULL_ONLY)}>
					<Hint label="Hide the sidebar" keys={["["]} side="right">
						<button
							type="button"
							onClick={onHide}
							aria-label="Hide the sidebar"
							className="flex size-8 items-center justify-center rounded-control text-text-3 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1"
							data-testid="sidebar-hide"
						>
							<PanelLeft className={ICON} />
						</button>
					</Hint>
				</span>
			</div>
			<div className="grid gap-0.5 px-2 pb-2">
				<Link
					to="/new"
					aria-current={pathname === "/new" ? "page" : undefined}
					aria-label="New"
					className={cn(
						DOOR,
						pathname === "/new" && "bg-surface-3 font-medium text-text-1",
					)}
					data-testid="nav-new"
				>
					<SquarePen className={ICON} />
					<span className={FULL_ONLY}>New</span>
					<span aria-hidden className={RAIL_LABEL}>
						New
					</span>
				</Link>
				<button
					type="button"
					onClick={openSearch}
					className={DOOR}
					data-testid="nav-search"
				>
					<Search className={ICON} aria-hidden />
					{/* The name stays visible: inline at full width, small under the icon on the rail. */}
					<span className="max-xl:text-[10px] max-xl:leading-none [[data-sidebar-folded]_&]:text-[10px] [[data-sidebar-folded]_&]:leading-none">
						Search
					</span>
					<span className={cn("ml-auto text-meta text-text-3", FULL_ONLY)}>
						Ctrl K
					</span>
				</button>
			</div>
			<nav className="grid gap-0.5 px-2" aria-label="Areas">
				{doors
					.filter((d) => d.to !== "/settings" && !(full && d.narrowOnly))
					.map((door) => (
						<DoorLink
							key={door.label}
							door={door}
							on={isOn(pathname, door.to)}
							labelled={full}
						/>
					))}
			</nav>
			<div className="mt-3.5 min-h-0 flex-1 overflow-y-auto pb-2">
				{signedIn && full && <AreaList />}
			</div>
			<div className="flex shrink-0 flex-wrap items-center gap-0.5 px-2 py-2 max-xl:justify-center [[data-sidebar-folded]_&]:justify-center">
				{settingsDoor && <SettingsIcon door={settingsDoor} />}
				<TerminalDoor />
				<ThemeToggle />
			</div>
		</>
	);
}

/** At the foot beside Settings: shows or hides the terminal panel. */
function TerminalDoor() {
	const { bottomPanel, setBottomPanel } = useLayoutPrefs();
	return (
		<Hint label="Terminal" keys={["Ctrl", "`"]} side="right">
			<button
				type="button"
				aria-label="Terminal"
				aria-expanded={bottomPanel}
				onClick={() => setBottomPanel(!bottomPanel)}
				className={cn(
					"flex size-8 items-center justify-center rounded-control text-text-3 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1",
					bottomPanel && "bg-surface-3 text-text-1",
				)}
				data-testid="nav-terminal"
			>
				<SquareTerminal className={ICON} />
			</button>
		</Hint>
	);
}

/** `[` hides the bar or brings it back, unless the operator is typing. */
function useFoldKey(toggle: () => void, enabled: boolean) {
	useEffect(() => {
		if (!enabled) return;
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
	}, [toggle, enabled]);
}

/**
 * The page bar's button while the bar is hidden: it sits at the left of
 * every page bar, which tokens.css pads for it.
 */
function ShowSidebar({ onShow }: { onShow: () => void }) {
	return (
		<Hint label="Show the sidebar" keys={["["]} side="right">
			<button
				type="button"
				onClick={onShow}
				aria-label="Show the sidebar"
				className="fixed top-(--frame-top) left-1 z-40 hidden size-(--header-h) items-center justify-center rounded-control text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1 md:flex"
				data-testid="sidebar-show"
			>
				<PanelLeft className={ICON} />
			</button>
		</Hint>
	);
}

const DOOR =
	"relative flex h-8 items-center gap-2.5 rounded-control px-2.5 text-body text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1 max-xl:h-12 max-xl:flex-col max-xl:justify-center max-xl:gap-1 max-xl:px-0 [[data-sidebar-folded]_&]:h-12 [[data-sidebar-folded]_&]:flex-col [[data-sidebar-folded]_&]:justify-center [[data-sidebar-folded]_&]:gap-1 [[data-sidebar-folded]_&]:px-0";
/** The rail's label under each icon; at full width the inline label shows instead. */
const RAIL_LABEL =
	"hidden max-w-full truncate text-[10px] leading-none max-xl:block [[data-sidebar-folded]_&]:block";

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
				search={door.search}
				aria-current={on ? "page" : undefined}
				aria-label={
					door.countLabel ? `${door.label}, ${door.countLabel}` : door.label
				}
				data-testid={`nav-${door.slug ?? door.label.toLowerCase()}`}
				className={cn(DOOR, on && "bg-surface-3 font-medium text-text-1")}
			>
				<span className="relative">
					{door.icon}
					{door.narrowOnly && door.count !== undefined && (
						<span
							aria-hidden
							className="absolute -top-2 -right-2.5 min-w-4 rounded-full bg-warn px-1 text-center text-[10px] leading-4 font-semibold text-canvas tabular-nums"
						>
							{door.count}
						</span>
					)}
					{door.dot && (
						<span
							aria-hidden
							className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-accent outline-2 outline-surface-1 outline-solid"
							data-testid={`nav-${door.slug ?? door.label.toLowerCase()}-dot`}
						/>
					)}
				</span>
				<span className={FULL_ONLY}>{door.label}</span>
				<span aria-hidden className={RAIL_LABEL}>
					{door.narrowOnly ? `${door.count} waiting` : door.label}
				</span>
				{door.dot && <span className="sr-only">, update available</span>}
				{door.count !== undefined && " "}
				{door.count !== undefined && (
					<span
						className={cn(
							"ml-auto text-meta font-normal text-warn tabular-nums",
							FULL_ONLY,
						)}
						data-testid={`nav-${door.slug ?? door.label.toLowerCase()}-count`}
					>
						{door.count}
					</span>
				)}
			</Link>
		</Hint>
	);
}

/** Under the doors, the list of the area you are in. */
/** Under the doors: the threads, on every page. */
function AreaList() {
	// One list of threads on every page; alerts and services list on their own pages (#1020 D1).
	return <ThreadList />;
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
				className="relative flex h-8 min-w-8 items-center justify-center gap-2.5 rounded-control text-body text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1 max-xl:h-12 max-xl:w-full max-xl:flex-col max-xl:gap-1 xl:flex-1 xl:justify-start xl:px-2.5 [[data-sidebar-folded]_&]:h-12 [[data-sidebar-folded]_&]:w-full [[data-sidebar-folded]_&]:flex-none [[data-sidebar-folded]_&]:flex-col [[data-sidebar-folded]_&]:justify-center [[data-sidebar-folded]_&]:gap-1 [[data-sidebar-folded]_&]:px-0"
				data-testid="nav-settings"
			>
				<span className="relative">
					{door.icon}
					{door.dot && (
						<span
							aria-hidden
							className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-accent outline-2 outline-surface-1 outline-solid"
							data-testid="nav-settings-dot"
						/>
					)}
				</span>
				<span className={FULL_ONLY}>Settings</span>
				{/* The rail names Settings as it names the doors above (#1020). */}
				<span aria-hidden className={RAIL_LABEL}>
					Settings
				</span>
			</Link>
		</Hint>
	);
}

/**
 * The phone's bar: Menu opens the sidebar as a labelled drawer with Search
 * and Recents; the page header beside it names the page (#1020).
 */
function PhoneStrip({
	pathname,
	doors,
	signedIn,
}: {
	pathname: string;
	doors: Door[];
	signedIn: boolean;
}) {
	const [open, setOpen] = useState(false);
	const openSearch = useOpenSearch();
	const waiting = doors.find((d) => d.narrowOnly);
	return (
		<nav
			className="sticky top-0 z-40 flex h-(--header-h) items-center gap-1 bg-canvas px-2 md:hidden"
			aria-label="Areas"
			data-testid="topbar"
		>
			<Sheet open={open} onOpenChange={setOpen}>
				<SheetTrigger asChild>
					<button
						type="button"
						aria-label="Menu"
						className="flex size-12 items-center justify-center rounded-control text-text-1 hover:bg-surface-2"
						data-testid="strip-menu"
					>
						<Menu className="size-5 shrink-0 stroke-[1.5]" aria-hidden />
					</button>
				</SheetTrigger>
				<SheetContent
					side="left"
					className="flex w-[280px] flex-col gap-0 bg-surface-1 p-0"
					onClickCapture={(e) => {
						if ((e.target as HTMLElement).closest("a")) setOpen(false);
					}}
					data-testid="phone-menu"
				>
					<SheetTitle className="flex h-(--header-h) shrink-0 items-center gap-2.5 px-4 text-body font-semibold">
						<PrismaLensMark className="size-[18px] shrink-0" aria-hidden />
						PrismaLens
					</SheetTitle>
					<div className="grid gap-0.5 px-2 pb-2">
						<Link
							to="/new"
							className={cn(MENU_ROW, pathname === "/new" && MENU_ON)}
							data-testid="menu-new"
						>
							<SquarePen className={ICON} aria-hidden />
							New
						</Link>
						<button
							type="button"
							onClick={() => {
								setOpen(false);
								openSearch();
							}}
							className={MENU_ROW}
							data-testid="menu-search"
						>
							<Search className={ICON} aria-hidden />
							Search
						</button>
						{doors
							.filter((d) => !d.narrowOnly)
							.map((door) => (
								<Link
									key={door.label}
									to={door.to}
									search={door.search}
									aria-current={isOn(pathname, door.to) ? "page" : undefined}
									className={cn(MENU_ROW, isOn(pathname, door.to) && MENU_ON)}
									data-testid={`menu-${door.slug ?? door.label.toLowerCase()}`}
								>
									{door.icon}
									{door.label}
									{door.count !== undefined && (
										<span className="ml-auto text-meta text-text-3 tabular-nums">
											{door.count}
										</span>
									)}
								</Link>
							))}
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto pb-2">
						{signedIn && <ThreadList />}
					</div>
				</SheetContent>
			</Sheet>
			<span className="flex-1" />
			{waiting && (
				<Link
					to={waiting.to}
					search={waiting.search}
					className="flex h-8 items-center rounded-control px-1"
					data-testid="strip-waiting"
				>
					<span className="rounded-full bg-warn/15 px-2 text-meta font-medium text-warn tabular-nums">
						{waiting.count} waiting
					</span>
				</Link>
			)}
			<Link
				to="/new"
				aria-label="New"
				data-testid="strip-new"
				className="flex size-12 items-center justify-center rounded-control text-text-2 hover:bg-surface-2 hover:text-text-1"
			>
				<SquarePen className={ICON} />
			</Link>
		</nav>
	);
}

const MENU_ROW =
	"flex h-10 min-w-0 items-center gap-3 rounded-control px-3 text-body text-text-2 hover:bg-surface-3 hover:text-text-1";
const MENU_ON = "bg-surface-3 font-medium text-text-1";
