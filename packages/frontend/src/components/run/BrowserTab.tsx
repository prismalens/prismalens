// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ArrowLeft,
	ArrowRight,
	ExternalLink,
	Globe,
	RotateCw,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	type DesktopBrowser,
	type DesktopBrowserState,
	desktopBridge,
} from "@/lib/desktop";
import type { RunLink } from "@/lib/run-links";

// The native view paints above the page; it steps aside while any of these is open over it.
const OVER =
	"[role=dialog][data-state=open], [role=alertdialog], [role=menu], [role=listbox], [data-radix-popper-content-wrapper], [data-float=toast]";

/**
 * The Browser tab (#973). In the desktop app, a real page in a view of its
 * own beside the app; in a browser or on a phone, the run's links, each
 * opening in a new tab (operator ruling: desktop only).
 */
export function BrowserTab({ links }: { links: RunLink[] }) {
	const browser = desktopBridge()?.browser;
	return browser ? (
		<DesktopBrowserView browser={browser} links={links} />
	) : (
		<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pt-3 pb-5">
			<p className="font-semibold text-text-1">Pages open in your browser</p>
			<p className="text-text-2">
				The built-in browser is part of the desktop app. Here, each link opens
				in a new tab.
			</p>
			<LinkList
				links={links}
				action={(l) => (
					<a
						href={l.url}
						target="_blank"
						rel="noreferrer noopener"
						className="inline-flex h-7 items-center gap-1.5 rounded-control bg-surface-3 px-2.5 text-meta text-text-1 hover:bg-surface-4"
						aria-label={`Open ${l.label} in a new tab`}
					>
						<ExternalLink className="size-3.5" aria-hidden />
						New tab
					</a>
				)}
			/>
		</div>
	);
}

function LinkList({
	links,
	action,
}: {
	links: RunLink[];
	action: (l: RunLink) => React.ReactNode;
}) {
	if (links.length === 0)
		return (
			<p className="text-text-2" data-testid="browser-no-links">
				This run's alerts and report link no pages.
			</p>
		);
	return (
		<ul
			aria-label="Pages this run links"
			className="m-0 list-none rounded-surface bg-surface-2 p-1"
			data-testid="browser-links"
		>
			{links.map((l) => (
				<li
					key={l.url}
					className="flex items-center gap-2.5 rounded-control px-2.5 py-2"
				>
					<Globe className="size-4 shrink-0 text-text-3" aria-hidden />
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="truncate text-text-1">{l.label}</span>
						<span className="truncate text-meta text-text-3">{l.url}</span>
					</span>
					{action(l)}
				</li>
			))}
		</ul>
	);
}

function DesktopBrowserView({
	browser,
	links,
}: {
	browser: DesktopBrowser;
	links: RunLink[];
}) {
	const [state, setState] = useState<DesktopBrowserState | null>(null);
	// The address shows where the view is; a refused address is named in the note instead (#977 OBJ-007).
	const [address, setAddress] = useState("");
	const slot = useRef<HTMLDivElement>(null);
	const page = state?.url && state.url !== "about:blank" ? state.url : null;

	// Ask where the view is on mount: switching tabs remounts this (#977 OBJ-006).
	useEffect(() => {
		const off = browser.onState((s) => {
			setState(s);
			if (s) setAddress(s.url);
		});
		browser.go("state");
		return off;
	}, [browser]);

	// Lay the native view over the slot; hide it when the slot is gone, empty, or covered.
	useEffect(() => {
		const el = slot.current;
		if (!el || !page) {
			browser.setBounds(null);
			return;
		}
		let frame = 0;
		const place = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const covered = Array.from(document.querySelectorAll(OVER)).some(
					(o) => !o.contains(el),
				);
				const r = el.getBoundingClientRect();
				browser.setBounds(
					covered || r.width < 1 || r.height < 1
						? null
						: { x: r.left, y: r.top, width: r.width, height: r.height },
				);
			});
		};
		place();
		const ro = new ResizeObserver(place);
		ro.observe(el);
		const mo = new MutationObserver(place);
		mo.observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["data-state", "role"],
		});
		window.addEventListener("resize", place);
		return () => {
			cancelAnimationFrame(frame);
			ro.disconnect();
			mo.disconnect();
			window.removeEventListener("resize", place);
			browser.setBounds(null);
		};
	}, [browser, page]);

	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (address.trim()) browser.open(address.trim());
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="browser-tab">
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
					disabled={!state?.canGoBack}
					onClick={() => browser.go("back")}
				>
					<ArrowLeft className="size-4" />
				</Button>
				<Button
					type="button"
					variant="text"
					size="icon"
					aria-label="Forward"
					disabled={!state?.canGoForward}
					onClick={() => browser.go("forward")}
				>
					<ArrowRight className="size-4" />
				</Button>
				<Button
					type="button"
					variant="text"
					size="icon"
					aria-label="Reload"
					disabled={!page}
					onClick={() => browser.go("reload")}
				>
					<RotateCw className="size-4" />
				</Button>
				<input
					value={address}
					onChange={(e) => setAddress(e.target.value)}
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
					aria-label="Open in your browser"
					disabled={!page}
					onClick={() => browser.go("external")}
				>
					<ExternalLink className="size-4" />
				</Button>
			</form>
			<p className="shrink-0 px-3 pb-1.5 text-meta text-text-3">
				{state?.refused
					? `Not opened: ${state.refused}. PrismaLens opens only http and https pages here.`
					: "Separate session: not signed in to PrismaLens, and nothing is kept after you close the app."}
			</p>
			{page ? (
				<div
					ref={slot}
					className="mx-2 mb-2 min-h-0 flex-1 rounded-surface bg-surface-2"
					data-testid="browser-slot"
				/>
			) : (
				<div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5">
					<LinkList
						links={links}
						action={(l) => (
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={() => browser.open(l.url)}
							>
								Open here
							</Button>
						)}
					/>
				</div>
			)}
		</div>
	);
}
