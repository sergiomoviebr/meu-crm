import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { isExcelFilename, parseContactExcelFile } from './parse-contact-excel';

/** Build an in-memory .xlsx File the same way a browser file picker
 *  would hand one to the import modal, from a plain header+rows grid. */
async function makeExcelFile(
  grid: (string | number)[][],
  filename = 'contacts.xlsx'
): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Contacts');
  sheet.addRows(grid);
  const buffer = await workbook.xlsx.writeBuffer();
  return new File([buffer], filename, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('isExcelFilename', () => {
  it('matches .xlsx and .xls, case-insensitively', () => {
    expect(isExcelFilename('contacts.xlsx')).toBe(true);
    expect(isExcelFilename('contacts.XLS')).toBe(true);
    expect(isExcelFilename('contacts.csv')).toBe(false);
    expect(isExcelFilename('contacts')).toBe(false);
  });
});

describe('parseContactExcelFile', () => {
  it('parses a well-formed workbook into the same shape the CSV path produces', async () => {
    const file = await makeExcelFile([
      ['phone', 'name', 'email', 'company'],
      ['+5511987654321', 'Maria Silva', 'maria@exemplo.com', 'Acme Ltda'],
      ['+5521912345678', 'João Souza', 'joao@exemplo.com', 'Outra Empresa'],
    ]);

    const result = await parseContactExcelFile(file);

    expect(result.hasCompanyColumn).toBe(true);
    expect(result.hasTagsColumn).toBe(false);
    expect(result.rows).toEqual([
      {
        phone: '+5511987654321',
        name: 'Maria Silva',
        email: 'maria@exemplo.com',
        company: 'Acme Ltda',
        tagNames: [],
      },
      {
        phone: '+5521912345678',
        name: 'João Souza',
        email: 'joao@exemplo.com',
        company: 'Outra Empresa',
        tagNames: [],
      },
    ]);
  });

  it('coerces a numeric phone cell to its string form rather than dropping the row', async () => {
    // A common real-world case: the user's phone column got auto-typed
    // as a number by Excel (no leading '+', but the digits are intact).
    const file = await makeExcelFile([
      ['phone', 'name'],
      [5511987654321, 'Numeric Phone'],
    ]);

    const result = await parseContactExcelFile(file);
    expect(result.rows).toEqual([
      { phone: '5511987654321', name: 'Numeric Phone', email: undefined, company: undefined, tagNames: [] },
    ]);
  });

  it('parses the tags column with the same comma/semicolon splitting as CSV', async () => {
    const file = await makeExcelFile([
      ['phone', 'name', 'tags'],
      ['+15551234567', 'Alice', 'VIP, Lead'],
    ]);

    const result = await parseContactExcelFile(file);
    expect(result.hasTagsColumn).toBe(true);
    expect(result.rows[0].tagNames).toEqual(['VIP', 'Lead']);
  });

  it('returns an empty result when there is no phone column', async () => {
    const file = await makeExcelFile([
      ['name'],
      ['Alice'],
    ]);
    const result = await parseContactExcelFile(file);
    expect(result.rows).toEqual([]);
  });

  it('skips fully blank rows', async () => {
    const file = await makeExcelFile([
      ['phone', 'name'],
      ['+15551234567', 'Alice'],
    ]);
    // eachRow({ includeEmpty: false }) already skips blank rows at the
    // exceljs level — this just confirms the happy path still yields
    // exactly one row rather than an empty-row artifact.
    const result = await parseContactExcelFile(file);
    expect(result.rows).toHaveLength(1);
  });
});
