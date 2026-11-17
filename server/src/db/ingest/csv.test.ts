import { describe, expect, it } from "vitest";
import { CsvFormatError, parseCsvRecords, parseCsvTable } from "./csv.js";

describe("parseCsvRecords", () => {
  it("reads quoted fields with commas, escaped quotes and newlines", () => {
    const text = 'a,b,c\n"Nov 1, 2026","$60,000","say ""hi""\nthere"\n';
    expect(parseCsvRecords(text)).toEqual([
      ["a", "b", "c"],
      ["Nov 1, 2026", "$60,000", 'say "hi"\nthere'],
    ]);
  });

  it("handles CRLF, a byte-order mark, blank lines and a missing final newline", () => {
    expect(parseCsvRecords("﻿a,b\r\n1,2\r\n\r\n3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("keeps empty cells, including trailing ones", () => {
    expect(parseCsvRecords("a,b,c\n1,,\n")).toEqual([["a", "b", "c"], ["1", "", ""]]);
  });

  it("rejects an unterminated quote and a quote inside an unquoted field", () => {
    expect(() => parseCsvRecords('a\n"open')).toThrow(CsvFormatError);
    expect(() => parseCsvRecords('a\nab"c"')).toThrow(/Unexpected quote/);
  });
});

describe("parseCsvTable", () => {
  const columns = ["id", "value"];

  it("maps cells by header name in any column order and numbers data rows from 1", () => {
    const table = parseCsvTable("value,id\n10,A\n20,B\n", columns, "t.csv");
    expect(table.rows).toEqual([
      { row: 1, cells: { value: "10", id: "A" } },
      { row: 2, cells: { value: "20", id: "B" } },
    ]);
  });

  it("returns rows with the wrong number of cells separately instead of guessing", () => {
    const table = parseCsvTable("id,value\nA,1\nB\nC,3,extra\n", columns, "t.csv");
    expect(table.rows.map((r) => r.row)).toEqual([1]);
    expect(table.malformedRows).toEqual([
      { row: 2, cells: ["B"] },
      { row: 3, cells: ["C", "3", "extra"] },
    ]);
  });

  it.each([
    ["missing column", "id\nA\n", /missing value/],
    ["unexpected column", "id,value,extra\nA,1,2\n", /unexpected extra/],
    ["repeated column", "id,value,value\nA,1,2\n", /repeated value/],
    ["empty file", "", /file is empty/],
  ])("rejects a header with a %s", (_label, text, message) => {
    expect(() => parseCsvTable(text, columns, "t.csv")).toThrow(message);
  });
});
