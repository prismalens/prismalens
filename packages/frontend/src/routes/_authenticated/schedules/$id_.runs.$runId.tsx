// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * A thread a schedule started is a thread like any other, with its composer and menu
 * (#1101, threads are flat siblings); old links land on its thread page.
 */
export const Route = createFileRoute(
	"/_authenticated/schedules/$id_/runs/$runId",
)({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/threads/$id",
			params: { id: params.runId },
			replace: true,
		});
	},
});
