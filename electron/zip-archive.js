// A small streaming ZIP writer and reader for full backups (electron/full-backup.js). A media library can be many gigabytes, so nothing here
// holds a whole file or the whole archive in memory, which is why jszip is not used. Files are streamed in, and the CRC and sizes are
// written back into each local header once its data is on disk (positional writes), so no data descriptors are needed and every file is read
// once. ZIP64 records are written only when an entry, an offset or the entry count passes the classic limits, so ordinary backups open in
// any unzip tool, and large ones open in Windows Explorer and 7-Zip.
//
// The reader handles STORE and DEFLATE entries, with and without ZIP64. It never trusts the archive: output is capped at the declared size,
// and every entry's CRC and length are checked before its file is kept.
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

export const STORE = 0;
export const DEFLATE = 8;

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EXTRA_ID = 0x0001;
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;
/** A central directory bigger than this is not one this app wrote (about a million entries). */
const MAX_DIRECTORY_BYTES = 256 * 1024 * 1024;

/** A problem with the archive itself, as a sentence the operator can read. */
export class ZipError extends Error {}

const damaged = (detail) => new ZipError(`This backup file is damaged or incomplete (${detail}).`);

function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function zip64Extra(values) {
  const extra = Buffer.alloc(4 + values.length * 8);
  extra.writeUInt16LE(ZIP64_EXTRA_ID, 0);
  extra.writeUInt16LE(values.length * 8, 2);
  values.forEach((value, i) => extra.writeBigUInt64LE(BigInt(value), 4 + i * 8));
  return extra;
}

async function writeFully(handle, buffer, position) {
  let written = 0;
  while (written < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, written, buffer.length - written, position + written);
    if (bytesWritten === 0) throw new Error('The disk accepted no more data.');
    written += bytesWritten;
  }
}

async function readFully(handle, position, length) {
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const { bytesRead } = await handle.read(buffer, read, length - read, position + read);
    if (bytesRead === 0) throw damaged('it ends early');
    read += bytesRead;
  }
  return buffer;
}

/**
 * Opens `target` for writing (replacing it) and returns { addFile, addBuffer, finish, abort }. Entries are added one at a time, in order.
 * `limits` exists for the tests, which cannot write 4 GB files: an entry, an offset or a count at or past a limit gets a ZIP64 record.
 */
