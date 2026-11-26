// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CanonicalEvent,
	isWorkflowLive,
	type SettlePreview,
	type ThreadRow,
	type ThreadStartSubject,
} from "@prismalens/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { setPageSurface } from "@/components/kit/active-surface";
import { Surface, SurfaceMore } from "@/components/kit/Surface";
import { primeAside } from "@/components/thread/aside-bus";
import { openNewThread } from "@/components/thread/composer/quote";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { userMovedThreads } from "@/hooks/use-list-hold";
import { useOperator } from "@/hooks/use-operator";
import { toast } from "@/hooks/use-toast";
import {
	threadMenuMutations,
	useRenameThread,
} from "@/lib/api/hooks/use-threads-orpc";
import { client } from "@/lib/api/orpc-client";
import { copyPending, copyText } from "@/lib/clipboard";
import { getErrorMessage } from "@/lib/get-error-message";
import { lazyPart } from "@/lib/lazy";
import { settleEndsLine } from "@/lib/settle-holds";
import { threadLink } from "@/lib/thread-rows";
import { rowSettleable, rowSettled } from "@/lib/thread-status";
import type {
	PageState,
	ThreadCtx,
	ThreadPageControls,
} from "./thread.actions";

// The schedule dialog loads only when the item is picked (#1101 cat 12).
const AddSchedule = lazyPart(
	() =>
		import("@/components/schedules/schedule-templates").then(
			(m) => m.AddScheduleFromThread,
		),
	null,
	{ now: true },
);

export interface ScheduleFrom {
	subject: ThreadStartSubject;
	prUrl?: string;
}

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
> &
	Partial<
		Pick<ThreadRow, "section" | "state" | "waitingAsk" | "awaitingApprovalAt">
	>;

/** Why an item cannot run now, or null when it can. */
export function disabledWhy(
	t: MenuThread,
	item: "fork" | "archive",
): string | null {
	if (item === "fork")
		return t.incidentId ? "Incident threads fork from their page" : null;
	return isWorkflowLive(t.status) && !t.archivedAt
		? "Stop the run first"
		: null;
}

