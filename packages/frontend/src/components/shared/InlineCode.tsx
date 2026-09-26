// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Renders a hint string's `backticked` spans as code instead of raw backticks. */
export function InlineCode({ text }: { text: string }) {
	return (
		<>
			{text.split("`").map((part, i) =>
				i % 2 === 1 ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string
					<code key={i} className="px-1 py-0 font-mono text-[0.95em]">
						{part}
					</code>
				) : (
					part
				),
			)}
		</>
	);
}
