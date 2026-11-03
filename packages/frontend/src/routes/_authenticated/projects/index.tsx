// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createFileRoute } from "@tanstack/react-router";
import { ProjectList } from "@/components/projects/ProjectList";

/** `?add=1` opens Add project (#1020): the sidebar and the palette land here. */
export const Route = createFileRoute("/_authenticated/projects/")({
	validateSearch: (search: Record<string, unknown>): { add?: true } => ({
		add: [true, 1, "1", "true"].includes(search.add as never) || undefined,
	}),
	component: function ProjectsRoute() {
		return <ProjectList add={!!Route.useSearch().add} />;
	},
});
