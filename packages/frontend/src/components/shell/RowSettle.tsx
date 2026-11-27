// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { Hint } from "@/components/shared/Hint";
import { orpc } from "@/lib/api/orpc-client";
import { settleEndsLine } from "@/lib/settle-holds";

/** The row's one-click Settle; its hint previews what Settle ends, read on first hover (#1101 cat 2). */
export function RowSettle({
	id,
	onSettle,
}: {
	id: string;
	onSettle: () => void;
}) {
	const [asked, setAsked] = useState(false);
	const preview = useQuery({
		...orpc.threads.settlePreview.queryOptions({ input: { id } }),
		enabled: asked,
		staleTime: 30_000,
	});
	const ask = () => setAsked(true);
	return (
		<Hint
			label="Settle"
			{...(preview.data ? { meta: settleEndsLine(preview.data) } : {})}
		>
			<button
				type="button"
				aria-label="Settle"
				onClick={onSettle}
				onPointerEnter={ask}
				onFocus={ask}
				className="flex size-6 items-center justify-center rounded-control text-text-2 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent"
				data-testid="thread-settle"
			>
				<Check className="size-3.5" aria-hidden />
			</button>
		</Hint>
	);
}
