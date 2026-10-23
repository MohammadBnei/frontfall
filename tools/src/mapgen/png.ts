import { deflateSync, inflateSync } from "node:zlib";

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * Indexed-colour PNG with no metadata, so the same pixels always give the same
 * file. `pixels` holds one palette index per pixel, row by row.
 */
export function encodeIndexedPng(
  width: number,
  height: number,
  palette: readonly (readonly [number, number, number])[],
  pixels: Uint8Array,
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 3; // indexed colour
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width + 1)] = 0; // no filter
    rows.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("PLTE", Uint8Array.from(palette.flat())),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ]);
}

/**
 * Whether two PNG files hold the same image: same header, palette and pixel
 * rows once decompressed. Compressed bytes depend on the zlib build of Node,
 * so the generator keeps a committed thumbnail whose pixels did not change.
 */
export function samePngImage(a: Uint8Array, b: Uint8Array): boolean {
  const left = decodeChunks(a);
  const right = decodeChunks(b);
  if (!left || !right) return false;
  return (
    Buffer.compare(left.header, right.header) === 0 &&
    Buffer.compare(left.palette, right.palette) === 0 &&
    Buffer.compare(inflateSync(left.data), inflateSync(right.data)) === 0
  );
}

function decodeChunks(
  png: Uint8Array,
): { header: Buffer; palette: Buffer; data: Buffer } | undefined {
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47) return undefined;
  let header: Buffer = Buffer.alloc(0);
  let palette: Buffer = Buffer.alloc(0);
  const data: Buffer[] = [];
  for (let offset = 8; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") header = body;
    else if (type === "PLTE") palette = body;
    else if (type === "IDAT") data.push(body);
    offset += 12 + length;
  }
  return { header, palette, data: Buffer.concat(data) };
}
