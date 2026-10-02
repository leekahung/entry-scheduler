import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tabName, toXlsx } from "./xlsx.js";
import { unzip } from "./xlsx.fixture.js";

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
    // A vertical tab survives a paste into Sheets, and left in it makes the
    // whole file malformed XML.
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
