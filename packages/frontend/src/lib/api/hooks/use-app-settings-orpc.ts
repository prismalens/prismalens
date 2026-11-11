// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	DEFAULT_THREAD_CONTEXT_SETTINGS,
	THREAD_TREE_DEFAULTS,
	type ThreadContextSettings,
	type ThreadTreeSettings,
} from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";
import { useSourcesOverview } from "./use-sources-orpc";

/** The editors on this computer's PATH, for General → "Open files in". */
export function useEditors() {
	return useQuery({
		...orpc.settings.editors.list.queryOptions({ input: {} }),
		staleTime: 60_000,
	});
}

/** "Open files in" and "Show pull request status": one stored pair. */
export function useThreadContextSettings() {
	return useQuery(orpc.settings.threadContext.get.queryOptions({ input: {} }));
}

/** The route replaces both fields, so a change to one keeps the other as read. */
export function useUpdateThreadContextSettings() {
	const queryClient = useQueryClient();
	const key = orpc.settings.threadContext.get.queryKey({ input: {} });
	return useMutation({
		mutationFn: (patch: Partial<ThreadContextSettings>) =>
			orpc.settings.threadContext.update.call({
				...DEFAULT_THREAD_CONTEXT_SETTINGS,
				...queryClient.getQueryData<ThreadContextSettings>(key),
				...patch,
			}),
		onSuccess: (saved) => queryClient.setQueryData(key, saved),
	});
}

/** Agent → "Agents may start threads", and its caps. */
export function useTreeSettings() {
	return useQuery(orpc.threadTree.getSettings.queryOptions({ input: {} }));
}

export function useUpdateTreeSettings() {
	const queryClient = useQueryClient();
	const key = orpc.threadTree.getSettings.queryKey({ input: {} });
	return useMutation({
		mutationFn: (patch: Partial<ThreadTreeSettings>) =>
			orpc.threadTree.updateSettings.call({
				...THREAD_TREE_DEFAULTS,
				...queryClient.getQueryData<ThreadTreeSettings>(key),
				...patch,
			}),
		onSuccess: (saved) => queryClient.setQueryData(key, saved),
	});
}

/** Sources → "Images from the git host"; absent is on. */
export function useHostImages(): boolean {
	return useSourcesOverview().data?.hostImages !== false;
}

export function useSetHostImages() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.sources.setHostImages.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.sources.key() });
			queryClient.invalidateQueries({ queryKey: orpc.repositories.key() });
			queryClient.invalidateQueries({ queryKey: orpc.services.key() });
		},
	});
}

/** The git hosts PrismaLens knows, for Add project's source switch. */
export function useGitHosts(enabled = true) {
	return useQuery({
		...orpc.sources.gitHosts.queryOptions({ input: {} }),
		enabled,
		staleTime: 30_000,
	});
}

/** One host's repositories the resolved credential can see, most recently pushed first. */
export function useHostRepositories(host: string | null, search: string) {
	return useQuery({
		...orpc.sources.hostRepositories.queryOptions({
			input: { host: host ?? "", ...(search ? { search } : {}) },
		}),
		enabled: !!host,
		staleTime: 30_000,
		placeholderData: (prev) => prev,
	});
}
