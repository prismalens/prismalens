// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	defineHarnessTool,
	fail,
	type HarnessTool,
	registered,
} from "@prismalens/integrations/harness";
import { z } from "zod";
import { SCOPED } from "./serves.js";

export interface ServiceView {
	name: string;
	displayName: string | null;
	type: string;
	tier: string;
	team: string | null;
	slackChannel: string | null;
	tags: string[];
	repos: { name: string; subPath: string | null; branch: string }[];
	dependsOn: { name: string; criticality: string }[];
	dependedOnBy: { name: string; criticality: string }[];
}

/** A service as PrismaLens's catalog holds it; null when there is none by that name. */
export type ServiceLookup = (name: string) => Promise<ServiceView | null>;

export function serviceTools(service: ServiceLookup): HarnessTool[] {
	return [
		defineHarnessTool({
			...registered("pl_service_get"),
			group: "knowledge",
			serves: SCOPED,
			input: z.object({ name: z.string().trim().min(1).max(200) }),
			run: async ({ name }) => {
				const found = await service(name);
				return found
					? { value: found }
					: fail(
							"not_found",
							`PrismaLens has no service named "${name}".`,
							"Use a service name from pl_thread_list, pl_changes_list or this thread's own context.",
						);
			},
		}),
	];
}
