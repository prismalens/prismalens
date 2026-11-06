// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createFileRoute, redirect } from "@tanstack/react-router";
import { validateNewSearch } from "../new";

/** New thread lives on Home (`/new`); this address stays for links, choices kept (#1020). */
export const Route = createFileRoute("/_authenticated/threads/new")({
	validateSearch: validateNewSearch,
	beforeLoad: ({ search }) => {
		throw redirect({ to: "/new", search, replace: true });
	},
});
