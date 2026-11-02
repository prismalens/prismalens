// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { GitHostView, SourceRow } from "@prismalens/contracts/schemas";
import {
	ChevronDown,
	ChevronRight,
	CircleDashed,
	Plug,
	Plus,
	Search,
	TriangleAlert,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { SettingGroup } from "@/components/shared/SettingRow";
import { Loading, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { PHONE, SIDEBAR_FULL, useMediaQuery } from "@/hooks/use-media-query";
import { useConnections, useDeleteConnection } from "@/lib/api/hooks";
import {
	useSourcesOverview,
	useSourcesPreRun,
} from "@/lib/api/hooks/use-sources-orpc";
import { cn } from "@/lib/utils";
import { ConnectionFormDialog } from "./ConnectionFormDialog";
import { DeleteConnectionDialog } from "./DeleteConnectionDialog";
import { SourceConnectDialog } from "./SourceConnectDialog";
import {
	ConnectionDetail,
	HostDetail,
	type SourceActions,
} from "./SourceDetail";
import {
	AlsoInNote,
	CredentialChip,
	credentialWord,
	hostCredentialWord,
	hostOf,
	hostState,
	hostVendor,
	KindIcon,
	kindLabel,
	OverridesNote,
	StatePill,
	sourceState,
	type Word,
} from "./source-words";

/** Past this many rows Sources becomes tiles, filters and master-detail (#848). */
export const MANY_SOURCES = 8;

type Item =
	| {
			type: "conn";
			id: string;
			name: string;
			group: string;
			row: SourceRow;
			word: Word;
	  }
	| {
			type: "host";
			id: string;
			name: string;
			group: "Git hosts";
			host: GitHostView;
			word: Word | null;
	  };

const KIND_ORDER = ["prometheus", "alertmanager", "loki"];
const attention = (i: Item) =>
	!!i.word && (i.word.tone === "warn" || i.word.tone === "danger");
const unused = (i: Item) => i.type === "conn" && i.row.usedBy.length === 0;

export function sourceItems(
	sources: SourceRow[],
	hosts: GitHostView[],
): Item[] {
	return [
		...sources.map(
			(row): Item => ({
				type: "conn",
				id: row.connectionId,
				name: row.label,
				group: row.kind,
				row,
				word: sourceState(row),
			}),
		),
		...hosts.map(
			(host): Item => ({
				type: "host",
				id: `host:${host.host}`,
				name: host.host,
				group: "Git hosts",
				host,
				word: hostState(host),
			}),
		),
	];
}

/** Which page an "Add source" opens on; an "Add a token" opens on its vendor. */
function kindForHost(host: string): string {
	const v = hostVendor(host).toLowerCase();
	return v === "git host" ? "github" : v;
}

/** The page's primary: Add source, three steps (Kind, Details, Test and save). */
export function AddSourceButton() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				variant="primary"
				size="lg"
				onClick={() => setOpen(true)}
				data-testid="sources-add"
			>
				<Plus className="size-4" />
				Add source
			</Button>
			<SourceConnectDialog open={open} onOpenChange={setOpen} />
		</>
	);
}

/**
 * Settings, Sources (#848): what a run reads before it starts. Telemetry and
 * git hosts, each with one state, one credential chip and at most one note;
 * details behind the chevron. Many sources get tiles, filters and a detail
 * panel beside the table (a sheet below 1280 px).
 */
