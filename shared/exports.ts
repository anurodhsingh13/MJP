/** Quote all cells and neutralize formula-looking text when opened in a spreadsheet. */
export function toCsv(rows: Array<Array<string | number | boolean | null | undefined>>): string {
  return '\ufeff' + rows.map(row => row.map(value => {
    let text = value == null ? '' : String(value);
    if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
}
