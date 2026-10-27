// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	defineHarnessTool,
	fail,
	type HarnessTool,
} from "@prismalens/integrations/harness";
import { z } from "zod";

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
			name: "service_get",
			title: "Look up a service",
			description:
				"One service from PrismaLens's catalog, by name: tier, team, Slack channel, type, tags, the repositories bound to it (name, sub-path, branch) and what it depends on and what depends on it, each with its criticality. Use it to know who owns a service and what it touches.",
			group: "knowledge",
			effect: "read",
			input: z.object({ name: z.string().trim().min(1).max(200) }),
			run: async ({ name }) => {
				const found = await service(name);
				return found
					? { value: found }
					: fail(
							"not_found",
							`PrismaLens has no service named "${name}".`,
							"Call incident_get for the service names of this incident.",
						);
			},
		}),
	];
}
