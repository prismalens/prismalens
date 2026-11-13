// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { makeDefine } from "@prismalens/registry";
import { kinds } from "./kinds";

/** `define.<kind>({ id: "…", … })`, exported from a file with the kind's suffix: the only way to add an entry. */
export const define = makeDefine(kinds);
