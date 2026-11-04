// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createFileRoute } from "@tanstack/react-router";
import { ThreadPage } from "@/components/thread/ThreadPage";

/** A project, service or no-subject thread's own page (#1020). */
export const Route = createFileRoute("/_authenticated/threads/$id")({
	component: function ThreadRoute() {
		const { id } = Route.useParams();
		return <ThreadPage key={id} id={id} />;
	},
});