export function SourcesSettings({ source }: { source?: string }) {
	const { data, isLoading, isError, refetch } = useSourcesOverview();
	const { data: connections } = useConnections();
	const remove = useDeleteConnection();
	const [editing, setEditing] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<string | null>(null);
	const [adding, setAdding] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(source ?? null);
	// A source reached through history selects afresh; an open edit keeps its draft (#848).
	const [shownSource, setShownSource] = useState(source);
	if (source !== shownSource) {
		setShownSource(source);
		setSelected(source ?? null);
	}
	const items = useMemo(
		() => sourceItems(data?.sources ?? [], data?.gitHosts ?? []),
		[data],
	);
	const editingRow = data?.sources.find((s) => s.connectionId === editing);
	const envOrigin = useEnvOrigin(editingRow);
	const actions: SourceActions = {
		onEdit: setEditing,
		onDelete: (id) => {
			remove.reset();
			setDeleting(id);
		},
		onAddToken: (host) => setAdding(kindForHost(host)),
	};

	if (isError)
		return (
			<Problem text="Your sources did not load." onRetry={() => refetch()} />
		);
	if (isLoading || !data) return <Loading rows={5} />;

	const dialogs = (
		<>
			<ConnectionFormDialog
				open={!!editing}
				onOpenChange={(o) => !o && setEditing(null)}
				mode="edit"
				connection={connections?.find((c) => c.id === editing) ?? null}
				envOrigin={envOrigin}
			/>
			<DeleteConnectionDialog
				open={!!deleting}
				onOpenChange={(o) => !o && setDeleting(null)}
				connectionId={deleting}
				error={remove.error}
				onDelete={async () => {
					if (deleting) await remove.mutateAsync({ id: deleting });
					if (selected === deleting) setSelected(null);
					setDeleting(null);
				}}
				onCancel={() => setDeleting(null)}
				isDeleting={remove.isPending}
			/>
			<SourceConnectDialog
				open={!!adding}
				onOpenChange={(o) => !o && setAdding(null)}
				initialKind={adding ?? undefined}
			/>
		</>
	);

	if (items.length === 0)
		return (
			<div
				className="flex flex-col items-center gap-3 px-6 py-12 text-center"
				data-testid="sources-empty"
			>
				<Plug className="size-6 text-text-3" aria-hidden />
				<h3 className="text-title">No sources yet</h3>
				<p className="max-w-[28rem] text-text-2">
					Runs still start. Add Prometheus, Alertmanager or Loki to give each
					one a snapshot, or a git token to clone private code.
				</p>
				<Button variant="primary" onClick={() => setAdding("prometheus")}>
					<Plus className="size-4" />
					Add your first source
				</Button>
				{dialogs}
			</div>
		);

	const dialogOpen = !!editing || !!deleting || !!adding;
	return (
		<>
			{items.length > MANY_SOURCES ? (
				<ManySources
					items={items}
					actions={actions}
					selected={selected}
					onSelect={setSelected}
					sheetHidden={dialogOpen}
				/>
			) : (
				<FewSources items={items} actions={actions} initialOpen={source} />
			)}
			{dialogs}
		</>
	);
}

/** The environment origin for the edited row's kind, from the run's own resolver (C16a). */
export function useEnvOrigin(row: SourceRow | undefined): string | null {
	const preRun = useSourcesPreRun(row?.usedBy[0]?.serviceId ?? null);
	if (!row) return null;
	const fallback = preRun.data?.kinds.find((k) => k.kind === row.kind)
		?.envFallback?.origin;
	if (fallback) return fallback;
	// With env in use, the env token is this address's by definition.
	return row.credential === "env" && row.address
		? new URL(row.address).origin
		: null;
}

function FewSources({
	items,
	actions,
	initialOpen,
}: {
	items: Item[];
	actions: SourceActions;
	initialOpen?: string;
}) {
	const telemetry = items.filter((i) => i.type === "conn");
	const hosts = items.filter((i) => i.type === "host");
	return (
		<>
			{telemetry.length > 0 && (
				<SettingGroup
					title="Telemetry"
					count={telemetry.length}
					testId="sources-telemetry"
				>
					<SourceList
						items={telemetry}
						actions={actions}
						initialOpen={initialOpen}
					/>
				</SettingGroup>
			)}
			{hosts.length > 0 && (
				<SettingGroup
					title="Git hosts"
					count={hosts.length}
					testId="sources-git-hosts"
				>
					<SourceList items={hosts} actions={actions} />
				</SettingGroup>
			)}
		</>
	);
}

function SourceList({
	items,
	actions,
	initialOpen,
}: {
	items: Item[];
	actions: SourceActions;
	initialOpen?: string;
}) {
	const [open, setOpen] = useState<Set<string>>(
		() => new Set(initialOpen ? [initialOpen] : []),
	);
	const [shownOpen, setShownOpen] = useState(initialOpen);
	if (initialOpen !== shownOpen) {
		setShownOpen(initialOpen);
		setOpen(new Set(initialOpen ? [initialOpen] : []));
	}
	useEffect(() => {
		if (initialOpen)
			document
				.getElementById(`more-${initialOpen}`)
				?.scrollIntoView({ block: "nearest" });
	}, [initialOpen]);
	const toggle = (id: string) =>
		setOpen((s) => {
			const n = new Set(s);
			if (n.has(id)) n.delete(id);
			else n.add(id);
			return n;
		});
	return (
		<ul className="pool flex flex-col divide-y divide-hairline px-4">
			{items.map((i) => (
				<li key={i.id} data-testid="source-row" data-source={i.name}>
					<SourceLine
						item={i}
						open={open.has(i.id)}
						onToggle={() => toggle(i.id)}
					/>
					{open.has(i.id) && (
						<div className="pb-4 pl-11" id={`more-${i.id}`}>
							<ItemDetail item={i} actions={actions} />
						</div>
					)}
				</li>
			))}
		</ul>
	);
}

