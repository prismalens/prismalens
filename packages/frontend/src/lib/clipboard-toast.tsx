// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";

/** A failed copy in product words, never the browser's error (#1101 23.4); `save` offers a file. */
export function notCopied(text: string | null, save: (() => void) | null) {
	toast({
		title: "Not copied",
		description:
			text === null
				? "PrismaLens couldn't load the text to copy. Try again."
				: "The browser kept the clipboard closed to this page.",
		variant: "destructive",
		...(save
			? {
					action: (
						<ToastAction
							altText="Save it as a file"
							onClick={save}
							data-testid="copy-save-file"
						>
							Save as a file
						</ToastAction>
					),
				}
			: {}),
	});
}
