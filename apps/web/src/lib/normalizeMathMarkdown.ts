/**
 * Converts the TeX delimiters commonly produced by agents into the syntax
 * understood by remark-math. Code is deliberately treated as opaque because
 * examples and snippets must retain their original source text.
 */
export function normalizeMathMarkdown(markdown: string): string {
  return splitFencedCodeBlocks(markdown)
    .map((segment) => {
      if (segment.isProtected) {
        return segment.value;
      }

      return splitIndentedCodeLines(segment.value)
        .map((indentedSegment) => {
          if (indentedSegment.isProtected) {
            return indentedSegment.value;
          }

          return splitInlineCodeSpans(indentedSegment.value)
            .map((inlineSegment) => (inlineSegment.isProtected ? inlineSegment.value : normalizeMathText(inlineSegment.value)))
            .join("");
        })
        .join("");
    })
    .join("");
}

interface MarkdownSegment {
  isProtected: boolean;
  value: string;
}

interface MarkdownContainer {
  contentStart: number;
  continuationPrefix: string;
}

function normalizeMathText(value: string): string {
  return normalizeInlineMathDelimiters(
    normalizeScreenshotClipboardMath(
      normalizeOneLineDollarDisplayMath(
        normalizeStandaloneBracketDisplayPairs(
          normalizeEmbeddedBracketDisplayMath(normalizeStandaloneDisplayMath(value)),
        ),
      ),
    ),
  );
}

function normalizeStandaloneDisplayMath(value: string): string {
  const preferredLineEnding = value.includes("\r\n") ? "\r\n" : "\n";
  let result = "";
  let index = 0;

  while (index < value.length) {
    const lineEnd = findLineEnd(value, index);
    const sourceLine = value.slice(index, lineEnd);
    const { content, lineEnding } = splitLineEnding(sourceLine);
    const normalizedLine = normalizeStandaloneDisplayLine(content, lineEnding, preferredLineEnding);

    result += normalizedLine ?? sourceLine;
    index = lineEnd;
  }

  return result;
}

function normalizeStandaloneDisplayLine(
  line: string,
  lineEnding: string,
  generatedLineEnding: string,
): string | null {
  const container = getMarkdownContainer(line);
  let mathStart = container.contentStart;

  while (line[mathStart] === " " || line[mathStart] === "\t") {
    mathStart += 1;
  }

  if (!isUnescapedDelimiter(line, mathStart, "[")) {
    return null;
  }

  const closingIndex = findClosingDelimiter(line, mathStart + 2, "]");
  if (closingIndex === -1) {
    return null;
  }

  const trailingWhitespace = line.slice(closingIndex + 2);
  if (!/^[ \t]*$/.test(trailingWhitespace)) {
    return null;
  }

  const openingPrefix = line.slice(0, mathStart);
  const leadingWhitespace = line.slice(container.contentStart, mathStart);
  const continuationPrefix = `${container.continuationPrefix}${leadingWhitespace}`;
  const body = line.slice(mathStart + 2, closingIndex);
  const separator = lineEnding || generatedLineEnding;

  return `${openingPrefix}$$${separator}${continuationPrefix}${body}${separator}${continuationPrefix}$$${trailingWhitespace}${lineEnding}`;
}

