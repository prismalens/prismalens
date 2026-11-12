// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CanonicalEvent,
	isWorkflowLive,
	type SettlePreview,
	type ThreadRow,
} from "@prismalens/contracts";
import { useNavigate } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { type ReactElement, useState } from "react";
import { Surface, SurfaceMore } from "@/components/kit/Surface";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import {
	useArchiveThread,
	usePinThread,
	useRegenerateThreadTitle,
	useRenameThread,
} from "@/lib/api/hooks/use-threads-orpc";
import { client } from "@/lib/api/orpc-client";
import { copyText } from "@/lib/clipboard";
import { getErrorMessage } from "@/lib/get-error-message";
import { threadLink } from "@/lib/thread-rows";
import type { ThreadCtx } from "./thread.actions";

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
export function disabledWhy(
	t: MenuThread,
	item: "fork" | "archive",
): string | null {
	if (item === "fork")
		return t.incidentId || t.scheduleId
			? "Incident and scheduled threads fork from their page"
			: null;
	return isWorkflowLive(t.status) && !t.archivedAt
		? "Stop the run first"
		: null;
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

export async function allEvents(id: string): Promise<CanonicalEvent[]> {
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

/** Why "Name it again" kept the title, by the server's outcome. */
const NAME_AGAIN_WHY: Record<string, string> = {
	off: "Thread titles are off in Settings, Models.",
	"no-model":
		"This agent lists no small model. Pick one in Thread titles in Settings, Models.",
	kept: "The title changed while it was being named.",
	empty: "The model gave no usable title.",
	failed: "The agent could not name it this time.",
};

/**
 * A thread's context for the registry (#1125): the row offers Rename, Pin,
 * Archive and Settle on ⋯ and on right-click; the header offers Rename, Settle,
 * Archive; the palette adds Open, Copy transcript and Copy link.
 */
export function useThreadCtx(
	thread: MenuThread,
	{
		onRename,
		onSettle,
		onDone,
	}: {
		/** The row renames in place; without it the menu asks in a dialog. */
		onRename?: () => void;
		onSettle?: () => void;
		/** Runs before an action, e.g. closing the palette. */
		onDone?: () => void;
	} = {},
) {
	const [renaming, setRenaming] = useState(false);
	const navigate = useNavigate();
	const pin = usePinThread();
	const archive = useArchiveThread();
	const regenerate = useRegenerateThreadTitle();
	const done = (fn: () => void) => () => {
		onDone?.();
		fn();
	};
	const doArchive = () => {
		const on = !thread.archivedAt;
		archive.mutate(
			{ id: thread.id, on },
			{
				onSuccess: () =>
					on &&
					toast({
						title: "Thread archived",
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
	};
	const standalone = !thread.incidentId && !thread.scheduleId;
	const ctx: ThreadCtx = {
		rename: done(() => (onRename ? onRename() : setRenaming(true))),
		nameAgain: done(() =>
			regenerate.mutate(
				{ id: thread.id },
				{
					onSuccess: ({ outcome }) =>
						outcome !== "named" &&
						toast({
							title: "Title kept",
							description: NAME_AGAIN_WHY[outcome],
						}),
					onError: (e) =>
						toast({
							title: "Title kept",
							description: getErrorMessage(e),
							variant: "destructive",
						}),
				},
			),
		),
		togglePin: done(() => pin.mutate({ id: thread.id, on: !thread.pinnedAt })),
		toggleArchive: done(doArchive),
		settle: done(() => onSettle?.()),
		open: done(() => void navigate(threadLink(thread))),
		openWithPanel: done(
			() =>
				void navigate({
					to: "/threads/$id",
					params: { id: thread.id },
					search: { panel: "thread" },
				}),
		),
		copyTranscript: done(() => {
			void allEvents(thread.id)
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
		copyLink: done(() => {
			void copyText(threadUrl(thread)).then(
				(ok) => ok && toast({ title: "Link copied" }),
			);
		}),
		facts: {
			is: {
				pinned: !!thread.pinnedAt,
				archived: !!thread.archivedAt,
				live: isWorkflowLive(thread.status),
				settleable: !!onSettle,
				standalone,
				naming: regenerate.isPending,
			},
		},
	};
	const dialog = renaming ? (
		<RenameDialog thread={thread} onClose={() => setRenaming(false)} />
	) : null;
	return { ctx, dialog };
}

/** The thread's absolute link, where its route lives. */
export function threadUrl(t: MenuThread): string {
	const l = threadLink(t);
	const path =
		l.to === "/threads/$id"
			? `/threads/${l.params.id}`
			: l.to === "/schedules/$id/runs/$runId"
				? `/schedules/${l.params.id}/runs/${l.params.runId}`
				: `/incidents/${l.params.id}/conversation?investigation=${l.search.investigation}`;
	return `${window.location.origin}${path}`;
}

/** The ⋯ trigger and its kit menu (220 px, down from the trigger). */
export function ThreadMenu({
	thread,
	where = "header",
	onRename,
	onSettle,
	triggerClassName,
	defaultOpen,
}: {
	thread: MenuThread;
	where?: "row" | "header";
	/** The row renames in place; without it the menu asks in a dialog. */
	onRename?: () => void;
	onSettle?: () => void;
	triggerClassName?: string;
	/** Open on first draw: the design gallery's frame. */
	defaultOpen?: boolean;
}) {
	const { ctx, dialog } = useThreadCtx(thread, { onRename, onSettle });
	return (
		<>
			<SurfaceMore
				id={where === "row" ? "thread.row" : "thread.header"}
				ctx={ctx}
				open={defaultOpen || undefined}
				trigger={
					<button
						type="button"
						aria-label="Thread actions"
						className={
							triggerClassName ??
							"flex size-6 items-center justify-center rounded-control text-text-2 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-3"
						}
						data-testid="thread-menu"
					>
						<MoreHorizontal className="size-3.5" aria-hidden />
					</button>
				}
			/>
			{dialog}
		</>
	);
}

/** The same row entries on right-click, Shift+F10, the Menu key and a long press. */
export function ThreadContextMenu({
	thread,
	onRename,
	onSettle,
	children,
}: {
	thread: MenuThread;
	onRename?: () => void;
	onSettle?: () => void;
	children: ReactElement;
}) {
	const { ctx, dialog } = useThreadCtx(thread, { onRename, onSettle });
	return (
		<>
			<Surface id="thread.row" ctx={ctx}>
				{children}
			</Surface>
			{dialog}
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
