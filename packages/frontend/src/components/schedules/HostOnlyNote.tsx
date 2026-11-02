// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Lock } from "lucide-react";

/** Why a paired device sees no controls: schedules are the host's to change (#979, #982). */
export function HostOnlyNote({ hostName }: { hostName: string }) {
	return (
		<p
			className="flex items-start gap-2.5 rounded-pool bg-surface-2 px-3.5 py-3 text-body text-text-2"
			data-testid="host-only-note"
		>
			<Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
			<span>
				You can view schedules here. To create or change one, use PrismaLens on{" "}
				<strong className="text-text-1">{hostName}</strong>, the computer that
				runs them.
			</span>
		</p>
	);
}
