// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

import type { ChatMessage, GenerateRequest, GenerateResult, ModelProvider } from "../types.ts";

export interface OllamaOptions {
  model?: string;
  host?: string;
  /** Injectable for tests; defaults to global `fetch`. */
  fetchFn?: typeof fetch;
}

interface OllamaChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

const DEFAULT_MODEL = "llama3.1";
const DEFAULT_HOST = "http://localhost:11434";

function toOllamaMessages(request: GenerateRequest): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (request.system) {
    messages.push({ role: "system", content: request.system });
  }
  messages.push(...request.messages);
  return messages;
}

/** Local model provider backed by the Ollama REST API (`/api/chat`). */
export class OllamaProvider implements ModelProvider {
  readonly name = "ollama" as const;
  readonly model: string;
  private readonly host: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: OllamaOptions = {}) {
    this.model = opts.model ?? process.env.RELIABILITY_OLLAMA_MODEL ?? DEFAULT_MODEL;
    this.host = opts.host ?? process.env.OLLAMA_HOST ?? DEFAULT_HOST;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const res = await this.fetchFn(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: toOllamaMessages(request),
        stream: false,
        options: { temperature: request.temperature ?? 0 },
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    return {
      text: data.message?.content ?? "",
      usage: {
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
      },
      provider: this.name,
      model: this.model,
    };
  }
}
