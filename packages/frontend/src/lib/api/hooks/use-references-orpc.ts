// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReferenceSearchInput } from "@prismalens/contracts";
import {
	QueryClient,
	QueryClientContext,
	useMutation,
	useQuery,
} from "@tanstack/react-query";
import { useContext, useEffect, useState } from "react";
import { orpc } from "../orpc-client";

let fallback: QueryClient | null = null;

/**
 * The page's query client, or the composer's own where a page renders the box without
 * one (a dialog in a test harness); the box never needs its host to provide it.
 */
export function useComposerClient(): QueryClient {
	const client = useContext(QueryClientContext);
	if (client) return client;
	fallback ??= new QueryClient();
	return fallback;
}

/** Typing settles this long before the search runs. */
const SEARCH_DEBOUNCE_MS = 120;

function useDebounced<T>(value: T, ms: number): T {
	const [v, setV] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setV(value), ms);
		return () => clearTimeout(t);
	}, [value, ms]);
	return v;
}

/** The `/`, `@` and `#` menu's one search (#1024); off while no trigger is open. */
export function useReferenceSearch(
	input: Partial<ReferenceSearchInput> | null,
	client?: QueryClient,
) {
	const settled = useDebounced(input, SEARCH_DEBOUNCE_MS);
	return useQuery(
		{
			...orpc.references.search.queryOptions({
				input: (settled ?? { q: "" }) as ReferenceSearchInput,
			}),
			enabled: !!settled && !!input,
			staleTime: 10_000,
			// Keep the last rows while the same trigger narrows, never another trigger's.
			placeholderData: (prev, last) =>
				(last?.queryKey[1] as { input?: { trigger?: string } } | undefined)
					?.input?.trigger === settled?.trigger
					? prev
					: undefined,
		},
		client,
	);
}

/** A picked hit ranks higher next time. */
export function useReferenceUse(client?: QueryClient) {
	return useMutation(orpc.references.use.mutationOptions(), client);
}

/** Pasted links a connected source recognises, as hits (#1024). */
export function useResolveLinks(client?: QueryClient) {
	return useMutation(orpc.references.resolve.mutationOptions(), client);
}
