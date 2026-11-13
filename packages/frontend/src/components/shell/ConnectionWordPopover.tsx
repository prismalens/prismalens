// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { reconnectNow } from "@/lib/api/live-refresh";
import type { ConnectionWord as Word } from "@/lib/connection-word";

/** Why the link reads as it does, and Retry now: the word's popover. */
export function ConnectionWordPopover({
	word,
	trigger,
}: {
	word: Word;
	trigger: ReactNode;
}) {
	return (
		<Popover defaultOpen>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
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