/** What Settle ends, before it runs (#1101 category 2): "Ends 2 watches, 1 schedule and 3 worktrees". */
export function settlePreviewLine(p: SettlePreview): string {
	return settleEndsLine(p);
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
		onUnsettled,
		onDone,
		scheduleFrom,
		row = false,
	}: {
		/** A row's menu offers Settle by the row's own rule, never on an ask. */
		row?: boolean;
		/** The row renames in place; without it the menu asks in a dialog. */
		onRename?: () => void;
		onSettle?: () => void;
		/** The page's own echo of Unsettle: null at once, undefined when it failed. */
		onUnsettled?: (at: null | undefined) => void;
		/** Runs before an action, e.g. closing the palette. */
		onDone?: () => void;
		/** The open thread's own subject and PR for Add scheduled task. */
		scheduleFrom?: ScheduleFrom;
	} = {},
) {
	const [renaming, setRenaming] = useState(false);
	const [scheduling, setScheduling] = useState(false);
	// Who may add a schedule is the host's scope, known before the page draws; the schedule
	// list loads late on a slow link (#1101 cat 22 item 3).
	const operator = useOperator();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [naming, setNaming] = useState(false);
	const archive = (on: boolean) =>
		threadMenuMutations.archive(queryClient).mutate({ id: thread.id, on });
	const done = (fn: () => void) => () => {
		onDone?.();
		fn();
	};
	const doArchive = () => {
		const on = !thread.archivedAt;
		userMovedThreads([thread.id]);
		archive(on).then(
			() =>
				on &&
				toast({
					title: "Thread archived",
					action: (
						<Button
							size="sm"
							variant="secondary"
							onClick={() => void archive(false).catch(() => {})}
							data-testid="archive-undo"
						>
							Undo
						</Button>
					) as never,
				}),
			(e: unknown) =>
				toast({
					title: "Not archived",
					description: getErrorMessage(e),
					variant: "destructive",
				}),
		);
	};
	const standalone = !thread.incidentId && !thread.scheduleId;
	const ctx: ThreadCtx = {
		rename: done(() => (onRename ? onRename() : setRenaming(true))),
		nameAgain: done(() => {
			setNaming(true);
			void threadMenuMutations
				.nameAgain(queryClient)
				.mutate({ id: thread.id })
				.then(
					({ outcome }) =>
						outcome !== "named" &&
						toast({
							title: "Title kept",
							description: NAME_AGAIN_WHY[outcome],
						}),
					(e: unknown) =>
						toast({
							title: "Title kept",
							description: getErrorMessage(e),
							variant: "destructive",
						}),
				)
				.finally(() => setNaming(false));
		}),
		togglePin: done(() => {
			// The reader moved this row: the list applies it now, not after they leave (#1247 D25).
			userMovedThreads([thread.id]);
			void threadMenuMutations
				.pin(queryClient)
				.mutate({ id: thread.id, on: !thread.pinnedAt })
				.catch(() => {});
		}),
		toggleArchive: done(doArchive),
		settle: done(() => onSettle?.()),
		unsettle: done(() => {
			// The reader moved this row back to Threads: the list applies it now (#1247 D25).
			userMovedThreads([thread.id]);
			onUnsettled?.(null);
			void threadMenuMutations
				.settle(queryClient)
				.mutate({ id: thread.id, settled: false })
				.catch((e: unknown) => {
					onUnsettled?.(undefined);
					toast({
						title: "Not unsettled",
						description: getErrorMessage(e),
						variant: "destructive",
					});
				});
		}),
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
			// The pending copy keeps the click's permission while the transcript loads.
			void copyPending(
				allEvents(thread.id).then(transcriptText),
				undefined,
				"transcript.txt",
			).then((ok) => ok && toast({ title: "Transcript copied" }));
		}),
		copyLink: done(() => {
			void copyText(threadUrl(thread)).then(
				(ok) => ok && toast({ title: "Link copied" }),
			);
		}),
		fork: done(() =>
			openNewThread({ quotes: [], references: [], forkOf: { id: thread.id } }),
		),
		aside: done(() => {
			// The thread's own page answers; from a row, open it first.
			primeAside(thread.id);
			void navigate(threadLink(thread));
		}),
		schedule: done(() => setScheduling(true)),
		facts: {
			is: {
				pinned: !!thread.pinnedAt,
				archived: !!thread.archivedAt,
				live: isWorkflowLive(thread.status),
				settleable: !!onSettle && (!row || rowSettleable(thread)),
				settled: rowSettled(thread),
				standalone,
				naming,
				project: standalone && !!thread.repositoryId,
				canSchedule: operator.managesPairing,
				scheduleLoading: operator.isPending,
			},
		},
	};
	const dialog = (
		<>
			{renaming && (
				<RenameDialog thread={thread} onClose={() => setRenaming(false)} />
			)}
			{scheduling && (
				<AddSchedule
					title={thread.title ?? null}
					subject={
						scheduleFrom?.subject ??
						(thread.repositoryId
							? { kind: "project", repositoryId: thread.repositoryId }
							: { kind: "none" })
					}
					{...(scheduleFrom?.prUrl ? { prUrl: scheduleFrom.prUrl } : {})}
					open
					onOpenChange={setScheduling}
				/>
			)}
		</>
	);
	return { ctx, dialog };
}

/** The thread's absolute link, where its route lives. */
export function threadUrl(t: MenuThread): string {
	const l = threadLink(t);
	const path =
		l.to === "/threads/$id"
			? `/threads/${l.params.id}`
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
	page,
	scheduleFrom,
	onUnsettled,
}: {
	thread: MenuThread;
	where?: "row" | "header";
	/** The row renames in place; without it the menu asks in a dialog. */
	onRename?: () => void;
	onSettle?: () => void;
	triggerClassName?: string;
	/** Open on first draw: the design gallery's frame. */
	defaultOpen?: boolean;
	/** A phone header's own controls and their facts, folded into this menu. */
	page?: {
		controls: ThreadPageControls;
		is: { readonly [S in PageState]?: boolean };
	};
	scheduleFrom?: ScheduleFrom;
	onUnsettled?: (at: null | undefined) => void;
}) {
	const base = useThreadCtx(thread, {
		onRename,
		onSettle,
		scheduleFrom,
		onUnsettled,
		row: where === "row",
	});
	const { dialog } = base;
	const ctx: ThreadCtx = page
		? {
				...base.ctx,
				page: page.controls,
				facts: { ...base.ctx.facts, is: { ...base.ctx.facts.is, ...page.is } },
			}
		: base.ctx;
	// The open thread's header gives the keys their thread when no row has focus.
	const latest = useRef(ctx);
	latest.current = ctx;
	const ownsPage = where === "header" && !defaultOpen;
	useEffect(() => {
		if (!ownsPage) return;
		setPageSurface({ id: "thread.header", ctx: () => latest.current });
		return () => setPageSurface(null);
	}, [ownsPage]);
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
	const { ctx, dialog } = useThreadCtx(thread, {
		onRename,
		onSettle,
		row: true,
	});
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
