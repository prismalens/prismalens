// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { client, orpc } from "@/lib/api/orpc-client";
import { desktopBridge } from "@/lib/desktop";

/** A pick: the folder, a cancel (nothing changes), or this computer cannot open a dialog. */
export type FolderPick =
	| { status: "picked"; path: string }
	| { status: "cancelled" }
	| { status: "unavailable" };

export interface FolderPicker {
	/** The desktop app picks in its own window; there the in-page folder list stays hidden. */
	desktop: boolean;
	/** Offered only to the host's own viewer with a dialog on this computer. */
	available: boolean;
	pick: () => Promise<FolderPick>;
}

/**
 * The one seat for choosing a folder with the computer's own dialog (#1216): the desktop
 * app's bridge when it has one, else the local API, which opens the dialog on the host.
 * `host` is whether the viewer may ask at all; the API refuses anyone else.
 */
export function useFolderPicker(host: boolean): FolderPicker {
	const bridge = desktopBridge()?.pickFolder;
	const [refused, setRefused] = useState(false);
	const asked = useQuery({
		...orpc.repositories.pickFolderAvailable.queryOptions({ input: {} }),
		enabled: host && !bridge,
		staleTime: 60_000,
		retry: false,
	});
	const available =
		!refused && host && (bridge ? true : asked.data?.available === true);
	const pick = async (): Promise<FolderPick> => {
		// A refusal (403) or a dead API ends the offer rather than showing an error.
		const answer = await (bridge
			? bridge().then(fromBridge)
			: client.repositories.pickFolder({})
		).catch((): FolderPick => ({ status: "unavailable" }));
		if (answer.status === "unavailable") setRefused(true);
		return answer;
	};
	return { desktop: !!bridge, available, pick };
}

function fromBridge(
	got: { path: string } | { path: null } | { unavailable: true },
): FolderPick {
	if ("unavailable" in got) return { status: "unavailable" };
	return got.path
		? { status: "picked", path: got.path }
		: { status: "cancelled" };
}
