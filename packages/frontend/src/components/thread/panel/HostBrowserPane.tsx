// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	BrowserInput,
	BrowserOwner,
	BrowserTab,
} from "@prismalens/contracts";
import {
	ChevronLeft,
	ChevronRight,
	ExternalLink,
	RotateCw,
	X,
} from "lucide-react";
import {
	type FormEvent,
	type KeyboardEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { Status, Tabs } from "@/components/kit";
import { BrowserTab as DesktopBrowserTab } from "@/components/run/BrowserTab";
import { Button } from "@/components/ui/button";
import {
	useBrowserActions,
	useBrowserStatus,
	useBrowserStream,
} from "@/lib/api/hooks/use-browser-orpc";
import { desktopBridge } from "@/lib/desktop";
import { PaneUnavailable } from "./NewTabPage";

/** Keys the frame forwards as presses; printable text goes as typed text. */
const KEYS = new Set([
	"Enter",
	"Tab",
	"Backspace",
	"Delete",
	"Escape",
	// The four arrow keys.
	...["Up", "Down", "Left", "Right"].map((d) => `Arrow${d}`),
	"Home",
	"End",
	"PageUp",
	"PageDown",
]);

/** The thread's browser: the host's, or the desktop's own view when the host has no engine. */
export function ThreadBrowser({ threadId }: { threadId: string }) {
	const status = useBrowserStatus(threadId);
	if (status.data?.engine === "missing" && desktopBridge()?.browser)
		return <DesktopBrowserTab links={[]} />;
	return <HostBrowserPane threadId={threadId} />;
}

/**
 * The host browser beside a thread (#1061): the live page, its address, and who
 * drives it. The agent's tabs say so in one strip, with Take control; any click
 * or key in the frame takes control too.
 */
export function HostBrowserPane({ threadId }: { threadId: string }) {
	const status = useBrowserStatus(threadId);
	const actions = useBrowserActions(threadId);
	const tabs = status.data?.tabs ?? [];
	const [picked, setPicked] = useState<string | null>(null);
	const current =
		tabs.find((t) => t.id === picked) ?? tabs[tabs.length - 1] ?? null;

	if (status.data && !status.data.canDrive)
		return (
			<PaneUnavailable
				title="Only the host can watch"
				why="The browser may be signed in to your accounts, so its pages show only on the computer running PrismaLens."
				testId="browser-host-only"
			/>
		);
	if (status.data?.engine === "missing")
		return (
			<PaneUnavailable
				title="No browser engine found"
				why="PrismaLens drives Chromium, Chrome or Edge on this computer, and found none. Install one, for example with npx playwright-core install chromium, then open this pane again."
				testId="browser-missing"
			/>
		);
	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="host-browser">
			{tabs.length > 1 && (
				<div className="flex shrink-0 items-center px-2 pt-1">
					<Tabs
						label="Browser tabs"
						value={current?.id ?? ""}
						onValueChange={setPicked}
						items={tabs.map((t) => ({
							value: t.id,
							label: shortTitle(t),
							testId: `browser-tab-${t.id}`,
						}))}
					/>
				</div>
			)}
			<AddressBar
				tab={current}
				onOpen={(url) =>
					current
						? actions.navigate.mutate({ tab: current.id, to: url })
						: actions.open.mutate(url, { onSuccess: (t) => setPicked(t.id) })
				}
				onGo={(to) =>
					current && actions.navigate.mutate({ tab: current.id, to })
				}
				onClose={() => current && actions.close.mutate(current.id)}
			/>
			{current ? (
				<Live threadId={threadId} tab={current} actions={actions} />
			) : (
				<p
					className="px-3 pt-3 text-meta text-text-3"
					data-testid="browser-empty"
				>
					No pages open
				</p>
			)}
		</div>
	);
}

