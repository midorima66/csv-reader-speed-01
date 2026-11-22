// Fast drop-in replacement for csv-reader 1.0.0 (make.fun csv-reader-speed-01).
//
// Returns exactly csv-reader 1.0.0's answer {columns, rows, errors} for every
// input {text, header}, following the same broken-row policy:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a quoted field runs to the next quote that is not doubled ("" is one
//     quote; CRLF and lone CR inside read as LF); text after the closing quote
//     up to the next comma or line break is appended as it stands (quote_junk
//     when anything was appended); a quote that never closes is a literal
//     character and the rest is re-read as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows are
//     padded (short_row) or cut (long_row) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line the record starts
//     on (counting every LF, CRLF and lone CR inside quotes), row the record's
//     index in rows (null for the header), in the order met.
//
// Speed: the reference builds every field a character at a time. This reads
// each field with a tight charCodeAt scan that only finds where the field
// ends, then takes the field with one slice; segment stitching happens only
// on the rare paths that need it (stray CRs, escaped quotes, CRs in quotes).

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  // The field most recently read: its ending and how many characters the
  // last unquoted read kept (for quote_junk).
  let fEnded = END;
  let fAdded = 0;

  // Reads unquoted characters onto `prefix` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Returns the field.
  function readUnquoted(prefix) {
    let segStart = pos;
    let parts = null;
    let kept = 0;
    while (pos < n) {
      const cc = text.charCodeAt(pos);
      if (cc === 44) {
        // ','
        const end = pos;
        pos += 1;
        fEnded = COMMA;
        if (parts === null) {
          fAdded = end - segStart;
          return prefix === '' ? text.slice(segStart, end) : prefix + text.slice(segStart, end);
        }
        kept += end - segStart;
        fAdded = kept;
        parts.push(text.slice(segStart, end));
        return prefix + parts.join('');
      }
      if (cc === 10) {
        // '\n'
        const end = pos;
        pos += 1;
        line += 1;
        fEnded = LINE_BREAK;
        if (parts === null) {
          fAdded = end - segStart;
          return prefix === '' ? text.slice(segStart, end) : prefix + text.slice(segStart, end);
        }
        kept += end - segStart;
        fAdded = kept;
        parts.push(text.slice(segStart, end));
        return prefix + parts.join('');
      }
      if (cc === 13) {
        // '\r'
        if (text.charCodeAt(pos + 1) === 10) {
          const end = pos;
          pos += 2;
          line += 1;
          fEnded = LINE_BREAK;
          if (parts === null) {
            fAdded = end - segStart;
            return prefix === '' ? text.slice(segStart, end) : prefix + text.slice(segStart, end);
          }
          kept += end - segStart;
          fAdded = kept;
          parts.push(text.slice(segStart, end));
          return prefix + parts.join('');
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (parts === null) parts = [text.slice(segStart, pos)];
        else parts.push(text.slice(segStart, pos));
        kept += pos - segStart;
        pos += 1;
        segStart = pos;
        continue;
      }
      pos += 1;
    }
    fEnded = END;
    if (parts === null) {
      fAdded = n - segStart;
      return prefix === '' ? text.slice(segStart, n) : prefix + text.slice(segStart, n);
    }
    kept += n - segStart;
    fAdded = kept;
    parts.push(text.slice(segStart, n));
    return prefix + parts.join('');
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let segStart = pos;
    let parts = null;
    let value = null;
    while (pos < n) {
      const cc = text.charCodeAt(pos);
      if (cc === 34) {
        // '"'
        if (text.charCodeAt(pos + 1) === 34) {
          if (parts === null) parts = [text.slice(segStart, pos), '"'];
          else parts.push(text.slice(segStart, pos), '"');
          pos += 2;
          segStart = pos;
          continue;
        }
        value = parts === null ? text.slice(segStart, pos) : parts.join('') + text.slice(segStart, pos);
        pos += 1;
        break;
      }
      if (cc === 13) {
        // CRLF and a lone CR inside quotes are each one LF.
        if (parts === null) parts = [text.slice(segStart, pos), '\n'];
        else parts.push(text.slice(segStart, pos), '\n');
        line += 1;
        pos += text.charCodeAt(pos + 1) === 10 ? 2 : 1;
        segStart = pos;
        continue;
      }
      if (cc === 10) line += 1;
      pos += 1;
    }
    if (value === null) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    if (pos >= n) {
      fEnded = END;
      return value;
    }
    const cc = text.charCodeAt(pos);
    if (cc === 44) {
      pos += 1;
      fEnded = COMMA;
      return value;
    }
    if (cc === 10) {
      pos += 1;
      line += 1;
      fEnded = LINE_BREAK;
      return value;
    }
    if (cc === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fEnded = LINE_BREAK;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const cc = text.charCodeAt(pos);
      if (cc === 10) {
        pos += 1;
        line += 1;
      } else if (cc === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      fields.push(quoted ? readQuoted() : readUnquoted(''));
    } while (fEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
