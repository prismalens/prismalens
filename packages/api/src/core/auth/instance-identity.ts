// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
// biome-ignore lint/style/useImportType: Nest DI needs the runtime class.
import { ConfigService } from "@nestjs/config";
import { deviceCookieName } from "@prismalens/auth";
import {
	ensureAppDataDir,
	ensureInstanceFile,
	type InstanceFile,
} from "@prismalens/config";
import type { Request } from "express";

/** This instance's id from `<workspace>/instance.json` (#763), and the names derived from it. */
@Injectable()
export class InstanceIdentity {
	private instance?: InstanceFile;

	constructor(private readonly config: ConfigService) {}

	get instanceId(): string {
		this.instance ??= ensureInstanceFile(ensureAppDataDir());
		return this.instance.instanceId;
	}

	get deviceCookie(): string {
		return deviceCookieName(this.instanceId);
	}

	/** `Secure` follows the resolved origin's scheme, never NODE_ENV. */
	get secureCookies(): boolean {
		const publicUrl = this.config.get<string>("PRISMALENS_PUBLIC_URL");
		if (publicUrl) return publicUrl.startsWith("https://");
		return this.config.get<string>("PRISMALENS_PROTOCOL") === "https";
	}

	/**
	 * Also `Secure` when this request reached the browser over HTTPS: directly, or
	 * through a TLS proxy on this machine (`tailscale serve`) that says so.
	 */
	secureFor(request: Request): boolean {
		if (this.secureCookies) return true;
		if ((request.socket as { encrypted?: boolean } | undefined)?.encrypted)
			return true;
		const proto = request.headers["x-forwarded-proto"];
		const peer = request.socket?.remoteAddress ?? "";
		const loopbackPeer =
			peer === "::1" ||
			peer.startsWith("127.") ||
			peer.startsWith("::ffff:127.");
		return loopbackPeer && String(proto).split(",")[0]?.trim() === "https";
	}
}
