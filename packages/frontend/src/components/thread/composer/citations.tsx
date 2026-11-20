// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Citation } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	createContext,
	Fragment,
	type ReactNode,
	useContext,
	useMemo,
} from "react";
import { orpc } from "@/lib/api/orpc-client";

/** A thread's citations both ways (#1195); one request per thread, shared by its rows. */
export function useCitations(threadId: string | undefined) {
	return useQuery({
		...orpc.references.citations.queryOptions({
			input: { threadId: threadId ?? "" },
		}),
		enabled: !!threadId,
	});
}

const LINK =
	"text-text-2 underline decoration-hairline underline-offset-[3px] hover:text-text-1 hover:decoration-current focus-visible:outline-1 focus-visible:outline-accent";

const CitedInContext = createContext<{
	threadId: string | null;
	citedIn: readonly Citation[];
	cites: readonly Citation[];
}>({ threadId: null, citedIn: [], cites: [] });

/** The thread page's citations, read once for every row it draws. */
export function CitationsProvider({
	threadId,
	children,
}: {
	threadId: string;
	children: ReactNode;
}) {
	const data = useCitations(threadId).data;
	const citedIn = data?.citedIn ?? NONE;
	const cites = data?.cites ?? NONE;
	const value = useMemo(
		() => ({ threadId, citedIn, cites }),
		[threadId, citedIn, cites],
	);
	return (
		<CitedInContext.Provider value={value}>{children}</CitedInContext.Provider>
	);
}

const NONE: readonly Citation[] = [];

/** The thread the page shows, so a chip quoting any other one links to it. */
export const useCitingThread = () => useContext(CitedInContext).threadId;

/** The turn this thread's citation of another thread's message recorded, for a `#` chip. */
export function useCitedTurn(
	threadId: string,
	key: string,
): number | undefined {
	return useContext(CitedInContext).cites.find(
		(c) => c.threadId === threadId && c.key === key,
	)?.turn;
}

/** Under a message other threads cited: where, each a link to the citing thread. */
export function CitedIn({ eventKey }: { eventKey: string | null }) {
	const all = useContext(CitedInContext).citedIn;
	const by = eventKey ? all.filter((c) => c.key === eventKey) : [];
	return by.length ? <CitedInLine by={by} /> : null;
}

export function CitedInLine({
	by,
}: {
	by: readonly Pick<Citation, "threadId" | "title">[];
}) {
	return (
		<p className="mt-1 text-meta text-text-3" data-testid="transcript-cited-in">
			Cited in{" "}
			{by.map((c, i) => (
				<Fragment key={c.threadId}>
					{i > 0 && ", "}
					<Link to="/threads/$id" params={{ id: c.threadId }} className={LINK}>
						{c.title?.trim() || "a thread"}
					</Link>
				</Fragment>
			))}
		</p>
	);
}
