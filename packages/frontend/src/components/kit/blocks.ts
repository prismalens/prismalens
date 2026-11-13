// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createContext } from "react";

/** A block's spec and source live with the `block` kind; `define.block` in a `*.blocks.ts` adds one. */
export type {
	BlockDef,
	BlockSource,
	BlockSpec,
} from "@/registry/kinds/block";

/** The thread whose message Add to composer writes into; none means no block is quotable. */
export const BlockThread = createContext<string | null>(null);
