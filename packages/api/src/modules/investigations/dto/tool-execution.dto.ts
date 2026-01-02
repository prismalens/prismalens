/**
 * DTO for creating a tool execution record
 */
export class CreateToolExecutionDto {
  agentExecutionId!: string;
  toolName!: string;
  toolCategory?: 'file' | 'search' | 'github' | 'logs' | 'analysis';
  arguments?: Record<string, unknown>;
  result?: Record<string, unknown>;
  status?: 'pending' | 'running' | 'success' | 'error';
  executionTimeMs?: number;
  confidence?: number;
  error?: string;
}
