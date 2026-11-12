// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Check, Copy, GitFork } from "lucide-react";
import { useEffect, useState } from "react";
import { Hint } from "@/components/shared/Hint";
import { toast } from "@/hooks/use-toast";
import type { MenuEntry } from "./Menu";

/** Copies to the clipboard; a blocked clipboard toasts and returns false. */
export async function copyText(text: string): Promise<boolean> {
	try {
		if (!navigator.clipboard) throw new Error("no clipboard");
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		toast({
			title: "Not copied",
			description: "This browser blocked the clipboard.",
			variant: "destructive",
		});
		return false;
	}
}

/** A message's actions: the response row's icons and its right-click menu read this list. */
export function messageEntries({
	text,
	onFork,
	onCopied,
}: {
	text: string;
	onFork?: () => void;
	onCopied?: () => void;
}): MenuEntry[] {
	return [
		{
			id: "copy",
			label: "Copy",
			icon: Copy,
			onSelect: () => void copyText(text).then((ok) => ok && onCopied?.()),
		},
		...(onFork
			? [
					{
						id: "fork",
						label: "Fork from here",
						icon: GitFork,
						onSelect: onFork,
					},
				]
			: []),
	];
}

const ICON_BTN =
	"flex size-6 items-center justify-center rounded-control text-text-3 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent";

/**
 * The quiet row after an agent response (sheet §2, §9.2): always visible,
 * Copy and Fork as icons. Copy turns into a tick for 1.5 s; a blocked
 * clipboard toasts, as `shared/CopyButton` does.
 */
export function ResponseActions({
	text,
	onFork,
}: {
	text: string;
	/** Absent when the thread cannot fork (no session to carry). */
	onFork?: () => void;
}) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(t);
	}, [copied]);
	const entries = messageEntries({
		text,
		onFork,
		onCopied: () => setCopied(true),
	});
	return (
		<div className="flex items-center gap-0.5" data-testid="response-actions">
			{entries.map((e) => {
				if ("separator" in e) return null;
				const done = e.id === "copy" && copied;
				const Icon = done ? Check : e.icon;
				return (
					<Hint key={e.id} label={done ? "Copied" : e.label}>
						<button
							type="button"
							aria-label={e.label}
							className={ICON_BTN}
							data-testid={`response-${e.id}`}
							onClick={e.onSelect}
						>
							{Icon && <Icon className="size-3.5" />}
						</button>
					</Hint>
				);
			})}
		</div>
	);
}