export async function createZipWriter(target, { limits = {} } = {}) {
  const sizeLimit = limits.size ?? MAX32;
  const countLimit = limits.count ?? MAX16;
  const handle = await fs.promises.open(target, 'w');
  const entries = [];
  let offset = 0;
  let closed = false;

  const append = async (buffer) => {
    await writeFully(handle, buffer, offset);
    offset += buffer.length;
  };

  /** Streams `source` (a Readable) in as `name`. `size` is the expected length, which decides the ZIP64 header up front. */
  async function addStream(name, source, { method = STORE, size = 0, mtime = new Date() } = {}) {
    const nameBytes = Buffer.from(name, 'utf8');
    if (nameBytes.length > MAX16) throw new Error(`The file name is too long for a backup: ${name}`);
    // Only stored entries can be this large here: the caller deflates small files only.
    const large = size >= sizeLimit;
    const entryMethod = large ? STORE : method;
    const { time, date } = dosDateTime(mtime);
    const headerAt = offset;
    const extra = large ? zip64Extra([0, 0]) : Buffer.alloc(0);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_SIG, 0);
    header.writeUInt16LE(large ? 45 : 20, 4);
    header.writeUInt16LE(FLAG_UTF8, 6);
    header.writeUInt16LE(entryMethod, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    // The CRC (14) and sizes (18, 22) are written back once the data is in.
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(extra.length, 28);
    await append(Buffer.concat([header, nameBytes, extra]));

    const dataAt = offset;
    let crc = 0;
    let length = 0;
    const measure = async function* (chunks) {
      for await (const chunk of chunks) {
        crc = zlib.crc32(chunk, crc);
        length += chunk.length;
        yield chunk;
      }
    };
    const sink = async (chunks) => {
      for await (const chunk of chunks) await append(chunk);
    };
    if (entryMethod === DEFLATE) await pipeline(source, measure, zlib.createDeflateRaw(), sink);
    else await pipeline(source, measure, sink);
    const compressed = offset - dataAt;
    if (!large && (length >= sizeLimit || compressed >= sizeLimit)) throw new Error(`${name} grew past 4 GB while it was being saved.`);

    const sizes = Buffer.alloc(12);
    sizes.writeUInt32LE(crc >>> 0, 0);
    sizes.writeUInt32LE(large ? MAX32 : compressed, 4);
    sizes.writeUInt32LE(large ? MAX32 : length, 8);
    await writeFully(handle, sizes, headerAt + 14);
    if (large) await writeFully(handle, zip64Extra([length, compressed]), headerAt + 30 + nameBytes.length);

    entries.push({ nameBytes, method: entryMethod, time, date, crc: crc >>> 0, compressed, length, headerAt, large });
  }

  return {
    /** Adds the file at `file` as `name`. The file is opened first, so a file that vanished throws before anything is written. */
    async addFile(name, file, { method = STORE } = {}) {
      const input = await fs.promises.open(file, 'r');
      try {
        const stat = await input.stat();
        await addStream(name, input.createReadStream({ autoClose: false }), { method, size: stat.size, mtime: stat.mtime });
      } finally {
        await input.close();
      }
    },

    async addBuffer(name, buffer, { method = DEFLATE, mtime = new Date() } = {}) {
      await addStream(name, Readable.from([buffer]), { method, size: buffer.length, mtime });
    },

    /** Writes the central directory and closes the file. Returns the archive's size in bytes. */
    async finish() {
      const directoryAt = offset;
      for (const entry of entries) {
        const lengthLarge = entry.large || entry.length >= sizeLimit;
        const compressedLarge = entry.large || entry.compressed >= sizeLimit;
        const offsetLarge = entry.headerAt >= sizeLimit;
        const values = [];
        if (lengthLarge) values.push(entry.length);
        if (compressedLarge) values.push(entry.compressed);
        if (offsetLarge) values.push(entry.headerAt);
        const extra = values.length ? zip64Extra(values) : Buffer.alloc(0);
        const version = values.length ? 45 : 20;

        const record = Buffer.alloc(46);
        record.writeUInt32LE(CENTRAL_SIG, 0);
        record.writeUInt16LE(version, 4);
        record.writeUInt16LE(version, 6);
        record.writeUInt16LE(FLAG_UTF8, 8);
        record.writeUInt16LE(entry.method, 10);
        record.writeUInt16LE(entry.time, 12);
        record.writeUInt16LE(entry.date, 14);
        record.writeUInt32LE(entry.crc, 16);
        record.writeUInt32LE(compressedLarge ? MAX32 : entry.compressed, 20);
        record.writeUInt32LE(lengthLarge ? MAX32 : entry.length, 24);
        record.writeUInt16LE(entry.nameBytes.length, 28);
        record.writeUInt16LE(extra.length, 30);
        record.writeUInt32LE(offsetLarge ? MAX32 : entry.headerAt, 42);
        await append(Buffer.concat([record, entry.nameBytes, extra]));
      }
      const directorySize = offset - directoryAt;
      const count = entries.length;

      if (count >= countLimit || directoryAt >= sizeLimit || directorySize >= sizeLimit) {
        const recordAt = offset;
        const record = Buffer.alloc(56);
        record.writeUInt32LE(ZIP64_EOCD_SIG, 0);
        record.writeBigUInt64LE(44n, 4);
        record.writeUInt16LE(45, 12);
        record.writeUInt16LE(45, 14);
        record.writeBigUInt64LE(BigInt(count), 24);
        record.writeBigUInt64LE(BigInt(count), 32);
        record.writeBigUInt64LE(BigInt(directorySize), 40);
        record.writeBigUInt64LE(BigInt(directoryAt), 48);
        await append(record);
        const locator = Buffer.alloc(20);
        locator.writeUInt32LE(ZIP64_LOCATOR_SIG, 0);
        locator.writeBigUInt64LE(BigInt(recordAt), 8);
        locator.writeUInt32LE(1, 16);
        await append(locator);
      }

      const end = Buffer.alloc(22);
      end.writeUInt32LE(EOCD_SIG, 0);
      end.writeUInt16LE(count >= countLimit ? MAX16 : count, 8);
      end.writeUInt16LE(count >= countLimit ? MAX16 : count, 10);
      end.writeUInt32LE(directorySize >= sizeLimit ? MAX32 : directorySize, 12);
      end.writeUInt32LE(directoryAt >= sizeLimit ? MAX32 : directoryAt, 16);
      await append(end);
      closed = true;
      await handle.close();
      return offset;
    },

    /** Closes the file without finishing it. The caller removes it. */
    async abort() {
      if (closed) return;
      closed = true;
      await handle.close().catch(() => {});
    },
  };
}

