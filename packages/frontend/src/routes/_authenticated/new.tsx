// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { SEVERITY_LABEL, type Severity } from "@prismalens/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import type { NewThreadSearch } from "@/components/home/HomeComposer";
import { HomeStandIn } from "@/components/home/HomeStandIn";
import { usePageTitle } from "@/hooks/use-page-title";
import { orpc } from "@/lib/api/orpc-client";
import { markFirstContent } from "@/lib/first-paint";
import { lazyPart } from "@/lib/lazy";

/** Home's first frame is the stand-in; the pickers and the composer load after it (#1101 category 12). */
const HomeComposer = lazyPart(
	() => import("@/components/home/HomeComposer").then((m) => m.HomeComposer),
	<HomeStandIn />,
);

const id = (v: unknown) =>
	typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined;
const yes = (v: unknown) => v === true || v === "true" || undefined;

/** Home's choices from the URL (#1020); `?incident=true` opens it with Incident on. */
export function validateNewSearch(
	search: Record<string, unknown>,
): NewThreadSearch {
	return {
		project: id(search.project),
		service: id(search.service),
		none: yes(search.none),
		incident: yes(search.incident),
		severity: severityOf(search.severity),
		note: yes(search.note),
		draft: id(search.draft),
	};
}

/** A severity from the address; a list check keeps the schema library off the first paint. */
function severityOf(v: unknown): Severity | undefined {
	return typeof v === "string" && Object.hasOwn(SEVERITY_LABEL, v)
		? (v as Severity)
		: undefined;
}

/** New: the Home box at any time, not only on a workspace with no incidents. */
export const Route = createFileRoute("/_authenticated/new")({
	validateSearch: validateNewSearch,
	// The composer's agents, default and subjects start with the route, not after its code
	// lands: they wait for the stand-in's paint, then go first in the lane (#1130).
	loader: ({ context: { queryClient: q } }) => {
		const harnesses = orpc.settings.harnesses;
		void q.prefetchQuery(harnesses.getHarnesses.queryOptions({ input: {} }));
		void q.prefetchQuery(harnesses.getSettings.queryOptions({ input: {} }));
		void q.prefetchQuery(
			orpc.services.list.queryOptions({ input: { limit: 100 } }),
		);
		void q.prefetchQuery(
			orpc.repositories.list.queryOptions({ input: { limit: 100 } }),
		);
	},
	component: NewThread,
});

function NewThread() {
	usePageTitle("New");
	// Home's box is its first content: the calls it held back go out now.
	useEffect(() => markFirstContent(), []);
	const navigate = useNavigate();
	return (
		<div
			className="flex h-full min-h-0 flex-col overflow-y-auto"
			data-testid="new-thread-page"
		>
			<HomeComposer
				search={Route.useSearch()}
				onSearch={(next) =>
					void navigate({
						to: "/new",
						search: (prev: NewThreadSearch) => ({ ...prev, ...next }),
						replace: true,
					})
				}
			/>
		</div>
	);
}
