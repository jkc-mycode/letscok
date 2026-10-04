import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import OpenAI from 'openai';
import type {
  ChatCompletionContentPart,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';
import { z } from 'zod';

// OpenRouter — OpenAI 호환 API로 여러 회사 모델을 키 하나로 호출 (마크헙 OpenRouterLlmProvider와 같은 구성)
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// AI는 "읽기"만 한다 — 응답을 스키마로 고정(구조화 출력)하고 서버가 zod로 다시 검증해
// 자유 문장이 나올 길을 막는다. 화면에 보이는 문장은 전부 서버가 조립한다
@Injectable()
export class AiClient {
  private readonly logger = new Logger(AiClient.name);
  private readonly client: OpenAI | null = null;
  private readonly model: string | null = null;

  constructor() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL;
    // 키가 없으면 비활성으로 정상 기동 — 로컬·CI·테스트는 키 없이 돌아간다 (푸시 VAPID와 같은 방식)
    if (!apiKey || !model) {
      this.logger.warn('OPENROUTER_API_KEY·OPENROUTER_MODEL이 없어 AI 기능을 비활성화합니다.');
      return;
    }
    // 캡처 여러 장은 수십 초 걸릴 수 있다. 재시도는 1번만 — 비용이 드는 호출이라
    this.client = new OpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL, timeout: 60_000, maxRetries: 1 });
    this.model = model;
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  // 스키마에 맞는 JSON 한 개를 받아 온다 — zod 스키마 하나로 요청 스키마와 응답 검증을 함께 만든다
  // fallback = 실패 안내 끝에 붙일 대안 ("직접 체크인해주세요." / "직접 입력해주세요.") — 기능마다 다르다
  async extract<T>(
    schema: z.ZodType<T>,
    schemaName: string,
    system: string,
    content: string | ChatCompletionContentPart[],
    fallback: string,
  ): Promise<T> {
    if (!this.client || !this.model) {
      throw new ServiceUnavailableException('AI 기능이 꺼져 있어요.');
    }
    // $schema 키는 일부 제공자가 거부해서 뺀다 (z.strictObject → additionalProperties:false, 필드 전부 required)
    const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;

    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: schemaName, strict: true, schema: jsonSchema },
        },
        max_tokens: 4000,
        // OpenRouter 전용 — 구조화 출력을 지원하는 제공자로만 보낸다(지원 안 하면 자유 문장 대신 에러)
        provider: { require_parameters: true },
      } as ChatCompletionCreateParamsNonStreaming);
    } catch (error) {
      if (error instanceof OpenAI.RateLimitError) {
        throw new HttpException(`AI 사용 한도를 넘었어요. ${fallback}`, HttpStatus.TOO_MANY_REQUESTS);
      }
      this.logger.error('AI 호출 실패', (error as Error).stack);
      throw new BadGatewayException(`AI 응답을 받지 못했어요. 잠시 후 다시 시도하거나 ${fallback}`);
    }

    // OpenRouter는 실제 청구액(USD)을 usage.cost에 넣어 준다 — 비용 실측용
    const usage = response.usage as (OpenAI.CompletionUsage & { cost?: number }) | undefined;
    this.logger.log(
      `AI 추출 ${schemaName}: in=${usage?.prompt_tokens ?? '?'} out=${usage?.completion_tokens ?? '?'} cost=$${usage?.cost ?? '?'}`,
    );

    const text = response.choices[0]?.message?.content ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw this.unreadable(schemaName, 'JSON 아님', fallback);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) throw this.unreadable(schemaName, result.error.message, fallback);
    return result.data;
  }

  private unreadable(schemaName: string, reason: string, fallback: string) {
    this.logger.warn(`AI 응답 형식 불일치 (${schemaName}): ${reason}`);
    return new UnprocessableEntityException(`내용을 읽지 못했어요. 다시 시도하거나 ${fallback}`);
  }
}
