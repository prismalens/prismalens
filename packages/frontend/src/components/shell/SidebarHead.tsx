// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadSection } from "@prismalens/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { FolderPlus, Search, SquarePen } from "lucide-react";
import { useEffect, useState } from "react";
import { Hint } from "@/components/shared/Hint";
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
import { useRepositories } from "@/lib/api/hooks";
import { useThreadFeed } from "@/lib/api/hooks/use-threads-orpc";
import { rowContext, threadLink } from "@/lib/thread-rows";
import { cn } from "@/lib/utils";

const ICON = "size-4 shrink-0 stroke-[1.5]";
const BUTTON =
	"flex size-8 shrink-0 items-center justify-center rounded-control text-text-3 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1";

/**
 * The sidebar's head (#1020): Search (Ctrl K) over threads with filters, Add
 * project, and New thread (Ctrl Shift O).
 */
export function SidebarHead() {
	const [open, setOpen] = useState(false);
	const navigate = useNavigate();
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey;
			if (mod && !e.shiftKey && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setOpen(true);
			} else if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
				e.preventDefault();
				void navigate({ to: "/threads/new" });
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [navigate]);
	return (
		<div
			className="flex items-center gap-0.5 px-2 pb-1"
			data-testid="sidebar-head"
		>
			<Hint label="Search" keys={["Ctrl", "K"]} side="bottom">
				<button
					type="button"
					onClick={() => setOpen(true)}
					className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control px-2.5 text-body text-text-3 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1"
					data-testid="sidebar-search"
				>
					<Search className={ICON} />
					<span>Search</span>
				</button>
			</Hint>
			<Hint label="Add project" side="bottom">
				<Link
					to="/projects"
					aria-label="Add project"
					className={BUTTON}
					data-testid="sidebar-add-project"
				>
					<FolderPlus className={ICON} />
				</Link>
			</Hint>
			<Hint label="New thread" keys={["Ctrl", "Shift", "O"]} side="bottom">
				<Link
					to="/threads/new"
					aria-label="New thread"
					className={BUTTON}
					data-testid="sidebar-new-thread"
				>
					<SquarePen className={ICON} />
				</Link>
			</Hint>
			<ThreadSearch open={open} onOpenChange={setOpen} />
		</div>
	);
}

type Kind = "chat" | "investigation" | undefined;
type Since = "1d" | "7d" | "30d" | undefined;
const SINCE_MS: Record<Exclude<Since, undefined>, number> = {
	"1d": 86_400_000,
	"7d": 7 * 86_400_000,
	"30d": 30 * 86_400_000,
};

const PLACES = [
	{ to: "/incidents", label: "Incidents" },
	{ to: "/alerts", label: "Alerts" },
	{ to: "/services", label: "Services" },
	{ to: "/projects", label: "Projects" },
	{ to: "/settings", label: "Settings" },
] as const;

/** The Ctrl K palette: the server searches threads; places match by name. */
export function ThreadSearch({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [kind, setKind] = useState<Kind>();
	const [section, setSection] = useState<ThreadSection>();
	const [repositoryId, setRepositoryId] = useState<string>();
	const [since, setSince] = useState<Since>();
	const [sinceAt, setSinceAt] = useState<string>();
	useEffect(() => {
		setSinceAt(
			since ? new Date(Date.now() - SINCE_MS[since]).toISOString() : undefined,
		);
	}, [since]);
	const repos = useRepositories({ limit: 100, enabled: open });
	const feed = useThreadFeed(
		{
			...(query.trim() ? { search: query.trim() } : {}),
			...(kind ? { kind } : {}),
			...(section ? { section } : {}),
			...(repositoryId ? { repositoryId } : {}),
			...(sinceAt ? { since: new Date(sinceAt) } : {}),
			limit: 20,
		},
		open,
	);
	const threads =
		feed.data?.pages.flatMap((p) => p.units.flatMap((u) => u.threads)) ?? [];
	const q = query.trim().toLowerCase();
	const places = PLACES.filter((p) => !q || p.label.toLowerCase().includes(q));
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
						placeholder="Search threads"
						data-testid="thread-search-input"
					/>
					<div
						className="flex flex-wrap gap-1 px-3 py-2"
						data-testid="thread-search-filters"
					>
						<Filter
							label="Kind"
							value={kind}
							onChange={(v) => setKind(v as Kind)}
							options={[
								["chat", "Chats"],
								["investigation", "Investigations"],
							]}
						/>
						<Filter
							label="State"
							value={section}
							onChange={(v) => setSection(v as ThreadSection | undefined)}
							options={[
								["needs", "Needs you"],
								["active", "Active"],
								["settled", "Settled"],
							]}
						/>
						<Filter
							label="Project"
							value={repositoryId}
							onChange={setRepositoryId}
							options={(repos.data?.data ?? []).map((r) => [r.id, r.fullName])}
						/>
						<Filter
							label="Time"
							value={since}
							onChange={(v) => setSince(v as Since)}
							options={[
								["1d", "Past day"],
								["7d", "Past week"],
								["30d", "Past month"],
							]}
						/>
					</div>
					<CommandList className="max-h-80">
						<CommandEmpty>Nothing found</CommandEmpty>
						{threads.length > 0 && (
							<CommandGroup heading="Threads">
								{threads.map((t) => (
									<CommandItem
										key={t.id}
										value={t.id}
										onSelect={() => go(() => void navigate(threadLink(t)))}
										data-testid="thread-search-result"
									>
										<span dir="auto" className="min-w-0 flex-1 truncate">
											{t.title?.trim() || "Thread"}
										</span>
										<span className="shrink-0 truncate text-meta text-text-3">
											{rowContext(t) ?? ""}
										</span>
									</CommandItem>
								))}
							</CommandGroup>
						)}
						{places.length > 0 && (
							<CommandGroup heading="Go to">
								{places.map((p) => (
									<CommandItem
										key={p.to}
										value={p.to}
										onSelect={() => go(() => void navigate({ to: p.to }))}
										data-testid="thread-search-place"
									>
										{p.label}
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

function Filter({
	label,
	value,
	onChange,
	options,
}: {
	label: string;
	value: string | undefined;
	onChange: (v: string | undefined) => void;
	options: Array<[string, string]>;
}) {
	return (
		<label className="inline-flex h-7 items-center gap-1 rounded-control bg-surface-2 pl-2 text-meta text-text-2">
			<span>{label}</span>
			<select
				value={value ?? ""}
				onChange={(e) => onChange(e.target.value || undefined)}
				className="h-7 rounded-control bg-transparent pr-1 text-text-1 outline-none"
				data-testid={`thread-filter-${label.toLowerCase()}`}
			>
				<option value="">Any</option>
				{options.map(([v, l]) => (
					<option key={v} value={v}>
						{l}
					</option>
				))}
			</select>
		</label>
	);
}