function readZip64Extra(extra, wanted) {
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at);
    const size = extra.readUInt16LE(at + 2);
    if (id === ZIP64_EXTRA_ID) {
      const values = {};
      let field = at + 4;
      for (const key of wanted) {
        if (field + 8 > at + 4 + size) throw damaged('a ZIP64 record is short');
        values[key] = Number(extra.readBigUInt64LE(field));
        field += 8;
      }
      return values;
    }
    at += 4 + size;
  }
  throw damaged('a ZIP64 record is missing');
}

/**
 * Opens a ZIP file for reading. Returns { entries, readEntry, extractEntry, close }. Each entry is
 * { name, method, crc, compressedSize, size, headerOffset, encrypted, directory }. Throws ZipError for a file that is not a ZIP.
 */
export async function openZip(file) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { size: fileSize } = await handle.stat();
    if (fileSize < 22) throw new ZipError('This file is not a backup archive (.zip).');
    const tailLength = Math.min(fileSize, 22 + MAX16);
    const tailAt = fileSize - tailLength;
    const tail = await readFully(handle, tailAt, tailLength);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === EOCD_SIG && i + 22 + tail.readUInt16LE(i + 20) <= tail.length) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new ZipError('This file is not a backup archive (.zip).');
    if (tail.readUInt16LE(end + 4) !== 0 || tail.readUInt16LE(end + 6) !== 0) throw new ZipError('Split or multi-part archives cannot be restored.');

    let count = tail.readUInt16LE(end + 10);
    let directorySize = tail.readUInt32LE(end + 12);
    let directoryAt = tail.readUInt32LE(end + 16);
    if (count === MAX16 || directorySize === MAX32 || directoryAt === MAX32) {
      const locatorAt = tailAt + end - 20;
      if (locatorAt < 0) throw damaged('the ZIP64 locator is missing');
      const locator = await readFully(handle, locatorAt, 20);
      if (locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIG) throw damaged('the ZIP64 locator is missing');
      const recordAt = Number(locator.readBigUInt64LE(8));
      if (recordAt + 56 > fileSize) throw damaged('the ZIP64 directory record is outside the file');
      const record = await readFully(handle, recordAt, 56);
      if (record.readUInt32LE(0) !== ZIP64_EOCD_SIG) throw damaged('the ZIP64 directory record is missing');
      count = Number(record.readBigUInt64LE(32));
      directorySize = Number(record.readBigUInt64LE(40));
      directoryAt = Number(record.readBigUInt64LE(48));
    }
    if (directoryAt + directorySize > fileSize) throw damaged('the file list is outside the file');
    if (directorySize > MAX_DIRECTORY_BYTES) throw new ZipError('This archive lists more files than a backup can hold.');

    const directory = await readFully(handle, directoryAt, directorySize);
    const entries = [];
    let at = 0;
    for (let i = 0; i < count; i += 1) {
      if (at + 46 > directory.length || directory.readUInt32LE(at) !== CENTRAL_SIG) throw damaged('the file list is cut short');
      const flags = directory.readUInt16LE(at + 8);
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      const next = at + 46 + nameLength + extraLength + commentLength;
      if (next > directory.length) throw damaged('the file list is cut short');
      const name = directory.toString(flags & FLAG_UTF8 ? 'utf8' : 'latin1', at + 46, at + 46 + nameLength);
      let compressedSize = directory.readUInt32LE(at + 20);
      let size = directory.readUInt32LE(at + 24);
      let headerOffset = directory.readUInt32LE(at + 42);
      const wanted = [];
      if (size === MAX32) wanted.push('size');
      if (compressedSize === MAX32) wanted.push('compressedSize');
      if (headerOffset === MAX32) wanted.push('headerOffset');
      if (wanted.length) {
        const values = readZip64Extra(directory.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength), wanted);
        size = values.size ?? size;
        compressedSize = values.compressedSize ?? compressedSize;
        headerOffset = values.headerOffset ?? headerOffset;
      }
      entries.push({
        name,
        method: directory.readUInt16LE(at + 10),
        crc: directory.readUInt32LE(at + 16),
        compressedSize,
        size,
        headerOffset,
        encrypted: (flags & FLAG_ENCRYPTED) !== 0,
        directory: name.endsWith('/') || name.endsWith('\\'),
      });
      at = next;
    }

    /** The entry's data as a Readable of its uncompressed bytes, checked against the CRC and size as it is read. */
    async function openEntry(entry) {
      if (entry.encrypted) throw new ZipError(`${entry.name} is password-protected, so it cannot be restored.`);
      if (entry.method !== STORE && entry.method !== DEFLATE) throw new ZipError(`${entry.name} uses a compression this app cannot read.`);
      const local = await readFully(handle, entry.headerOffset, 30);
      if (local.readUInt32LE(0) !== LOCAL_SIG) throw damaged(`${entry.name} has no file header`);
      const dataAt = entry.headerOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      if (dataAt + entry.compressedSize > fileSize) throw damaged(`${entry.name} runs past the end of the file`);
      const raw = entry.compressedSize === 0 ? Readable.from([]) : fs.createReadStream(file, { start: dataAt, end: dataAt + entry.compressedSize - 1 });
      let crc = 0;
      let length = 0;
      const check = async function* (chunks) {
        for await (const chunk of chunks) {
          length += chunk.length;
          // Never more than the archive declared, so a crafted entry cannot fill the disk.
          if (length > entry.size) throw damaged(`${entry.name} is longer than its listed size`);
          crc = zlib.crc32(chunk, crc);
          yield chunk;
        }
        if (length !== entry.size || crc >>> 0 !== entry.crc) throw damaged(`${entry.name} failed its checksum`);
      };
      return entry.method === DEFLATE ? [raw, zlib.createInflateRaw(), check] : [raw, check];
    }

    return {
      entries,

      /** A small entry's contents (a manifest). Refuses anything over `limit` bytes. */
      async readEntry(entry, limit = 1024 * 1024) {
        if (entry.size > limit) throw new ZipError(`${entry.name} is too large to read.`);
        const chunks = [];
        await pipeline(...(await openEntry(entry)), async (source) => {
          for await (const chunk of source) chunks.push(chunk);
        });
        return Buffer.concat(chunks);
      },

      /** Writes the entry to `dest`, which must not exist. A file that fails its checks is removed. */
      async extractEntry(entry, dest) {
        try {
          await pipeline(...(await openEntry(entry)), fs.createWriteStream(dest, { flags: 'wx' }));
        } catch (err) {
          // 'wx' failing means the file was already there and is not ours to remove.
          if (err?.code !== 'EEXIST') await fs.promises.rm(dest, { force: true }).catch(() => {});
          throw err;
        }
      },

      close: () => handle.close().catch(() => {}),
    };
  } catch (err) {
    await handle.close().catch(() => {});
    throw err;
  }
}
