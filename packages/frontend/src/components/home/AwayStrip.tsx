// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
	useActiveIncidents,
	useRecentlyResolved,
} from "@/components/inbox/use-inbox-data";
import { awayItems } from "@/lib/away";
import { formatDayClock } from "@/lib/format-time";

/** This browser's last visit to Home or the board; there is no server-side last-visited yet (FOLLOWUPS). */
const SEEN = "pl.home.seenAt";

function readSeen(): number | null {
	try {
		const v = Number(localStorage.getItem(SEEN));
		return Number.isFinite(v) && v > 0 ? v : null;
	} catch {
		return null;
	}
}

/** What happened since the last visit: one quiet line of links, absent when nothing happened. */
export function AwayStrip() {
	const [since] = useState(readSeen);
	useEffect(() => {
		try {
			localStorage.setItem(SEEN, String(Date.now()));
		} catch {}
	}, []);
	const active = useActiveIncidents();
	const recent = useRecentlyResolved(20);
	const items = awayItems([...active.incidents, ...recent.rows], since);
	if (items.length === 0) return null;
	return (
		<p
			className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-body text-text-2"
			data-testid="away-strip"
		>
			<span className="text-text-3">
				Since {since ? formatDayClock(since, Date.now()) : ""}
			</span>
			{items.map((item) =>
				item.incidentId ? (
					<Link
						key={item.key}
						to="/incidents/$id"
						params={{ id: item.incidentId }}
						className="inline-flex min-h-6 max-w-full items-center text-center text-accent hover:underline"
						data-testid={`away-${item.key}`}
					>
						<span>{item.text}</span>
					</Link>
				) : (
					<Link
						key={item.key}
						to="/new"
						className="inline-flex min-h-6 max-w-full items-center text-center text-accent hover:underline"
						data-testid={`away-${item.key}`}
					>
						<span>{item.text}</span>
					</Link>
				),
			)}
		</p>
	);
}
