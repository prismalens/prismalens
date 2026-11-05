// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { ArrowUp, FolderOpen, History } from "lucide-react";
import { type FormEvent, useDeferredValue, useEffect, useState } from "react";
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
import { orpc } from "@/lib/api/orpc-client";
import { desktopBridge } from "@/lib/desktop";
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

/**
 * One dialog for "folder or git URL" (#1020). The host browses its own folders (folders
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
	onChoose: (source: string) => void;
	title?: string;
	submitLabel?: string;
	/** A place on disk, not a project: no URL and no kind. */
	folderOnly?: boolean;
	pending?: boolean;
	error?: string | null;
}) {
	const [typed, setTyped] = useState("");
	const [hidden, setHidden] = useState(false);
	const [native, setNative] = useState(!!desktopBridge()?.pickFolder);
	useEffect(() => {
		if (open) setTyped("");
	}, [open]);
	const { managesPairing: host } = useOperator();
	const url = !folderOnly && isGitUrl(typed);
	const { dir, prefix } = splitTyped(useDeferredValue(typed));
	const listing = useQuery({
		...orpc.repositories.browseFolders.queryOptions({ input: { path: dir } }),
		enabled: open && host && !url,
		staleTime: 5_000,
		placeholderData: (prev) => prev,
	});
	const at = listing.data;
	const kind = folderOnly ? null : typedKind(typed, at, prefix);
	const entries = at?.ok ? shownEntries(at.entries, prefix, hidden) : [];
	const recent = typed ? [] : recentSources();
	const source = sourceOf(typed);

	const choose = (s: string) => {
		if (!s || pending) return;
		rememberSource(s);
		onChoose(s);
	};
	const onSubmit = (e: FormEvent) => {
		e.preventDefault();
		choose(source);
	};
	const pickNative = async () => {
		const got = await desktopBridge()?.pickFolder?.();
		if (!got || "unavailable" in got) return setNative(false);
		if (got.path) setTyped(got.path);
	};
	const sep = at?.ok && at.path.includes("\\") ? "\\" : "/";
	const into = (path: string) =>
		setTyped(path.endsWith(sep) ? path : `${path}${sep}`);
	const KindIcon = kind ? KIND_ICON[kind] : null;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className={cn(DIALOG_WIDTH.sm, "grid gap-3")}
				data-testid="add-project-dialog"
			>
				<DialogTitle>{title}</DialogTitle>
				<form onSubmit={onSubmit} className="grid gap-2">
					<div className="flex items-center gap-2">
						<Input
							autoFocus
							value={typed}
							onChange={(e) => setTyped(e.target.value)}
							placeholder={folderOnly ? "Folder" : "Folder or git URL"}
							aria-label={folderOnly ? "Folder" : "Folder or git URL"}
							className="min-w-0 flex-1 font-mono"
							data-testid="add-project-source"
						/>
						{native && host && (
							<Button
								type="button"
								variant="secondary"
								onClick={() => void pickNative()}
								data-testid="add-project-native"
							>
								<FolderOpen />
								Choose
							</Button>
						)}
					</div>
					{KindIcon && kind && (
						<span
							className="flex items-center gap-1.5 text-meta text-text-2"
							data-testid="add-project-kind"
							data-kind={kind}
						>
							<KindIcon className="size-3.5" aria-hidden />
							{KIND_WORD[kind]}
						</span>
					)}
					{host && !url && (
						<div className="grid gap-1.5 rounded-surface bg-surface-1 p-2">
							<div className="flex items-center gap-2">
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
								<span className="min-w-0 flex-1 truncate font-mono text-meta text-text-3">
									{at?.path}
								</span>
								<label className="flex items-center gap-1.5 text-meta text-text-2">
									<Switch
										checked={hidden}
										onCheckedChange={setHidden}
										data-testid="add-project-hidden"
									/>
									Hidden
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
									className="grid max-h-56 gap-px overflow-y-auto"
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
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="text"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={!source || pending}
							data-testid="add-project-submit"
						>
							{submitLabel}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
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
