// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { markLook } from "@/components/kit/marks";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { useNow } from "@/hooks/use-now";
import { reconnectNow, useStreamStatus } from "@/lib/api/live-refresh";
import {
	connectionWord,
	type ConnectionWord as Word,
} from "@/lib/connection-word";
import { cn } from "@/lib/utils";

/** The phone header's live connection, read from the app's one change stream. */
export function ConnectionWord() {
	const status = useStreamStatus();
	const now = useNow(1_000);
	if (now === null) return <span className="min-w-0 flex-1" />;
	const online = typeof navigator === "undefined" || navigator.onLine;
	return <ConnectionWordView word={connectionWord(status, now, online)} />;
}

/** The word, and on a tap why and Retry now; the gallery draws it from fixtures. */
export function ConnectionWordView({
	word,
	defaultOpen,
}: {
	word: Word;
	defaultOpen?: boolean;
}) {
	// The word always shows beside its mark; Connected reads quiet (#1101 bar 5.1).
	const look = markLook("connection", word.state);
	return (
		<Popover defaultOpen={defaultOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className={cn(
						"flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-control px-2 text-left text-meta hover:bg-surface-2",
						word.state === "connected" ? "text-text-3" : "text-text-1",
					)}
					aria-label={`Connection: ${word.word}`}
					data-testid="phone-connection"
					data-state={word.state}
				>
					<look.icon
						aria-hidden
						className={cn("size-3.5 shrink-0 stroke-[1.75]", look.className)}
					/>
					<span className="truncate">{word.word}</span>
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="flex w-64 flex-col gap-2">
				<p className="text-body text-text-1">{word.word}</p>
				<p className="text-meta text-text-2" data-testid="phone-connection-why">
					{word.reason ?? "Changes arrive as they happen."}
				</p>
				{word.asOf && <p className="text-meta text-text-3">{word.asOf}</p>}
				{word.state !== "connected" && (
					<Button
						variant="secondary"
						className="min-h-11 self-start"
						onClick={reconnectNow}
					>
						Retry now
					</Button>
				)}
			</PopoverContent>
		</Popover>
	);
}
