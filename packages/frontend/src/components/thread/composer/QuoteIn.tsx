// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { FileText, MessageSquare, SquarePen } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Problem } from "@/components/shared/State";
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
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { useThreadFeed } from "@/lib/api/hooks/use-threads-orpc";
import { cn } from "@/lib/utils";
import { holdForThread, openThreadAt, type QuoteChip } from "./quote";

export interface PickableThread {
	id: string;
	title: string;
	kind: string;
}

/** The picker's list: New thread, then threads; the gallery draws it from fixtures. */
export function QuotePicker({
	threads,
	loading,
	failed = false,
	onRetry,
	query,
	onQuery,
	onNew,
	onPick,
}: {
	threads: readonly PickableThread[];
	loading: boolean;
	/** The thread list did not load: New thread stays, and Retry asks again. */
	failed?: boolean;
	onRetry?: () => void;
	query: string;
	onQuery: (q: string) => void;
	onNew: () => void;
	onPick: (t: PickableThread) => void;
}) {
	return (
		<Command shouldFilter={false}>
			<CommandInput
				autoFocus
				value={query}
				onValueChange={onQuery}
				placeholder="Find a thread"
				data-testid="quote-in-input"
			/>
			<CommandList className="max-h-[360px]">
				<CommandEmpty>{loading ? "Loading threads" : "No thread"}</CommandEmpty>
				{failed && (
					<Problem
						text="Threads did not load."
						onRetry={onRetry}
						className="px-3"
					/>
				)}
				<CommandGroup>
					<CommandItem
						value="new-thread"
						onSelect={onNew}
						data-testid="quote-in-new"
					>
						<SquarePen aria-hidden />
						New thread
					</CommandItem>
				</CommandGroup>
				{threads.length > 0 && (
					<CommandGroup heading="Threads">
						{threads.map((t) => {
							const Icon =
								t.kind === "investigation" ? FileText : MessageSquare;
							return (
								<CommandItem
									key={t.id}
									value={t.id}
									onSelect={() => onPick(t)}
									data-testid="quote-in-thread"
									data-thread={t.id}
								>
									<Icon aria-hidden />
									<span className="truncate">{t.title}</span>
								</CommandItem>
							);
						})}
					</CommandGroup>
				)}
			</CommandList>
		</Command>
	);
}

/**
 * "Quote in another thread" (#1195): pick any thread, or a new one. The chip waits for that
 * thread's box, so quotes from several threads gather in one box before it is opened.
 */
export function QuoteIn({
	chip,
	from,
	onNewThread,
	onClose,
}: {
	chip: QuoteChip | null;
	/** The open thread: left out, since Quote puts a chip in its own box. */
	from: string;
	onNewThread: (q: QuoteChip) => void;
	onClose: () => void;
}) {
	const [query, setQuery] = useState("");
	const typed = useDeferredValue(query.trim());
	const feed = useThreadFeed(
		{ ...(typed ? { search: typed } : {}), limit: 30 },
		!!chip,
	);
	const threads = (feed.data?.pages.flatMap((p) => p.units) ?? [])
		.flatMap((u) => u.threads)
		.filter((t) => !t.archivedAt && t.id !== from)
		.slice(0, 30)
		.map((t) => ({
			id: t.id,
			title: t.title?.trim() || "Thread",
			kind: t.kind,
		}));
	const pick = (t: PickableThread) => {
		if (!chip) return;
		holdForThread(t.id, chip);
		onClose();
		toast({
			title: `Quoted in ${t.title}`,
			action: (
				<ToastAction
					altText={`Open ${t.title}`}
					onClick={() => openThreadAt(t.id)}
					data-testid="quote-in-open"
				>
					Open
				</ToastAction>
			),
		});
	};
	return (
		<Dialog open={!!chip} onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				fit
				className={cn(DIALOG_WIDTH.lg, "gap-0 p-0 sm:max-w-[520px]")}
				data-testid="quote-in"
			>
				<DialogTitle className="sr-only">Quote in another thread</DialogTitle>
				<QuotePicker
					threads={threads}
					loading={feed.isPending}
					failed={feed.isError}
					onRetry={() => void feed.refetch()}
					query={query}
					onQuery={setQuery}
					onNew={() => {
						if (chip) onNewThread(chip);
						onClose();
					}}
					onPick={pick}
				/>
			</DialogContent>
		</Dialog>
	);
}
