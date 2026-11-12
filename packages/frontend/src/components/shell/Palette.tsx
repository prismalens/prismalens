// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadRow } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	Bell,
	CalendarClock,
	FileText,
	FolderGit2,
	FolderPlus,
	type LucideIcon,
	MessageSquare,
	MessageSquareText,
	Moon,
	Server,
	Siren,
	SquarePen,
	SquareTerminal,
	Sun,
} from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	useDeferredValue,
	useState,
} from "react";
import { Tabs } from "@/components/kit";
import { allEvents, transcriptText } from "@/components/shell/ThreadMenu";
import { StatusMark, wordTone } from "@/components/shell/ThreadTree";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { PHONE, useMediaQuery } from "@/hooks/use-media-query";
import { useNow } from "@/hooks/use-now";
import { toast } from "@/hooks/use-toast";
import { useRepositories, useServices } from "@/lib/api/hooks";
import {
	useSettleThread,
	useThreadFeed,
} from "@/lib/api/hooks/use-threads-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { PLACES } from "@/lib/places";
import { useTheme } from "@/lib/providers/theme-provider";
import { rowContext, rowLine, threadLink } from "@/lib/thread-rows";
import {
	needsYouNow,
	STATUS_TONE,
	STATUS_WORD,
	statusOf,
	statusReason,
	TONE_TEXT,
} from "@/lib/thread-status";
import { readableTitle } from "@/lib/title";
import { cn } from "@/lib/utils";

export const PALETTE_TABS = [
	{ id: "all", label: "All" },
	{ id: "threads", label: "Threads" },
	{ id: "messages", label: "Messages" },
	{ id: "incidents", label: "Incidents" },
	{ id: "alerts", label: "Alerts" },
	{ id: "projects", label: "Projects" },
	{ id: "schedules", label: "Schedules" },
	{ id: "actions", label: "Actions" },
] as const;
export type PaletteTab = (typeof PALETTE_TABS)[number]["id"];

interface Item {
	key: string;
	tab: Exclude<PaletteTab, "all">;
	label: string;
	sub?: string | null;
	icon: LucideIcon;
	keys?: string[];
	run: () => void;
	thread?: ThreadRow;
	testId: string;
}

const RECENT = 8;
const TERMINAL_KEYS = ["Ctrl", "`"];

/** The thread link with find set on a message hit (#1101 category 19 item 4). */
function findLink(threadId: string, q: string, key: string) {
	return {
		to: "/threads/$id" as const,
		params: { id: threadId },
		search: { find: q, at: key },
	};
}

/**
 * The Ctrl K palette (#1101 category 19): one overlay with type tabs, recents when
 * empty, a preview of the hovered result, row actions on Alt+Enter, and a footer of keys.
 * Threads that need you list first; message text is searched across threads.
 */
