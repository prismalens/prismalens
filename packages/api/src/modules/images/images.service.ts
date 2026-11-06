// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One proxy for every remote image (#1024 E): project logos, owner avatars,
 * social previews, and the PR and commit avatars surface D shows. A caller
 * gets a signed `/api/images/{key}`; the key names the source URL and an HMAC
 * over it, so a browser cannot make the server fetch an arbitrary URL.
 */

import {
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { getAppDataDir } from "@prismalens/config";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { API_GLOBAL_PREFIX } from "../../shared/constants/routes.js";
import {
	allowedImageUrl,
	type FetchedImage,
	fetchImage,
	type ImageKind,
	type OriginContext,
} from "./image-fetch.js";

const KEY_SETTING = "images.signingKey";
export const HOST_IMAGES_SETTING = "sources.hostImages";
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const HOSTS_TTL_MS = 60_000;

interface Claim {
	u: string;
	k: ImageKind;
	/** The URL came from a host's own API, so Gravatar may serve it. */
	g?: 1;
}

export type ServedImage = { bytes: Buffer; type: string } | null;

@Injectable()
export class ImagesService implements OnModuleInit {
	private readonly logger = new Logger(ImagesService.name);
	private secret: Buffer | null = null;
	private hostImages = true;
	private hosts: { at: number; value: string[] } | null = null;
	private readonly inFlight = new Map<string, Promise<ServedImage>>();

	// Fields rather than constructor parameters: Nest would try to inject them. Tests set them.
	fetchImpl: typeof fetch = fetch;
	now: () => number = Date.now;
	cacheDir = (): string => join(getAppDataDir(), "cache", "images");

	constructor(private readonly prisma: PrismaService) {}

	async onModuleInit(): Promise<void> {
		await this.load();
	}

	/** Reads the signing key (made once per workspace) and the setting. */
	async load(): Promise<void> {
		const rows = await this.prisma.setting.findMany({
			where: { key: { in: [KEY_SETTING, HOST_IMAGES_SETTING] } },
		});
		const key = rows.find((r) => r.key === KEY_SETTING)?.value;
		if (key && /^"[0-9a-f]{64}"$/.test(key))
			this.secret = Buffer.from(JSON.parse(key), "hex");
		else {
			const fresh = randomBytes(32).toString("hex");
			await this.prisma.setting.upsert({
				where: { key: KEY_SETTING },
				update: { value: JSON.stringify(fresh), type: "string" },
				create: {
					key: KEY_SETTING,
					value: JSON.stringify(fresh),
					type: "string",
					category: "general",
				},
			});
			this.secret = Buffer.from(fresh, "hex");
		}
		const flag = rows.find((r) => r.key === HOST_IMAGES_SETTING)?.value;
		this.hostImages = flag !== "false";
	}

	/** "Images from the git host" (#1024 E); off leaves repo icon files and monograms. */
	get enabled(): boolean {
		return this.hostImages;
	}

	async setEnabled(enabled: boolean): Promise<boolean> {
		await this.prisma.setting.upsert({
			where: { key: HOST_IMAGES_SETTING },
			update: { value: JSON.stringify(enabled), type: "boolean" },
			create: {
				key: HOST_IMAGES_SETTING,
				value: JSON.stringify(enabled),
				type: "boolean",
				category: "integrations",
			},
		});
		this.hostImages = enabled;
		return enabled;
	}

	private sign(payload: string): string {
		if (!this.secret) throw new Error("ImagesService used before load()");
		return createHmac("sha256", this.secret)
			.update(payload)
			.digest("base64url")
			.slice(0, 32);
	}

	/**
	 * The proxied URL for `source`, or undefined when host images are off or the
	 * origin isn't one the proxy serves. `fromHostApi` lets Gravatar through.
	 */
	urlFor(
		source: string | undefined | null,
		kind: ImageKind,
		opts: { fromHostApi?: boolean } = {},
	): string | undefined {
		if (!source || !this.hostImages || !this.secret) return undefined;
		const ctx: OriginContext = {
			gitlabHosts: [],
			gravatar: !!opts.fromHostApi,
		};
		// A GitLab origin is checked against the clone hosts when the image is fetched.
		if (!allowedImageUrl(source, ctx) && !this.maybeGitlab(source))
			return undefined;
		const claim: Claim = {
			u: source,
			k: kind,
			...(opts.fromHostApi ? { g: 1 as const } : {}),
		};
		const payload = Buffer.from(JSON.stringify(claim)).toString("base64url");
		return `/${API_GLOBAL_PREFIX}/images/${payload}.${this.sign(payload)}`;
	}

	private maybeGitlab(source: string): boolean {
		try {
			const url = new URL(source);
			return url.protocol === "https:" && url.pathname.startsWith("/uploads/");
		} catch {
			return false;
		}
	}

	/** The claim a key carries, or null when it isn't one this workspace signed. */
	verify(key: string): Claim | null {
		const [payload, mac] = key.split(".");
		if (!payload || !mac || !this.secret) return null;
		const want = Buffer.from(this.sign(payload));
		const got = Buffer.from(mac);
		if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
		try {
			const claim = JSON.parse(
				Buffer.from(payload, "base64url").toString("utf8"),
			) as Claim;
			return typeof claim.u === "string" &&
				(claim.k === "avatar" || claim.k === "preview")
				? claim
				: null;
		} catch {
			return null;
		}
	}

	/** GitLab origins: gitlab.com and the hosts this install clones from that are neither GitHub nor Bitbucket. */
	private async gitlabHosts(): Promise<string[]> {
		if (this.hosts && this.now() - this.hosts.at < HOSTS_TTL_MS)
			return this.hosts.value;
		const rows = await this.prisma.repository.findMany({
			where: { sourceKind: "url" },
			select: { url: true },
		});
		const value = ["gitlab.com"];
		for (const { url } of rows) {
			try {
				const host = new URL(url).hostname.toLowerCase();
				if (
					!["github.com", "bitbucket.org"].includes(host) &&
					!value.includes(host)
				)
					value.push(host);
			} catch {
				// An ssh or scp-style address has no image origin.
			}
		}
		this.hosts = { at: this.now(), value };
		return value;
	}

	/** Fetch (or read from the 7-day cache) the image a source URL names. */
	async fetch(
		source: string,
		kind: ImageKind,
		fromHostApi = false,
	): Promise<FetchedImage> {
		if (!this.hostImages) return { ok: false, reason: "origin" };
		const ctx = {
			gitlabHosts: await this.gitlabHosts(),
			gravatar: fromHostApi,
		};
		const id = createHash("sha256").update(`${kind}\0${source}`).digest("hex");
		const dir = this.cacheDir();
		try {
			const meta = JSON.parse(
				readFileSync(join(dir, `${id}.json`), "utf8"),
			) as {
				at: number;
				type: string;
				finalUrl: string;
			};
			if (this.now() - meta.at < CACHE_MS && allowedImageUrl(source, ctx))
				return {
					ok: true,
					bytes: readFileSync(join(dir, `${id}.bin`)),
					type: meta.type,
					finalUrl: meta.finalUrl,
				};
		} catch {
			// Not cached yet.
		}
		const got = await fetchImage(source, kind, ctx, this.fetchImpl);
		if (got.ok) {
			try {
				mkdirSync(dir, { recursive: true });
				writeFileSync(join(dir, `${id}.bin`), got.bytes);
				writeFileSync(
					join(dir, `${id}.json`),
					JSON.stringify({
						at: this.now(),
						type: got.type,
						finalUrl: got.finalUrl,
					}),
				);
			} catch (e) {
				this.logger.debug(`Could not cache an image: ${(e as Error).message}`);
			}
		}
		return got;
	}

	/** What `GET /images/{key}` sends, or null for a 404. */
	async serve(key: string): Promise<ServedImage> {
		const claim = this.verify(key);
		if (!claim || !this.hostImages) return null;
		const pending = this.inFlight.get(key);
		if (pending) return pending;
		const work = this.fetch(claim.u, claim.k, claim.g === 1)
			.then((r) => (r.ok ? { bytes: r.bytes, type: r.type } : null))
			.finally(() => this.inFlight.delete(key));
		this.inFlight.set(key, work);
		return work;
	}
}
