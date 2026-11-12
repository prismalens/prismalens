// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import {
	Tabs as Root,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs";

export interface TabItem {
	value: string;
	label: string;
	/** A count after the label, in the meta colour. */
	count?: number;
	testId?: string;
}

/**
 * The one tabs style (pattern sheet §0.2): plain words with the sliding
 * underline. PR view, palette and settings all use it; no pills, no boxes.
 */
export function Tabs({
	items,
	value,
	onValueChange,
	label,
	trailing,
	fill,
	children,
}: {
	items: TabItem[];
	value: string;
	onValueChange: (value: string) => void;
	label: string;
	/** Controls on the tab row's right, e.g. a pane menu and Close. */
	trailing?: ReactNode;
	/** The tabs and their panel fill a column, as a side panel's do. */
	fill?: boolean;
	/** `TabPanel`s, one per item. */
	children?: ReactNode;
}) {
	const list = (
		// A tab row scrolls sideways on purpose when its words outgrow a phone.
		<TabsList
			aria-label={label}
			className="max-w-full overflow-x-auto px-1"
			data-scroll-x
		>
			{items.map((t) => (
				<TabsTrigger
					key={t.value}
					value={t.value}
					data-testid={t.testId}
					// A tab row with no panels (the palette's filter) points at none.
					{...(children ? {} : { "aria-controls": undefined })}
					className="group/tab min-w-6 focus-visible:outline-none"
				>
					{/* Active is the word plus the underline; key focus outlines the label only (ui/tabs marks pointer presses). */}
					<span className="inline-flex items-center gap-1.5 rounded-control outline-accent group-focus-visible/tab:outline group-focus-visible/tab:outline-offset-2 group-data-[pointer]/tab:outline-none!">
						{t.label}
						{t.count !== undefined && (
							<span className="text-meta text-text-3 tabular-nums">
								{t.count}
							</span>
						)}
					</span>
				</TabsTrigger>
			))}
		</TabsList>
	);
	return (
		<Root
			value={value}
			onValueChange={onValueChange}
			className={fill ? "flex min-h-0 min-w-0 flex-1 flex-col" : "min-w-0"}
		>
			{trailing ? (
				<div className="flex min-w-0 items-center gap-1">
					<div className="min-w-0 flex-1">{list}</div>
					{trailing}
				</div>
			) : (
				list
			)}
			{children}
		</Root>
	);
}

export function TabPanel({
	value,
	fill,
	children,
}: {
	value: string;
	/** Fills the rest of a `fill` column, with no gap above. */
	fill?: boolean;
	children: ReactNode;
}) {
	return (
		<TabsContent
			value={value}
			className={
				fill
					? "mt-0 flex min-h-0 flex-1 flex-col outline-none"
					: "mt-3 outline-none"
			}
		>
			{children}
		</TabsContent>
	);
}
