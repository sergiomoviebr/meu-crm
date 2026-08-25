import { describe, expect, it } from 'vitest';
import { classifySalesIntent } from './intent-classifier';

describe('classifySalesIntent', () => {
  it.each([
    ['Quanto custa o trabalho?', 'PERGUNTOU_PRECO'], ['Já tenho uma agência', 'JA_TEM_AGENCIA'],
    ['Precisamos vender mais, está parado', 'PRECISA_VENDER_MAIS'], ['Me chama mês que vem', 'FALAR_DEPOIS'],
    ['Não tenho interesse', 'SEM_INTERESSE'], ['Vamos marcar uma reunião?', 'PEDIU_REUNIAO'],
  ])('classifies %s', (text, intent) => expect(classifySalesIntent(text).intent).toBe(intent));
  it('recommends human handoff for sensitive requests', () => expect(classifySalesIntent('Quero falar com uma pessoa sobre o contrato').humanHandoff).toBe(true));
  it('does not invent certainty for ambiguous replies', () => expect(classifySalesIntent('ok').confidence).toBeLessThan(0.5));
});
