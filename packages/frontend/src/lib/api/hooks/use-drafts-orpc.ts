// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ComposerScope } from "@prismalens/contracts";
import { type QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/** The scope's saved draft, read once per mount: the box owns it after that. */
export function useServerDraft(
	scope: ComposerScope | null,
	client?: QueryClient,
) {
	return useQuery(
		{
			...orpc.drafts.get.queryOptions({
				input: { scope: (scope ?? "new:home") as ComposerScope },
			}),
			enabled: !!scope,
			staleTime: Number.POSITIVE_INFINITY,
			refetchOnWindowFocus: false,
			retry: false,
		},
		client,
	);
}

export function useSaveDraft(client?: QueryClient) {
	return useMutation(orpc.drafts.put.mutationOptions(), client);
}

export function useDeleteDraft() {
	return useMutation(orpc.drafts.delete.mutationOptions());
}

/** The draft's uploaded files: name, type, size and whether each was a folded paste. */
export function useDraftAttachments(
	scope: ComposerScope | null,
	ids: string[],
) {
	return useQuery({
		...orpc.drafts.attachments.queryOptions({
			input: { scope: (scope ?? "new:home") as ComposerScope },
		}),
		enabled: !!scope && ids.length > 0,
		staleTime: Number.POSITIVE_INFINITY,
	});
}
