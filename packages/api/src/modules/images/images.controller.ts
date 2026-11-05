// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, Get, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { ImagesService } from "./images.service.js";

/** `GET /images/{key}`: a raw route, so `<img>` can load it (#1024 E). */
@Controller("images")
export class ImagesController {
	constructor(private readonly images: ImagesService) {}

	@Get(":key")
	async get(@Param("key") key: string, @Res() res: Response): Promise<void> {
		const image = key.length <= 4096 ? await this.images.serve(key) : null;
		if (!image) {
			res.status(404).end();
			return;
		}
		sendImage(res, image.bytes, image.type, 7 * 24 * 3600);
	}
}

/** An image response that can't run as a document: SVG included (#1024 E). */
export function sendImage(
	res: Response,
	bytes: Buffer,
	type: string,
	maxAge: number,
): void {
	res.setHeader("Content-Type", type);
	res.setHeader(
		"Content-Security-Policy",
		"default-src 'none'; style-src 'unsafe-inline'; sandbox",
	);
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("Cache-Control", `private, max-age=${maxAge}`);
	res.setHeader("Content-Disposition", "inline");
	res.status(200).end(bytes);
}
