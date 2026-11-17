// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Hint } from "@/components/shared/Hint";
import { useForkPreview } from "@/lib/api/hooks/use-fix-thread";

/** What a fork or side question takes from its parent thread (#1176 D13), full words on hover. */
export function CarryLine({ threadId }: { threadId: string }) {
	const preview = useForkPreview(threadId);
	const carried = preview.data?.carried;
	if (!carried) return null;
	const words = `Carries ${carried}`;
	return (
		<Hint
			label={
				preview.data?.omitted
					? `${words}; leaves out ${preview.data.omitted}`
					: words
			}
		>
			<p
				className="m-0 min-w-0 truncate px-2 text-meta text-text-3"
				data-testid="carry-line"
			>
				{words}
			</p>
		</Hint>
	);
}
