// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useNeedsCtx } from "@/components/home/use-needs-ctx";
import type { ActionId } from "@/components/kit/actions";
import { entryOf } from "@/components/kit/registry";
import type { ListNode } from "@/lib/thread-list";

/** The row's one fix: the same registered action, label and icon as Home's card and the dock. */
export function RowFix({ node, id }: { node: ListNode; id: ActionId }) {
	const ctx = useNeedsCtx(node, () => {});
	const found = entryOf(id, ctx);
	if (!found || "separator" in found) return null;
	return (
		<div className="flex pb-1.5" style={{ paddingLeft: 30 }}>
			<button
				type="button"
				disabled={found.disabled}
				onClick={found.onSelect}
				className="inline-flex min-h-6 items-center gap-1 rounded-control px-1.5 text-meta text-text-1 outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
				data-testid="row-fix"
				data-fix={id}
			>
				{found.icon && <found.icon className="size-3.5" aria-hidden />}
				{found.label}
			</button>
		</div>
	);
}
