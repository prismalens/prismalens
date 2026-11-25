// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { entryPoint } from "./entry-point.ts";
import { provider } from "./provider.ts";

/** Every kind this host declares; the generator also finds them by scanning this folder. */
export const kinds = [entryPoint, provider] as const;
