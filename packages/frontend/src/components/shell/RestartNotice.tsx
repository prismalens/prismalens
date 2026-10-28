// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PHONE, useMediaQuery } from "@/hooks/use-media-query";
import { useRestartSummary } from "@/lib/api/hooks";
import {
	restartNoticeView,
	SEEN_KEY,
	shouldShowRestartNotice,
} from "@/lib/restart-notice";

function readSeen(): string | null {
	try {
		return localStorage.getItem(SEEN_KEY);
	} catch {
		return null;
	}
}

/**
 * What the last start did with the runs a stop cut off (#981): once per
 * device, within an hour of the start. A card bottom-right, a banner under
 * the header on a phone.
 */
export function RestartNotice() {
	const { data } = useRestartSummary();
	const phone = useMediaQuery(PHONE);
	const [now] = useState(() => Date.now());
	const [seen, setSeen] = useState<string | null | undefined>(undefined);
	useEffect(() => setSeen(readSeen()), []);
	if (seen === undefined || !shouldShowRestartNotice(data, seen, now))
		return null;
	const view = restartNoticeView(data, now);
	const dismiss = () => {
		try {
			localStorage.setItem(SEEN_KEY, data.at);
		} catch {
			// A device that cannot store it sees the notice again on the next load.
		}
		setSeen(data.at);
	};
	const open = view.open && (
		<Button
			variant="secondary"
			asChild
			className="self-start"
			data-testid="restart-notice-open"
		>
			<Link
				to="/incidents/$id/conversation"
				params={{ id: view.open.incidentId }}
				search={{ investigation: view.open.investigationId }}
				onClick={dismiss}
			>
				{view.open.label}
			</Link>
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
	return (
		<div
			role="status"
			className="floating fixed right-4 bottom-4 z-[90] flex w-[340px] max-w-[calc(100%-2rem)] flex-col gap-2 rounded-surface py-3 pr-10 pl-3.5"
			data-testid="restart-notice"
			data-layout="toast"
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
}
