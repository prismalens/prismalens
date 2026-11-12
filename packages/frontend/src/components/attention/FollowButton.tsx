// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { Bell, BellOff, BellRing, Check } from "lucide-react";
import { Hint } from "@/components/shared/Hint";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { orpc } from "@/lib/api/orpc-client";
import { useFollowThread } from "@/lib/attention/use-attention";
import { cn } from "@/lib/utils";

const LABEL = {
	watch: "Notifying when it finishes",
	mute: "Muted",
	none: "Notifications",
} as const;

/**
 * A thread's own notification choice (#1101 category 4 item 7): notify when this
 * running thread finishes, or mute it. Applies on every device.
 */
export function FollowButton({
	threadId,
	running,
}: {
	threadId: string;
	running: boolean;
}) {
	const view = useQuery(
		orpc.attention.threads.queryOptions({ input: { ids: [threadId] } }),
	);
	const follow = view.data?.[0]?.follow ?? null;
	const set = useFollowThread();
	const choose = (next: "watch" | "mute") =>
		set.mutate(
			{ id: threadId, follow: follow === next ? null : next },
			{ onSettled: () => void view.refetch() },
		);
	const Icon =
		follow === "watch" ? BellRing : follow === "mute" ? BellOff : Bell;
	const label = LABEL[follow ?? "none"];
	return (
		<DropdownMenu>
			<Hint label={label}>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						aria-label={label}
						className={cn(
							"flex size-7 shrink-0 items-center justify-center rounded-control bg-surface-2 transition-colors duration-(--dur-instant) hover:bg-surface-3",
							follow === "watch" ? "text-accent" : "text-text-2",
						)}
						data-testid="thread-follow"
						data-follow={follow ?? "none"}
					>
						<Icon className="size-4" aria-hidden />
					</button>
				</DropdownMenuTrigger>
			</Hint>
			<DropdownMenuContent align="end">
				<DropdownMenuItem
					disabled={!running && follow !== "watch"}
					onSelect={() => choose("watch")}
					data-testid="follow-watch"
				>
					<Check
						className={cn("size-4", follow === "watch" ? "" : "invisible")}
						aria-hidden
					/>
					{running || follow === "watch"
						? "Notify me when this finishes"
						: "Notify when finished: not running"}
				</DropdownMenuItem>
				<DropdownMenuItem
					onSelect={() => choose("mute")}
					data-testid="follow-mute"
				>
					<Check
						className={cn("size-4", follow === "mute" ? "" : "invisible")}
						aria-hidden
					/>
					Mute this thread
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
