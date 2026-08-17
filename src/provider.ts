import type { ProbeNode } from './types';

export class ProviderError extends Error {
  constructor(message: string, public readonly code = 'PROVIDER_ERROR') {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ParsedProbeResult {
  nodeId: string;
  probe?: ProbeNode;
  success: boolean;
  latencyMs: number | null;
  statusCode: number | null;
  message: string | null;
  resolvedIp: string | null;
}
