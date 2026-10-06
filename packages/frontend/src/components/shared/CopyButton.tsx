// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

/**
 * The one copy affordance (look ruling §2): a text button that reads
 * "Copied" for 1.5 s. Success never toasts; a blocked clipboard does, since
 * the button cannot say why (no clipboard over plain HTTP on another device).
 */
export function CopyButton({
	value,
	label = "Copy",
	variant = "secondary",
	className,
	testId,
}: {
	value: string;
	label?: string;
	variant?: "secondary" | "text";
	className?: string;
	testId?: string;
}) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(t);
	}, [copied]);
	return (
		<Button
			type="button"
			variant={variant}
			size="sm"
			className={className}
			data-testid={testId}
			onClick={async () => {
				try {
					if (!navigator.clipboard) throw new Error("no clipboard");
					await navigator.clipboard.writeText(value);
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
			<span aria-live="polite">{copied ? "Copied" : label}</span>
		</Button>
	);
}
