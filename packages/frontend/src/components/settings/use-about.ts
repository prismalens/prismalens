// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/api/orpc-client";

/** This copy's version and update state; the sidebar reads it without loading Settings' code. */
export function useAbout(enabled = true) {
	return useQuery({
		...orpc.settings.about.get.queryOptions(),
		enabled,
		staleTime: 60 * 60 * 1000,
	});
}
