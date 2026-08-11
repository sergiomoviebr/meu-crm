import { describe, expect, it } from 'vitest';
import {
  buildContactRows,
  detectDelimiter,
  parseContactCsv,
  parseTagCell,
} from './parse-contact-csv';

describe('parseTagCell', () => {
  it('splits comma-separated tags and trims whitespace', () => {
    expect(parseTagCell(' VIP , Lead ,  ')).toEqual(['VIP', 'Lead']);
  });

  it('splits semicolon-separated tags', () => {
    expect(parseTagCell('VIP; Lead; Customer')).toEqual([
      'VIP',
      'Lead',
      'Customer',
    ]);
  });

  it('de-dupes case-insensitively', () => {
    expect(parseTagCell('vip, VIP, Lead')).toEqual(['vip', 'Lead']);
  });

  it('returns empty for blank values', () => {
    expect(parseTagCell('')).toEqual([]);
    expect(parseTagCell(undefined)).toEqual([]);
  });
});

describe('parseContactCsv', () => {
  it('parses optional tags column', () => {
    const csv = `phone,name,tags
+15551234567,Alice,"VIP, Lead"
+15559876543,Bob,Customer`;

    expect(parseContactCsv(csv)).toEqual({
      hasTagsColumn: true,
      hasCompanyColumn: false,
      rows: [
        {
          phone: '+15551234567',
          name: 'Alice',
          email: undefined,
          company: undefined,
          tagNames: ['VIP', 'Lead'],
        },
        {
          phone: '+15559876543',
          name: 'Bob',
          email: undefined,
          company: undefined,
          tagNames: ['Customer'],
        },
      ],
    });
  });

  it('returns empty tagNames when tags column is absent', () => {
    const csv = `phone,name
+15551234567,Alice`;

    expect(parseContactCsv(csv)).toEqual({
      hasTagsColumn: false,
      hasCompanyColumn: false,
      rows: [
        {
          phone: '+15551234567',
          name: 'Alice',
          email: undefined,
          company: undefined,
          tagNames: [],
        },
      ],
    });
  });

  // Regression coverage for the bug this was written to fix: Excel
  // configured for pt-BR (or most non-US locales) exports "CSV" files
  // delimited by `;`, not `,`, because `,` is the decimal separator
  // there. A hardcoded comma split saw the whole row as one field.
  it('auto-detects a semicolon-delimited file (Excel pt-BR "CSV" export)', () => {
    const csv = `phone;name;email;company
+5511987654321;Maria Silva;maria@exemplo.com;Acme Ltda
+5521912345678;João Souza;joao@exemplo.com;Outra Empresa`;

    const result = parseContactCsv(csv);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      phone: '+5511987654321',
      name: 'Maria Silva',
      email: 'maria@exemplo.com',
      company: 'Acme Ltda',
      tagNames: [],
    });
    expect(result.hasCompanyColumn).toBe(true);
  });

  it('auto-detects a tab-delimited file', () => {
    const csv = 'phone\tname\n+15551234567\tAlice';
    expect(parseContactCsv(csv).rows).toEqual([
      { phone: '+15551234567', name: 'Alice', email: undefined, company: undefined, tagNames: [] },
    ]);
  });

  it('still handles a quoted comma inside a field of a semicolon-delimited file', () => {
    const csv = `phone;name;tags
+15551234567;"Doe, John";"VIP; Lead"`;
    const result = parseContactCsv(csv);
    expect(result.rows[0].name).toBe('Doe, John');
    expect(result.rows[0].tagNames).toEqual(['VIP', 'Lead']);
  });

  it('defaults to comma when the header has no delimiter characters at all', () => {
    expect(detectDelimiter('phone')).toBe(',');
  });
});

describe('buildContactRows — shared by CSV and Excel import paths', () => {
  it('builds the same shape from a pre-split header + row grid (as Excel provides)', () => {
    const result = buildContactRows(
      ['phone', 'name', 'company'],
      [
        ['+15551234567', 'Alice', 'Acme'],
        ['+15559876543', 'Bob', ''],
      ]
    );
    expect(result).toEqual({
      hasTagsColumn: false,
      hasCompanyColumn: true,
      rows: [
        { phone: '+15551234567', name: 'Alice', email: undefined, company: 'Acme', tagNames: [] },
        { phone: '+15559876543', name: 'Bob', email: undefined, company: undefined, tagNames: [] },
      ],
    });
  });

  it('returns empty when there is no phone column', () => {
    expect(buildContactRows(['name'], [['Alice']])).toEqual({
      rows: [],
      hasTagsColumn: false,
      hasCompanyColumn: false,
    });
  });

  it('skips rows with a blank phone cell', () => {
    const result = buildContactRows(
      ['phone', 'name'],
      [
        ['', 'No Phone'],
        ['+15551234567', 'Alice'],
      ]
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('Alice');
  });
});
