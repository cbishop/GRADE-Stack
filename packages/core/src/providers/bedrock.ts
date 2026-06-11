// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import type { GenerateRequest, GenerateResult, ModelProvider } from "../types.ts";

export interface BedrockOptions {
  model?: string;
  region?: string;
  /** Injectable for tests; defaults to a real `BedrockRuntimeClient`. */
  client?: BedrockRuntimeClient;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

// US cross-region inference profile — newer Claude models on Bedrock require an
// inference profile rather than a raw on-demand model ID. Override per-call via
// RELIABILITY_BEDROCK_MODEL. (us-east-1 has Claude; see pre-flight notes.)
const DEFAULT_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const DEFAULT_REGION = "us-east-1";

/** Cloud model provider backed by Amazon Bedrock (Anthropic Messages API). */
export class BedrockProvider implements ModelProvider {
  readonly name = "bedrock" as const;
  readonly model: string;
  private readonly client: BedrockRuntimeClient;

  constructor(opts: BedrockOptions = {}) {
    this.model = opts.model ?? process.env.RELIABILITY_BEDROCK_MODEL ?? DEFAULT_MODEL;
    const region =
      opts.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? DEFAULT_REGION;
    this.client = opts.client ?? new BedrockRuntimeClient({ region });
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const body = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature ?? 0,
      ...(request.system ? { system: request.system } : {}),
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    };

    const command = new InvokeModelCommand({
      modelId: this.model,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(body),
    });

    const response = await this.client.send(command);
    const decoded = new TextDecoder().decode(response.body ?? new Uint8Array());
    const data = JSON.parse(decoded) as AnthropicResponse;

    const text = (data.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");

    return {
      text,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
      provider: this.name,
      model: this.model,
    };
  }
}
