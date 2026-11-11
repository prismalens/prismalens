// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CanonicalEvent,
	isWorkflowLive,
	type SettlePreview,
	type ThreadRow,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import {
	useArchiveThread,
	useForkThread,
	usePinThread,
	useRenameThread,
} from "@/lib/api/hooks/use-threads-orpc";
import { client, orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { threadLink } from "@/lib/thread-rows";

/** The menu's keys (#1101 category 20 item 1): the same in the row and the header. */
export const MENU_KEYS = {
	rename: "R",
	pin: "P",
	fork: "F",
	side: "Q",
	settle: "E",
	archive: "A",
	workIn: "W",
	link: "C",
	transcript: "T",
} as const;
type Item = keyof typeof MENU_KEYS;

/** The thread fields the menu reads; a feed row and an open thread both carry them. */
export type MenuThread = Pick<
	ThreadRow,
	| "id"
	| "title"
	| "status"
	| "incidentId"
	| "scheduleId"
	| "repositoryId"
	| "settledAt"
	| "pinnedAt"
	| "archivedAt"
>;

/** Why an item cannot run now, or null when it can. */
export function disabledWhy(t: MenuThread, item: Item): string | null {
	const live = isWorkflowLive(t.status);
	const owned = !!(t.incidentId || t.scheduleId);
	switch (item) {
		case "fork":
		case "side":
			return owned
				? "Incident and scheduled threads fork from their page"
				: null;
		case "archive":
			return live && !t.archivedAt ? "Stop the run first" : null;
		case "workIn":
			return t.repositoryId
				? "Set by the first message; start a new thread to change it"
				: "Only a project thread works in a checkout";
		default:
			return null;
	}
}

const count = (n: number, one: string, many = `${one}s`) =>
	`${n} ${n === 1 ? one : many}`;

/** What Settle ends, before it runs (#1101 category 2): "Ends 2 watches, 1 cron and 3 child threads". */
export function settlePreviewLine(p: SettlePreview): string {
	const parts = [
		...(p.running ? [count(p.running, "running agent")] : []),
		...(p.watches ? [count(p.watches, "watch", "watches")] : []),
		...(p.crons ? [count(p.crons, "cron")] : []),
		...(p.wakes ? [count(p.wakes, "wake")] : []),
		...(p.children ? [count(p.children, "child thread")] : []),
		...(p.worktrees.filter((w) => w.action === "remove").length
			? [
					count(
						p.worktrees.filter((w) => w.action === "remove").length,
						"worktree",
					),
				]
			: []),
	];
	if (!parts.length) return "Nothing else to end";
	const last = parts.pop();
	return `Ends ${parts.length ? `${parts.join(", ")} and ${last}` : last}`;
}

/** Plain text of a thread's messages: the user's and the agent's words, in order. */
export function transcriptText(events: readonly CanonicalEvent[]): string {
	const lines: string[] = [];
	for (const e of events) {
		if (e.kind === "operator_message") lines.push(`You: ${e.text}`);
		else if (e.kind === "agent_step" && e.text?.trim())
			lines.push(`Agent: ${e.text.trim()}`);
	}
	return lines.join("\n\n");
}

async function allEvents(id: string): Promise<CanonicalEvent[]> {
	const out: CanonicalEvent[] = [];
	let cursor: number | undefined;
	for (let n = 0; n < 50; n++) {
		const page = await client.investigations.getEvents({
			id,
			limit: 200,
			...(cursor !== undefined ? { cursor } : {}),
		});
		out.push(...page.events);
		if (page.nextCursor === null) break;
		cursor = page.nextCursor;
	}
	return out;
}

/**
 * One overflow menu for a thread (#1101 category 20), the same in its list row and its
 * header: each item shows its key, a disabled item says why, and Archive offers Undo.
 */
export function ThreadMenu({
	thread,
	onRename,
	onSettle,
	triggerClassName,
	align = "end",
	defaultOpen = false,
}: {
	/** Open on first draw: the design gallery's frame. */
	defaultOpen?: boolean;
	thread: MenuThread;
	/** The row renames in place; without it the menu asks in a dialog. */
	onRename?: () => void;
	onSettle?: () => void;
	triggerClassName?: string;
	align?: "start" | "end";
}) {
	const [open, setOpen] = useState(defaultOpen);
	const [dialog, setDialog] = useState<"rename" | "fork" | "side" | null>(null);
	const pin = usePinThread();
	const archive = useArchiveThread();
	const preview = useQuery({
		...orpc.threads.settlePreview.queryOptions({ input: { id: thread.id } }),
		enabled: open && !!onSettle,
	});
	const href = () => {
		const l = threadLink(thread as ThreadRow);
		if (l.to === "/threads/$id") return `/threads/${l.params.id}`;
		if (l.to === "/schedules/$id/runs/$runId")
			return `/schedules/${l.params.id}/runs/${l.params.runId}`;
		return `/incidents/${l.params.id}/conversation?investigation=${l.search.investigation}`;
	};
	const copy = async (what: string, text: Promise<string> | string) => {
		try {
			await navigator.clipboard.writeText(await text);
			toast({ title: `${what} copied` });
		} catch (e) {
			toast({
				title: `${what} not copied`,
				description: getErrorMessage(e),
				variant: "destructive",
			});
		}
	};
	const run = (item: Item) => {
		if (disabledWhy(thread, item)) return;
		setOpen(false);
		switch (item) {
			case "rename":
				if (onRename) onRename();
				else setDialog("rename");
				return;
			case "pin":
				pin.mutate({ id: thread.id, on: !thread.pinnedAt });
				return;
			case "fork":
			case "side":
				setDialog(item);
				return;
			case "settle":
				onSettle?.();
				return;
			case "archive": {
				const on = !thread.archivedAt;
				archive.mutate(
					{ id: thread.id, on },
					{
						onSuccess: () =>
							on &&
							toast({
								title: "Thread archived",
								description: "Find it with the archived filter on Threads.",
								action: (
									<Button
										size="sm"
										variant="secondary"
										onClick={() => archive.mutate({ id: thread.id, on: false })}
										data-testid="archive-undo"
									>
										Undo
									</Button>
								) as never,
							}),
						onError: (e) =>
							toast({
								title: "Not archived",
								description: getErrorMessage(e),
								variant: "destructive",
							}),
					},
				);
				return;
			}
			case "link":
				void copy("Link", `${window.location.origin}${href()}`);
				return;
			case "transcript":
				void copy("Transcript", allEvents(thread.id).then(transcriptText));
				return;
			case "workIn":
				return;
		}
	};
	const onKey = (e: KeyboardEvent) => {
		const item = (Object.keys(MENU_KEYS) as Item[]).find(
			(k) => MENU_KEYS[k] === e.key.toUpperCase(),
		);
		if (!item || e.metaKey || e.ctrlKey || e.altKey) return;
		e.preventDefault();
		run(item);
	};
	const settleLine = preview.data ? settlePreviewLine(preview.data) : null;
	const entry = (item: Item, label: string, extra?: ReactNode) => {
		const why = disabledWhy(thread, item);
		return (
			<DropdownMenuItem
				disabled={!!why}
				onSelect={(e) => {
					e.preventDefault();
					run(item);
				}}
				className="flex-col items-start gap-0"
				data-testid={`thread-menu-${item}`}
			>
				<span className="flex w-full items-center gap-2">
					{label}
					<DropdownMenuShortcut>{MENU_KEYS[item]}</DropdownMenuShortcut>
				</span>
				{(why ?? extra) && (
					<span
						className="text-meta text-text-3"
						data-testid={why ? "thread-menu-why" : undefined}
					>
						{why ?? extra}
					</span>
				)}
			</DropdownMenuItem>
		);
	};
	return (
		<>
			<DropdownMenu open={open} onOpenChange={setOpen} modal={!defaultOpen}>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						aria-label="Thread menu"
						className={
							triggerClassName ??
							"flex size-6 items-center justify-center rounded-control text-text-2 hover:bg-surface-4 hover:text-text-1"
						}
						data-testid="thread-menu"
					>
						<MoreHorizontal className="size-3.5" aria-hidden />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align={align}
					className="w-72"
					onKeyDown={onKey}
					data-testid="thread-menu-content"
				>
					{entry("rename", "Rename")}
					{entry("pin", thread.pinnedAt ? "Unpin" : "Pin")}
					<DropdownMenuSeparator />
					{entry(
						"fork",
						"Fork here",
						"A child thread that carries this one on",
					)}
					{entry(
						"side",
						"Side question",
						"A child thread; this one is untouched",
					)}
					<DropdownMenuSeparator />
					{onSettle &&
						entry(
							"settle",
							"Settle",
							settleLine ?? "Ends this thread's watches and schedules",
						)}
					{entry(
						"archive",
						thread.archivedAt ? "Unarchive" : "Archive",
						"Hides it from the list; Undo after",
					)}
					{entry("workIn", "Work in / Move to worktree")}
					<DropdownMenuSeparator />
					{entry("link", "Copy link")}
					{entry("transcript", "Copy transcript")}
				</DropdownMenuContent>
			</DropdownMenu>
			{dialog === "rename" && (
				<RenameDialog thread={thread} onClose={() => setDialog(null)} />
			)}
			{(dialog === "fork" || dialog === "side") && (
				<ForkDialog
					thread={thread}
					mode={dialog}
					onClose={() => setDialog(null)}
				/>
			)}
		</>
	);
}

function RenameDialog({
	thread,
	onClose,
}: {
	thread: MenuThread;
	onClose: () => void;
}) {
	const rename = useRenameThread();
	const [value, setValue] = useState(thread.title ?? "");
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Rename thread</DialogTitle>
					<DialogDescription>
						The agent stops naming it after this.
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						const next = value.trim();
						if (next) rename.mutate({ id: thread.id, title: next });
						onClose();
					}}
					className="flex flex-col gap-3"
				>
					<Input
						// biome-ignore lint/a11y/noAutofocus: the dialog opens for this one field.
						autoFocus
						aria-label="Thread name"
						value={value}
						maxLength={80}
						onChange={(e) => setValue(e.target.value)}
					/>
					<DialogFooter>
						<Button type="submit" disabled={!value.trim()}>
							Rename
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/** Fork here and Side question both start a child that reads this thread (#1101 decision c). */
function ForkDialog({
	thread,
	mode,
	onClose,
}: {
	thread: MenuThread;
	mode: "fork" | "side";
	onClose: () => void;
}) {
	const fork = useForkThread();
	const navigate = useNavigate();
	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent data-testid="fork-dialog">
				<DialogHeader>
					<DialogTitle>
						{mode === "fork" ? "Fork here" : "Side question"}
					</DialogTitle>
					<DialogDescription>
						{mode === "fork"
							? "A child thread reads this one and carries the work on. This thread keeps running as it is."
							: "A child thread reads this one and answers you there. This thread is untouched."}
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						if (!text.trim()) return;
						setError(null);
						fork.mutate(
							{ id: thread.id, mode, text: text.trim() },
							{
								onSuccess: ({ investigationId }) => {
									onClose();
									void navigate({
										to: "/threads/$id",
										params: { id: investigationId },
									});
								},
								onError: (e) => setError(getErrorMessage(e)),
							},
						);
					}}
				>
					<textarea
						// biome-ignore lint/a11y/noAutofocus: the dialog opens for this one field.
						autoFocus
						aria-label={
							mode === "fork" ? "What the fork does next" : "Your question"
						}
						placeholder={
							mode === "fork"
								? "What should the fork do next?"
								: "Ask beside this thread"
						}
						value={text}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
								e.currentTarget.form?.requestSubmit();
						}}
						rows={3}
						className="w-full rounded-control bg-surface-2 px-3 py-2 text-body text-text-1 outline-none placeholder:text-text-3 focus-visible:ring-2 focus-visible:ring-accent/60"
						data-testid="fork-text"
					/>
					{error && (
						<p className="text-meta text-danger" role="alert">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button
							type="submit"
							disabled={!text.trim() || fork.isPending}
							data-testid="fork-start"
						>
							{mode === "fork" ? "Start fork" : "Ask"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
