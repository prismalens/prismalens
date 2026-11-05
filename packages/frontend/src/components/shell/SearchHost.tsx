// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useNavigate } from "@tanstack/react-router";
import {
	ChevronsDown,
	FileText,
	FolderGit2,
	FolderPlus,
	MessageSquare,
	Moon,
	Server,
	SquarePen,
	SquareTerminal,
	Sun,
} from "lucide-react";
import {
	createContext,
	type ReactNode,
	useContext,
	useDeferredValue,
	useEffect,
	useState,
} from "react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	DIALOG_WIDTH,
	Dialog,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { PHONE, useMediaQuery } from "@/hooks/use-media-query";
import { useRepositories, useServices } from "@/lib/api/hooks";
import { useThreadFeed } from "@/lib/api/hooks/use-threads-orpc";
import { PLACES } from "@/lib/places";
import { useTheme } from "@/lib/providers/theme-provider";
import { rowContext, threadLink } from "@/lib/thread-rows";
import { cn } from "@/lib/utils";

const OpenSearch = createContext<() => void>(() => {});

/** Opens the Search palette from anywhere inside `SearchHost`. */
export const useOpenSearch = () => useContext(OpenSearch);

/**
 * Holds Search and its shortcuts (Ctrl K, Ctrl Shift O for New thread) for the
 * whole shell, so they work with the sidebar hidden, on Settings and on a phone.
 */