/** One source: its name and state, the kind and address, the credential chip and one note. */
function SourceLine({
	item,
	open,
	onToggle,
}: {
	item: Item;
	open: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			aria-expanded={open}
			aria-controls={`more-${item.id}`}
			className="flex min-h-16 w-full items-start gap-3 py-3 text-left"
		>
			<KindIcon kind={item.type === "host" ? "git" : item.row.kind} />
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<span className="text-heading" data-testid="source-name">
						{item.name}
					</span>
					{item.word && <StatePill word={item.word} testId="source-state" />}
				</span>
				<span className="truncate text-meta text-text-2">
					{item.type === "conn" ? (
						<>
							{kindLabel(item.row.kind)} ·{" "}
							<span className="font-mono">{hostOf(item.row.address)}</span>
						</>
					) : (
						hostVendor(item.host.host)
					)}
				</span>
				<span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
					{item.type === "conn" ? (
						<>
							<CredentialChip
								text={credentialWord(item.row)}
								testId="source-credential"
							/>
							{item.row.overridesEnv ? (
								<OverridesNote variable={item.row.overridesEnv} />
							) : (
								item.row.alsoInAlertIntake && <AlsoInNote page="Alert intake" />
							)}
						</>
					) : (
						<CredentialChip
							text={hostCredentialWord(item.host)}
							testId="source-credential"
						/>
					)}
				</span>
			</span>
			<ChevronDown
				className={cn(
					"mt-2 size-4 shrink-0 text-text-3 transition-transform duration-(--dur-fast)",
					open && "rotate-180",
				)}
				aria-hidden
			/>
		</button>
	);
}

function ItemDetail({ item, actions }: { item: Item; actions: SourceActions }) {
	return item.type === "conn" ? (
		<ConnectionDetail
			row={item.row}
			actions={actions}
			alsoInAlertIntake={false}
		/>
	) : (
		<HostDetail host={item.host} actions={actions} />
	);
}

type Tile = "all" | "attention" | "unused";

