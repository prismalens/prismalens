// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";

/** One titled block of the state gallery (`/_design`), from fixtures only. */
export interface GallerySection {
	id: string;
	title: string;
	render: () => ReactNode;
}
