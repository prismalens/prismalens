// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect, useState } from "react";
import { Pressed } from "@/components/kit/Menu";
import { markLook } from "@/components/kit/marks";
import { useNow } from "@/hooks/use-now";
import { useStreamStatus } from "@/lib/api/live-refresh";
import {
	connectionWord,
	type ConnectionWord as Word,
} from "@/lib/connection-word";
import { onFirstContent } from "@/lib/first-paint";
import { lazyPart, whenIdle } from "@/lib/lazy";
import { cn } from "@/lib/utils";

// The word's popover loads when pressed (#1101 category 12).
const WordPopover = lazyPart(
	() => import("./ConnectionWordPopover").then((m) => m.ConnectionWordPopover),
	(p) => p.trigger,
	{ now: true },
);

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
	const [asked, setAsked] = useState(!!defaultOpen);
	// Cached after the first content, so a link that drops later still opens it.
	useEffect(
		() => onFirstContent(() => whenIdle(() => void WordPopover.preload())),
		[],
	);
	// The word always shows beside its mark; Connected reads quiet (#1101 bar 5.1).
	const look = markLook("connection", word.state);
	const trigger = (
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
	);
	if (!asked)
		return <Pressed onPress={() => setAsked(true)}>{trigger}</Pressed>;
	return <WordPopover word={word} trigger={trigger} />;
}