function getMarkdownContainer(line: string): MarkdownContainer {
  let index = consumeUpToThreeSpaces(line, 0);

  while (true) {
    const blockQuoteMarker = /^[ ]{0,3}>[ \t]?/.exec(line.slice(index));

    if (!blockQuoteMarker) {
      break;
    }

    index += blockQuoteMarker[0].length;
  }

  const prefixBeforeList = line.slice(0, index);
  const listMarker = /^[ ]{0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(line.slice(index));

  if (!listMarker) {
    return {
      contentStart: index,
      continuationPrefix: prefixBeforeList,
    };
  }

  const listPrefix = listMarker[0];
  return {
    contentStart: index + listPrefix.length,
    continuationPrefix: `${prefixBeforeList}${" ".repeat(listPrefix.length)}`,
  };
}

/**
 * Converts an explicit `\[ ... \]` pair that shares a line with prose into a
 * proper display block. The delimiter itself is unambiguous TeX, but we only
 * accept one pair per line so nested or mixed notation remains untouched.
 */
function normalizeEmbeddedBracketDisplayMath(value: string): string {
  const preferredLineEnding = value.includes("\r\n") ? "\r\n" : "\n";
  let result = "";
  let index = 0;

  while (index < value.length) {
    const lineEnd = findLineEnd(value, index);
    const sourceLine = value.slice(index, lineEnd);
    const { content, lineEnding } = splitLineEnding(sourceLine);
    const normalizedLine = normalizeEmbeddedBracketDisplayLine(content, lineEnding, preferredLineEnding);

    result += normalizedLine ?? sourceLine;
    index = lineEnd;
  }

  return result;
}

function normalizeEmbeddedBracketDisplayLine(
  line: string,
  lineEnding: string,
  generatedLineEnding: string,
): string | null {
  const container = getMarkdownContainer(line);
  const openingIndex = findNextTeXDelimiter(line, container.contentStart, "[");

  if (openingIndex === -1) {
    return null;
  }

  const closingIndex = findNextTeXDelimiter(line, openingIndex + 2, "]");
  const anotherOpeningIndex = findNextTeXDelimiter(line, openingIndex + 2, "[");
  if (
    closingIndex === -1 ||
    anotherOpeningIndex !== -1 ||
    findNextTeXDelimiter(line, closingIndex + 2, "]") !== -1
  ) {
    return null;
  }

  const body = line.slice(openingIndex + 2, closingIndex).trim();
  if (!body || !hasClearDisplayMathSignal(body)) {
    return null;
  }

  const beforeText = line.slice(container.contentStart, openingIndex).trimEnd();
  const afterText = line.slice(closingIndex + 2).trimStart();

  // A fully standalone pair is handled by normalizeStandaloneDisplayMath so
  // it can retain its exact surrounding whitespace.
  if (!beforeText && !afterText) {
    return null;
  }

  const separator = lineEnding || generatedLineEnding;
  const blockOpeningPrefix = beforeText ? container.continuationPrefix : line.slice(0, openingIndex);
  const lines = [
    ...(beforeText ? [line.slice(0, container.contentStart) + beforeText] : []),
    `${blockOpeningPrefix}$$`,
    `${container.continuationPrefix}${body}`,
    `${container.continuationPrefix}$$`,
    ...(afterText ? [`${container.continuationPrefix}${afterText}`] : []),
  ];

  return `${lines.join(separator)}${lineEnding}`;
}

/**
 * Handles multi-line `\[` / `\]` blocks after all one-line variants have
 * been normalized. A copied agent response may place prose immediately after
 * the closing marker (`\]where ...`); because the opening marker is already
 * on its own line and the closing marker starts its line, that boundary is
 * unambiguous and can be reflowed safely.
 */
function normalizeStandaloneBracketDisplayPairs(value: string): string {
  const generatedLineEnding = value.includes("\r\n") ? "\r\n" : "\n";
  const result: string[] = [];
  let openingIndex = -1;
  let index = 0;
  let segmentStart = 0;

  while (index < value.length) {
    if (openingIndex === -1 && isUnescapedDelimiter(value, index, "[")) {
      openingIndex = index;
      index += 2;
      continue;
    }

    if (openingIndex !== -1 && isUnescapedDelimiter(value, index, "]")) {
      const closingContext = getLeadingBracketDelimiterContext(value, index);

      if (isStandaloneBracketDelimiter(value, openingIndex) && closingContext) {
        result.push(value.slice(segmentStart, openingIndex), "$$", value.slice(openingIndex + 2, index), "$$");
        segmentStart = index + 2;

        if (closingContext.hasTrailingContent) {
          result.push(generatedLineEnding, closingContext.continuationPrefix);
        }
      }

      openingIndex = -1;
      index += 2;
      continue;
    }

    index += 1;
  }

  result.push(value.slice(segmentStart));

  return result.join("");
}

function getLeadingBracketDelimiterContext(
  value: string,
  delimiterIndex: number,
): { continuationPrefix: string; hasTrailingContent: boolean } | null {
  const lineStart = value.lastIndexOf("\n", delimiterIndex - 1) + 1;
  const lineEnd = findLineEnd(value, lineStart);
  const { content } = splitLineEnding(value.slice(lineStart, lineEnd));
  const localIndex = delimiterIndex - lineStart;
  const container = getMarkdownContainer(content);
  let contentIndex = container.contentStart;

  while (content[contentIndex] === " " || content[contentIndex] === "\t") {
    contentIndex += 1;
  }

  if (localIndex !== contentIndex) {
    return null;
  }

  return {
    continuationPrefix: `${container.continuationPrefix}${content.slice(container.contentStart, contentIndex)}`,
    hasTrailingContent: content.slice(localIndex + 2).trim().length > 0,
  };
}

function isStandaloneBracketDelimiter(value: string, delimiterIndex: number): boolean {
  const lineStart = value.lastIndexOf("\n", delimiterIndex - 1) + 1;
  const lineEnd = findLineEnd(value, lineStart);
  const { content } = splitLineEnding(value.slice(lineStart, lineEnd));
  const localIndex = delimiterIndex - lineStart;
  const container = getMarkdownContainer(content);
  let contentIndex = container.contentStart;

  while (content[contentIndex] === " " || content[contentIndex] === "\t") {
    contentIndex += 1;
  }

  return localIndex === contentIndex && /^[ \t]*$/.test(content.slice(localIndex + 2));
}

/**
 * Normalizes a single, unambiguous `$$...$$` line. It intentionally requires
 * an obvious math signal, which leaves literal doubled dollars and price-like
 * content untouched.
 */
function normalizeOneLineDollarDisplayMath(value: string): string {
  const preferredLineEnding = value.includes("\r\n") ? "\r\n" : "\n";
  let result = "";
  let index = 0;

  while (index < value.length) {
    const lineEnd = findLineEnd(value, index);
    const sourceLine = value.slice(index, lineEnd);
    const { content, lineEnding } = splitLineEnding(sourceLine);
    const normalizedLine = normalizeOneLineDollarDisplayLine(content, lineEnding, preferredLineEnding);

    result += normalizedLine ?? sourceLine;
    index = lineEnd;
  }

  return result;
}

function normalizeOneLineDollarDisplayLine(
  line: string,
  lineEnding: string,
  generatedLineEnding: string,
): string | null {
  const container = getMarkdownContainer(line);
  let mathStart = container.contentStart;

  while (line[mathStart] === " " || line[mathStart] === "\t") {
    mathStart += 1;
  }

  if (!isUnescapedDoubleDollar(line, mathStart)) {
    return null;
  }

  const closingIndex = findNextDoubleDollar(line, mathStart + 2);
  if (closingIndex === -1 || !/^[ \t]*$/.test(line.slice(closingIndex + 2))) {
    return null;
  }

  const body = line.slice(mathStart + 2, closingIndex).trim();
  if (!hasClearDisplayMathSignal(body)) {
    return null;
  }

  const openingPrefix = line.slice(0, mathStart);
  const leadingWhitespace = line.slice(container.contentStart, mathStart);
  const continuationPrefix = `${container.continuationPrefix}${leadingWhitespace}`;
  const separator = lineEnding || generatedLineEnding;

  return `${openingPrefix}$$${separator}${continuationPrefix}${body}${separator}${continuationPrefix}$$${line.slice(closingIndex + 2)}${lineEnding}`;
}

/**
 * This is intentionally narrow: it repairs the exact malformed form emitted
 * by the copied Pythagorean-triples example without treating ordinary `$…`
 * prose or currency as an unterminated equation.
 */
function normalizeScreenshotClipboardMath(value: string): string {
  const preferredLineEnding = value.includes("\r\n") ? "\r\n" : "\n";
  let result = "";
  let index = 0;

  while (index < value.length) {
    const lineEnd = findLineEnd(value, index);
    const sourceLine = value.slice(index, lineEnd);
    const { content, lineEnding } = splitLineEnding(sourceLine);
    const normalizedLine = normalizeScreenshotClipboardLine(content, lineEnding, preferredLineEnding);

    result += normalizedLine ?? sourceLine;
    index = lineEnd;
  }

  return result;
}

function normalizeScreenshotClipboardLine(
  line: string,
  lineEnding: string,
  generatedLineEnding: string,
): string | null {
  const container = getMarkdownContainer(line);
  let formulaStart = container.contentStart;

  while (line[formulaStart] === " " || line[formulaStart] === "\t") {
    formulaStart += 1;
  }

  if (line[formulaStart] !== "$" || isEscaped(line, formulaStart) || line[formulaStart + 1] === "$") {
    return null;
  }

  const boundaryIndex = line.indexOf("$$where", formulaStart + 1);
  if (boundaryIndex === -1 || !isUnescapedDoubleDollar(line, boundaryIndex)) {
    return null;
  }

  // There must be no dollar between the accidental opener and `$$where`.
  // This makes the recovery opt-in for the exact clipboard corruption rather
  // than guessing at general malformed dollar notation.
  if (line.indexOf("$", formulaStart + 1) !== boundaryIndex) {
    return null;
  }

  const formula = line.slice(formulaStart + 1, boundaryIndex).trim();
  const trailingProse = line.slice(boundaryIndex + 2);

  if (!looksLikeScreenshotFormula(formula) || !hasPairedInlineMath(trailingProse)) {
    return null;
  }

  const openingPrefix = line.slice(0, formulaStart);
  const leadingWhitespace = line.slice(container.contentStart, formulaStart);
  const continuationPrefix = `${container.continuationPrefix}${leadingWhitespace}`;
  const separator = lineEnding || generatedLineEnding;

  return `${openingPrefix}$$${separator}${continuationPrefix}${formula}${separator}${continuationPrefix}$$${separator}${continuationPrefix}${trailingProse}${lineEnding}`;
}

function looksLikeScreenshotFormula(value: string): boolean {
  const equationCount = value.match(/=/g)?.length ?? 0;
  return value.includes("\\qquad") && equationCount >= 2;
}

function hasPairedInlineMath(value: string): boolean {
  let openingIndex = -1;

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "$" || isEscaped(value, index) || value[index + 1] === "$") {
      continue;
    }

    if (openingIndex === -1) {
      openingIndex = index;
      continue;
    }

    if (hasClearDisplayMathSignal(value.slice(openingIndex + 1, index))) {
      return true;
    }

    openingIndex = -1;
  }

  return false;
}

