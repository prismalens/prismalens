// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { ArrowUp, FolderOpen, History, Link2 } from "lucide-react";
import {
	type FormEvent,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { SourceConnectDialog } from "@/components/settings/SourceConnectDialog";
import { KindIcon } from "@/components/settings/source-words";
import { PathTail } from "@/components/shared/PathTail";
import { Loading, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import {
	DIALOG_WIDTH,
	Dialog,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useOperator } from "@/hooks/use-operator";
import { useGitHosts } from "@/lib/api/hooks/use-app-settings-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { useFolderPicker } from "@/lib/folder-picker";
import {
	BROWSE_ERROR,
	isGitUrl,
	KIND_ICON,
	KIND_WORD,
	recentSources,
	rememberSource,
	shownEntries,
	sourceOf,
	splitTyped,
	typedKind,
} from "@/lib/project-source";
import { cn } from "@/lib/utils";
import { type HostChoice, HostRepoPicker, hostChoices } from "./HostRepoPicker";

// Whitespace, so no host name (which never has any) can equal a source row.
const FOLDER = "source folder";
const URL_ROW = "source url";

/**
 * One dialog for "folder or git URL" (#1020), or a pick from a git host's repositories (#1024). The host browses its own folders (folders
 * only, never file names) or picks one natively on the desktop; a paired device types it.
 * It hands the source back; the caller adds it, links it or fills a field.
 */
export function AddProjectDialog({
	open,
	onOpenChange,
	onChoose,
	title = "Add project",
	submitLabel = "Add",
	folderOnly = false,
	pending = false,
	error = null,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** A promise that settles tells the dialog whether the add worked; the source is remembered only then. */
	onChoose: (source: string) => void | Promise<unknown>;
	title?: string;
	submitLabel?: string;
	/** A place on disk, not a project: no URL and no kind. */
	folderOnly?: boolean;
	pending?: boolean;
	error?: string | null;
}) {
	const [typed, setTyped] = useState("");
	const [hidden, setHidden] = useState(false);
	useEffect(() => {
		if (open) setTyped("");
	}, [open]);
	const { managesPairing: host } = useOperator();
	const folders = useFolderPicker(host);
	const hosts = useGitHosts(open && !folderOnly);
	const choices = useMemo(() => hostChoices(hosts.data ?? []), [hosts.data]);
	// Local folder leads and stays the default: the list never reorders with the tokens.
	const [picked, setPicked] = useState(FOLDER);
	const [connecting, setConnecting] = useState<HostChoice | null>(null);
	const [pasted, setPasted] = useState("");
	const from = folderOnly ? FOLDER : picked;
	const choice = choices.find((c) => c.host === from && c.connected);
	const pasting = from === URL_ROW;
	const url = !folderOnly && isGitUrl(typed);
	// The desktop app picks only in its own window; the browser keeps the list beside Browse.
	const usesNative = folders.desktop && folders.available;
	const { dir, prefix } = splitTyped(useDeferredValue(typed));
	const listing = useQuery({
		...orpc.repositories.browseFolders.queryOptions({ input: { path: dir } }),
		enabled: open && host && !url && !choice && !pasting && !usesNative,
		staleTime: 5_000,
		placeholderData: (prev) => prev,
	});
	const at = listing.data;
	const kind = folderOnly ? null : typedKind(typed, at, prefix);
	const entries = at?.ok ? shownEntries(at.entries, prefix, hidden) : [];
	const recent = typed ? [] : recentSources();
	const source = pasting ? pasted.trim() : sourceOf(typed);

	const choose = (s: string) => {
		if (!s || pending) return;
		const done = onChoose(s);
		if (done)
			done.then(
				() => rememberSource(s),
				() => {},
			);
		else rememberSource(s);
	};
	const onSubmit = (e: FormEvent) => {
		e.preventDefault();
		choose(source);
	};
	// What the dialog shows when a pick resolves, not when it was clicked.
	const now = useRef({ open, from, choose, pending });
	now.current = { open, from, choose, pending };
	// A pick that resolves after this dialog unmounted (its owner closes it that way) adds nothing.
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const [picking, setPicking] = useState(false);
	const [pickFailed, setPickFailed] = useState(false);
	const pickNative = async () => {
		setPicking(true);
		setPickFailed(false);
		const got = await folders.pick().finally(() => setPicking(false));
		if (got.status === "failed") setPickFailed(true);
		if (got.status !== "picked") return;
		const cur = now.current;
		if (!mounted.current || !cur.open || cur.from !== FOLDER || cur.pending)
			return;
		setTyped(got.path);
		now.current.choose(got.path);
	};
	const sep = at?.ok && at.path.includes("\\") ? "\\" : "/";
	const into = (path: string) =>
		setTyped(path.endsWith(sep) ? path : `${path}${sep}`);
	const KindIcon = kind ? KIND_ICON[kind] : null;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className={cn(DIALOG_WIDTH.sm, "flex flex-col gap-3 overflow-hidden")}
				data-testid="add-project-dialog"
			>
				<DialogTitle className="shrink-0">{title}</DialogTitle>
				{/* The footer stays in view; a short screen scrolls this body instead. */}
				<div className="-mx-1 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-3 overflow-x-hidden overflow-y-auto px-1">
					{!folderOnly && (
						<SourceList
							from={from}
							choices={choices}
							ready={!!hosts.data}
							failed={hosts.isError && !hosts.data}
							locked={picking}
							onRetry={() => void hosts.refetch()}
							onPick={setPicked}
							onConnect={setConnecting}
						/>
					)}
					{connecting && (
						<SourceConnectDialog
							open
							onOpenChange={(o) => {
								if (o) return;
								setConnecting(null);
								void hosts.refetch();
							}}
							initialKind={connecting.kindId}
						/>
					)}
					{choice ? (
						<>
							<HostRepoPicker
								key={choice.host}
								choice={choice}
								onChoose={choose}
								pending={pending}
							/>
							{error && (
								<p
									className="text-meta text-danger"
									role="alert"
									data-testid="add-project-error"
								>
									{error}
								</p>
							)}
						</>
					) : (
						<form
							id="add-project-form"
							onSubmit={onSubmit}
							className="grid grid-cols-[minmax(0,1fr)] gap-2"
						>
							{pasting ? (
								<Input
									autoFocus
									value={pasted}
									onChange={(e) => setPasted(e.target.value)}
									placeholder="https://github.com/owner/repo.git"
									aria-label="Repository URL"
									className="min-w-0 font-mono"
									data-testid="add-project-url"
								/>
							) : (
								<div className="flex items-center gap-2">
									<Input
										autoFocus
										value={typed}
										onChange={(e) => setTyped(e.target.value)}
										placeholder={folderOnly ? "Folder" : "Folder path"}
										aria-label={folderOnly ? "Folder" : "Folder path"}
										className="min-w-0 flex-1 font-mono"
										data-testid="add-project-source"
									/>
									{folders.available && (
										<Button
											type="button"
											variant="secondary"
											disabled={picking}
											onClick={() => void pickNative()}
											data-testid="add-project-pick-folder"
										>
											<FolderOpen />
											Browse…
										</Button>
									)}
								</div>
							)}
							{pickFailed && (
								<p
									className="text-meta text-danger"
									role="alert"
									data-testid="add-project-pick-failed"
								>
									The folder dialog did not open. Try again.
								</p>
							)}
							{!pasting && KindIcon && kind && (
								<span
									className="flex items-center gap-1.5 text-meta text-text-2"
									data-testid="add-project-kind"
									data-kind={kind}
								>
									<KindIcon className="size-3.5" aria-hidden />
									{KIND_WORD[kind]}
								</span>
							)}
							{host && !url && !pasting && !usesNative && (
								<div className="grid gap-1.5 rounded-surface bg-surface-1 p-2">
									<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
										<Button
											type="button"
											variant="text"
											size="sm"
											disabled={!at?.ok || !at.parent}
											onClick={() => at?.ok && at.parent && into(at.parent)}
											data-testid="add-project-up"
										>
											<ArrowUp />
											Up
										</Button>
										<PathTail
											path={at?.path ?? ""}
											className="min-w-0 flex-1 basis-28 font-mono text-meta text-text-3"
										/>
										<label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-meta text-text-2">
											<Switch
												checked={hidden}
												onCheckedChange={setHidden}
												data-testid="add-project-hidden"
											/>
											Show hidden
										</label>
									</div>
									{recent.length > 0 && (
										<div className="flex flex-wrap gap-1">
											{recent.map((r) => (
												<button
													type="button"
													key={r}
													onClick={() => setTyped(r)}
													className="flex max-w-full items-center gap-1 rounded-control px-1.5 py-0.5 text-meta text-text-2 hover:bg-surface-3"
													data-testid="add-project-recent"
												>
													<History className="size-3 shrink-0" aria-hidden />
													<span className="truncate font-mono">{r}</span>
												</button>
											))}
										</div>
									)}
									{at && !at.ok ? (
										<p
											className="px-1 py-1 text-meta text-text-3"
											data-testid="add-project-browse-error"
											data-error={at.error}
										>
											{BROWSE_ERROR[at.error]}
										</p>
									) : (
										<ul
											className="grid max-h-44 gap-px overflow-y-auto"
											aria-label="Folders"
											data-testid="add-project-entries"
										>
											{entries.map((e) => {
												const Icon = KIND_ICON[e.git ? "repo" : "folder"];
												return (
													<li key={e.path}>
														<button
															type="button"
															onClick={() => into(e.path)}
															className="flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-body text-text-1 hover:bg-surface-3"
															data-testid="add-project-entry"
														>
															<Icon
																className="size-4 shrink-0 text-text-3"
																aria-hidden
															/>
															<span className="min-w-0 truncate">{e.name}</span>
														</button>
													</li>
												);
											})}
											{at?.ok && entries.length === 0 && (
												<li className="px-2 py-1 text-meta text-text-3">
													No folders
												</li>
											)}
											{at?.ok && at.truncated && (
												<li className="px-2 py-1 text-meta text-text-3">
													More not shown
												</li>
											)}
										</ul>
									)}
								</div>
							)}
							{error && (
								<p
									className="text-meta text-danger"
									role="alert"
									data-testid="add-project-error"
								>
									{error}
								</p>
							)}
						</form>
					)}
				</div>
				<div className="flex shrink-0 justify-end gap-2">
					<Button
						type="button"
						variant="text"
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					{!choice && (
						<Button
							type="submit"
							form="add-project-form"
							disabled={!source || pending || (pasting && !isGitUrl(source))}
							data-testid="add-project-submit"
						>
							{submitLabel}
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function SourceList({
	from,
	choices,
	ready,
	failed,
	locked,
	onRetry,
	onPick,
	onConnect,
}: {
	from: string;
	choices: readonly HostChoice[];
	ready: boolean;
	failed: boolean;
	/** A folder pick is open: the source cannot change under it. */
	locked: boolean;
	onRetry: () => void;
	onPick: (row: string) => void;
	onConnect: (choice: HostChoice) => void;
}) {
	const rowClass = (on: boolean) =>
		cn(
			"flex min-h-9 items-center gap-2 rounded-control px-2 text-body text-text-1",
			on ? "bg-surface-3" : "hover:bg-surface-2",
		);
	const pickClass = "flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left";
	return (
		<ul
			className="grid gap-px rounded-surface bg-surface-1 p-1"
			aria-label="Add from"
			data-testid="add-project-from"
		>
			<li className={rowClass(from === FOLDER)}>
				<button
					type="button"
					aria-pressed={from === FOLDER}
					disabled={locked}
					onClick={() => onPick(FOLDER)}
					className={pickClass}
					data-testid="add-project-row-folder"
				>
					<FolderOpen className="size-4 shrink-0 text-text-3" aria-hidden />
					Local folder
				</button>
			</li>
			<li className={rowClass(from === URL_ROW)}>
				<button
					type="button"
					aria-pressed={from === URL_ROW}
					disabled={locked}
					onClick={() => onPick(URL_ROW)}
					className={pickClass}
					data-testid="add-project-row-url"
				>
					<Link2 className="size-4 shrink-0 text-text-3" aria-hidden />
					Paste repository URL
				</button>
			</li>
			{!ready && (
				<li className="px-2 py-1.5">
					{failed ? (
						<Problem text="Code hosts did not load." onRetry={onRetry} />
					) : (
						<Loading rows={1} />
					)}
				</li>
			)}
			{ready &&
				choices.map((c) => (
					<li key={c.host} className={rowClass(from === c.host)}>
						<button
							type="button"
							aria-pressed={from === c.host}
							disabled={!c.connected || locked}
							onClick={() => onPick(c.host)}
							className={cn(pickClass, "disabled:cursor-default")}
							data-testid={`add-project-row-${c.kindId}`}
						>
							<KindIcon kind={c.kindId} />
							{c.label}
							{ready && c.connected && (
								<span className="text-meta text-text-3">Connected</span>
							)}
						</button>
						{ready && (
							<Button
								type="button"
								variant="text"
								size="sm"
								disabled={locked}
								aria-label={`${c.connected ? "Browse" : "Connect"} ${c.label}`}
								onClick={() => (c.connected ? onPick(c.host) : onConnect(c))}
								data-testid={`add-project-${c.connected ? "browse" : "connect"}-${c.kindId}`}
							>
								{c.connected ? "Browse" : "Connect"}
							</Button>
						)}
					</li>
				))}
		</ul>
	);
}

/** A field's Browse button: the same dialog, handing the pick back to fill the field. */
export function BrowseButton({
	onPick,
	folderOnly = false,
	disabled = false,
	testId = "browse-folder",
}: {
	onPick: (source: string) => void;
	folderOnly?: boolean;
	disabled?: boolean;
	testId?: string;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				type="button"
				variant="secondary"
				disabled={disabled}
				onClick={() => setOpen(true)}
				data-testid={testId}
			>
				<FolderOpen />
				Browse
			</Button>
			{open && (
				<AddProjectDialog
					open
					onOpenChange={setOpen}
					title={folderOnly ? "Choose a folder" : "Choose code"}
					submitLabel="Use"
					folderOnly={folderOnly}
					onChoose={(s) => {
						onPick(s);
						setOpen(false);
					}}
				/>
			)}
		</>
	);
}
