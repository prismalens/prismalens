// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createFileRoute } from "@tanstack/react-router";
import { HomeComposer } from "@/components/home/HomeComposer";
import { usePageTitle } from "@/hooks/use-page-title";

/** New: the Home box at any time, not only on a workspace with no incidents. */
export const Route = createFileRoute("/_authenticated/new")({
	component: NewThread,
});

function NewThread() {
	usePageTitle("New");
	return (
		<div className="flex h-full min-h-0 flex-col overflow-y-auto">
			<HomeComposer />
		</div>
	);
}
