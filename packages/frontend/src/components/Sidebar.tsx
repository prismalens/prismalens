// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The shell's left bar, the same on every page (#1020): New and Search, the
 * doors, Waiting for you and Recents, Settings at the foot. Below 1280 it folds
 * to a labelled rail; `[` hides it. On the phone the doors are a strip across the top.
 */
import {
	Link,
	type LinkComponent,
	type LinkComponentProps,
	useHydrated,
	useLocation,
	useRouter,
} from "@tanstack/react-router";
import {
	ArrowUpCircle,
	Bell,
	Gauge,
	Menu,
	MessagesSquare,
	PanelLeft,
	Search,
	SlidersHorizontal,
	SquarePen,
	SquareTerminal,
} from "lucide-react";
import {
	type ComponentProps,
	type ReactNode,
	useEffect,
	useState,
} from "react";
import { HomeIcon } from "@/components/home/home-icon";
import { PrismaLensMark } from "@/components/icons/prismalens-mark";
import { useActiveIncidents } from "@/components/inbox/use-inbox-data";
import { MARKS, markLook } from "@/components/kit/marks";
import { useAbout } from "@/components/settings/use-about";
import { Hint } from "@/components/shared/Hint";
import { ConnectionWord } from "@/components/shell/ConnectionWord";
import { SearchHost, useOpenSearch } from "@/components/shell/SearchHost";
import {
	ThreadList,
	useUnmappedAlerts,
	useWaitingCount,
} from "@/components/shell/ThreadList";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import {
	Sheet,
	SheetContent,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { useBreathePhase } from "@/hooks/use-breathe-phase";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { SIDEBAR_FULL } from "@/hooks/use-media-query";
import { useOperator } from "@/hooks/use-operator";
import { useLastDelivery } from "@/lib/api/hooks/use-webhooks-orpc";
import { useAppCommand } from "@/lib/app-commands";
import { GO_SHORTCUTS, placeOf } from "@/lib/places";
import { triggerOf } from "@/lib/trigger";
import { cn } from "@/lib/utils";

type DoorTo =
	| "/automation"
	| "/projects"
	| "/incidents"
	| "/alerts"
	| "/services"
	| "/schedules"
	| "/events"
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
	/** A count that informs rather than asks for you: neutral, not warn. */
	quietCount?: boolean;
	/** A newer release is out (#717). */
	dot?: boolean;
	/** Only where the list is folded away: the rail and the phone strip (#1020). */
	narrowOnly?: boolean;
	search?: { f?: string; tab?: string };
	/** The list where it is folded away: the rail opens it in a sheet (sheet §1, #1101). */
	sheet?: boolean;
	/** What it holds, shown on hover even at full width (the places registry's `hint`). */
	hint?: string;
}

const ICON = "size-4 shrink-0 stroke-[1.5]";

