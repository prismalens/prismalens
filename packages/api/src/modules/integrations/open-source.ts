// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AuthenticatedRequestFn } from "@prismalens/integrations";
import type { IntegrationsService } from "./integrations.service.js";
import {
	credentialSecrets,
	type SourceRequestOptions,
	sourceRequestFn,
} from "./source-request.js";

/** A connection ready to query; the agent sees only id, label and kind. */
export interface OpenedSource {
	id: string;
	label: string;
	kind: string;
	request?: AuthenticatedRequestFn;
	/** Every secret its credential holds now, scrubbed from anything returned. */
	readonly secrets: string[];
	/** Why it cannot be queried, in PrismaLens's own words. */
	unusable?: string;
}

/** The credential seam (#848): decrypted here, used only through `request`, never returned. */
export async function openSource(
	integrations: IntegrationsService,
	src: { id: string; label: string; kind: string },
	opts: SourceRequestOptions,
): Promise<OpenedSource> {
	const unusable = (reason: string): OpenedSource => ({
		...src,
		secrets: [],
		unusable: reason,
	});
	const row = await integrations.storedRow(src.id);
	const base =
		(await integrations.connectionBaseUrl(src.id)) ?? row?.stored.baseUrl;
	if (!base) return unusable("the connection has no URL");
	const parsed = row?.stored.credential;
	if (!parsed?.ok) return unusable(parsed?.message ?? "Connection not found");
	const credential = parsed.credential;
	return {
		...src,
		request: sourceRequestFn(base, parsed, {
			...opts,
			connection: integrations.sourceConnection(src.id),
		}),
		get secrets() {
			return credentialSecrets(credential, src.id);
		},
	};
}
