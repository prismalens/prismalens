// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { SeveritySchema } from "@prismalens/contracts";
import { createFileRoute } from "@tanstack/react-router";
import {
	NewThreadPage,
	type NewThreadSearch,
} from "@/components/thread/NewThreadPage";

const id = (v: unknown) =>
	typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined;

/** New thread (#1020); `?incident=true` opens it with Incident on. */
export const Route = createFileRoute("/_authenticated/threads/new")({
	validateSearch: (search: Record<string, unknown>): NewThreadSearch => ({
		project: id(search.project),
		service: id(search.service),
		incident:
			search.incident === true || search.incident === "true" || undefined,
		severity: SeveritySchema.safeParse(search.severity).data,
		note: search.note === true || search.note === "true" || undefined,
	}),
	component: function NewThreadRoute() {
		return <NewThreadPage search={Route.useSearch()} />;
	},
});
