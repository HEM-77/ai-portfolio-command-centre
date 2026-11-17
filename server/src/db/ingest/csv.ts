// A small RFC 4180 CSV reader: quoted fields, "" escapes, commas and newlines inside quotes,
// LF or CRLF line endings, optional byte-order mark. Enough for the four Nimbus files
// (e.g. "Nov 1, 2026" and "$60,000" are quoted), so no CSV dependency is needed.

export interface CsvRow {
  /** 1-based data row number (the header is row 0), as reported in data-quality messages. */
  row: number;
  /** Cells keyed by header name, exactly as read (not trimmed). */
  cells: Record<string, string>;
}

export interface CsvTable {
  header: string[];
  rows: CsvRow[];
}

export class CsvFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvFormatError";
  }
}

/** Split CSV text into records of raw cells. Blank lines are skipped. */
export function parseCsvRecords(text: string): string[][] {
  const input = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let inQuotes = false;
  let cellWasQuoted = false;

  const endCell = () => {
    record.push(cell);
    cell = "";
    cellWasQuoted = false;
  };
  const endRecord = () => {
    endCell();
    if (!(record.length === 1 && record[0] === "" && !cellWasQuoted)) records.push(record);
    record = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      if (cell.trim() !== "") throw new CsvFormatError(`Unexpected quote inside an unquoted field near "${cell}"`);
      cell = "";
      inQuotes = true;
      cellWasQuoted = true;
    } else if (ch === ",") {
      endCell();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      endRecord();
    } else {
      cell += ch;
    }
  }
  if (inQuotes) throw new CsvFormatError("Unterminated quoted field at end of file");
  if (cell !== "" || record.length > 0) endRecord();
  return records;
}

/**
 * Parse a CSV file whose header must contain exactly `expectedColumns` (any order).
 * A missing, extra or repeated column is a file-level error. A row with the wrong number of
 * cells is returned with `cellCount` problems left to the caller, who records it as an issue.
 */
export function parseCsvTable(
  text: string,
  expectedColumns: readonly string[],
  fileName: string,
): CsvTable & { malformedRows: { row: number; cells: string[] }[] } {
  const [headerCells, ...dataRecords] = parseCsvRecords(text);
  if (!headerCells) throw new CsvFormatError(`${fileName}: file is empty`);

  const header = headerCells.map((h) => h.trim());
  const duplicates = header.filter((h, i) => header.indexOf(h) !== i);
  const missing = expectedColumns.filter((c) => !header.includes(c));
  const extra = header.filter((h) => !expectedColumns.includes(h));
  if (duplicates.length || missing.length || extra.length) {
    const parts = [
      missing.length ? `missing ${missing.join(", ")}` : "",
      extra.length ? `unexpected ${extra.join(", ")}` : "",
      duplicates.length ? `repeated ${duplicates.join(", ")}` : "",
    ].filter(Boolean);
    throw new CsvFormatError(`${fileName}: header does not match the official columns (${parts.join("; ")})`);
  }

  const rows: CsvRow[] = [];
  const malformedRows: { row: number; cells: string[] }[] = [];
  dataRecords.forEach((cells, index) => {
    const row = index + 1;
    if (cells.length !== header.length) {
      malformedRows.push({ row, cells });
      return;
    }
    rows.push({ row, cells: Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])) });
  });
  return { header, rows, malformedRows };
}