function ManySources({
	items,
	actions,
	selected,
	onSelect,
	sheetHidden,
}: {
	items: Item[];
	actions: SourceActions;
	selected: string | null;
	onSelect: (id: string | null) => void;
	sheetHidden: boolean;
}) {
	const [tile, setTile] = useState<Tile>("all");
	const [kind, setKind] = useState<string>("all");
	const [query, setQuery] = useState("");
	const wide = useMediaQuery(SIDEBAR_FULL);
	const phone = useMediaQuery(PHONE);
	const groups = [
		...KIND_ORDER.filter((k) => items.some((i) => i.group === k)),
		...(items.some((i) => i.group === "Git hosts") ? ["Git hosts"] : []),
	];
	const q = query.trim().toLowerCase();
	const shown = items
		.filter((i) => kind === "all" || i.group === kind)
		.filter((i) => tile !== "attention" || attention(i))
		.filter((i) => tile !== "unused" || unused(i))
		.filter(
			(i) =>
				!q ||
				`${i.name} ${i.type === "conn" ? `${i.row.kind} ${i.row.address ?? ""}` : i.host.host}`
					.toLowerCase()
					.includes(q),
		)
		// Attention first, then by name: what needs a decision leads.
		.sort(
			(a, b) =>
				Number(attention(b)) - Number(attention(a)) ||
				a.name.localeCompare(b.name),
		);
	const current = items.find((i) => i.id === selected) ?? null;
	const tiles: { id: Tile; n: number; label: string; icon: ReactNode }[] = [
		{
			id: "all",
			n: items.length,
			label: "Sources",
			icon: <Plug className="size-3.5" aria-hidden />,
		},
		{
			id: "attention",
			n: items.filter(attention).length,
			label: "Need attention",
			icon: <TriangleAlert className="size-3.5" aria-hidden />,
		},
		{
			id: "unused",
			n: items.filter(unused).length,
			label: "Not used yet",
			icon: <CircleDashed className="size-3.5" aria-hidden />,
		},
	];
	const detail = current && (
		<div className="flex flex-col gap-4">
			<div className="flex items-start gap-3">
				<KindIcon kind={current.type === "host" ? "git" : current.row.kind} />
				<div className="min-w-0">
					<div className="text-title [overflow-wrap:anywhere]">
						{current.name}
					</div>
					<div className="text-meta text-text-2">
						{current.type === "conn"
							? kindLabel(current.row.kind)
							: hostVendor(current.host.host)}
					</div>
					{current.word && <StatePill word={current.word} className="mt-2" />}
				</div>
			</div>
			<ItemDetail item={current} actions={actions} />
		</div>
	);
	return (
		<div data-testid="sources-many">
			<div className="mb-6 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
				{tiles.map((t) => (
					<button
						key={t.id}
						type="button"
						aria-pressed={tile === t.id}
						onClick={() =>
							setTile(tile === t.id && t.id !== "all" ? "all" : t.id)
						}
						className={cn(
							"raised grid min-h-12 content-start gap-0.5 rounded-dialog px-4 py-3.5 text-left",
							tile === t.id &&
								"bg-accent/8 outline-2 -outline-offset-2 outline-accent",
						)}
						data-testid={`sources-tile-${t.id}`}
					>
						<span className="text-[28px] leading-8 font-semibold tabular-nums">
							{t.n}
						</span>
						<span
							className={cn(
								"flex items-center gap-1.5 text-meta font-medium text-text-2",
								t.id === "attention" && t.n > 0 && "text-warn",
							)}
						>
							{t.icon}
							{t.label}
						</span>
					</button>
				))}
			</div>
			<div className="mb-3 flex flex-col gap-3">
				<div className="raised flex h-10 items-center gap-2 rounded-pool px-3">
					<Search className="size-4 text-text-3" aria-hidden />
					<Input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search sources"
						aria-label="Search sources"
						className="h-8 flex-1 bg-transparent px-0"
						data-testid="sources-search"
					/>
				</div>
				<fieldset
					aria-label="Kind"
					data-scroll-x
					className="m-0 flex gap-1.5 overflow-x-auto border-0 p-0.5"
				>
					{["all", ...groups].map((g) => {
						const n =
							g === "all"
								? items.length
								: items.filter((i) => i.group === g).length;
						return (
							<button
								key={g}
								type="button"
								aria-pressed={kind === g}
								onClick={() => setKind(g)}
								className={cn(
									"inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-meta font-medium whitespace-nowrap text-text-2 outline-1 -outline-offset-1 outline-text-3/50 hover:text-text-1",
									kind === g &&
										"bg-text-1 text-canvas outline-0 hover:text-canvas",
								)}
								data-testid={`sources-kind-${g}`}
							>
								{g === "all" ? "All" : g === "Git hosts" ? g : kindLabel(g)}
								<span className="tabular-nums">{n}</span>
							</button>
						);
					})}
				</fieldset>
			</div>
			<div className="flex items-start gap-4">
				<div className="min-w-0 flex-1">
					{shown.length === 0 ? (
						<div className="pool flex flex-col items-center gap-2 px-6 py-10 text-center">
							<h3 className="text-heading">Nothing matches</h3>
							<p className="text-text-2">
								Try another name, or clear the filters.
							</p>
							<Button
								variant="secondary"
								size="sm"
								onClick={() => {
									setTile("all");
									setKind("all");
									setQuery("");
								}}
							>
								Clear filters
							</Button>
						</div>
					) : phone ? (
						<SourceCards items={shown} onSelect={onSelect} />
					) : (
						<SourceTable
							items={shown}
							selected={selected}
							onSelect={onSelect}
						/>
					)}
				</div>
				{wide && current && (
					<aside
						className="raised sticky top-4 w-[336px] shrink-0 rounded-[14px] p-4"
						aria-label={current.name}
						data-testid="sources-detail"
					>
						{detail}
					</aside>
				)}
			</div>
			{!wide && (
				<Sheet
					open={!!current && !sheetHidden}
					onOpenChange={(o) => !o && onSelect(null)}
				>
					<SheetContent
						side={phone ? "bottom" : "right"}
						className={cn(
							"overflow-y-auto",
							phone
								? "max-h-[90dvh] rounded-t-dialog"
								: "w-[400px] sm:max-w-[400px]",
						)}
						data-testid="sources-sheet"
					>
						<SheetHeader className="sr-only">
							<SheetTitle>{current?.name}</SheetTitle>
							<SheetDescription>Source details</SheetDescription>
						</SheetHeader>
						{detail}
					</SheetContent>
				</Sheet>
			)}
		</div>
	);
}

