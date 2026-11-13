// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createFileRoute } from "@tanstack/react-router";
import { panelSearchOf } from "@/components/thread/panel/panel-model";
import { ThreadPage } from "@/components/thread/ThreadPage";
import { threadLanding } from "@/components/thread/thread-landing";
import { orpc } from "@/lib/api/orpc-client";
import { prefetchWindow } from "@/lib/thread-window/prefetch";

/** A project, service or no-subject thread's own page (#1020). */
export const Route = createFileRoute("/_authenticated/threads/$id")({
	// `find` and `at` open find on a palette message hit (#1101 category 19 item 4).
	validateSearch: (s: Record<string, unknown>) => ({
		...panelSearchOf(s),
		...(typeof s.find === "string" && s.find ? { find: s.find } : {}),
		...(typeof s.at === "string" && s.at ? { at: s.at } : {}),
		// `ask` lands on that ask's card at the box: phone Home's rows link here.
		...(typeof s.ask === "string" && s.ask ? { ask: s.ask } : {}),
	}),
	// The record and the transcript's first page start as the route matches, beside its code,
	// so neither waits in series behind the other (#1101 category 12). Never awaited.
	loader: ({ params, context }) => {
		void context.queryClient.prefetchQuery(
			orpc.investigations.get.queryOptions({ input: { id: params.id } }),
		);
		prefetchWindow(params.id, threadLanding());
	},
	component: function ThreadRoute() {
		const { id } = Route.useParams();
		return <ThreadPage key={id} id={id} />;
	},
});
