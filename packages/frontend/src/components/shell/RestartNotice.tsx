// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { FLOAT_CARDS_ID } from "@/components/ui/toaster";
import { PHONE, useMediaQuery } from "@/hooks/use-media-query";
import { useRestartSummary } from "@/lib/api/hooks";
import {
	restartNoticeView,
	SEEN_KEY,
	SIDEBAR_NOTICES_ID,
	shouldShowRestartNotice,
} from "@/lib/restart-notice";
import { cn } from "@/lib/utils";

function readSeen(): string | null {
	try {
		return localStorage.getItem(SEEN_KEY);
	} catch {
		return null;
	}
}

/** How long the notice stays when nobody points at it or focuses it. */
export const RESTART_NOTICE_MS = 12_000;

// One showing per device: marked seen the moment it first shows, and the
// timer survives remounts and route changes (#1101 cat 23).
let session: { at: string; until: number } | null = null;

/**
 * What the last start did with the runs a stop cut off (#981): once per
 * device, within an hour of the start. In the sidebar on a wide screen, a
 * corner card otherwise, a banner on a phone; it closes itself unless held.
 */
export function RestartNotice({
	inline = false,
	skip = false,
}: {
	/** In a page's own flow (Home), so no floating card covers its rows (#1101 cat 3). */
	inline?: boolean;
	/** The page shows its own inline copy. */
	skip?: boolean;
}) {
	const { data } = useRestartSummary();
	const phone = useMediaQuery(PHONE);
	const [now] = useState(() => Date.now());
	const [shown, setShown] = useState(false);
	const [held, setHeld] = useState(false);
	const [slot, setSlot] = useState<HTMLElement | null>(null);
	useEffect(() => {
		const side = document.getElementById(SIDEBAR_NOTICES_ID);
		// The slot is display:none where the sidebar is folded or narrow.
		setSlot(
			side && side.getClientRects().length > 0
				? side
				: document.getElementById(FLOAT_CARDS_ID),
		);
	}, []);
	const at = data?.at;
	useEffect(() => {
		if (skip || !data) return setShown(false);
		if (shouldShowRestartNotice(data, readSeen(), now)) {
			session = { at: data.at, until: Date.now() + RESTART_NOTICE_MS };
			try {
				localStorage.setItem(SEEN_KEY, data.at);
			} catch {
				// A device that cannot store it sees the notice again on the next load.
			}
		}
		// The same tests as a first showing, the device's record aside.
		setShown(
			session?.at === data.at &&
				Date.now() < session.until &&
				shouldShowRestartNotice(data, null, now),
		);
	}, [data, skip, now]);
	const dismiss = () => {
		if (session && session.at === at) session.until = 0;
		setShown(false);
	};
	const dismissRef = useRef(dismiss);
	dismissRef.current = dismiss;
	useEffect(() => {
		if (!shown || held || !session) return;
		const left = Math.max(0, session.until - Date.now());
		const t = window.setTimeout(() => dismissRef.current(), left);
		return () => window.clearTimeout(t);
	}, [shown, held]);
	const holdOn = () => setHeld(true);
	const holdOff = () => {
		if (session) session.until = Math.max(session.until, Date.now() + 3_000);
		setHeld(false);
	};
	if (!shown || !data) return null;
	const view = restartNoticeView(data, now);
	const hold = {
		onPointerEnter: holdOn,
		onPointerLeave: holdOff,
		onFocus: holdOn,
		onBlur: holdOff,
	};
	const inSidebar = !phone && !inline && slot?.id === SIDEBAR_NOTICES_ID;
	const open = view.open && (
		<Button
			variant="secondary"
			asChild
			className="self-start"
			data-testid="restart-notice-open"
		>
			{view.open.incidentId ? (
				<Link
					to="/incidents/$id/conversation"
					params={{ id: view.open.incidentId }}
					search={{ investigation: view.open.investigationId }}
					onClick={dismiss}
				>
					{view.open.label}
				</Link>
			) : (
				<Link
					to="/investigations/$id"
					params={{ id: view.open.investigationId }}
					onClick={dismiss}
				>
					{view.open.label}
				</Link>
			)}
		</Button>
	);
	const close = (
		<Button
			variant="text"
			size="icon"
			onClick={dismiss}
			aria-label="Dismiss"
			className="shrink-0"
			data-testid="restart-notice-dismiss"
		>
			<X aria-hidden />
		</Button>
	);
	if (phone || inline || inSidebar) {
		const banner = (
			<div
				role="status"
				className={cn(
					"floating flex gap-1 rounded-surface py-0.5 pl-3",
					inSidebar ? "mx-2 mb-1" : !inline && "mx-3 mt-2",
				)}
				data-testid="restart-notice"
				data-layout="banner"
				{...hold}
			>
				<div className="flex min-w-0 flex-1 flex-col gap-1.5 py-2 text-meta">
					<p>
						<span className="font-semibold">{view.title}.</span>{" "}
						<span className="text-text-2">
							{[phone ? null : view.gap, view.resumed, view.skipped]
								.filter(Boolean)
								.join(" ")}
						</span>
					</p>
					{open}
				</div>
				{close}
			</div>
		);
		return inSidebar && slot ? createPortal(banner, slot) : banner;
	}
	const card = (
		<div
			role="status"
			className={cn(
				"floating flex flex-col gap-2 rounded-surface py-3 pr-10 pl-3.5",
				slot
					? "relative w-full"
					: "fixed right-4 bottom-4 z-[90] w-[340px] max-w-[calc(100%-2rem)]",
			)}
			data-testid="restart-notice"
			data-layout="toast"
			{...hold}
		>
			<div className="absolute top-1 right-1">{close}</div>
			<h2 className="text-body font-semibold">{view.title}</h2>
			{view.gap && <p className="text-meta text-text-2">{view.gap}</p>}
			<ul className="flex flex-col gap-1 text-meta">
				{view.resumed && (
					<li className="flex items-center gap-2">
						<span
							aria-hidden
							className="size-[7px] shrink-0 rounded-full bg-live"
						/>
						{view.resumed}
					</li>
				)}
				{view.skipped && (
					<li className="flex items-center gap-2">
						<span
							aria-hidden
							className="size-[7px] shrink-0 rounded-full bg-warn"
						/>
						{view.skipped}
					</li>
				)}
			</ul>
			{open}
		</div>
	);
	// Toasts stack under it in the same corner (Toaster), so a Settled toast never covers it.
	return slot ? createPortal(card, slot) : card;
}
