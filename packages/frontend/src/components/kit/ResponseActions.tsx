// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Check, Copy, GitFork } from "lucide-react";
import { useEffect, useState } from "react";
import { Hint } from "@/components/shared/Hint";
import { toast } from "@/hooks/use-toast";

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
	return (
		<div className="flex items-center gap-0.5" data-testid="response-actions">
			<Hint label={copied ? "Copied" : "Copy"}>
				<button
					type="button"
					aria-label="Copy"
					className={ICON_BTN}
					data-testid="response-copy"
					onClick={async () => {
						try {
							if (!navigator.clipboard) throw new Error("no clipboard");
							await navigator.clipboard.writeText(text);
							setCopied(true);
						} catch {
							toast({
								title: "Not copied",
								description: "This browser blocked the clipboard.",
								variant: "destructive",
							});
						}
					}}
				>
					{copied ? (
						<Check className="size-3.5" />
					) : (
						<Copy className="size-3.5" />
					)}
				</button>
			</Hint>
			{onFork && (
				<Hint label="Fork from here">
					<button
						type="button"
						aria-label="Fork from here"
						className={ICON_BTN}
						data-testid="response-fork"
						onClick={onFork}
					>
						<GitFork className="size-3.5" />
					</button>
				</Hint>
			)}
		</div>
	);
}
