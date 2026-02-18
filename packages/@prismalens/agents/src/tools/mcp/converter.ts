/**
 * MCP to LangChain tool converter.
 *
 * Stub implementation — Phase 8 adds real conversion via @langchain/mcp-adapters.
 */

import type { StructuredToolInterface } from "@langchain/core/tools"

/**
 * Raw MCP tool definition (from MCP protocol).
 */
export interface MCPToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/**
 * Convert MCP tool definitions to LangChain StructuredTool instances.
 *
 * Stub: returns empty array until Phase 8 implementation.
 */
export function mcpToolsToLangChain(
  _mcpTools: MCPToolDefinition[],
  _callFn: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): StructuredToolInterface[] {
  // Stub: return empty array until MCP is implemented
  return []
}
