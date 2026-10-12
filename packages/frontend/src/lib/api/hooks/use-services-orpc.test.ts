// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { afterServiceDelete, serviceKeys } from "./use-services-orpc";

describe("afterServiceDelete (#831 w6-5)", () => {
	it("marks a neighbour's topology and detail stale, not only the list", async () => {
		const queryClient = new QueryClient();
		const neighbour = "00000000-0000-4000-8000-000000000001";
		queryClient.setQueryData(serviceKeys.topology(neighbour), { downstream: 2 });
		queryClient.setQueryData(serviceKeys.detail(neighbour), { id: neighbour });

		await afterServiceDelete(queryClient);

		for (const key of [
			serviceKeys.topology(neighbour),
			serviceKeys.detail(neighbour),
		])
			expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
	});
});
