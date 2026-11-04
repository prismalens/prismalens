// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createFileRoute } from "@tanstack/react-router";
import { ProjectList } from "@/components/projects/ProjectList";

export const Route = createFileRoute("/_authenticated/projects/")({
	component: ProjectList,
});
