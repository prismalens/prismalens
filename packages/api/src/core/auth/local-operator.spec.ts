// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	hostHeaderName,
	isLocalOperatorRequest,
	isLoopbackAddress,
	isLoopbackHost,
} from "./local-operator.js";

const local = {
	remoteAddress: "127.0.0.1",
	headers: { host: "localhost:3001" },
	placement: "laptop" as const,
};

describe("isLocalOperatorRequest", () => {
	it("passes a loopback peer with a loopback Host, no forwarding header, on a laptop", () => {
		expect(isLocalOperatorRequest(local)).toBe(true);
		expect(
			isLocalOperatorRequest({ ...local, remoteAddress: "::1", headers: { host: "[::1]:3001" } }),
		).toBe(true);
		expect(
			isLocalOperatorRequest({
				...local,
				remoteAddress: "::ffff:127.0.0.1",
				headers: { host: "127.0.0.1" },
			}),
		).toBe(true);
	});

	it("fails a non-loopback peer (LAN or tailnet client)", () => {
		expect(isLocalOperatorRequest({ ...local, remoteAddress: "192.168.1.20" })).toBe(false);
		expect(isLocalOperatorRequest({ ...local, remoteAddress: "100.64.0.7" })).toBe(false);
		expect(isLocalOperatorRequest({ ...local, remoteAddress: undefined })).toBe(false);
	});

	it("fails a non-loopback Host (reverse proxy, tailscale serve, rebound page)", () => {
		expect(
			isLocalOperatorRequest({ ...local, headers: { host: "prismalens.example" } }),
		).toBe(false);
		expect(
			isLocalOperatorRequest({ ...local, headers: { host: "machine.tailnet.ts.net" } }),
		).toBe(false);
		expect(isLocalOperatorRequest({ ...local, headers: {} })).toBe(false);
	});

	it("fails when any forwarding header is present", () => {
		for (const header of [
			"forwarded",
			"x-forwarded-for",
			"x-forwarded-host",
			"x-forwarded-proto",
			"x-real-ip",
		]) {
			expect(
				isLocalOperatorRequest({
					...local,
					headers: { host: "localhost:3001", [header]: "203.0.113.9" },
				}),
			).toBe(false);
		}
	});

	it("fails on a server placement even from loopback", () => {
		expect(isLocalOperatorRequest({ ...local, placement: "server" })).toBe(false);
	});
});

describe("isLoopbackAddress", () => {
	it("accepts the whole 127/8 block, ::1 and the IPv4-mapped form", () => {
		expect(isLoopbackAddress("127.0.0.1")).toBe(true);
		expect(isLoopbackAddress("127.255.0.9")).toBe(true);
		expect(isLoopbackAddress("::1")).toBe(true);
		expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
	});
	it("rejects everything else, including lookalikes", () => {
		expect(isLoopbackAddress("10.0.0.1")).toBe(false);
		expect(isLoopbackAddress("1270.0.0.1")).toBe(false);
		expect(isLoopbackAddress("::ffff:10.0.0.1")).toBe(false);
		expect(isLoopbackAddress("localhost")).toBe(false);
		expect(isLoopbackAddress("")).toBe(false);
	});
});

describe("isLoopbackHost / hostHeaderName", () => {
	it("reads the hostname out of every Host spelling", () => {
		expect(hostHeaderName("localhost:3001")).toBe("localhost");
		expect(hostHeaderName("LOCALHOST.")).toBe("localhost");
		expect(hostHeaderName("[::1]:3001")).toBe("::1");
		expect(hostHeaderName("127.0.0.1")).toBe("127.0.0.1");
		expect(hostHeaderName("")).toBeUndefined();
	});
	it("accepts loopback names and literals only", () => {
		expect(isLoopbackHost("localhost:3001")).toBe(true);
		expect(isLoopbackHost("[::1]")).toBe(true);
		expect(isLoopbackHost("127.0.0.1:3001")).toBe(true);
		expect(isLoopbackHost("localhost.example:3001")).toBe(false);
		expect(isLoopbackHost("evil.example")).toBe(false);
		expect(isLoopbackHost(undefined)).toBe(false);
	});
});
