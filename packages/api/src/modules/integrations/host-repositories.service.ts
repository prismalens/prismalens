// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import type { HostRepositories } from "@prismalens/contracts";
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
		search?: string;
		page?: number;
	}): Promise<HostRepositories> {
		const host = normalizeGitHost(input.host);
		if (!host || host.includes("/"))
			throw new HostListingError(`${input.host} isn't a git host name.`);
		const probe = `https://${host}/_/_`;
		const ref = { sourceKind: "url" as const, url: probe, connectionId: null };
		let cred: Awaited<ReturnType<GitCredentialService["resolveForUse"]>>;
		try {
			cred = await this.credentials.resolveForUse({ ...ref, pick: null });
		} catch (error) {
			// Two saved tokens for one host: list with the first, as Add project has no repo to pin yet.
			if (!(error instanceof GitCredentialAmbiguousError)) throw error;
			const [first] = await this.credentials.candidates(probe);
			if (!first) throw error;
			cred = await this.credentials.resolveForUse({
				...ref,
				pick: first.connectionId,
			});
		}
		const kind = gitHostKind(host);
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
			{ search: input.search, page: input.page },
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
