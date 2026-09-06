import { crc32, deflateRawSync } from "node:zlib";

/**
 * Writes an .xlsx workbook: a zip of a few XML parts, and nothing else.
 *
 * Every library that does this either ships a dependency tree far larger than
 * the job or is a fork of an abandoned one; text cells in a workbook need only
 * what is here.
 */

/** A sheet as its tab name and its rows, header row included. */
export type Sheet = { name: string; rows: (string | number)[][] };

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/**
 * Characters XML 1.0 has no way to carry: the C0 controls other than tab,
 * newline and carriage return. There is no escape for these — a numeric
 * reference is just as illegal — so they come out.
 *
 * A cell can hold one after a paste into Google Sheets, and one of them
 * anywhere in the file makes the whole workbook unreadable rather than the one
 * cell: a parser rejects it as malformed XML and Excel offers to repair it.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

const escapeXml = (value: string) =>
  value.replace(ILLEGAL, "").replace(/[&<>"]/g, (char) => ESCAPES[char]);

/** Excel forbids : \ / ? * [ ] in a tab name, and caps it at 31 characters. */
export function tabName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, "-").slice(0, 31);
}

/** A zero-based column index as its spreadsheet letters: 0 → A, 26 → AA. */
function columnRef(index: number): string {
  let ref = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    ref = String.fromCharCode(65 + ((n - 1) % 26)) + ref;
  }
  return ref;
}

/**
 * A sheet's rows as worksheet XML.
 *
 * Text goes in as an inline string, which Excel never evaluates — so a name
 * beginning "=" lands as itself and needs none of the quoting the CSV export
 * has to do.
 */
function sheetXml(rows: (string | number)[][]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          if (value === "" || value === null || value === undefined) return "";
          const ref = `${columnRef(c)}${r + 1}`;
          if (typeof value === "number") {
            return `<c r="${ref}"><v>${value}</v></c>`;
          }
          // Style 1 wraps; a note with a newline in it is one line high
          // otherwise, with the rest of it hidden behind the next column.
          const style = value.includes("\n") ? ' s="1"' : "";
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/**
 * The parts as a zip archive.
 *
 * Deflated, with a real MS-DOS timestamp on every entry: left at zero they
 * date to "0000-00-00", which Windows Explorer's own zip handler refuses to
 * open.
 */
function zip(files: [string, string][]): Buffer {
  const now = new Date();
  const time =
    (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date =
    ((now.getFullYear() - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate();
  // Bit 11 marks the entry name as UTF-8.
  const FLAGS = 0x0800;
  const DEFLATED = 8;

  const chunks: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const [name, text] of files) {
    const content = Buffer.from(text, "utf8");
    const deflated = deflateRawSync(content);
    const checksum = crc32(content);
    // Always "/" in the archive, whatever separator the host uses.
    const path = Buffer.from(name, "utf8");

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(FLAGS, 6);
    header.writeUInt16LE(DEFLATED, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(deflated.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(path.length, 26);
    chunks.push(header, path, deflated);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(FLAGS, 8);
    entry.writeUInt16LE(DEFLATED, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(deflated.length, 20);
    entry.writeUInt32LE(content.length, 24);
    entry.writeUInt16LE(path.length, 28);
    entry.writeUInt32LE(offset, 42);
    directory.push(entry, path);
    offset += header.length + path.length + deflated.length;
  }

  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, central, end]);
}

// One unstyled format and one that wraps. Excel reads a workbook without a
// styles part, but it is the strictest reader of the format and there is no
// reason to make it decide.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs></styleSheet>`;

/** A workbook with one tab per sheet, in the order given. */
export function toXlsx(sheets: Sheet[]): Buffer {
  const tabs = sheets.map((sheet, index) => ({
    name: tabName(sheet.name),
    rows: sheet.rows,
    id: index + 1,
  }));

  return zip([
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${tabs
        .map(
          (tab) =>
            `<Override PartName="/xl/worksheets/sheet${tab.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("")}</Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tabs
        .map(
          (tab) =>
            `<sheet name="${escapeXml(tab.name)}" sheetId="${tab.id}" r:id="rId${tab.id}"/>`,
        )
        .join("")}</sheets></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tabs
        .map(
          (tab) =>
            `<Relationship Id="rId${tab.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${tab.id}.xml"/>`,
        )
        .join(
          "",
        )}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ["xl/styles.xml", STYLES],
    ...tabs.map((tab): [string, string] => [
      `xl/worksheets/sheet${tab.id}.xml`,
      sheetXml(tab.rows),
    ]),
  ]);
}
