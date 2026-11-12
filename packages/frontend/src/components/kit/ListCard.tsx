// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ContextMenu, Menu, type MenuEntry } from "./Menu";
import { Status, type StatusKind } from "./Status";

/**
 * The one list card (pattern sheet §6): a title, a status word, one meta
 * line. The title is a stretched link or button, so the whole card opens it
 * and the ⋯ menu stays its own target.
 */
export function ListCard({
	title,
	status,
	statusWord,
	meta,
	icon,
	link,
	onOpen,
	menu,
	selected,
	testId,
}: {
	title: string;
	status?: StatusKind;
	/** Overrides the status's own word, e.g. "Usage limit" for limited. */
	statusWord?: string;
	meta?: ReactNode;
	/** A type mark before the title when the grid mixes kinds. */
	icon?: ReactNode;
	/** Wraps the title in the route's `<Link>`; the whole card follows it. */
	link?: (title: ReactNode) => ReactNode;
	/** Or a callback, for a card that opens in place. */
	onOpen?: () => void;
	menu?: MenuEntry[];
	selected?: boolean;
	testId?: string;
}) {
	const heading = <span className="truncate">{title}</span>;
	const stretch =
		"min-h-0 min-w-0 truncate text-left outline-none after:absolute after:inset-0 after:rounded-surface focus-visible:after:ring-2 focus-visible:after:ring-accent";
	let opener: ReactNode = heading;
	if (link) opener = link(heading);
	else if (onOpen)
		opener = (
			<button type="button" className={stretch} onClick={onOpen}>
				{heading}
			</button>
		);
	const card = (
		<li
			className={cn(
				"group/card relative flex min-w-0 flex-col gap-1 rounded-surface bg-surface-1 px-3 py-2.5 transition-colors duration-(--dur-instant) hover:bg-surface-2",
				selected && "bg-surface-3 hover:bg-surface-3",
				"[&_a]:min-h-0 [&_a]:min-w-0 [&_a]:truncate [&_a]:outline-none [&_a]:after:absolute [&_a]:after:inset-0 [&_a]:after:rounded-surface [&_a:focus-visible]:after:ring-2 [&_a:focus-visible]:after:ring-accent",
			)}
			data-testid={testId}
		>
			<div className="flex min-w-0 items-center gap-2 pr-6 [@media(hover:none)]:pr-12">
				{icon && (
					<span className="flex size-3.5 shrink-0 items-center text-text-3">
						{icon}
					</span>
				)}
				<span className="flex min-w-0 text-body font-medium text-text-1">
					{opener}
				</span>
			</div>
			{(status || meta) && (
				<div className="flex min-w-0 items-center gap-1.5 text-meta text-text-2">
					{status && (
						<Status kind={status} word={statusWord} className="shrink-0" />
					)}
					{status && meta && (
						<span aria-hidden className="text-text-3">
							·
						</span>
					)}
					{meta && <span className="min-w-0 truncate">{meta}</span>}
				</div>
			)}
			{menu && (
				<div
					className={cn(
						"absolute top-1.5 right-1.5 opacity-0 group-focus-within/card:opacity-100 group-hover/card:opacity-100 has-[[data-state=open]]:opacity-100",
						selected && "opacity-100",
						"[@media(hover:none)]:opacity-100",
					)}
				>
					<Menu
						label={`${title} actions`}
						entries={menu}
						trigger={
							<button
								type="button"
								aria-label={`${title} actions`}
								className="relative flex size-6 items-center justify-center rounded-control text-text-2 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent"
							>
								<MoreHorizontal className="size-3.5" />
							</button>
						}
					/>
				</div>
			)}
		</li>
	);
	return menu ? (
		<ContextMenu label={`${title} actions`} entries={menu}>
			{card}
		</ContextMenu>
	) : (
		card
	);
}

/** Cards in a grid that reflows: as many 240 px columns as fit, one on a phone. */
export function ListGrid({
	label,
	children,
	testId,
}: {
	label: string;
	children: ReactNode;
	testId?: string;
}) {
	return (
		<ul
			aria-label={label}
			className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2"
			data-testid={testId}
		>
			{children}
		</ul>
	);
}
