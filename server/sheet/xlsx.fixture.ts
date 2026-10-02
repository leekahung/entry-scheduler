import { inflateRawSync } from "node:zlib";

/**
 * The parts of a written workbook, by name.
 * Walks the central directory, the index a real reader uses.
 */
export function unzip(book: Buffer): Map<string, string> {
  const parts = new Map<string, string>();
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
