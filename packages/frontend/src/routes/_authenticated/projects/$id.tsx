// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createFileRoute } from "@tanstack/react-router";
import { ProjectPage } from "@/components/projects/ProjectPage";

export const Route = createFileRoute("/_authenticated/projects/$id")({
	component: function ProjectRoute() {
		const { id } = Route.useParams();
		return <ProjectPage key={id} id={id} />;
	},
});
