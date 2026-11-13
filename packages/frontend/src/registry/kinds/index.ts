// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { action } from "./action";
import { block } from "./block";
import { setting } from "./setting";
import { surface } from "./surface";

/** Every open kind. A kind missing here fails the guards' manifest check. */
export const kinds = [action, block, setting, surface] as const;
