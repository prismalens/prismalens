// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Threads that start and message threads, as a transcript shows them (#1101 cat 9, 10):
 * a "Started thread X" row, and one card per message that names its peer as a link.
 */
import type {
	CanonicalEvent,
	ThreadLink as Linked,
} from "@prismalens/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { markLook } from "@/components/kit/marks";
import { Status } from "@/components/kit/Status";
import { Surface } from "@/components/kit/Surface";
import { TOOL_LINE } from "@/components/kit/ToolLine";
import { useCancelInvestigation } from "@/lib/api/hooks/use-investigations-orpc";
import { useThreadLinks } from "@/lib/api/hooks/use-thread-tree-orpc";
import { formatClock } from "@/lib/format-time";
import { cn } from "@/lib/utils";
import { stopReasons } from "@/registry/closed/stop-reason";
import { linkStates } from "./link-states";

type Ev<K extends CanonicalEvent["kind"]> = Extract<
	CanonicalEvent,
	{ kind: K }
>;

const LINK =
	"text-text-1 underline decoration-hairline underline-offset-[3px] hover:decoration-current";

const idOf = (link: string, fallback: string) =>
	link.split("?")[0]?.split("/").pop() || fallback;

function ThreadLink({ id, children }: { id: string; children: string }) {
	return (
		<Link to="/threads/$id" params={{ id }} className={LINK}>
			{children}
		</Link>
	);
}

/** "Started thread X" (sheet §2): one flat line with the started thread's status mark. */
export function ThreadStartedCard({ event }: { event: Ev<"thread_started"> }) {
	const navigate = useNavigate();
	const cancel = useCancelInvestigation();
	const links = useThreadLinks(event.runId);
	const started: Linked | undefined = links.data?.started.find(
		(l) => l.id === event.childId,
	);
	const mark = markLook("startedBy");
	return (
		<Surface
			id="child.card"
			ctx={{
				href: `${window.location.origin}/threads/${event.childId}`,
				open: () =>
					void navigate({ to: "/threads/$id", params: { id: event.childId } }),
				stop: () => cancel.mutate({ id: event.childId }),
				facts: { is: { running: started?.state === "running" } },
			}}
		>
			<p
				className={cn(TOOL_LINE, "hover:text-text-2")}
				data-testid="tree-started"
			>
				<mark.icon
					aria-hidden
					className={cn("size-3.5 shrink-0 stroke-[1.75]", mark.className)}
				/>
				<span className="shrink-0">Started thread</span>
				<span className="min-w-0 truncate">
					<ThreadLink id={event.childId}>
						{started?.title ?? event.title}
					</ThreadLink>
				</span>
				<span className="flex-1" />
				{started && (
					<span className="shrink-0 text-meta" data-testid="child-state">
						<Status
							kind={started.status ?? linkStates.get(started.state).status}
						/>
					</span>
				)}
			</p>
		</Surface>
	);
}

const CLAMP_CHARS = 280;

/**
 * A message between threads (sheet §2, no fill): a header line naming the peer as a link
 * and the time, then the text under a 2 px bar that clamps and expands. Received reads
 * at full strength; sent reads quieter. Past the pair cap it is held, with its mark.
 */
/**
 * PrismaLens's own notice that threads this one started stopped without finishing
 * (amendment 2026-11-13): one quiet row per stop, its mark and words from `stopReasons`.
 */
export function ThreadsStoppedCard({
	event,
}: {
	event: Ev<"threads_stopped">;
}) {
	return (
		<ul
			className="m-0 flex min-w-0 list-none flex-col gap-0.5 p-0"
			data-testid="threads-stopped"
		>
			{event.stops.map((s, i) => {
				const reason = stopReasons.get(s.reason);
				return (
					<li
						key={`${s.threadId}-${s.reason}`}
						className="flex min-w-0 items-center gap-1.5 text-meta text-text-2"
						data-reason={s.reason}
					>
						<Status kind={reason.status} showWord={false} />
						<span className="min-w-0 truncate">
							<ThreadLink id={s.threadId}>
								{s.title?.trim() || "A thread you started"}
							</ThreadLink>
							{` stopped: ${reason.how}`}
						</span>
						{i === 0 && (
							<span className="ml-auto shrink-0 tabular-nums text-text-3">
								{formatClock(event.ts)}
							</span>
						)}
					</li>
				);
			})}
		</ul>
	);
}

export function ThreadMessageCard({ event }: { event: Ev<"thread_message"> }) {
	const [open, setOpen] = useState(false);
	const sent = event.direction === "sent";
	const Icon = sent ? ArrowUpRight : ArrowDownLeft;
	const peerId = idOf(event.peerLink, event.peerId);
	const peerName = event.peerTitle ?? event.peerRole ?? "a thread";
	const body = event.text;
	const long = body.length > CLAMP_CHARS || body.includes("\n");
	const held = event.held === true;
	return (
		<div
			className="flex min-w-0 flex-col gap-1"
			data-testid="tree-message"
			data-direction={event.direction}
			data-held={held || undefined}
		>
			<p
				className={cn(
					"flex min-h-7 min-w-0 items-center gap-1.5 text-meta",
					sent ? "text-text-3" : "text-text-2",
				)}
			>
				<Icon aria-hidden className="size-3.5 shrink-0" />
				<span className="min-w-0 truncate">
					{sent ? "Messaged" : "From"}{" "}
					{/^[0-9a-f-]{36}$/i.test(peerId) ? (
						<ThreadLink id={peerId}>{peerName}</ThreadLink>
					) : (
						peerName
					)}
					{event.mode === "steer" ? " · steered" : ""}
				</span>
				<span className="ml-auto shrink-0 tabular-nums">
					{formatClock(event.ts)}
				</span>
			</p>
			{body && (
				<div
					className={cn(
						"relative ml-1.5 flex min-w-0 flex-col gap-1 pl-3.5 before:absolute before:inset-y-0.5 before:left-0 before:w-0.5 before:rounded-full",
						sent ? "before:bg-surface-3" : "before:bg-surface-4",
					)}
				>
					<p
						className={cn(
							"text-body whitespace-pre-wrap [overflow-wrap:anywhere]",
							sent || held ? "text-text-2" : "text-text-1",
							!open && "line-clamp-3",
						)}
					>
						{body}
					</p>
					{long && (
						<button
							type="button"
							onClick={() => setOpen((o) => !o)}
							aria-expanded={open}
							className="min-h-6 self-start text-meta text-text-2 hover:text-text-1"
							data-testid="tree-message-expand"
						>
							{open ? "Show less" : "Show all"}
						</button>
					)}
				</div>
			)}
			{held && <PairCapNotice direction={event.direction} />}
		</div>
	);
}

/** The pair cap stopped a message loop: its notice, under the first message it held (#1101 cat 10). */
function PairCapNotice({
	direction,
}: {
	direction: "sent" | "received";
}): ReactNode {
	const look = markLook("pairCap", direction);
	return (
		<p
			role="status"
			className="flex min-w-0 items-start gap-1.5 py-1 text-meta text-text-2"
			data-testid="message-held"
		>
			<look.icon
				aria-hidden
				className={cn("mt-px size-3.5 shrink-0 stroke-[1.75]", look.className)}
			/>
			<span className="min-w-0">
				<span className="font-medium text-text-1">{look.label}.</span>{" "}
				{look.word}
			</span>
		</p>
	);
}