export function SearchHost({
	enabled,
	children,
}: {
	enabled: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const navigate = useNavigate();
	useEffect(() => {
		if (!enabled) return;
		const onKey = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey;
			if (mod && !e.shiftKey && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setOpen(true);
			} else if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
				e.preventDefault();
				void navigate({ to: "/new" });
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [navigate, enabled]);
	return (
		<OpenSearch.Provider value={() => setOpen(true)}>
			{children}
			{enabled && <ThreadSearch open={open} onOpenChange={setOpen} />}
		</OpenSearch.Provider>
	);
}

const RECENT = 5;
const TERMINAL_KEYS = ["Ctrl", "`"];

/**
 * The Ctrl K palette (#1020): at rest, actions, recent threads and places; typing
 * searches threads on the server and matches projects, places and actions by name.
 */
export function ThreadSearch({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const navigate = useNavigate();
	const { bottomPanel, setBottomPanel } = useLayoutPrefs();
	const { theme, setTheme } = useTheme();
	const services = useServices({ limit: 100 });
	// A phone has no bottom panel (#931), so Terminal is not an action there.
	const phone = useMediaQuery(PHONE);
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	// The server finds the project: the first 100 would miss one past them.
	const typed = useDeferredValue(query.trim());
	const repos = useRepositories({
		...(typed ? { search: typed } : {}),
		limit: 100,
		enabled: open && !!q,
	});
	const feed = useThreadFeed(
		{ ...(q ? { search: query.trim() } : {}), limit: 20 },
		open,
	);
	const found =
		feed.data?.pages.flatMap((p) => p.units.flatMap((u) => u.threads)) ?? [];
	const threads = q ? found : found.slice(0, RECENT);
	const named = (label: string) => !q || label.toLowerCase().includes(q);
	const actions: {
		id: string;
		label: string;
		icon: typeof SquarePen;
		keys?: string[];
		run: () => void;
	}[] = [
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
	].filter((a) => named(a.label));
	const places = PLACES.filter((p) => named(p.label));
	const serviceHits = q
		? (services.data?.data ?? []).filter((sv) =>
				named(`${sv.displayName ?? ""} ${sv.name}`),
			)
		: [];
	const projects = q
		? (repos.data?.data ?? []).filter((r) => named(r.fullName))
		: [];
	const go = (fn: () => void) => {
		onOpenChange(false);
		fn();
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className={cn(DIALOG_WIDTH.lg, "gap-0 p-0")}
				data-testid="thread-search"
			>
				<DialogTitle className="sr-only">Search</DialogTitle>
				<Command shouldFilter={false} label="Search">
					<CommandInput
						value={query}
						onValueChange={setQuery}
						placeholder="Search threads, services, projects, places"
						data-testid="thread-search-input"
					/>
					<CommandList className="max-h-[min(60vh,420px)]">
						<CommandEmpty>Nothing found</CommandEmpty>
						{actions.length > 0 && (
							<CommandGroup heading="Actions">
								{actions.map((a) => (
									<CommandItem
										key={a.id}
										value={`action-${a.id}`}
										onSelect={() => go(a.run)}
										data-testid={`thread-search-action-${a.id}`}
									>
										<a.icon aria-hidden />
										<span className="min-w-0 flex-1 truncate">{a.label}</span>
										{a.keys && <Keys keys={a.keys} />}
									</CommandItem>
								))}
							</CommandGroup>
						)}
						{threads.length > 0 && (
							<CommandGroup heading={q ? "Threads" : "Recent threads"}>
								{threads.map((t) => {
									const Icon =
										t.kind === "investigation" ? FileText : MessageSquare;
									return (
										<CommandItem
											key={t.id}
											value={t.id}
											onSelect={() => go(() => void navigate(threadLink(t)))}
											data-testid="thread-search-result"
										>
											<Icon aria-hidden />
											<span dir="auto" className="min-w-0 flex-1 truncate">
												{t.title?.trim() || "Thread"}
											</span>
											<span className="max-w-[40%] shrink-0 truncate text-meta text-text-3">
												{rowContext(t) ?? ""}
											</span>
										</CommandItem>
									);
								})}
								{q && feed.hasNextPage && (
									<CommandItem
										value="more-results"
										disabled={feed.isFetching || feed.isPlaceholderData}
										onSelect={() => void feed.fetchNextPage()}
										className="text-text-3"
										data-testid="thread-search-more"
									>
										<ChevronsDown aria-hidden />
										More results
									</CommandItem>
								)}
							</CommandGroup>
						)}
						{projects.length > 0 && (
							<CommandGroup heading="Projects">
								{projects.map((r) => (
									<CommandItem
										key={r.id}
										value={`project-${r.id}`}
										onSelect={() =>
											go(
												() =>
													void navigate({
														to: "/projects/$id",
														params: { id: r.id },
													}),
											)
										}
										data-testid="thread-search-project"
									>
										<FolderGit2 aria-hidden />
										<span className="min-w-0 flex-1 truncate">
											{r.fullName}
										</span>
									</CommandItem>
								))}
							</CommandGroup>
						)}
						{serviceHits.length > 0 && (
							<CommandGroup heading="Services">
								{serviceHits.map((sv) => (
									<CommandItem
										key={sv.id}
										value={`service-${sv.id}`}
										onSelect={() =>
											go(
												() =>
													void navigate({
														to: "/services/$id",
														params: { id: sv.id },
													}),
											)
										}
										data-testid="thread-search-service"
									>
										<Server aria-hidden />
										<span className="min-w-0 flex-1 truncate">
											{sv.displayName || sv.name}
										</span>
									</CommandItem>
								))}
							</CommandGroup>
						)}
						{places.length > 0 && (
							<CommandGroup heading="Go to">
								{places.map((p) => (
									<CommandItem
										key={p.id}
										value={`place-${p.id}`}
										onSelect={() => go(() => void navigate({ to: p.to }))}
										data-testid="thread-search-place"
									>
										<p.icon aria-hidden />
										<span className="min-w-0 flex-1 truncate">{p.label}</span>
										{p.goKey && <Keys keys={["G", p.goKey.toUpperCase()]} />}
									</CommandItem>
								))}
							</CommandGroup>
						)}
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}

function Keys({ keys }: { keys: string[] }) {
	return (
		<span className="flex shrink-0 gap-0.5" aria-hidden>
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