function hasClearDisplayMathSignal(value: string): boolean {
  return /\\[a-zA-Z]+|[=<>^_{}]|[+*/]|[±×÷∈∑∫√∞]/u.test(value);
}

function normalizeInlineMathDelimiters(value: string): string {
  const result: string[] = [];
  let openingIndex = -1;
  let index = 0;
  let segmentStart = 0;

  while (index < value.length) {
    if (openingIndex === -1 && isUnescapedDelimiter(value, index, "(")) {
      openingIndex = index;
      index += 2;
      continue;
    }

    if (openingIndex !== -1 && isUnescapedDelimiter(value, index, ")")) {
      result.push(value.slice(segmentStart, openingIndex), "$", value.slice(openingIndex + 2, index), "$");
      segmentStart = index + 2;
      openingIndex = -1;
      index += 2;
      continue;
    }

    index += 1;
  }

  result.push(value.slice(segmentStart));

  return result.join("");
}

function findNextTeXDelimiter(value: string, startIndex: number, delimiterCharacter: "[" | "]"): number {
  for (let index = startIndex; index < value.length - 1; index += 1) {
    if (isUnescapedDelimiter(value, index, delimiterCharacter)) {
      return index;
    }
  }

  return -1;
}

function isUnescapedDoubleDollar(value: string, index: number): boolean {
  return value[index] === "$" && value[index + 1] === "$" && !isEscaped(value, index);
}

