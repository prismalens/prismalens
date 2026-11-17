// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Hint } from "@/components/shared/Hint";
import { Loading, Problem } from "@/components/shared/State";
import { useForkPreview } from "@/lib/api/hooks/use-fix-thread";

/** What a fork or side question takes from its parent thread (#1176 D13), full words on hover. */
export function CarryLine({ threadId }: { threadId: string }) {
	const preview = useForkPreview(threadId);
	if (preview.isPending) return <Loading rows={1} className="px-2 py-1" />;
	if (preview.isError)
		return (
			<Problem
				text="Could not read the parent"
				onRetry={() => void preview.refetch()}
				className="px-2 py-1 text-meta"
			/>
		);
	const carried = preview.data.carried;
	if (!carried) return null;
	const words = `Carries ${carried}`;
	return (
		<Hint
			label={
				preview.data.omitted
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
