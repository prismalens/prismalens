// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { entry } from "@prismalens/registry";
import type { BlockDef, BlockSpec } from "./kinds/block";
import type { ConditionDef, ConditionSpec } from "./kinds/condition";
import type { LensDef, LensSpec } from "./kinds/lens";
import type { SettingDef, SettingSpec } from "./kinds/setting";

/*
 * Each kind's define function, apart from its kind file: the app loads these at
 * startup, while the kind files (schemas, guards) load only for the checks.
 */

/** `define.block`: `D` is inferred from `text`'s parameter. */
export function defineBlock<D>(spec: BlockSpec<D>): BlockDef<D> {
	return entry("block", spec);
}

/** `S` keeps a choice's option values literal, so its control reads them typed. */
export function defineSetting<const S extends SettingSpec>(
	spec: S,
): S & SettingDef {
	return entry("setting", spec);
}

export function defineCondition(spec: ConditionSpec): ConditionDef {
	return entry("condition", spec);
}

export function defineLens(spec: LensSpec): LensDef {
	return entry("lens", spec);
}
