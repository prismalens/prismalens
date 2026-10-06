// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Vercel AI Elements' Conversation (registry.ai-sdk.dev/conversation.json),
 * owned and restyled to the system (decision 14): a log that follows the tail
 * until the reader scrolls up, then offers its way back.
 */
import { ArrowDown } from "lucide-react";
import type { ComponentProps } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { cn } from "@/lib/utils";

function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => {
	const motion = prefersReducedMotion() ? "instant" : "smooth";
	return (
		<StickToBottom
			className={cn("relative min-h-0 flex-1 overflow-y-hidden", className)}
			initial="instant"
			resize={motion}
			role="log"
			{...props}
		/>
	);
};

export type ConversationContentProps = ComponentProps<
	typeof StickToBottom.Content
>;

export const ConversationContent = ({
	className,
	...props
}: ConversationContentProps) => (
	<StickToBottom.Content
		className={cn("flex flex-col", className)}
		{...props}
	/>
);

/** Shown only when the reader has scrolled away from the newest message. */
export const ConversationScrollButton = ({
	className,
}: {
	className?: string;
}) => {
	const { isAtBottom, scrollToBottom } = useStickToBottomContext();
	if (isAtBottom) return null;
	return (
		<button
			type="button"
			onClick={() => scrollToBottom()}
			className={cn(
				"floating absolute bottom-3 left-1/2 inline-flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-full px-3 text-meta text-text-1 hover:bg-surface-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200",
				className,
			)}
			data-testid="transcript-new-messages"
		>
			New messages
			<ArrowDown className="size-3.5" />
		</button>
	);
};
