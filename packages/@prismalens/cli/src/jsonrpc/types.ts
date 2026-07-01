/**
 * JSON-RPC 2.0 wire types — the newline-delimited JSON framing shared over stdio:
 * one JSON value per line in both directions (requests in, responses +
 * notifications out).
 */

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: JsonRpcId;
	method: string;
	params?: unknown;
}

export interface JsonRpcSuccess {
	jsonrpc: "2.0";
	id: JsonRpcId;
	result: unknown;
}

export interface JsonRpcErrorResponse {
	jsonrpc: "2.0";
	id: JsonRpcId;
	error: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params: unknown;
}

export type OutgoingMessage =
	| JsonRpcSuccess
	| JsonRpcErrorResponse
	| JsonRpcNotification;
