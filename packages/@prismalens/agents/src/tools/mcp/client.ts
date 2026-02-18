/**
 * MCPClientManager — wraps MCP tool discovery and invocation.
 *
 * Stub implementation — Phase 8 adds real MCP client via @langchain/mcp-adapters.
 */

import type { StructuredToolInterface } from "@langchain/core/tools"

/**
 * MCP server configuration.
 */
export interface MCPServerConfig {
  name: string
  transport: {
    type: "sse" | "stdio"
    url?: string
    command?: string
    args?: string[]
  }
  headers?: Record<string, string>
}

/**
 * MCPClientManager — discovers and manages MCP tool connections.
 *
 * Stub: returns empty tools until Phase 8 implementation.
 */
export class MCPClientManager {
  private configs: MCPServerConfig[]

  constructor(configs: MCPServerConfig[]) {
    this.configs = configs
  }

  /**
   * Discover and return LangChain-compatible tools from all MCP servers.
   */
  async getTools(): Promise<StructuredToolInterface[]> {
    // Stub: return empty array until MCP is implemented
    return []
  }

  /**
   * Close all MCP server connections.
   */
  async close(): Promise<void> {
    // Stub: nothing to close
  }

  /**
   * Get the number of configured MCP servers.
   */
  getServerCount(): number {
    return this.configs.length
  }
}
