// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Fragment } from "react";
import { splitForWrap } from "@/lib/split-for-wrap";

/** A title that may break inside identifiers: <wbr> at case and `_ - . /` boundaries. */
export function WrapText({ text }: { text: string }) {
	return splitForWrap(text).map((part, i, all) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string
		<Fragment key={i}>
			{part}
			{i < all.length - 1 && <wbr />}
		</Fragment>
	));
}
