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
	children,
}: {
	items: TabItem[];
	value: string;
	onValueChange: (value: string) => void;
	label: string;
	/** `TabPanel`s, one per item. */
	children?: ReactNode;
}) {
	return (
		<Root value={value} onValueChange={onValueChange} className="min-w-0">
			<TabsList aria-label={label} className="max-w-full overflow-x-auto">
				{items.map((t) => (
					<TabsTrigger key={t.value} value={t.value} className="gap-1.5">
						{t.label}
						{t.count !== undefined && (
							<span className="text-meta text-text-3 tabular-nums">
								{t.count}
							</span>
						)}
					</TabsTrigger>
				))}
			</TabsList>
			{children}
		</Root>
	);
}

export function TabPanel({
	value,
	children,
}: {
	value: string;
	children: ReactNode;
}) {
	return (
		<TabsContent value={value} className="mt-3 outline-none">
			{children}
		</TabsContent>
	);
}
