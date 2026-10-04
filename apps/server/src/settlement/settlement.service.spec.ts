import { UnprocessableEntityException } from '@nestjs/common';
import { AiClient } from '../ai/ai.client';
import { RECEIPT_FALLBACK, SettlementService, UNREADABLE_RECEIPT_MESSAGE } from './settlement.service';

// 영수증 판독 후처리 — AI 호출은 고정 결과로 대체하고 요청 모양과 걸러내기 규칙만 본다
const aiStub = { isEnabled: () => true, extract: jest.fn() };
const service = new SettlementService(aiStub as unknown as AiClient);

const image = (text = 'receipt') => ({ buffer: Buffer.from(text), mimetype: 'image/jpeg' });
const item = (name: string, amount: number, category: 'common' | 'alcohol' | 'beverage' = 'common') => ({
  name,
  amount,
  category,
});

describe('SettlementService.readReceipt', () => {
  beforeEach(() => aiStub.extract.mockReset());

  it('읽은 품목과 총액을 그대로 돌려주고, 사진 장수만큼 이미지를 싣고 실패 안내 꼬리를 넘긴다', async () => {
    aiStub.extract.mockResolvedValue({
      items: [item('모듬전', 25000), item('참이슬', 5000, 'alcohol'), item('콜라', 2000, 'beverage')],
      total: 32000,
      readable: true,
    });

    await expect(service.readReceipt([image('1차'), image('2차')])).resolves.toEqual({
      items: [item('모듬전', 25000), item('참이슬', 5000, 'alcohol'), item('콜라', 2000, 'beverage')],
      total: 32000,
    });

    const [, name, , content, fallback] = aiStub.extract.mock.calls[0];
    expect(name).toBe('receipt');
    expect(content.filter((part: { type: string }) => part.type === 'image_url')).toHaveLength(2);
    expect(content[0].image_url.url).toBe(`data:image/jpeg;base64,${Buffer.from('1차').toString('base64')}`);
    expect(fallback).toBe(RECEIPT_FALLBACK);
  });

  it('할인(음수)은 남기고, 이름이 비었거나 0원인 줄은 뺀다', async () => {
    aiStub.extract.mockResolvedValue({
      items: [item(' 감자튀김 ', 12000), item('할인', -2000), item('  ', 3000), item('서비스 김치', 0)],
      total: 10000,
      readable: true,
    });

    await expect(service.readReceipt([image()])).resolves.toEqual({
      items: [item('감자튀김', 12000), item('할인', -2000)],
      total: 10000,
    });
  });

  it('총액을 못 읽었거나 0원 이하면 null — 웹이 품목 합계로 채운다', async () => {
    aiStub.extract.mockResolvedValueOnce({ items: [item('치킨', 20000)], total: null, readable: true });
    await expect(service.readReceipt([image()])).resolves.toMatchObject({ total: null });

    aiStub.extract.mockResolvedValueOnce({ items: [item('치킨', 20000)], total: 0, readable: true });
    await expect(service.readReceipt([image()])).resolves.toMatchObject({ total: null });
  });

  it('영수증이 아니거나 품목이 하나도 없으면 422 — 직접 입력으로 안내', async () => {
    aiStub.extract.mockResolvedValueOnce({ items: [], total: null, readable: false });
    await expect(service.readReceipt([image()])).rejects.toThrow(UnprocessableEntityException);

    aiStub.extract.mockResolvedValueOnce({ items: [item('', 0)], total: 5000, readable: true });
    await expect(service.readReceipt([image()])).rejects.toThrow(UNREADABLE_RECEIPT_MESSAGE);
  });

  it('품목이 지나치게 많으면 100줄까지만', async () => {
    aiStub.extract.mockResolvedValue({
      items: Array.from({ length: 150 }, (_, i) => item(`품목${i}`, 1000)),
      total: 150000,
      readable: true,
    });

    const result = await service.readReceipt([image()]);
    expect(result.items).toHaveLength(100);
  });
});
