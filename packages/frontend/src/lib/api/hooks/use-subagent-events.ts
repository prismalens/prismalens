// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/** One sub-agent's stored steps, read when the loaded window holds none of them (#1176 D16). */
export function useSubagentEvents(
	id: string,
	sessionId: string,
	enabled = true,
) {
	return useQuery({
		...orpc.investigations.subagentEvents.queryOptions({
			input: { id, sessionId },
		}),
		enabled: enabled && !!id && !!sessionId,
	});
}
