// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createFileRoute, redirect } from "@tanstack/react-router";

/** The sidebar is the thread list, so the Threads page is gone (#1101 pattern sheet §1). */
export const Route = createFileRoute("/_authenticated/threads/")({
	beforeLoad: () => {
		throw redirect({ to: "/new", replace: true });
	},
});