export function Palette({ onDone }: { onDone: () => void }) {
	const navigate = useNavigate();
	const { bottomPanel, setBottomPanel } = useLayoutPrefs();
	const { theme, setTheme } = useTheme();
	const phone = useMediaQuery(PHONE);
	const now = useNow(30_000) ?? 0;
	const [query, setQuery] = useState("");
	const [tab, setTab] = useState<PaletteTab>("all");
	const [active, setActive] = useState("");
	const [actionsFor, setActionsFor] = useState<ThreadRow | null>(null);
	const q = query.trim().toLowerCase();
	const typed = useDeferredValue(query.trim());
	const on = (t: Exclude<PaletteTab, "all">) => tab === "all" || tab === t;
	const feed = useThreadFeed(
		{ ...(typed ? { search: typed } : {}), limit: 30 },
		on("threads"),
	);
	const messages = useQuery({
		...orpc.threads.searchMessages.queryOptions({
			input: { q: typed, limit: 20 },
		}),
		enabled: on("messages") && typed.length >= 2,
	});
	const incidents = useQuery({
		...orpc.incidents.list.queryOptions({
			input: { ...(typed ? { search: typed } : {}), limit: 8 },
		}),
		enabled: on("incidents") && (!!typed || tab === "incidents"),
	});
	const alerts = useQuery({
		...orpc.alerts.list.queryOptions({ input: { limit: 50 } }),
		enabled: on("alerts") && (!!typed || tab === "alerts"),
	});
	const schedules = useQuery({
		...orpc.schedules.list.queryOptions({ input: {} }),
		enabled: on("schedules") && (!!typed || tab === "schedules"),
	});
	const repos = useRepositories({
		...(typed ? { search: typed } : {}),
		limit: 100,
		enabled: on("projects") && (!!typed || tab === "projects"),
	});
	const services = useServices({ limit: 100 });
	const settle = useSettleThread();
	const named = (label: string) => !q || label.toLowerCase().includes(q);

	const units = feed.data?.pages.flatMap((p) => p.units) ?? [];
	// An alert's thread carries no title of its own: its incident names it, as in the list.
	const incidentTitle = new Map(
		units.flatMap((u) =>
			u.incident
				? u.threads.map((t) => [t.id, u.incident?.title] as const)
				: [],
		),
	);
	const threads = units
		.flatMap((u) => u.threads)
		.filter((t) => !t.archivedAt)
		.sort(
			(a, b) =>
				Number(needsYouNow(b)) - Number(needsYouNow(a)) ||
				Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt),
		)
		.slice(0, q || tab === "threads" ? 30 : RECENT);
	const items: Item[] = [
		...threads.map(
			(t): Item => ({
				key: `thread-${t.id}`,
				tab: "threads",
				label:
					t.title?.trim() ||
					readableTitle(incidentTitle.get(t.id) ?? "") ||
					"Thread",
				sub: rowContext(t),
				icon: t.kind === "investigation" ? FileText : MessageSquare,
				thread: t,
				run: () => void navigate(threadLink(t)),
				testId: "thread-search-result",
			}),
		),
		...(messages.data?.hits ?? []).map(
			(h): Item => ({
				key: `message-${h.threadId}-${h.key}`,
				tab: "messages",
				label: h.snippet,
				sub: `${h.title ?? "Thread"}${h.count > 1 ? `, ${h.count} hits` : ""}`,
				icon: MessageSquareText,
				run: () => void navigate(findLink(h.threadId, typed, h.key) as never),
				testId: "thread-search-message",
			}),
		),
		...(q || tab === "incidents" ? (incidents.data?.data ?? []) : []).map(
			(i): Item => ({
				key: `incident-${i.id}`,
				tab: "incidents",
				label: i.title,
				sub: `INC-${i.number}, ${i.severity}, ${i.status}`,
				icon: Siren,
				run: () =>
					void navigate({ to: "/incidents/$id", params: { id: i.id } }),
				testId: "thread-search-incident",
			}),
		),
		...(q || tab === "alerts" ? (alerts.data?.data ?? []) : [])
			.filter((a) => named(`${a.title} ${a.fingerprint ?? ""}`))
			.slice(0, 8)
			.map(
				(a): Item => ({
					key: `alert-${a.id}`,
					tab: "alerts",
					label: a.title,
					sub: `${a.status}${a.fingerprint ? `, ${a.fingerprint.slice(0, 12)}` : ""}`,
					icon: Bell,
					run: () =>
						void navigate({ to: "/alerts/$id", params: { id: a.id } } as never),
					testId: "thread-search-alert",
				}),
			),
		// At rest a cached project list would crowd out recents; projects show once typed.
		...(q || tab === "projects" ? (repos.data?.data ?? []) : [])
			.filter((r) => named(r.fullName))
			.slice(0, 8)
			.map(
				(r): Item => ({
					key: `project-${r.id}`,
					tab: "projects",
					label: r.fullName,
					icon: FolderGit2,
					run: () =>
						void navigate({ to: "/projects/$id", params: { id: r.id } }),
					testId: "thread-search-project",
				}),
			),
		...(q
			? (services.data?.data ?? [])
					.filter((sv) => named(`${sv.displayName ?? ""} ${sv.name}`))
					.slice(0, 6)
					.map(
						(sv): Item => ({
							key: `service-${sv.id}`,
							tab: "projects",
							label: sv.displayName || sv.name,
							sub: "Service",
							icon: Server,
							run: () =>
								void navigate({ to: "/services/$id", params: { id: sv.id } }),
							testId: "thread-search-service",
						}),
					)
			: []),
		...(q || tab === "schedules" ? (schedules.data?.schedules ?? []) : [])
			.filter((s) => named(s.name))
			.slice(0, 8)
			.map(
				(s): Item => ({
					key: `schedule-${s.id}`,
					tab: "schedules",
					label: s.name,
					icon: CalendarClock,
					run: () =>
						void navigate({
							to: "/schedules/$id",
							params: { id: s.id },
						} as never),
					testId: "thread-search-schedule",
				}),
			),
		...[
			{
				id: "new-thread",
				label: "New thread",
				icon: SquarePen,
				keys: ["Ctrl", "Shift", "O"],
				run: () => void navigate({ to: "/new" }),
			},
			{
				id: "add-project",
				label: "Add project",
				icon: FolderPlus,
				run: () => void navigate({ to: "/projects", search: { add: true } }),
			},
			...(phone
				? []
				: [
						{
							id: "terminal",
							label: bottomPanel ? "Hide the terminal" : "Show the terminal",
							icon: SquareTerminal,
							keys: TERMINAL_KEYS,
							run: () => setBottomPanel(!bottomPanel),
						},
					]),
			{
				id: "theme",
				label: theme === "dark" ? "Use the light theme" : "Use the dark theme",
				icon: theme === "dark" ? Sun : Moon,
				run: () => setTheme(theme === "dark" ? "light" : "dark"),
			},
			...PLACES.map((p) => ({
				id: `place-${p.id}`,
				label: `Go to ${p.label}`,
				icon: p.icon,
				keys: p.goKey ? ["G", p.goKey.toUpperCase()] : undefined,
				run: () => void navigate({ to: p.to }),
			})),
		]
			.filter((a) => named(a.label))
			.map(
				(a): Item => ({
					key: `action-${a.id}`,
					tab: "actions",
					label: a.label,
					icon: a.icon,
					...(a.keys ? { keys: a.keys } : {}),
					run: a.run,
					testId: a.id.startsWith("place-")
						? "thread-search-place"
						: `thread-search-action-${a.id}`,
				}),
			),
	].filter((i) => on(i.tab));
	const current = items.find((i) => i.key === active) ?? items[0];
	const go = (fn: () => void) => {
		onDone();
		fn();
	};
	const rowActions = (t: ThreadRow) => [
		{
			id: "open",
			label: "Open",
			run: () => go(() => void navigate(threadLink(t))),
		},
		...(t.incidentId || t.scheduleId
			? []
			: [
					{
						id: "panel",
						label: "Open with its panel",
						run: () =>
							go(
								() =>
									void navigate({
										to: "/threads/$id",
										params: { id: t.id },
										search: { panel: "thread" },
									}),
							),
					},
				]),
		{
			id: "settle",
			label: "Settle",
			run: () =>
				go(() =>
					settle.mutate(
						{ id: t.id, settled: true },
						{
							onSuccess: () =>
								toast({ title: `Settled ${t.title?.trim() || "thread"}` }),
						},
					),
				),
		},
		{
			id: "transcript",
			label: "Copy transcript",
			run: () =>
				go(() => {
					void allEvents(t.id)
						.then(transcriptText)
						.then((text) => navigator.clipboard.writeText(text))
						.then(
							() => toast({ title: "Transcript copied" }),
							(e: unknown) =>
								toast({
									title: "Transcript not copied",
									description: getErrorMessage(e),
									variant: "destructive",
								}),
						);
				}),
		},
		{
			id: "link",
			label: "Copy link",
			run: () =>
				go(() => {
					const l = threadLink(t);
					const path =
						l.to === "/threads/$id"
							? `/threads/${l.params.id}`
							: l.to === "/schedules/$id/runs/$runId"
								? `/schedules/${l.params.id}/runs/${l.params.runId}`
								: `/incidents/${l.params.id}/conversation?investigation=${l.search.investigation}`;
					void navigator.clipboard.writeText(
						`${window.location.origin}${path}`,
					);
					toast({ title: "Link copied" });
				}),
		},
	];
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Tab") {
			e.preventDefault();
			const at = PALETTE_TABS.findIndex((t) => t.id === tab);
			const next =
				PALETTE_TABS[
					(at + (e.shiftKey ? -1 : 1) + PALETTE_TABS.length) %
						PALETTE_TABS.length
				];
			if (next) setTab(next.id);
			setActionsFor(null);
		} else if (e.key === "Enter" && e.altKey && current?.thread) {
			e.preventDefault();
			setActionsFor(current.thread);
		} else if (e.key === "Escape" && actionsFor) {
			e.preventDefault();
			e.stopPropagation();
			setActionsFor(null);
		}
	};
	const groups = (
		[
			"threads",
			"messages",
			"incidents",
			"alerts",
			"projects",
			"schedules",
			"actions",
		] as const
	)
		.map((g) => ({ g, rows: items.filter((i) => i.tab === g) }))
		.filter((x) => x.rows.length);
	const heading = (g: string) =>
		g === "threads"
			? q
				? "Threads"
				: "Recent threads"
			: (PALETTE_TABS.find((t) => t.id === g)?.label ?? g);
	return (
		<Command
			shouldFilter={false}
			label="Search"
			value={active}
			onValueChange={setActive}
			onKeyDown={onKey}
		>
			<CommandInput
				value={query}
				onValueChange={(v) => {
					setQuery(v);
					setActionsFor(null);
				}}
				placeholder={
					actionsFor
						? `Actions for ${actionsFor.title ?? "thread"}`
						: "Search threads, messages, incidents, alerts"
				}
				data-testid="thread-search-input"
			/>
			<div className="px-3" data-scroll-x data-testid="palette-tabs">
				<Tabs
					label="Result types"
					value={tab}
					onValueChange={(v) => {
						setTab(v as PaletteTab);
						setActionsFor(null);
					}}
					items={PALETTE_TABS.map((t) => ({
						value: t.id,
						label: t.label,
						testId: `palette-tab-${t.id}`,
					}))}
				/>
			</div>
			<div className="flex min-h-0">
				<CommandList className="max-h-[min(60vh,420px)] min-w-0 flex-1">
					<CommandEmpty>
						{typed.length === 1 && tab === "messages"
							? "Type two letters"
							: "Nothing found"}
					</CommandEmpty>
					{actionsFor ? (
						<CommandGroup heading={actionsFor.title?.trim() || "Thread"}>
							{rowActions(actionsFor).map((a) => (
								<CommandItem
									key={a.id}
									value={`row-action-${a.id}`}
									onSelect={a.run}
									data-testid={`palette-row-action-${a.id}`}
								>
									{a.label}
								</CommandItem>
							))}
						</CommandGroup>
					) : (
						groups.map(({ g, rows }) => (
							<CommandGroup key={g} heading={heading(g)}>
								{rows.map((i) => (
									<CommandItem
										key={i.key}
										value={i.key}
										onSelect={() => go(i.run)}
										data-testid={i.testId}
									>
										{i.thread ? (
											<StatusMark status={statusOf(i.thread).status} />
										) : (
											<i.icon aria-hidden />
										)}
										<span dir="auto" className="min-w-0 flex-1 truncate">
											{i.label}
										</span>
										{i.sub && (
											<span className="max-w-[40%] shrink-0 truncate text-right text-meta text-text-3">
												{i.sub}
											</span>
										)}
										{i.keys && <Keys keys={i.keys} />}
									</CommandItem>
								))}
							</CommandGroup>
						))
					)}
					{searchedNote(messages.data, tab)}
				</CommandList>
				{!phone && current && !actionsFor && (
					<aside
						className="relative hidden w-60 shrink-0 p-3 before:absolute before:inset-y-2 before:left-0 before:w-px before:bg-hairline min-[900px]:block"
						aria-label="Preview"
						data-testid="palette-preview"
					>
						<Preview item={current} now={now} />
					</aside>
				)}
			</div>
			<footer
				className="relative flex items-center gap-x-3 overflow-hidden px-3 py-2 text-meta whitespace-nowrap text-text-3 after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-hairline"
				data-testid="palette-keys"
			>
				<span>
					<Keys keys={["↑", "↓"]} /> Move
				</span>
				<span>
					<Keys keys={["Enter"]} /> Open
				</span>
				<span>
					<Keys keys={["Alt", "Enter"]} /> Actions
				</span>
				<span>
					<Keys keys={["Tab"]} /> Type
				</span>
				<span>
					<Keys keys={["Esc"]} /> {actionsFor ? "Back" : "Close"}
				</span>
			</footer>
		</Command>
	);
}

