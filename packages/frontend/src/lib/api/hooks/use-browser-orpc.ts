// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	BrowserInput,
	BrowserOwner,
	BrowserStreamEvent,
	BrowserTab,
} from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { client, orpc } from "../orpc-client";

/** The engine and this thread's tabs in the host browser (#1061); refreshed while the pane shows. */
export function useBrowserStatus(threadId: string) {
	return useQuery({
		...orpc.browser.status.queryOptions({ input: { id: threadId } }),
		refetchInterval: 3_000,
	});
}

export interface BrowserView {
	frame: { data: string; width: number; height: number } | null;
	tab: BrowserTab | null;
	flash: { x: number; y: number; width: number; height: number } | null;
	closed: boolean;
}

/** One tab's live frames and state; the server streams only while this is mounted. */
export function useBrowserStream(
	threadId: string,
	tabId: string | null,
): BrowserView {
	const queryClient = useQueryClient();
	const [view, setView] = useState<BrowserView>({
		frame: null,
		tab: null,
		flash: null,
		closed: false,
	});
	useEffect(() => {
		setView({ frame: null, tab: null, flash: null, closed: false });
		if (!tabId) return;
		const controller = new AbortController();
		let flashTimer: ReturnType<typeof setTimeout> | undefined;
		void (async () => {
			try {
				const stream = await client.browser.stream(
					{ id: threadId, tab: tabId },
					{ signal: controller.signal },
				);
				for await (const e of stream as AsyncIterable<BrowserStreamEvent>) {
					if (e.kind === "frame") setView((v) => ({ ...v, frame: e }));
					else if (e.kind === "tab") {
						setView((v) => ({ ...v, tab: e.tab }));
						void queryClient.invalidateQueries({
							queryKey: orpc.browser.status.key(),
						});
					} else if (e.kind === "flash") {
						clearTimeout(flashTimer);
						setView((v) => ({ ...v, flash: e.box }));
						flashTimer = setTimeout(
							() => setView((v) => ({ ...v, flash: null })),
							1_000,
						);
					} else {
						setView((v) => ({ ...v, closed: true }));
						void queryClient.invalidateQueries({
							queryKey: orpc.browser.status.key(),
						});
					}
				}
			} catch {
				// Closed, refused or aborted: the status query shows what is left.
			}
		})();
		return () => {
			controller.abort();
			clearTimeout(flashTimer);
		};
	}, [threadId, tabId, queryClient]);
	return view;
}

export function useBrowserActions(threadId: string) {
	const queryClient = useQueryClient();
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: orpc.browser.status.key() });
	const open = useMutation({
		mutationFn: (url: string) => client.browser.open({ id: threadId, url }),
		onSuccess: refresh,
	});
	const navigate = useMutation({
		mutationFn: (v: { tab: string; to: string }) =>
			client.browser.navigate({ id: threadId, ...v }),
		onSuccess: refresh,
	});
	const control = useMutation({
		mutationFn: (v: { tab: string; to: BrowserOwner }) =>
			client.browser.control({ id: threadId, ...v }),
		onSuccess: refresh,
	});
	const close = useMutation({
		mutationFn: (tab: string) => client.browser.close({ id: threadId, tab }),
		onSuccess: refresh,
	});
	const input = (tab: string, i: BrowserInput) =>
		void client.browser.input({ id: threadId, tab, input: i }).catch(() => {});
	return { open, navigate, control, close, input };
}

/** Agent → "Agents can use the browser"; on by default (#1061). */
export function useBrowserSettings() {
	return useQuery(orpc.browser.getSettings.queryOptions({ input: {} }));
}

export function useUpdateBrowserSettings() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (agentBrowser: boolean) =>
			client.browser.setSettings({ agentBrowser }),
		onSuccess: (saved) => {
			queryClient.setQueryData(
				orpc.browser.getSettings.queryKey({ input: {} }),
				saved,
			);
			void queryClient.invalidateQueries({
				queryKey: orpc.browser.status.key(),
			});
		},
	});
}
