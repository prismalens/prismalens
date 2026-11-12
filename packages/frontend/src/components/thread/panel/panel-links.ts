// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LinkTarget } from "@prismalens/contracts";
import { desktopBridge } from "@/lib/desktop";
import { isLocalUrl } from "@/lib/link-candidates";
import type { PanelSearch } from "./panel-model";

/** Where a resolved link goes (#1024): a panel tab, a page, a view or a new tab. */
export type LinkPlace =
	| { to: "panel"; search: PanelSearch }
	| { to: "thread"; id: string }
	| { to: "incident"; id: string }
	| { to: "subagent"; sessionId: string }
	| { to: "artifact"; id: string }
	| { to: "browser"; href: string }
	| { to: "tab"; href: string };

/** The desktop app's own view takes this machine's pages, and a page the agent served. */
export function placeOf(target: LinkTarget, desktop: boolean): LinkPlace {
	switch (target.type) {
		case "file":
			// A cited file opens in the Files tab at its line; Show changes moves to the diff (#1101 category 21).
			return {
				to: "panel",
				search: {
					panel: "files",
					path: `${target.repo}:${target.path}`,
					...(target.line ? { line: target.line } : {}),
				},
			};
		case "diff":
			return { to: "panel", search: { panel: "changes" } };
		case "pull_request":
			return {
				to: "panel",
				search: {
					panel: "thread",
					section: `pull-requests:${target.pullRequest.id}`,
				},
			};
		case "thread":
			return { to: "thread", id: target.id };
		case "incident":
			return { to: "incident", id: target.id };
		case "subagent":
			return { to: "subagent", sessionId: target.sessionId };
		case "artifact":
			return { to: "artifact", id: target.id };
		case "url":
			return desktop && isLocalUrl(target.href)
				? { to: "browser", href: target.href }
				: { to: "tab", href: target.href };
	}
}

/** The address a Ctrl or Cmd click opens in a new tab. */
export function hrefOf(target: LinkTarget, threadPath: string): string {
	const place = placeOf(target, false);
	switch (place.to) {
		case "panel": {
			const q = new URLSearchParams(
				Object.entries(place.search).map(([k, v]) => [k, String(v)]),
			);
			return `${threadPath}?${q}`;
		}
		case "thread":
			return `/threads/${place.id}`;
		case "incident":
			return `/incidents/${place.id}`;
		case "browser":
		case "tab":
			return place.href;
		default:
			return threadPath;
	}
}

/** True in the desktop app with its own browser view. */
export const hasDesktopBrowser = () => !!desktopBridge()?.browser;
