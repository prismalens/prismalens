// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Hands the browser a text file to save, then releases the object URL. */
export function download(
	filename: string,
	text: string,
	type = "text/markdown;charset=utf-8",
) {
	const url = URL.createObjectURL(new Blob([text], { type }));
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