function useDoors(signedIn: boolean): Door[] {
	const about = useAbout(signedIn);
	const { incidents } = useActiveIncidents(signedIn);
	const { data: delivery } = useLastDelivery(signedIn);
	// Operations is earned: it stays once alerts have ever arrived, not only while one is open (#1020).
	const operations =
		!!delivery || incidents.some((i) => triggerOf(i).kind !== "you");
	const waiting = useWaitingCount(signedIn);
	const unmapped = useUnmappedAlerts(signedIn);
	return [
		{
			to: "/automation",
			label: "Threads",
			slug: "threads",
			icon: <MessagesSquare className={ICON} />,
			narrowOnly: true,
			sheet: true,
			...(waiting
				? { count: waiting, countLabel: `${waiting} waiting for you` }
				: {}),
		},
		placeDoor("automation"),
		placeDoor("projects"),
		...(operations ? [placeDoor("incidents")] : []),
		// Alerts with no service wait to be mapped: a labelled door with its count (#1101 nav).
		...(unmapped
			? [
					{
						to: "/alerts" as const,
						label: "Alerts",
						icon: <Bell className={ICON} />,
						count: unmapped,
						countLabel: `${unmapped.toLocaleString("en-US")} with no service`,
						search: { tab: "unmapped" },
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

/** A door drawn from the places registry: its label, icon and hint (#1020). */
function placeDoor(id: "automation" | "projects" | "incidents"): Door {
	const { to, label, icon: Icon, hint } = placeOf(id);
	return {
		to: to as DoorTo,
		label,
		slug: id,
		icon: <Icon className={ICON} />,
		...(hint ? { hint } : {}),
	};
}

const goKey = (label: string) =>
	GO_SHORTCUTS.find((s) => s.label === label)?.key;

/**
 * The prerendered shell is drawn at "/", so until the app hydrates the sidebar draws
 * "/" too; drawing the real route first failed hydration (React error #418).
 */
const SHELL_PATH = "/";

export function Sidebar() {
	// Only the path: a thread page's search (a diff file pick) must not redraw the sidebar.
	const live = useLocation({ select: (l) => l.pathname });
	const pathname = useHydrated() ? live : SHELL_PATH;
	if (pathname.startsWith("/pair") || pathname.startsWith("/_design"))
		return null;
	return <Shell pathname={pathname} />;
}

/**
 * A sidebar link: a plain anchor until the app hydrates, then a router Link. A Link
 * marks the live route active on its first render, which the "/" shell never drew.
 */
const NavLink: LinkComponent<"a"> = (props) => {
	const router = useRouter();
	if (useHydrated()) return <Link {...props} />;
	const { to, search, ...anchor } = props as LinkComponentProps<"a">;
	const { href } = router.buildLocation({ to, search } as Parameters<
		typeof router.buildLocation
	>[0]);
	return <a {...(anchor as ComponentProps<"a">)} href={href} />;
};

function Shell({ pathname }: { pathname: string }) {
	const { via } = useOperator();
	// The shell is prerendered with no session, so it hydrates signed out (React error #418).
	const signedIn = useHydrated() && via !== null;
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
	const openSearch = useOpenSearch();
	const settingsDoor = doors.find((d) => d.to === "/settings");
	// Same query as the Settings door's dot; it marks a nightly build in every screenshot (#1024).
	const nightlyBuild = useAbout(signedIn).data?.updateChannel?.nightlyBuild;
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
					{nightlyBuild && (
						<Badge
							variant="secondary"
							className={FULL_ONLY}
							data-testid="sidebar-nightly"
						>
							Nightly
						</Badge>
					)}
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
				<NavLink
					to="/new"
					aria-current={pathname === "/new" ? "page" : undefined}
					aria-label="Home"
					className={cn(
						DOOR,
						pathname === "/new" && "bg-surface-3 font-medium text-text-1",
					)}
					data-testid="nav-new"
				>
					<HomeIcon className={ICON} />
					<span className={FULL_ONLY}>Home</span>
					<span aria-hidden className={RAIL_LABEL}>
						Home
					</span>
				</NavLink>
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
					.filter((d) => d.to !== "/settings")
					.map((door) =>
						door.sheet ? (
							// The rail's door to the list; at full width the list itself shows.
							<div key={door.label} className={RAIL_ONLY}>
								<ThreadsSheet door={door} />
							</div>
						) : (
							<DoorLink
								key={door.label}
								door={door}
								on={!door.narrowOnly && isOn(pathname, door.to)}
							/>
						),
					)}
			</nav>
			<div className="mt-3.5 min-h-0 flex-1 overflow-y-auto pb-2">
				{signedIn && (
					<div className={FULL_BLOCK}>
						<AreaList />
					</div>
				)}
			</div>
			{signedIn && (
				<div className={FULL_BLOCK}>
					<UpdateReady />
				</div>
			)}
			<div className="flex shrink-0 flex-wrap items-center gap-0.5 px-2 py-2 max-xl:justify-center [[data-sidebar-folded]_&]:justify-center">
				{settingsDoor && <SettingsIcon door={settingsDoor} />}
				<UsageDoor />
				<TerminalDoor />
				<ThemeToggle />
			</div>
		</>
	);
}

/** Above the foot once a newer version is out: names it and opens About; it never interrupts (#1024). */
function UpdateReady() {
	const about = useAbout(true);
	const latest = about.data?.update.latest;
	if (!about.data?.update.available || !latest) return null;
	const can = about.data.update.install?.available;
	return (
		<Hint
			label={
				can
					? `PrismaLens ${latest} is ready. Open About to read what changed and install it.`
					: `PrismaLens ${latest} is ready. Run ${about.data.upgradeCommand} in a terminal, or open About for what changed.`
			}
			side="right"
		>
			<NavLink
				to="/settings"
				search={{ tab: "about" }}
				className="mx-2 flex h-8 items-center gap-2 rounded-control px-2 text-body text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1"
				data-testid="sidebar-update-ready"
			>
				<ArrowUpCircle className={ICON} aria-hidden />
				<span>Update to {latest}</span>
			</NavLink>
		</Hint>
	);
}

/** At the foot beside Settings: opens Usage (#1101 cat 17). */
function UsageDoor() {
	return (
		<Hint label="Usage" side="right">
			<NavLink
				to="/settings"
				search={{ tab: "usage" }}
				aria-label="Usage"
				className="flex size-8 items-center justify-center rounded-control text-text-3 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1"
				data-testid="nav-usage"
			>
				<Gauge className={ICON} aria-hidden />
			</NavLink>
		</Hint>
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

/** `[` (the app.foldSidebar key, run by the shortcut runner) hides the bar or brings it back. */
function useFoldKey(toggle: () => void, enabled: boolean) {
	useAppCommand("foldSidebar", toggle, enabled);
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
// Full width (from 1280, not folded) and the rail are CSS, so the prerendered sidebar is
// already right and hydration changes nothing (#1101 category 12).
const RAIL_ONLY = "contents xl:hidden [[data-sidebar-folded]_&]:contents";
const FULL_BLOCK = "hidden xl:block [[data-sidebar-folded]_&]:hidden";
/** At full width the door's label shows, so its hint stays shut. */
const sidebarFull = () =>
	window.matchMedia(SIDEBAR_FULL).matches &&
	!document.documentElement.hasAttribute("data-sidebar-folded");

/** The rail's label under each icon; at full width the inline label shows instead. */
const RAIL_LABEL =
	"hidden max-w-full truncate text-[10px] leading-none max-xl:block [[data-sidebar-folded]_&]:block";

/** The rail's Threads: the list in a sheet, since there is no Threads page (sheet §1). */
function ThreadsSheet({ door }: { door: Door }) {
	const [open, setOpen] = useState(false);
	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<Hint label={door.countLabel ?? door.label} side="right">
				<SheetTrigger asChild>
					<button
						type="button"
						aria-label={
							door.countLabel ? `${door.label} ${door.countLabel}` : door.label
						}
						data-testid="nav-threads"
						className={DOOR}
					>
						{/* The word comes first in the DOM, so the text reads "Threads 3" as the name does; order-last draws it under the icon. */}
						<span aria-hidden className={cn(RAIL_LABEL, "order-last")}>
							{door.label}
						</span>
						<span className="relative">
							{door.icon}
							{door.count !== undefined && (
								<span
									aria-hidden
									className="absolute -top-2 -right-2.5 min-w-4 rounded-full bg-warn px-1 text-center text-[10px] leading-4 font-semibold text-canvas tabular-nums"
								>
									{door.count}
								</span>
							)}
						</span>
					</button>
				</SheetTrigger>
			</Hint>
			<SheetContent
				side="left"
				className="flex w-[300px] flex-col gap-0 bg-surface-1 p-0"
				onClickCapture={(e) => {
					if ((e.target as HTMLElement).closest("a")) setOpen(false);
				}}
				data-testid="threads-sheet"
			>
				<SheetTitle className="flex h-(--header-h) shrink-0 items-center px-4 text-body font-semibold">
					Threads
				</SheetTitle>
				<div className="min-h-0 flex-1 overflow-y-auto pb-2">
					<ThreadList />
				</div>
			</SheetContent>
		</Sheet>
	);
}

function DoorLink({ door, on }: { door: Door; on: boolean }) {
	const key = goKey(door.label);
	return (
		<Hint
			label={door.hint ? `${door.label}: ${door.hint}` : door.label}
			keys={key ? ["G", key.toUpperCase()] : undefined}
			side="right"
			{...(door.hint ? {} : { skip: sidebarFull })}
		>
			<NavLink
				to={door.to}
				search={door.search}
				aria-current={on ? "page" : undefined}
				aria-label={
					door.countLabel ? `${door.label} ${door.countLabel}` : door.label
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
							"ml-auto text-meta font-normal tabular-nums",
							door.quietCount ? "text-text-3" : "text-warn",
							FULL_ONLY,
						)}
						data-testid={`nav-${door.slug ?? door.label.toLowerCase()}-count`}
					>
						{door.count}
					</span>
				)}
			</NavLink>
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
			<NavLink
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
			</NavLink>
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
	const waiting = doors.find((d) => d.sheet && d.count !== undefined);
	const waitingLook = markLook("ask", "approval");
	const WaitingIcon = waitingLook.icon;
	useKeyboardInset();
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
						<NavLink
							to="/new"
							className={cn(MENU_ROW, pathname === "/new" && MENU_ON)}
							data-testid="menu-new"
						>
							<HomeIcon className={ICON} aria-hidden />
							Home
						</NavLink>
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
								<NavLink
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
								</NavLink>
							))}
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto pb-2">
						{signedIn && <ThreadList />}
					</div>
				</SheetContent>
			</Sheet>
			{signedIn ? <ConnectionWord /> : <span className="flex-1" />}
			{waiting && (
				<Hint label={`${waiting.count} ${MARKS.ask.label.toLowerCase()}`}>
					<button
						type="button"
						onClick={() => setOpen(true)}
						aria-label={`${waiting.count} ${MARKS.ask.label.toLowerCase()}`}
						className="flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control px-2 text-meta font-medium text-text-1 tabular-nums hover:bg-surface-2"
						data-testid="strip-waiting"
					>
						<WaitingIcon
							aria-hidden
							className={cn("size-3.5", waitingLook.className)}
						/>
						{waiting.count}
					</button>
				</Hint>
			)}
			<NavLink
				to="/new"
				aria-label="New"
				data-testid="strip-new"
				className="flex size-12 items-center justify-center rounded-control text-text-2 hover:bg-surface-2 hover:text-text-1"
			>
				<SquarePen className={ICON} />
			</NavLink>
		</nav>
	);
}

const MENU_ROW =
	"flex h-11 min-w-0 items-center gap-3 rounded-control px-3 text-body text-text-2 hover:bg-surface-3 hover:text-text-1";
const MENU_ON = "bg-surface-3 font-medium text-text-1";
