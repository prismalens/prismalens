// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { orpc } from "@/lib/api/orpc-client";
import {
	currentRemaps,
	onRemaps,
	setRemaps,
	shortcutRows,
} from "@/lib/shortcuts";

/** Loads the server's remaps into the registry; mounted once by the authenticated layout. */
export function useShortcutRemapsLoader(): void {
	const { data } = useQuery(
		orpc.settings.shortcuts.get.queryOptions({ input: {} }),
	);
	useEffect(() => {
		if (data) setRemaps(data.keys);
	}, [data]);
}

/** The registry's rows, re-read whenever a remap lands. */
export function useShortcutRows() {
	const remaps = useSyncExternalStore(onRemaps, currentRemaps, currentRemaps);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the rows read the remaps through the registry.
	return useMemo(() => shortcutRows(), [remaps]);
}

/** Remap one shortcut, or `null` to put its default back; the whole map is saved. */
export function useRemapShortcut() {
	const queryClient = useQueryClient();
	const key = orpc.settings.shortcuts.get.queryKey({ input: {} });
	return useMutation({
		mutationFn: async ({ id, keys }: { id: string; keys: string | null }) => {
			const next: Record<string, string> = { ...currentRemaps() };
			if (keys === null) delete next[id];
			else next[id] = keys;
			return orpc.settings.shortcuts.update.call({ keys: next });
		},
		onSuccess: (saved) => {
			queryClient.setQueryData(key, saved);
			setRemaps(saved.keys);
		},
	});
}
