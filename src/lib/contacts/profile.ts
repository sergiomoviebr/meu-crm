import { z } from 'zod';

import type {
  ContactRelationshipStatus,
  ContactRelationshipType,
} from '@/types';

export const CONTACT_RELATIONSHIP_TYPES: readonly ContactRelationshipType[] = [
  'client',
  'lead',
  'prospect',
  'partner',
  'supplier',
  'other',
] as const;

export const CONTACT_RELATIONSHIP_STATUSES: readonly ContactRelationshipStatus[] =
  ['active', 'inactive', 'nurturing', 'qualified', 'unqualified'] as const;

export function onlyDigits(value: string | null | undefined): string {
  return value?.replace(/\D/g, '') ?? '';
}

export function isValidCpf(value: string): boolean {
  const digits = onlyDigits(value);
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;

  const calculate = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return (
    calculate(9) === Number(digits[9]) && calculate(10) === Number(digits[10])
  );
}

export function isValidCnpj(value: string): boolean {
  const digits = onlyDigits(value);
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;

  const calculate = (baseLength: 12 | 13) => {
    const weights =
      baseLength === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce(
      (total, weight, index) => total + Number(digits[index]) * weight,
      0
    );
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  return (
    calculate(12) === Number(digits[12]) && calculate(13) === Number(digits[13])
  );
}

export function formatCpf(value: string): string {
  return onlyDigits(value)
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function formatCnpj(value: string): string {
  return onlyDigits(value)
    .slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

const nullableText = (max: number) =>
  z.union([z.string().trim().max(max), z.null()]).optional();
const nullableTimestamp = z
  .union([z.string().datetime({ offset: true }), z.null()])
  .optional();

export const ContactProfileSchema = z
  .object({
    name: nullableText(160),
    preferred_name: nullableText(100),
    company: nullableText(160),
    job_title: nullableText(120),
    email: z
      .union([z.string().trim().email().max(254), z.literal(''), z.null()])
      .optional(),
    phone: z.string().trim().min(7).max(40),
    whatsapp: nullableText(40),
    secondary_phone: nullableText(40),
    cpf: nullableText(20),
    cnpj: nullableText(24),
    birth_day: z.union([z.number().int().min(1).max(31), z.null()]).optional(),
    birth_month: z
      .union([z.number().int().min(1).max(12), z.null()])
      .optional(),
    birth_year: z
      .union([z.number().int().min(1900).max(2200), z.null()])
      .optional(),
    notes: nullableText(5_000),
    address_zip: nullableText(20),
    address_street: nullableText(180),
    address_number: nullableText(30),
    address_complement: nullableText(120),
    address_neighborhood: nullableText(120),
    address_city: nullableText(120),
    address_state: nullableText(80),
    address_country: nullableText(80),
    relationship_type: z
      .enum(
        CONTACT_RELATIONSHIP_TYPES as [
          ContactRelationshipType,
          ...ContactRelationshipType[],
        ]
      )
      .nullable()
      .optional(),
    source: nullableText(120),
    owner_user_id: z.union([z.string().uuid(), z.null()]).optional(),
    relationship_status: z
      .enum(
        CONTACT_RELATIONSHIP_STATUSES as [
          ContactRelationshipStatus,
          ...ContactRelationshipStatus[],
        ]
      )
      .nullable()
      .optional(),
    first_contact_at: nullableTimestamp,
    last_contact_at: nullableTimestamp,
    next_follow_up_at: nullableTimestamp,
  })
  .superRefine((value, ctx) => {
    if ((value.birth_day == null) !== (value.birth_month == null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['birth_day'],
        message: 'Informe o dia e o mês do aniversário.',
      });
    }
    if (value.cpf && !isValidCpf(value.cpf)) {
      ctx.addIssue({ code: 'custom', path: ['cpf'], message: 'CPF inválido.' });
    }
    if (value.cnpj && !isValidCnpj(value.cnpj)) {
      ctx.addIssue({
        code: 'custom',
        path: ['cnpj'],
        message: 'CNPJ inválido.',
      });
    }
  });

export type ContactProfileInput = z.infer<typeof ContactProfileSchema>;

/** Convert blank optional strings to null before persistence. */
export function cleanContactProfile(
  input: ContactProfileInput
): ContactProfileInput {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      typeof value === 'string' && value.trim() === '' ? null : value,
    ])
  ) as ContactProfileInput;
}
