// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { join } from "node:path";
import type { Forbid } from "./extract.ts";
import { buildManifest, loadConfig } from "./index.ts";
import type { Workspace } from "./workspace.ts";

/** Each family's member ids, by family: `agent.codex` is `codex` under `agent`. */
export type FamilyIds = ReadonlyMap<string, readonly string[]>;

/**
 * The ids every rule with `ids` counts, read from the workspace's id host, so a newly
 * registered member is covered with no rule edit. Only a scan calls this: label-check never loads the host.
 */
export function familyIds(
	ws: Workspace | undefined,
	forbid: readonly Forbid[],
): { ids: FamilyIds; problems: string[] } {
	const rules = forbid.filter((f) => f.ids !== undefined);
	const ids = new Map<string, string[]>();
	const problems: string[] = [];
	if (!rules.length) return { ids, problems };
	if (ws?.ids) {
		const host = buildManifest(loadConfig(join(ws.root, ws.ids.host)));
		problems.push(...host.problems);
		for (const { id } of host.manifest.entries[ws.ids.kind] ?? []) {
			const dot = id.indexOf(".");
			if (dot < 0) continue;
			const family = id.slice(0, dot);
			ids.set(family, [...(ids.get(family) ?? []), id.slice(dot + 1)]);
		}
	}
	for (const f of rules)
		if (!ids.get(f.ids ?? "")?.length)
			problems.push(
				`[workspace/ids] forbid rule ${f.rule} reads the ids of "${f.ids}", but the id host lists no ${f.ids}.* entry. Fix: register its first member (pnpm new provider ${f.ids}.<member>) or drop the rule's ids.`,
			);
	return { ids, problems };
}
