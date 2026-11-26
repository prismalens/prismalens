// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/** What loads into each agent, and the one PrismaLens set beside its own (#1180 §3.1-§3.3). */
import type { AgentLoadoutInput, SharedSet } from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

export const agentSetupKeys = {
	all: () => orpc.settings.agentSetup.key(),
	sharedSet: () => orpc.settings.agentSetup.sharedSet.queryKey({ input: {} }),
};

/** One agent's loadout for a project and profile; fetched only while `enabled`, never polled. */
export function useAgentLoadout(input: AgentLoadoutInput, enabled: boolean) {
	return useQuery({
		...orpc.settings.agentSetup.loadout.queryOptions({ input }),
		enabled,
	});
}

export function useSharedSet(enabled = true) {
	return useQuery({
		...orpc.settings.agentSetup.sharedSet.queryOptions({ input: {} }),
		enabled,
	});
}

/** User-scope MCP servers in installed agents' own config a share can start from. */
export function useSharedSources(enabled = true) {
	return useQuery({
		...orpc.settings.agentSetup.sharedSources.queryOptions({ input: {} }),
		enabled,
	});
}

/**
 * Every set change answers with the whole set; a loadout may change with it. A set read already
 * under way is cancelled first, so its older list never lands over this one.
 */
function useSetChange() {
	const queryClient = useQueryClient();
	return async (set: SharedSet) => {
		const queryKey = agentSetupKeys.sharedSet();
		await queryClient.cancelQueries({ queryKey });
		queryClient.setQueryData(queryKey, set);
		void queryClient.invalidateQueries({ queryKey });
		void queryClient.invalidateQueries({
			queryKey: orpc.settings.agentSetup.loadout.key(),
		});
	};
}

export function useUpdateSharedSet() {
	const onSet = useSetChange();
	return useMutation({
		...orpc.settings.agentSetup.updateSharedSet.mutationOptions(),
		onSuccess: onSet,
	});
}

export function useApproveSharedServer() {
	const onSet = useSetChange();
	return useMutation({
		...orpc.settings.agentSetup.approveSharedServer.mutationOptions(),
		onSuccess: onSet,
	});
}

export function useRemoveSharedServer() {
	const onSet = useSetChange();
	return useMutation({
		...orpc.settings.agentSetup.removeSharedServer.mutationOptions(),
		onSuccess: onSet,
	});
}

/** `agent.useSharedSet`: one agent in or out of every server and the instructions. */
export function useSetSharedMembership() {
	const onSet = useSetChange();
	return useMutation({
		...orpc.settings.agentSetup.setSharedMembership.mutationOptions(),
		onSuccess: onSet,
	});
}

/** A source with every argument and the URL path masked; reads, saves nothing. */
export function usePreviewSharedServer() {
	return useMutation({
		...orpc.settings.agentSetup.previewSharedServer.mutationOptions(),
		meta: { notASave: true },
	});
}

/** One argument or the URL path, when the person presses that row's Reveal. */
export function useRevealSharedServerRow() {
	return useMutation({
		...orpc.settings.agentSetup.revealSharedServerRow.mutationOptions(),
		meta: { notASave: true },
	});
}
