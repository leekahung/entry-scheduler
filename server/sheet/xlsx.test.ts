import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { tabName, toXlsx } from "./xlsx.js";

/** The parts of a written workbook, by name. */
function unzip(book: Buffer): Map<string, string> {
  const parts = new Map<string, string>();
  // Walk the central directory rather than the local headers: it is the index
  // a reader actually uses, so this checks the one the file will be read by.
  const end = book.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = book.readUInt16LE(end + 10);
  let at = book.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const compressed = book.readUInt32LE(at + 20);
    const nameLength = book.readUInt16LE(at + 28);
    const extraLength = book.readUInt16LE(at + 30);
    const commentLength = book.readUInt16LE(at + 32);
    const offset = book.readUInt32LE(at + 42);
    const name = book.toString("utf8", at + 46, at + 46 + nameLength);

    const localNameLength = book.readUInt16LE(offset + 26);
    const localExtraLength = book.readUInt16LE(offset + 28);
    const start = offset + 30 + localNameLength + localExtraLength;
    parts.set(
      name,
      inflateRawSync(book.subarray(start, start + compressed)).toString("utf8"),
    );
    at += 46 + nameLength + extraLength + commentLength;
  }
  return parts;
}

describe("the workbook writer", () => {
  it("writes one worksheet per sheet, named as given", () => {
    const parts = unzip(
      toXlsx([
        { name: "September 2026", rows: [["Client Name"], ["Ada"]] },
        { name: "August 2026", rows: [["Client Name"], ["Bo"]] },
      ]),
    );

    const workbook = parts.get("xl/workbook.xml") ?? "";
    expect(workbook).toContain('name="September 2026"');
    expect(workbook).toContain('name="August 2026"');
    expect(parts.has("xl/worksheets/sheet1.xml")).toBe(true);
    expect(parts.has("xl/worksheets/sheet2.xml")).toBe(true);
    expect(parts.get("xl/worksheets/sheet1.xml")).toContain("Ada");
    expect(parts.get("xl/worksheets/sheet2.xml")).toContain("Bo");
  });

  it("declares every part it writes, so the workbook opens", () => {
    const parts = unzip(toXlsx([{ name: "September 2026", rows: [["Name"]] }]));
    const types = parts.get("[Content_Types].xml") ?? "";
    expect(types).toContain("/xl/workbook.xml");
    expect(types).toContain("/xl/styles.xml");
    expect(types).toContain("/xl/worksheets/sheet1.xml");
    expect(parts.get("xl/_rels/workbook.xml.rels")).toContain(
      "worksheets/sheet1.xml",
    );
    expect(parts.has("xl/styles.xml")).toBe(true);
  });

  it("escapes the characters XML would otherwise read as markup", () => {
    const parts = unzip(
      toXlsx([{ name: "September 2026", rows: [['A & B <c> "d"']] }]),
    );
    const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).toContain("A &amp; B &lt;c&gt; &quot;d&quot;");
  });

  it("writes a leading = as text, which the CSV has to quote around", () => {
    const parts = unzip(toXlsx([{ name: "Sheet", rows: [["=SUM(A1:A9)"]] }]));
    const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
    // An inline string is never evaluated, so it needs no apostrophe in front.
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).toContain("=SUM(A1:A9)");
    expect(sheet).not.toContain("'=SUM");
  });

  it("drops the control characters XML cannot carry at all", () => {
    // A vertical tab survives a paste into a Google Sheets cell and comes
    // straight back out of the board. Left in, it is not one bad cell: the
    // file is malformed XML and no reader will open any of it.
    const vertical = String.fromCharCode(0x0b);
    const parts = unzip(
      toXlsx([{ name: "Sheet", rows: [[`Ada${vertical}Lovelace`]] }]),
    );
    const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).toContain("AdaLovelace");
    expect(sheet).not.toContain(vertical);
  });

  it("keeps the whitespace XML does allow", () => {
    const parts = unzip(
      toXlsx([{ name: "Sheet", rows: [["one\ttwo\nthree"]] }]),
    );
    expect(parts.get("xl/worksheets/sheet1.xml")).toContain("one\ttwo\nthree");
  });

  it("keeps numbers numeric, so a spreadsheet can total them", () => {
    const parts = unzip(toXlsx([{ name: "Sheet", rows: [[1.25, "1.25"]] }]));
    const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).toContain('<c r="A1"><v>1.25</v></c>');
    expect(sheet).toContain('r="B1" t="inlineStr"');
  });

  it("wraps a cell holding a newline, which would hide behind the next column", () => {
    const parts = unzip(toXlsx([{ name: "Sheet", rows: [["one\ntwo"]] }]));
    expect(parts.get("xl/worksheets/sheet1.xml")).toContain('s="1"');
  });

  it("leaves an empty cell out rather than writing a blank one", () => {
    const parts = unzip(toXlsx([{ name: "Sheet", rows: [["", "here"]] }]));
    const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).not.toContain('r="A1"');
    expect(sheet).toContain('r="B1"');
  });

  it("lettering carries past Z, so a 27th column is not written as A", () => {
    const row = Array.from({ length: 27 }, (_, i) => `c${i}`);
    const sheet = unzip(toXlsx([{ name: "Sheet", rows: [row] }])).get(
      "xl/worksheets/sheet1.xml",
    );
    expect(sheet).toContain('r="Z1"');
    expect(sheet).toContain('r="AA1"');
  });

  it("cuts a tab name to what Excel accepts", () => {
    expect(tabName("a/b:c?d*e[f]g")).toBe("a-b-c-d-e-f-g");
    expect(tabName("x".repeat(40))).toHaveLength(31);
  });

  it("dates its entries, which Windows refuses to open a zip without", () => {
    const book = toXlsx([{ name: "Sheet", rows: [["a"]] }]);
    // The first local header's MS-DOS date, at offset 12.
    expect(book.readUInt16LE(12)).not.toBe(0);
  });

  it("is a zip the system unpacks", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xlsx-"));
    const file = path.join(dir, "book.xlsx");
    writeFileSync(
      file,
      toXlsx([
        { name: "September 2026", rows: [["Client Name"], ["Ada Lovelace"]] },
        { name: "August 2026", rows: [["Client Name"], ["Bo"]] },
      ]),
    );
    // `unzip -t` verifies every entry against its own CRC, which is what a
    // hand-built archive is most likely to get wrong.
    expect(execFileSync("unzip", ["-t", file]).toString()).toContain(
      "No errors detected",
    );
  });
});
