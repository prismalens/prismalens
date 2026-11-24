// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import type { HostRepositories } from "@prismalens/contracts";
import { GIT_HOSTS } from "@prismalens/contracts/schemas";
import { gitHostKind, listHostRepositories } from "@prismalens/integrations";
import { normalizeGitHost } from "../../core/harness/git-credential.js";
import {
	GitCredentialAmbiguousError,
	GitCredentialService,
} from "./git-credential.service.js";

const TIMEOUT_MS = 10_000;

/** A failure the host gave back, shown on the dialog as is. */
export class HostListingError extends Error {}

/**
 * Add project → From GitHub, GitLab or Bitbucket (#1024 E). The credential is
 * the one a clone from that host would use; a pick becomes the ordinary git-URL
 * source, so cloning, credentials and errors stay as they are.
 */
@Injectable()
export class HostRepositoriesService {
	// A field rather than a constructor parameter: Nest would try to inject it. Tests set it.
	fetchImpl: typeof fetch = fetch;

	constructor(private readonly credentials: GitCredentialService) {}

	async list(input: {
		host: string;
		workspace?: string;
		credentialConnectionId?: string;
		search?: string;
		page?: number;
	}): Promise<HostRepositories> {
		const host = normalizeGitHost(input.host);
		if (!host || host.includes("/"))
			throw new HostListingError(`${input.host} isn't a git host name.`);
		const probe = `https://${host}/_/_`;
		const ref = { sourceKind: "url" as const, url: probe, connectionId: null };
		const pick = input.credentialConnectionId ?? null;
		if (pick && !(await this.credentials.tokenFor(probe, pick)))
			throw new HostListingError(`Choose a saved token for ${host}.`);
		const cred = await this.credentials
			.resolveForUse({ ...ref, pick })
			.catch((error: unknown) => {
				if (error instanceof GitCredentialAmbiguousError)
					throw new HostListingError(`Choose a saved token for ${host}.`);
				throw error;
			});
		const kind = gitHostKind(host);
		if (GIT_HOSTS[kind].scope === "workspace" && !input.workspace)
			throw new HostListingError("Enter a Bitbucket workspace slug.");
		let signed = false;
		const page = await listHostRepositories(
			kind,
			host,
			async (url) => {
				const authorization = cred.apiAuthorization(url);
				if (!authorization) throw new MissingCredential();
				signed = true;
				const res = await this.fetchImpl(url, {
					headers: { accept: "application/json", authorization },
					redirect: "error",
					signal: AbortSignal.timeout(TIMEOUT_MS),
				});
				if (!res.ok)
					throw new HostListingError(
						`${host} answered ${res.status} when listing repositories${res.status === 401 || res.status === 403 ? "; the token may lack the scope to list them" : ""}.`,
					);
				return res.json();
			},
			{ search: input.search, page: input.page, workspace: input.workspace },
		).catch((error: unknown) => {
			if (error instanceof MissingCredential) return null;
			throw error;
		});
		if (!page || !signed)
			return { credential: "none", repositories: [], hasMore: false };
		return { credential: "resolved", ...page };
	}
}

class MissingCredential extends Error {}
