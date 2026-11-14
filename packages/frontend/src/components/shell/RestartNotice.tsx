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

/**
 * What the last start did with the runs a stop cut off (#981): once per
 * device, within an hour of the start. A card bottom-right, a banner under
 * the header on a phone; it closes itself unless held by hover or focus.
 */
export function RestartNotice() {
	const { data } = useRestartSummary();
	const phone = useMediaQuery(PHONE);
	const [now] = useState(() => Date.now());
	const [seen, setSeen] = useState<string | null | undefined>(undefined);
	const [held, setHeld] = useState(false);
	const [corner, setCorner] = useState<HTMLElement | null>(null);
	useEffect(() => setCorner(document.getElementById(FLOAT_CARDS_ID)), []);
	useEffect(() => setSeen(readSeen()), []);
	const shown = seen !== undefined && shouldShowRestartNotice(data, seen, now);
	const at = data?.at;
	const dismiss = () => {
		if (!at) return;
		try {
			localStorage.setItem(SEEN_KEY, at);
		} catch {
			// A device that cannot store it sees the notice again on the next load.
		}
		setSeen(at);
	};
	const dismissRef = useRef(dismiss);
	dismissRef.current = dismiss;
	useEffect(() => {
		if (!shown || held) return;
		const t = window.setTimeout(() => dismissRef.current(), RESTART_NOTICE_MS);
		return () => window.clearTimeout(t);
	}, [shown, held]);
	if (seen === undefined || !shouldShowRestartNotice(data, seen, now))
		return null;
	const view = restartNoticeView(data, now);
	const hold = {
		onPointerEnter: () => setHeld(true),
		onPointerLeave: () => setHeld(false),
		onFocus: () => setHeld(true),
		onBlur: () => setHeld(false),
	};
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
	if (phone)
		return (
			<div
				role="status"
				className="floating mx-3 mt-2 flex gap-1 rounded-surface py-0.5 pl-3"
				data-testid="restart-notice"
				data-layout="banner"
				{...hold}
			>
				<div className="flex min-w-0 flex-1 flex-col gap-1.5 py-2 text-meta">
					<p>
						<span className="font-semibold">{view.title}.</span>{" "}
						<span className="text-text-2">
							{[view.resumed, view.skipped].filter(Boolean).join(", ")}
						</span>
					</p>
					{open}
				</div>
				{close}
			</div>
		);
	const card = (
		<div
			role="status"
			className={cn(
				"floating flex flex-col gap-2 rounded-surface py-3 pr-10 pl-3.5",
				corner
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
	return corner ? createPortal(card, corner) : card;
}