function searchedNote(
	data: { searched: number; total: number } | undefined,
	tab: PaletteTab,
): ReactNode {
	if (
		!data ||
		(tab !== "all" && tab !== "messages") ||
		data.searched >= data.total
	)
		return null;
	return (
		<p
			className="px-3 py-1.5 text-meta text-text-3"
			data-testid="palette-searched"
		>
			Searched {data.searched} of {data.total} threads
		</p>
	);
}

/** The hovered result (#1101 category 19 item 2): status, last line, PR and limit. */
function Preview({ item, now }: { item: Item; now: number }) {
	const t = item.thread;
	if (!t)
		return (
			<div className="flex flex-col gap-1 text-body">
				<p className="font-medium text-text-1">{item.label}</p>
				{item.sub && <p className="text-meta text-text-3">{item.sub}</p>}
			</div>
		);
	const info = statusOf(t);
	const reason = statusReason(t, info, now);
	return (
		<div
			className="flex flex-col gap-1.5 text-body"
			data-testid="palette-preview-thread"
		>
			<p className="line-clamp-2 font-medium text-text-1">{item.label}</p>
			<p className="flex items-center gap-1.5 text-meta">
				<StatusMark status={info.status} />
				<span className={cn("font-medium", wordTone(info.status))}>
					{STATUS_WORD[info.status]}
				</span>
			</p>
			{reason && <p className="text-meta text-text-2">{reason}</p>}
			{/* A failed or blocked thread's last line is its raw error; the reason above words it. */}
			{info.status !== "failed" && info.status !== "blocked" && (
				<p dir="auto" className="line-clamp-4 text-meta text-text-2">
					{rowLine(t) ?? t.latestText ?? "No reply yet"}
				</p>
			)}
			{t.pr && (
				<p className="text-meta text-text-2">
					PR #{t.pr.number}, {t.pr.tone}
				</p>
			)}
			{t.limit && statusReason(t, { status: "limited" }, now) !== reason && (
				<p className="text-meta text-text-2">
					{statusReason(t, { status: "limited" }, now)}
				</p>
			)}
		</div>
	);
}

function Keys({ keys }: { keys: string[] }) {
	return (
		<span className="inline-flex shrink-0 gap-0.5" aria-hidden>
			{keys.map((k) => (
				<kbd
					key={k}
					className="min-w-5 rounded-[4px] bg-surface-3 px-1 text-center font-sans text-meta text-text-3"
				>
					{k}
				</kbd>
			))}
		</span>
	);
}
