/** Export rows to .xlsx with auto column widths (same behaviour as the original pages). */
export async function exportSheet(headers: string[], rows: (string | number)[][], sheetName: string, fileName: string) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((h, i) => {
    const max = Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length));
    return { wch: Math.min(max + 2, 50) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, fileName);
}

export function dateSpan(from: string, to: string) {
  return to && to !== from ? `${from}_to_${to}` : from;
}
