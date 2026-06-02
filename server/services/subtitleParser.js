const DEDUP_WINDOW = 5;
const MIN_LINES_PER_PARAGRAPH = 4;
const MAX_LINES_PER_PARAGRAPH = 6;

const TIMESTAMP_LINE =
  /^\d{1,2}:\d{2}(?::\d{2})?[.,]\d{0,3}\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?[.,]\d{0,3}/;
const SRT_TIMESTAMP_LINE =
  /^\d{1,2}:\d{2}:\d{2}[.,]\d{0,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[.,]\d{0,3}/;

export function subtitleFileToPlainText(content) {
  const cueLines = extractCueLines(content);
  const uniqueLines = deduplicateLines(cueLines);
  return buildParagraphs(uniqueLines);
}

function extractCueLines(content) {
  const lines = content.replace(/\r/g, '').split('\n');
  const cueLines = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (shouldSkipLine(line)) {
      continue;
    }

    const cleaned = cleanCueLine(line);
    if (!cleaned) {
      continue;
    }

    cueLines.push(cleaned);
  }

  return cueLines;
}

function shouldSkipLine(line) {
  if (!line) {
    return true;
  }

  if (line === 'WEBVTT' || /^WEBVTT\b/i.test(line)) {
    return true;
  }

  if (/^Kind:/i.test(line) || /^Language:/i.test(line)) {
    return true;
  }

  if (line.startsWith('NOTE') || line.startsWith('STYLE') || line.startsWith('REGION')) {
    return true;
  }

  if (/^X-TIMESTAMP-MAP=/i.test(line)) {
    return true;
  }

  if (/^\d+$/.test(line)) {
    return true;
  }

  if (TIMESTAMP_LINE.test(line) || SRT_TIMESTAMP_LINE.test(line)) {
    return true;
  }

  if (/^(align|position|line|size|vertical):/i.test(line)) {
    return true;
  }

  return false;
}

function cleanCueLine(line) {
  return line
    .replace(/<[\d:.]+>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForComparison(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:…]+$/u, '')
    .trim();
}

function deduplicateLines(lines) {
  const uniqueLines = [];
  const recentKeys = [];

  for (const displayLine of lines) {
    const key = normalizeForComparison(displayLine);

    if (!key) {
      continue;
    }

    if (recentKeys.includes(key)) {
      continue;
    }

    uniqueLines.push(displayLine);
    recentKeys.push(key);

    if (recentKeys.length > DEDUP_WINDOW) {
      recentKeys.shift();
    }
  }

  return uniqueLines;
}

function endsWithSentencePunctuation(text) {
  return /[.!?…][\s"')\]]*$/u.test(text.trim());
}

function buildParagraphs(lines) {
  if (lines.length === 0) {
    return '';
  }

  const paragraphs = [];
  let block = [];

  const flushBlock = () => {
    if (block.length === 0) {
      return;
    }

    paragraphs.push(block.join(' '));
    block = [];
  };

  for (const line of lines) {
    block.push(line);

    const reachedMaxLines = block.length >= MAX_LINES_PER_PARAGRAPH;
    const reachedMinWithSentenceEnd =
      block.length >= MIN_LINES_PER_PARAGRAPH && endsWithSentencePunctuation(line);

    if (reachedMaxLines || reachedMinWithSentenceEnd) {
      flushBlock();
    }
  }

  flushBlock();
  return paragraphs.join('\n\n').trim();
}
