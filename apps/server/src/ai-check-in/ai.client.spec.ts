import { HttpException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import OpenAI from 'openai';
import { z } from 'zod';
import { AiClient } from './ai.client';

// OpenRouter 클라이언트 — 실제 호출 대신 chat.completions.create를 바꿔 끼워 응답 검증 경로만 본다

const schema = z.strictObject({ names: z.array(z.string()) });

function createClient(withKeys = true) {
  if (withKeys) {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_MODEL = 'test/model';
  } else {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
  }
  const client = new AiClient();
  const create = jest.fn();
  // 비공개 OpenAI 인스턴스의 create만 바꿔 끼운다 (키가 없으면 인스턴스 자체가 없음)
  const inner = (client as unknown as { client: OpenAI | null }).client;
  if (inner) (inner.chat.completions as unknown as { create: jest.Mock }).create = create;
  return { client, create };
}

const reply = (content: string) => ({
  choices: [{ message: { content } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 },
});

afterAll(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
});

describe('AiClient', () => {
  it('키가 없으면 비활성 — 호출하면 503', async () => {
    const { client } = createClient(false);

    expect(client.isEnabled()).toBe(false);
    await expect(client.extract(schema, 'test', 'system', 'hi')).rejects.toThrow(ServiceUnavailableException);
  });

  it('스키마에 맞는 JSON이면 검증된 값을 돌려주고, 요청에 strict 스키마와 제공자 조건을 싣는다', async () => {
    const { client, create } = createClient();
    create.mockResolvedValue(reply('{"names":["김하나"]}'));

    await expect(client.extract(schema, 'names', 'system', 'hi')).resolves.toEqual({ names: ['김하나'] });

    const body = create.mock.calls[0][0];
    expect(body.response_format.json_schema).toMatchObject({ name: 'names', strict: true });
    expect(body.response_format.json_schema.schema).toMatchObject({ additionalProperties: false });
    expect(body.response_format.json_schema.schema.$schema).toBeUndefined();
    expect(body.provider).toEqual({ require_parameters: true });
  });

  it('자유 문장이나 스키마와 어긋난 JSON은 422 — 체크인으로 이어지지 않는다', async () => {
    const { client, create } = createClient();
    create.mockResolvedValueOnce(reply('오늘 날씨는 맑아요'));
    await expect(client.extract(schema, 'names', 'system', 'hi')).rejects.toThrow(UnprocessableEntityException);

    create.mockResolvedValueOnce(reply('{"names":"김하나"}'));
    await expect(client.extract(schema, 'names', 'system', 'hi')).rejects.toThrow(UnprocessableEntityException);
  });

  it('사용 한도 초과(429)는 429로 안내', async () => {
    const { client, create } = createClient();
    create.mockRejectedValue(new OpenAI.RateLimitError(429, undefined, 'rate limited', new Headers()));

    await expect(client.extract(schema, 'names', 'system', 'hi')).rejects.toMatchObject({ status: 429 });
    await expect(client.extract(schema, 'names', 'system', 'hi')).rejects.toBeInstanceOf(HttpException);
  });
});
