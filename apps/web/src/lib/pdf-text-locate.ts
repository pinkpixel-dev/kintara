/**
 * Finds a quoted passage inside a rendered PDF page and returns boxes over it.
 *
 * The quote was verified server-side against Poppler's `pdftotext` output, but
 * the boxes have to come from pdf.js, which is a different extractor that splits
 * text into runs wherever the PDF's own drawing operators did. The two disagree
 * constantly about spacing: pdf.js happily emits "high" and "light" as separate
 * runs, and `pdftotext` wraps lines wherever the page did.
 *
 * So matching ignores whitespace entirely rather than merely collapsing it. On
 * a quote of any real length a spurious cross-word match is not a practical
 * risk, and the alternative — a highlight that silently fails to place on
 * perfectly ordinary documents — is much worse.
 */

/** One run of text from `getTextContent()`, already in canvas coordinates. */
export interface TextPiece {
  str: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** pdf.js `hasEOL`: a line break follows this run. */
  endsLine: boolean;
}

export interface HighlightBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where one character of the stripped text came from. */
interface Origin {
  piece: number;
  offset: number;
}

/** Lowercases and drops every whitespace character, keeping a map back. */
function strip(pieces: TextPiece[]): { text: string; origins: Origin[] } {
  let text = "";
  const origins: Origin[] = [];
  pieces.forEach((piece, index) => {
    for (let offset = 0; offset < piece.str.length; offset += 1) {
      const character = piece.str[offset];
      if (/\s/.test(character)) continue;
      text += character.toLowerCase();
      origins.push({ piece: index, offset });
    }
  });
  return { text, origins };
}

function stripExcerpt(excerpt: string): string {
  return excerpt.replace(/\s+/g, "").toLowerCase();
}

/**
 * Boxes covering `excerpt`, one per line it spans, or an empty array when the
 * text is not on this page.
 *
 * An empty result is a normal outcome, not an error: the page may be the wrong
 * one, or the PDF may draw its text in an order that does not reconstruct.
 * Callers must handle it rather than assuming a highlight was placed.
 */
export function locatePassage(pieces: TextPiece[], excerpt: string): HighlightBox[] {
  const needle = stripExcerpt(excerpt);
  if (needle.length === 0) return [];

  const { text, origins } = strip(pieces);
  const start = text.indexOf(needle);
  if (start === -1) return [];

  // The covered character range within each piece the match touches.
  const covered = new Map<number, { from: number; to: number }>();
  for (let at = start; at < start + needle.length; at += 1) {
    const { piece, offset } = origins[at];
    const existing = covered.get(piece);
    if (existing) {
      existing.from = Math.min(existing.from, offset);
      existing.to = Math.max(existing.to, offset);
    } else {
      covered.set(piece, { from: offset, to: offset });
    }
  }

  // Line index per piece, counted from the runs that declared a break.
  const lineOf: number[] = [];
  let line = 0;
  pieces.forEach((piece, index) => {
    lineOf[index] = line;
    if (piece.endsLine) line += 1;
  });

  const byLine = new Map<number, HighlightBox[]>();
  for (const [index, range] of covered) {
    const box = boxFor(pieces[index], range.from, range.to);
    if (!box) continue;
    const existing = byLine.get(lineOf[index]);
    if (existing) existing.push(box);
    else byLine.set(lineOf[index], [box]);
  }

  return [...byLine.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, boxes]) => merge(boxes));
}

/**
 * The slice of one run's box covering characters `from` through `to`.
 *
 * Interpolated across the run by character count. Proportional spacing makes
 * that an approximation, but a highlight is a coloured rectangle over prose —
 * a pixel or two at each end is invisible, and the exact per-glyph advances are
 * not available here.
 */
function boxFor(piece: TextPiece, from: number, to: number): HighlightBox | null {
  const length = piece.str.length;
  if (length === 0 || piece.width <= 0) return null;
  const startFraction = from / length;
  const endFraction = Math.min(to + 1, length) / length;
  return {
    x: piece.left + startFraction * piece.width,
    y: piece.top,
    w: (endFraction - startFraction) * piece.width,
    h: piece.height,
  };
}

/** One box around everything on a line. */
function merge(boxes: HighlightBox[]): HighlightBox {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * The boxes an annotation draws on a given page.
 *
 * Two shapes are stored. A hand-drawn highlight is one box, written as
 * `{page, x, y, w, h}` since the reader shipped. An accepted AI passage is
 * `{page, boxes: [...]}`, because a quote that wraps needs one box per line and
 * a single rectangle around all of them would cover the margins in between.
 * The server treats the field as opaque, so both shapes round-trip untouched.
 */
export function highlightBoxes(serializedPosition: string, page: number): HighlightBox[] {
  let position: unknown;
  try {
    position = JSON.parse(serializedPosition);
  } catch {
    return [];
  }
  if (typeof position !== "object" || position === null) return [];
  const shape = position as { page?: number; boxes?: unknown; x?: number; y?: number; w?: number; h?: number };
  if (shape.page !== page) return [];
  if (Array.isArray(shape.boxes)) {
    return shape.boxes.filter(isBox);
  }
  return isBox(shape) ? [{ x: shape.x, y: shape.y, w: shape.w, h: shape.h }] : [];
}

function isBox(value: unknown): value is HighlightBox {
  const box = value as HighlightBox;
  return (
    typeof box?.x === "number" &&
    typeof box?.y === "number" &&
    typeof box?.w === "number" &&
    typeof box?.h === "number"
  );
}