const shortTitle = (t: BrowserTab) => {
	const text = t.title || t.url.replace(/^https?:\/\//, "") || "New tab";
	return text.length > 24 ? `${text.slice(0, 23)}…` : text;
};

function AddressBar({
	tab,
	onOpen,
	onGo,
	onClose,
}: {
	tab: BrowserTab | null;
	onOpen: (url: string) => void;
	onGo: (to: "back" | "forward" | "reload") => void;
	onClose: () => void;
}) {
	const [address, setAddress] = useState(tab?.url ?? "");
	const editing = useRef(false);
	useEffect(() => {
		if (!editing.current) setAddress(tab?.url ?? "");
	}, [tab?.url]);
	const submit = (e: FormEvent) => {
		e.preventDefault();
		editing.current = false;
		if (address.trim()) onOpen(address.trim());
	};
	return (
		<form
			onSubmit={submit}
			className="flex shrink-0 items-center gap-1 px-2 pt-2 pb-1"
			aria-label="Address"
		>
			<Button
				type="button"
				variant="text"
				size="icon"
				aria-label="Back"
				disabled={!tab}
				onClick={() => onGo("back")}
			>
				<ChevronLeft className="size-4" />
			</Button>
			<Button
				type="button"
				variant="text"
				size="icon"
				aria-label="Forward"
				disabled={!tab}
				onClick={() => onGo("forward")}
			>
				<ChevronRight className="size-4" />
			</Button>
			<Button
				type="button"
				variant="text"
				size="icon"
				aria-label="Reload"
				disabled={!tab}
				onClick={() => onGo("reload")}
			>
				<RotateCw className="size-4" />
			</Button>
			<input
				value={address}
				onChange={(e) => {
					editing.current = true;
					setAddress(e.target.value);
				}}
				onBlur={() => {
					editing.current = false;
				}}
				aria-label="Address"
				placeholder="Address"
				spellCheck={false}
				className="h-7 min-w-0 flex-1 rounded-control bg-surface-2 px-2.5 font-mono text-mono text-text-1 outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"
				data-testid="browser-address"
			/>
			<Button
				type="button"
				variant="text"
				size="icon"
				aria-label="Open in a new tab"
				disabled={!tab?.url}
				onClick={() => tab?.url && window.open(tab.url, "_blank", "noreferrer")}
			>
				<ExternalLink className="size-4" />
			</Button>
			<Button
				type="button"
				variant="text"
				size="icon"
				aria-label="Close tab"
				disabled={!tab}
				onClick={onClose}
			>
				<X className="size-4" />
			</Button>
		</form>
	);
}

function Live({
	threadId,
	tab,
	actions,
}: {
	threadId: string;
	tab: BrowserTab;
	actions: ReturnType<typeof useBrowserActions>;
}) {
	const view = useBrowserStream(threadId, tab.id);
	return (
		<LiveView
			// The stream and the status poll both report the tab; the later generation wins.
			tab={view.tab && view.tab.generation >= tab.generation ? view.tab : tab}
			frame={
				view.frame
					? {
							src: `data:image/jpeg;base64,${view.frame.data}`,
							width: view.frame.width,
							height: view.frame.height,
						}
					: null
			}
			flash={view.flash}
			onControl={(to) => actions.control.mutate({ tab: tab.id, to })}
			onInput={(i) => actions.input(tab.id, i)}
		/>
	);
}

/** One tab as the user sees it: who drives, and the live frame; from props only, for the gallery too. */
export function LiveView({
	tab,
	frame,
	flash,
	onControl,
	onInput,
}: {
	tab: BrowserTab;
	frame: { src: string; width: number; height: number } | null;
	flash: { x: number; y: number; width: number; height: number } | null;
	onControl: (to: BrowserOwner) => void;
	onInput: (input: BrowserInput) => void;
}) {
	const live = tab;
	const view = { frame, flash };
	const actions = { input: (_tab: string, i: BrowserInput) => onInput(i) };
	const img = useRef<HTMLImageElement>(null);
	const agent = live.owner === "agent";

	/** The frame's CSS pixels under a pointer on the scaled image. */
	const at = (clientX: number, clientY: number) => {
		const el = img.current;
		if (!el || !view.frame) return null;
		const r = el.getBoundingClientRect();
		return {
			x: Math.max(0, ((clientX - r.left) / r.width) * view.frame.width),
			y: Math.max(0, ((clientY - r.top) / r.height) * view.frame.height),
		};
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (KEYS.has(e.key)) actions.input(tab.id, { kind: "key", key: e.key });
		else if (e.key.length === 1)
			actions.input(tab.id, { kind: "text", text: e.key });
		else return;
		e.preventDefault();
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div
				className="mx-2 mb-1 flex shrink-0 items-center gap-2 rounded-control bg-surface-2 px-2.5 py-1.5 text-meta"
				data-testid="browser-control-strip"
				data-owner={live.owner}
			>
				{agent ? (
					<>
						<Status kind="working" word="Agent is using this tab" />
						{live.acting && (
							<span
								className="min-w-0 flex-1 truncate text-text-3"
								data-testid="browser-acting"
							>
								{live.acting}
							</span>
						)}
						<Button
							variant="text"
							size="sm"
							className="ml-auto"
							onClick={() => onControl("human")}
							data-testid="browser-take-control"
						>
							Take control
						</Button>
					</>
				) : (
					<>
						<span className="font-medium text-text-2">You have control</span>
						<Button
							variant="text"
							size="sm"
							className="ml-auto"
							onClick={() => onControl("agent")}
							data-testid="browser-hand-back"
						>
							Hand back
						</Button>
					</>
				)}
			</div>
			<div className="relative mx-2 mb-2 min-h-0 flex-1 overflow-hidden rounded-surface bg-surface-2">
				{view.frame ? (
					<div
						// biome-ignore lint/a11y/noNoninteractiveTabindex: the frame takes the user's keys, as a page does.
						tabIndex={0}
						role="application"
						aria-label={`Page: ${live.title || live.url}`}
						className="relative h-full w-full outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"
						onKeyDown={onKey}
						data-testid="browser-frame"
					>
						<img
							ref={img}
							src={view.frame.src}
							alt=""
							draggable={false}
							className="h-full w-full select-none object-contain object-top"
							onClick={(e) => {
								const p = at(e.clientX, e.clientY);
								if (p)
									actions.input(tab.id, {
										kind: "click",
										...p,
										clicks: e.detail > 1 ? 2 : 1,
									});
							}}
							onWheel={(e) => {
								const p = at(e.clientX, e.clientY);
								if (p)
									actions.input(tab.id, {
										kind: "wheel",
										...p,
										dx: e.deltaX,
										dy: e.deltaY,
									});
							}}
						/>
						{view.flash && (
							<Flash box={view.flash} frame={view.frame} img={img.current} />
						)}
					</div>
				) : (
					<p className="p-3 text-meta text-text-3">Loading the page</p>
				)}
			</div>
		</div>
	);
}

/** The element the agent acts on, outlined for a second over the scaled frame. */
function Flash({
	box,
	frame,
	img,
}: {
	box: { x: number; y: number; width: number; height: number };
	frame: { width: number; height: number };
	img: HTMLImageElement | null;
}) {
	if (!img) return null;
	// object-contain, top-aligned: the frame is scaled by the smaller ratio and centred across.
	const scale = Math.min(
		img.clientWidth / frame.width,
		img.clientHeight / frame.height,
	);
	const left = (img.clientWidth - frame.width * scale) / 2;
	return (
		<span
			aria-hidden
			className="pointer-events-none absolute rounded-control shadow-[0_0_0_2px_var(--accent)]"
			style={{
				left: left + box.x * scale,
				top: box.y * scale,
				width: box.width * scale,
				height: box.height * scale,
			}}
			data-testid="browser-flash"
		/>
	);
}
