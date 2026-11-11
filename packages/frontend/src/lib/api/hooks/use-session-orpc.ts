// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/** Compact a finished thread's session with its agent's own command (#1024). */
export function useCompactSession(id: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (instructions?: string) =>
			orpc.investigations.compact.call({
				id,
				...(instructions?.trim() ? { instructions: instructions.trim() } : {}),
			}),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: orpc.investigations.key() }),
	});
}

/** Resume after a usage limit, or not; `message` is the draft sent when it resets. */
export function useSetAutoResume(id: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { on: boolean; message?: string }) =>
			orpc.investigations.setAutoResume.call({ id, ...input }),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: orpc.investigations.key() }),
	});
}
