export class GenericWebhookDto {
  title!: string;
  description?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  source?: string;
  sourceUrl?: string;
  externalId?: string;
  rawPayload?: Record<string, unknown>;
  autoAnalyze?: boolean;
}

export class GithubWebhookDto {
  action?: string;
  issue?: {
    number: number;
    title: string;
    body?: string;
    html_url?: string;
    labels?: Array<{ name: string }>;
    state?: string;
  };
  pull_request?: {
    number: number;
    title: string;
    body?: string;
    html_url?: string;
    state?: string;
    merged?: boolean;
  };
  alert?: {
    number: number;
    html_url?: string;
    state?: string;
    severity?: string;
    summary?: string;
  };
  repository?: {
    full_name: string;
    html_url?: string;
  };
  sender?: {
    login: string;
  };
}

export class RenderWebhookDto {
  type?: string;
  service?: {
    id: string;
    name: string;
    type?: string;
  };
  deploy?: {
    id: string;
    status: string;
    finishedAt?: string;
  };
  healthCheck?: {
    path?: string;
    protocol?: string;
  };
  timestamp?: string;
}
