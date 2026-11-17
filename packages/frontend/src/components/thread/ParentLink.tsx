// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { StartedByVia } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { startedByLabel } from "@/components/kit/MarkBadges";
import { MARKS } from "@/components/kit/marks";
import { Hint } from "@/components/shared/Hint";
import { useThreadLinks } from "@/lib/api/hooks/use-thread-tree-orpc";

/** The header's started-by mark: a click opens the thread that started this one (#1101 cat 10). */
export function ParentLink({ threadId }: { threadId: string }) {
	const links = useThreadLinks(threadId);
	const by = links.data?.startedBy;
	if (!by) return null;
	return <ParentLinkView id={by.id} title={by.title} via={by.via} />;
}

/** The mark itself: the started-by icon and the starter's title; a phone keeps the icon. */
export function ParentLinkView({
	id,
	title,
	fork = false,
	via,
}: {
	id: string;
	title: string | null;
	/** Forked by a person rather than started by an agent. */
	fork?: boolean;
	/** How it was started; anything but `agent` is a person's start (#1176). */
	via?: StartedByVia;
}) {
	const by: { title: string; via: StartedByVia } = {
		title: title?.trim() || "a thread",
		via: via ?? (fork ? "fork" : "agent"),
	};
	const label = startedByLabel(by);
	const Icon = MARKS.startedBy.icons[by.via];
	return (
		<Hint label={label}>
			<Link
				to="/threads/$id"
				params={{ id }}
				aria-label={label}
				className="inline-flex max-w-[30%] shrink items-center gap-1 rounded-control px-1 py-0.5 text-meta text-text-3 outline-none hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent max-sm:max-w-none max-sm:shrink-0"
				data-testid="thread-parent"
				data-via={by.via}
			>
				<Icon className="size-3.5 shrink-0" aria-hidden />
				<span className="min-w-0 truncate max-sm:hidden">{by.title}</span>
			</Link>
		</Hint>
	);
}
