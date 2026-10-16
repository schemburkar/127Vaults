// Single-range support lets browsers/download tools resume large private installers.
// Invalid or multi-range requests are refused rather than interpreted ambiguously.
export function byteRange(header, size) {
  if (header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw Error('invalid_range');
  const start = match[1] ? Number(match[1]) : null, end = match[2] ? Number(match[2]) : null;
  if ((start !== null && (!Number.isSafeInteger(start) || start < 0 || start >= size))
    || (end !== null && (!Number.isSafeInteger(end) || end < 0))) throw Error('invalid_range');
  if (start === null) {
    if (!end) throw Error('invalid_range');
    return { offset: Math.max(0, size - end), length: Math.min(size, end) };
  }
  const last = end === null ? size - 1 : Math.min(end, size - 1);
  if (last < start) throw Error('invalid_range');
  return { offset: start, length: last - start + 1 };
}