function findNextDoubleDollar(value: string, startIndex: number): number {
  for (let index = startIndex; index < value.length - 1; index += 1) {
    if (isUnescapedDoubleDollar(value, index)) {
      return index;
    }
  }

  return -1;
}

function splitIndentedCodeLines(value: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let index = 0;
  let unprotectedStart = 0;

  while (index < value.length) {
    const lineEnd = findLineEnd(value, index);
    const line = value.slice(index, lineEnd);

    if (/^(?: {4}|\t)/.test(line)) {
      if (unprotectedStart < index) {
        segments.push({ isProtected: false, value: value.slice(unprotectedStart, index) });
      }

      segments.push({ isProtected: true, value: line });
      unprotectedStart = lineEnd;
    }

    index = lineEnd;
  }

  if (unprotectedStart < value.length) {
    segments.push({ isProtected: false, value: value.slice(unprotectedStart) });
  }

  return segments;
}

function splitFencedCodeBlocks(value: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let index = 0;
  let unprotectedStart = 0;

  while (index < value.length) {
    const lineEnd = findLineEnd(value, index);
    const openingFence = getOpeningFence(value.slice(index, lineEnd));

    if (!openingFence) {
      index = lineEnd;
      continue;
    }

    if (unprotectedStart < index) {
      segments.push({ isProtected: false, value: value.slice(unprotectedStart, index) });
    }

    const fenceEnd = findClosingFence(value, lineEnd, openingFence);
    segments.push({ isProtected: true, value: value.slice(index, fenceEnd) });
    index = fenceEnd;
    unprotectedStart = fenceEnd;
  }

  if (unprotectedStart < value.length) {
    segments.push({ isProtected: false, value: value.slice(unprotectedStart) });
  }

  return segments;
}

