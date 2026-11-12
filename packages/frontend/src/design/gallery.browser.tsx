// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { BrowserTab, PendingAsk } from "@prismalens/contracts";
import { AskDock } from "@/components/thread/composer/AskDock";
import { LiveView } from "@/components/thread/panel/HostBrowserPane";
import { PaneUnavailable } from "@/components/thread/panel/NewTabPage";
import type { GallerySection } from "./gallery";

const noop = () => {};
const box = "flex flex-col gap-2 rounded-pool bg-surface-1 p-2";
const frameBox = "flex h-[420px] flex-col gap-2 rounded-pool bg-surface-1 p-2";

const TAB: BrowserTab = {
	id: "t1",
	threadId: "t-browser",
	url: "https://grafana.example.com/d/checkout?from=now-1h",
	title: "Checkout latency",
	loading: false,
	owner: "agent",
	generation: 0,
	acting: 'Clicked "Save note"',
};

const PAGE = [
	'<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" font-family="sans-serif">',
	'<rect width="1280" height="800" fill="#f7f7f8"/><rect width="1280" height="64" fill="#1f2430"/>',
	'<text x="32" y="40" fill="#fff" font-size="22">Checkout latency</text>',
	'<rect x="32" y="96" width="1216" height="320" rx="8" fill="#fff" stroke="#e3e3e8"/>',
	'<polyline fill="none" stroke="#3b82f6" stroke-width="4" points="60,380 200,360 340,370 480,300 620,220 760,160 900,170 1040,150 1200,140"/>',
	'<text x="56" y="132" fill="#555" font-size="18">p99, ms</text>',
	'<text x="64" y="452" fill="#333" font-size="18">Note</text>',
	'<rect x="120" y="430" width="420" height="36" rx="6" fill="#fff" stroke="#c9c9d1"/>',
	'<text x="132" y="454" fill="#333" font-size="16">Rolled back checkout to v412</text>',
	'<rect x="64" y="480" width="150" height="40" rx="6" fill="#3b82f6"/>',
	'<text x="100" y="506" fill="#fff" font-size="16">Save note</text>',
	"</svg>",
].join("");

/** A page drawn in SVG, standing in for a screencast frame. */
const FRAME = {
	src: `data:image/svg+xml;utf8,${encodeURIComponent(PAGE)}`,
	width: 1280,
	height: 800,
};

const OPTIONS = [
	{ optionId: "allow", name: "Allow once", kind: "allow_once" as const },
	{ optionId: "deny", name: "Deny", kind: "reject_once" as const },
];

const card = (over: Partial<PendingAsk>): PendingAsk => ({
	askId: crypto.randomUUID(),
	threadId: "t-browser",
	kind: "permission",
	requiresHost: true,
	source: { kind: "tool", tool: "pl_browser_act", requestId: "r" },
	title: "",
	openedAt: "2026-11-12T10:00:00.000Z",
	...over,
});

const ASKS: PendingAsk[] = [
	card({
		title: "Submit a form on grafana.example.com?",
		detail: "Sends POST https://grafana.example.com/api/annotations",
		permission: {
			toolKind: "act",
			input: [
				"POST https://grafana.example.com/api/annotations",
				"",
				"{",
				' "text": "Rolled back checkout to v412",',
				' "csrf": "[hidden]"',
				"}",
			].join("\n"),
			options: OPTIONS,
		},
	}),
	card({
		source: { kind: "tool", tool: "pl_browser_open", requestId: "r2" },
		title: "Let the agent use the browser?",
		detail:
			"It wants to open https://grafana.example.com/d/checkout. It can read pages you are signed in to.",
		permission: { toolKind: "act", options: OPTIONS },
	}),
];

/** The host browser's states (#1061): who drives, the host-only view, and its cards. */
export const browserGallery: GallerySection[] = [
	{
		id: "browser",
		title:
			"Browser pane: the agent drives, the user has control, and its cards",
		render: () => (
			<div className="grid max-w-[1040px] gap-3 md:grid-cols-2">
				<div className={frameBox} data-testid="gallery-browser-agent">
					<LiveView
						tab={TAB}
						frame={FRAME}
						flash={{ x: 64, y: 480, width: 150, height: 40 }}
						onControl={noop}
						onInput={noop}
					/>
				</div>
				<div className={frameBox} data-testid="gallery-browser-human">
					<LiveView
						tab={{ ...TAB, owner: "human", acting: null, generation: 1 }}
						frame={FRAME}
						flash={null}
						onControl={noop}
						onInput={noop}
					/>
				</div>
				<div className={box}>
					<PaneUnavailable
						title="Only the host can watch"
						why="The browser may be signed in to your accounts, so its pages show only on the computer running PrismaLens."
						testId="gallery-browser-host-only"
					/>
				</div>
				<div className={box} data-testid="gallery-browser-asks">
					<AskDock asks={ASKS} threadId="t-browser" agent="Claude Code" />
				</div>
			</div>
		),
	},
];
