// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Copy } from "lucide-react";
import { defineAction } from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

/** A rendered code block: its code alone, read when the action runs (#1101). */
export interface CodeCtx {
	code: () => string;
	onCopied?: () => void;
}

declare module "@/components/kit/actions" {
	interface ObjectContexts {
		code: CodeCtx;
	}
	interface ActionObjects {
		"code.copy": "code";
	}
}

export const codeCopy = defineAction({
	id: "code.copy",
	label: "Copy code",
	icon: Copy,
	run: (c) => void copyText(c.code()).then((ok) => ok && c.onCopied?.()),
});
