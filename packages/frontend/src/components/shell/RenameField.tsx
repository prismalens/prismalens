// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useRenameThread } from "@/lib/api/hooks/use-threads-orpc";

/** The row as a field: Enter keeps the name, Esc or leaving it drops the edit. */
export function RenameField({
	id,
	title,
	onDone,
}: {
	id: string;
	title: string;
	onDone: () => void;
}) {
	const rename = useRenameThread();
	const [value, setValue] = useState(title);
	const save = () => {
		const next = value.trim();
		if (next && next !== title) rename.mutate({ id, title: next });
		onDone();
	};
	return (
		<form
			className="px-1 py-0.5"
			onSubmit={(e) => {
				e.preventDefault();
				save();
			}}
		>
			<Input
				// biome-ignore lint/a11y/noAutofocus: the field opens only from its own Rename button.
				autoFocus
				value={value}
				maxLength={80}
				onChange={(e) => setValue(e.target.value)}
				onBlur={onDone}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						e.preventDefault();
						onDone();
					}
				}}
				aria-label="Thread name"
				dir="auto"
				className="h-8"
				data-testid="thread-rename-input"
			/>
		</form>
	);
}
