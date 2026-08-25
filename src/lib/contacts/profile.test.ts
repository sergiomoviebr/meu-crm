import { describe, expect, it } from 'vitest';

import {
  ContactProfileSchema,
  formatCnpj,
  formatCpf,
  isValidCnpj,
  isValidCpf,
} from './profile';

describe('contact profile validation', () => {
  it('validates and formats a CPF without logging or coercing the identifier', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(formatCpf('52998224725')).toBe('529.982.247-25');
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('529.982.247-24')).toBe(false);
  });

  it('validates and formats a CNPJ', () => {
    expect(isValidCnpj('04.252.011/0001-10')).toBe(true);
    expect(formatCnpj('04252011000110')).toBe('04.252.011/0001-10');
    expect(isValidCnpj('00.000.000/0000-00')).toBe(false);
  });

  it('accepts birthday without year but requires day and month together', () => {
    expect(
      ContactProfileSchema.safeParse({
        phone: '+55 11 99999-9999',
        birth_day: 15,
        birth_month: 9,
      }).success
    ).toBe(true);
    expect(
      ContactProfileSchema.safeParse({
        phone: '+55 11 99999-9999',
        birth_day: 15,
      }).success
    ).toBe(false);
  });

  it('rejects invalid sensitive identifiers at the backend boundary', () => {
    const result = ContactProfileSchema.safeParse({
      phone: '+55 11 99999-9999',
      cpf: '123.456.789-00',
      cnpj: '12.345.678/0001-00',
    });
    expect(result.success).toBe(false);
  });
});
