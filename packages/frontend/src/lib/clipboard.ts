// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { toast } from "@/hooks/use-toast";

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