function splitInlineCodeSpans(value: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let index = 0;
  let unprotectedStart = 0;

  while (index < value.length) {
    if (value[index] !== "`" || isEscaped(value, index)) {
      index += 1;
      continue;
    }

    const delimiterLength = countConsecutiveCharacters(value, index, "`");
    const closingIndex = findInlineCodeSpanClose(value, index + delimiterLength, delimiterLength);

    if (closingIndex === -1) {
      index += delimiterLength;
      continue;
    }

    if (unprotectedStart < index) {
      segments.push({ isProtected: false, value: value.slice(unprotectedStart, index) });
    }

    const codeSpanEnd = closingIndex + delimiterLength;
    segments.push({ isProtected: true, value: value.slice(index, codeSpanEnd) });
    index = codeSpanEnd;
    unprotectedStart = codeSpanEnd;
  }

  if (unprotectedStart < value.length) {
    segments.push({ isProtected: false, value: value.slice(unprotectedStart) });
  }

  return segments;
}

function getOpeningFence(line: string): { character: "`" | "~"; length: number } | null {
  const fenceMatch = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);

  if (!fenceMatch) {
    return null;
  }

  const marker = fenceMatch[1]!;
  return {
    character: marker[0]! as "`" | "~",
    length: marker.length,
  };
}

function findClosingFence(
  value: string,
  startIndex: number,
  openingFence: { character: "`" | "~"; length: number },
): number {
  let index = startIndex;

  while (index < value.length) {
    const lineEnd = findLineEnd(value, index);
    const line = value.slice(index, lineEnd).replace(/\r?\n$/, "");
    const closingFence = new RegExp(
      `^[ \\t]{0,3}${escapeRegularExpression(openingFence.character)}{${openingFence.length},}[ \\t]*$`,
    );

    if (closingFence.test(line)) {
      return lineEnd;
    }

    index = lineEnd;
  }

  return value.length;
}

function findInlineCodeSpanClose(value: string, startIndex: number, delimiterLength: number): number {
  let index = startIndex;

  while (index < value.length) {
    if (value[index] !== "`" || isEscaped(value, index)) {
      index += 1;
      continue;
    }

    const runLength = countConsecutiveCharacters(value, index, "`");
    if (runLength === delimiterLength) {
      return index;
    }

    index += runLength;
  }

  return -1;
}

function findClosingDelimiter(value: string, startIndex: number, closingCharacter: "]"): number {
  for (let index = startIndex; index < value.length - 1; index += 1) {
    if (isUnescapedDelimiter(value, index, closingCharacter)) {
      return index;
    }
  }

  return -1;
}

function isUnescapedDelimiter(value: string, index: number, delimiterCharacter: "(" | ")" | "[" | "]"): boolean {
  return value[index] === "\\" && value[index + 1] === delimiterCharacter && !isEscaped(value, index);
}

function isEscaped(value: string, index: number): boolean {
  let precedingBackslashes = 0;

  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    precedingBackslashes += 1;
  }

  return precedingBackslashes % 2 === 1;
}

function countConsecutiveCharacters(value: string, startIndex: number, character: string): number {
  let length = 0;

  while (value[startIndex + length] === character) {
    length += 1;
  }

  return length;
}

function findLineEnd(value: string, startIndex: number): number {
  const lineBreakIndex = value.indexOf("\n", startIndex);
  return lineBreakIndex === -1 ? value.length : lineBreakIndex + 1;
}

function splitLineEnding(value: string): { content: string; lineEnding: string } {
  if (value.endsWith("\r\n")) {
    return { content: value.slice(0, -2), lineEnding: "\r\n" };
  }

  if (value.endsWith("\n")) {
    return { content: value.slice(0, -1), lineEnding: "\n" };
  }

  return { content: value, lineEnding: "" };
}

function consumeUpToThreeSpaces(value: string, startIndex: number): number {
  let index = startIndex;

  while (index - startIndex < 3 && value[index] === " ") {
    index += 1;
  }

  return index;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
