// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { CircleHelp } from "lucide-react";
import { KitPopover } from "./Popover";

/**
 * Help that is opt-in (pattern sheet §0.3): a `?` that opens one line, and a
 * second when a caveat needs it. It opens on click so a phone can read it too.
 */
export function Help({
	about,
	text,
	more,
}: {
	/** What it explains, for the button's name: "Notify me with". */
	about: string;
	text: string;
	more?: string;
}) {
	return (
		<KitPopover
			family="menu"
			label={about}
			trigger={
				<button
					type="button"
					aria-label={`About ${about.toLowerCase()}`}
					className="inline-flex size-6 shrink-0 items-center justify-center rounded-control text-text-3 outline-none hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:text-text-1"
					data-testid="help"
				>
					<CircleHelp className="size-3.5" />
				</button>
			}
		>
			<div className="flex flex-col gap-1 px-2 py-1.5 text-meta">
				<p className="text-text-1">{text}</p>
				{more && <p className="text-text-2">{more}</p>}
			</div>
		</KitPopover>
	);
}
