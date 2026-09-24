import type { Usage } from './pricing.js';

export type ModelEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  strict?: boolean;
}

export interface ModelTextBlock {
  type: 'text';
  text: string;
  cache?: true;
}

export interface ModelToolCallBlock {
  type: 'tool-call';
  id: string;
  name: string;
  input: unknown;
}

export interface ModelToolResultBlock {
  type: 'tool-result';
  toolCallId: string;
  content: string;
  isError?: true;
}

export interface ModelOpaqueBlock {
  type: 'opaque';
  value: unknown;
}

export type ModelContentBlock =
  | ModelTextBlock
  | ModelToolCallBlock
  | ModelToolResultBlock
  | ModelOpaqueBlock;

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: ModelContentBlock[];
}

export interface ModelRequest {
  model: string;
  maxOutputTokens: number;
  effort?: ModelEffort;
  /** Lets a caller stop an in-flight provider request rather than only the next turn. */
  signal?: AbortSignal;
  system: ModelTextBlock[];
  tools: ModelTool[];
  messages: ModelMessage[];
}

export interface ModelResponse {
  content: ModelContentBlock[];
  stopReason?: string | null;
  refusalReason?: string;
  usage?: Partial<Usage>;
}

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}
