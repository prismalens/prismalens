// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import { CornerLeftUp, GitFork } from "lucide-react";
import { Hint } from "@/components/shared/Hint";
import { useThreadTree } from "@/lib/api/hooks/use-thread-tree-orpc";

/** A child thread's way back to the thread that started it (#1101 bar 10, item 2). */
export function ParentLink({ threadId }: { threadId: string }) {
	const tree = useThreadTree(threadId);
	const nodes = tree.data?.nodes ?? [];
	const self = nodes.find((n) => n.id === threadId);
	const parent = self?.parentId
		? nodes.find((n) => n.id === self.parentId)
		: undefined;
	if (!parent) return null;
	return (
		<ParentLinkView
			id={parent.id}
			title={parent.title}
			fork={self?.role === "fork"}
		/>
	);
}

/** The crumb itself: an icon and the parent's title; a phone keeps the icon. */
export function ParentLinkView({
	id,
	title,
	fork = false,
}: {
	id: string;
	title: string | null;
	/** Forked by the user rather than started by an agent. */
	fork?: boolean;
}) {
	const name = title?.trim() || "Parent thread";
	const Icon = fork ? GitFork : CornerLeftUp;
	return (
		<Hint label={`${fork ? "Forked from" : "Started from"} ${name}`}>
			<Link
				to="/threads/$id"
				params={{ id }}
				aria-label={`${fork ? "Forked from" : "Started from"} ${name}`}
				className="inline-flex max-w-[30%] shrink items-center gap-1 rounded-control px-1 py-0.5 text-meta text-text-3 outline-none hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent max-sm:max-w-none max-sm:shrink-0"
				data-testid="thread-parent"
			>
				<Icon className="size-3.5 shrink-0" aria-hidden />
				<span className="min-w-0 truncate max-sm:hidden">{name}</span>
			</Link>
		</Hint>
	);
}
