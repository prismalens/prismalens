// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createFileRoute, redirect } from "@tanstack/react-router";

/** Schedules live in Settings, Scheduled prompts; this address stays for links (#1020). */
export const Route = createFileRoute("/_authenticated/schedules/")({
	beforeLoad: () => {
		throw redirect({ to: "/settings", search: { tab: "schedules" } });
	},
});