function usedCell(i: Item): string {
	if (i.type === "host") {
		const n = i.host.stored.reduce((a, t) => a + t.pinnedRepos.length, 0);
		return n ? `${n} ${n === 1 ? "repository" : "repositories"}` : "None";
	}
	const names = Array.from(new Set(i.row.usedBy.map((u) => u.name)));
	return names.length
		? names.length > 1
			? `${names[0]} +${names.length - 1}`
			: (names[0] as string)
		: "None";
}

function SourceTable({
	items,
	selected,
	onSelect,
}: {
	items: Item[];
	selected: string | null;
	onSelect: (id: string) => void;
}) {
	return (
		<div className="raised overflow-hidden rounded-[14px]">
			<table
				className="w-full text-left tabular-nums"
				data-testid="sources-table"
			>
				<thead>
					<tr className="h-9 text-meta font-medium text-text-2">
						<th className="pl-4 font-medium">Name</th>
						<th className="px-3 font-medium">Credential</th>
						<th className="px-3 font-medium max-lg:hidden">Used by</th>
						<th className="px-3 font-medium">Status</th>
						<th className="w-8 pr-3">
							<span className="sr-only">Open</span>
						</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-hairline">
					{items.map((i) => (
						<tr
							key={i.id}
							tabIndex={0}
							aria-selected={selected === i.id}
							onClick={() => onSelect(i.id)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									onSelect(i.id);
								}
							}}
							className={cn(
								"cursor-pointer transition-colors duration-(--dur-instant) hover:bg-surface-3",
								selected === i.id && "bg-accent/8",
							)}
							data-testid="source-row"
							data-source={i.name}
						>
							<td className="py-2.5 pl-4">
								<span className="flex min-w-0 items-center gap-2.5">
									<KindIcon
										kind={i.type === "host" ? "git" : i.row.kind}
										small
									/>
									<span className="min-w-0">
										<b className="block truncate font-semibold">{i.name}</b>
										<span className="block text-meta text-text-2">
											{i.type === "host" ? "Git host" : kindLabel(i.row.kind)}
										</span>
									</span>
								</span>
							</td>
							<td className="px-3">
								<CredentialChip
									text={
										i.type === "conn"
											? credentialWord(i.row)
											: hostCredentialWord(i.host)
									}
								/>
							</td>
							<td className="px-3 whitespace-nowrap max-lg:hidden">
								{usedCell(i)}
							</td>
							<td className="px-3">{i.word && <StatePill word={i.word} />}</td>
							<td className="pr-3 text-text-3">
								<ChevronRight className="size-4" aria-hidden />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function SourceCards({
	items,
	onSelect,
}: {
	items: Item[];
	onSelect: (id: string) => void;
}) {
	return (
		<ul className="flex flex-col gap-2">
			{items.map((i) => (
				<li key={i.id}>
					<button
						type="button"
						onClick={() => onSelect(i.id)}
						className="raised flex min-h-12 w-full flex-col gap-2 rounded-dialog p-3 text-left"
						data-testid="source-row"
						data-source={i.name}
					>
						<span className="flex items-start gap-3">
							<KindIcon kind={i.type === "host" ? "git" : i.row.kind} />
							<span className="min-w-0 flex-1">
								<b className="block font-semibold [overflow-wrap:anywhere]">
									{i.name}
								</b>
								<span className="block truncate font-mono text-mono text-text-2">
									{i.type === "conn" ? hostOf(i.row.address) : i.host.host}
								</span>
							</span>
						</span>
						<span className="flex flex-wrap items-center gap-2">
							<CredentialChip
								text={
									i.type === "conn"
										? credentialWord(i.row)
										: hostCredentialWord(i.host)
								}
							/>
							{i.word && <StatePill word={i.word} className="ml-auto" />}
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}
