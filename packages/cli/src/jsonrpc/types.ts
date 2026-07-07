// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * JSON-RPC 2.0 wire types — the newline-delimited JSON framing shared over stdio:
 * one JSON value per line in both directions. Requests and responses now come
 * from json-rpc-2.0; only the outbound notification (which the library does not
 * model) stays hand-framed here.
 */

export interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params: unknown;
}
