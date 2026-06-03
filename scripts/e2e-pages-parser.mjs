/**
 * Espelha o parser do index.html para teste E2E sem browser.
 */
const TRANSCRIPT_API = 'https://youtube-transcript.ai/transcript';
const SPEAKER_BREAK = '\n·\n';

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function cleanCueLine(line) {
  return decodeHtmlEntities(line)
    .replace(/<[^>]*>/g, '')
    .replace(/^[>›»]+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRawCueLine(line) {
  return decodeHtmlEntities(line).replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeForComparison(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:…]+$/u, '')
    .trim();
}

function collapseInlineRepeats(text) {
  let result = cleanCueLine(text);
  if (!result) return '';
  for (let pass = 0; pass < 10; pass++) {
    const repeated = result.match(/(.{4,}?)(?:\s+\1){1,}/);
    if (!repeated) break;
    const escaped = repeated[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp('(' + escaped + ')(?:\\s+\\1)+', 'g'), '$1');
  }
  return result.trim();
}

function lineComparisonKey(line) {
  return normalizeForComparison(collapseInlineRepeats(cleanCueLine(line)));
}

function isPrefixOfLine(shorterKey, longerKey) {
  if (!shorterKey || !longerKey) return false;
  if (shorterKey === longerKey) return true;
  return longerKey.startsWith(shorterKey);
}

function parseTimestampToSeconds(timestamp) {
  const parts = String(timestamp || '').split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || null;
}

function normalizeCueEntry(entry) {
  if (entry && typeof entry === 'object' && entry.raw) {
    return { seconds: typeof entry.seconds === 'number' ? entry.seconds : null, raw: entry.raw };
  }
  return { seconds: null, raw: normalizeRawCueLine(entry) };
}

function removePrefixDuplicateLines(lines) {
  const items = lines
    .map(normalizeCueEntry)
    .map((item) => ({ seconds: item.seconds, raw: item.raw, key: lineComparisonKey(item.raw) }))
    .filter((item) => item.key.length > 0);

  const kept = [];
  for (let i = 0; i < items.length; i++) {
    let dominated = false;
    for (let j = i + 1; j < items.length; j++) {
      if (isPrefixOfLine(items[i].key, items[j].key)) {
        dominated = true;
        break;
      }
    }
    if (!dominated) kept.push({ seconds: items[i].seconds, raw: items[i].raw });
  }
  return kept;
}

function extractTranscriptCueLines(body) {
  const cues = [];
  const timestampRe = /\[([\d:.]+)\]\s*/g;
  const markers = [];
  let match;
  while ((match = timestampRe.exec(body)) !== null) {
    markers.push({
      start: match.index,
      end: match.index + match[0].length,
      seconds: parseTimestampToSeconds(match[1]),
    });
  }
  if (markers.length > 0) {
    for (let i = 0; i < markers.length; i++) {
      const chunkStart = markers[i].end;
      const chunkEnd = i + 1 < markers.length ? markers[i + 1].start : body.length;
      const chunk = body.slice(chunkStart, chunkEnd).replace(/\n+/g, ' ').trim();
      const raw = normalizeRawCueLine(chunk);
      if (raw) cues.push({ seconds: markers[i].seconds, raw });
    }
    return cues;
  }
  return body
    .split(/\n+/)
    .map((row) => {
      const timeMatch = row.match(/^\[([\d:.]+)\]\s*/);
      return {
        seconds: timeMatch ? parseTimestampToSeconds(timeMatch[1]) : null,
        raw: normalizeRawCueLine(row.replace(/^\[[\d:.]+\]\s*/, '')),
      };
    })
    .filter((cue) => cue.raw);
}

function splitInternalSpeakerParts(rawChunk) {
  const decoded = decodeHtmlEntities(rawChunk);
  const withoutLeading = decoded.replace(/^\s*(?:>>|&gt;&gt;|››|»»)\s*/i, '').trim();
  if (!withoutLeading) return [];
  if (!/(?:>>|&gt;&gt;|››|»»)/.test(withoutLeading)) return [withoutLeading];
  return withoutLeading.split(/\s*(?:>>|&gt;&gt;|››|»»)\s*/g).map(cleanCueLine).filter(Boolean);
}

function appendLineToTurn(turnLines, cleaned) {
  const key = normalizeForComparison(cleaned);
  if (!key) return;
  if (turnLines.length > 0) {
    const lastIndex = turnLines.length - 1;
    const lastKey = normalizeForComparison(turnLines[lastIndex]);
    if (key === lastKey) return;
    if (key.startsWith(lastKey) || lastKey.startsWith(key)) {
      if (key.length >= lastKey.length) turnLines[lastIndex] = cleaned;
      return;
    }
  }
  for (const line of turnLines) {
    if (normalizeForComparison(line) === key) return;
  }
  turnLines.push(cleaned);
}

function mergeTurnToScriptBlock(lines) {
  const deduped = removePrefixDuplicateLines(lines);
  return deduped
    .map((entry) => collapseInlineRepeats(cleanCueLine(entry.raw || entry)))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandCueLinesFromRaw(cueLines) {
  const expanded = [];
  for (const entry of cueLines) {
    const cue = normalizeCueEntry(entry);
    for (const part of splitInternalSpeakerParts(cue.raw)) {
      const cleaned = collapseInlineRepeats(part);
      if (cleaned) expanded.push({ seconds: cue.seconds, raw: cleaned });
    }
  }
  return expanded;
}

function endsWithSentencePunctuation(text) {
  return /[.!?…][\s"')\]]*$/u.test(String(text || '').trim());
}

function shouldStartNewSpeakerTurn(lastLine, newLine) {
  if (!lastLine || !newLine) return false;
  if (!endsWithSentencePunctuation(lastLine)) return false;
  const lastKey = lineComparisonKey(lastLine);
  const newKey = lineComparisonKey(newLine);
  return !isPrefixOfLine(lastKey, newKey) && !isPrefixOfLine(newKey, lastKey);
}

function processSpeakerTurns(cueLines) {
  const turns = [];
  let currentTurn = [];
  const flushTurn = () => {
    if (!currentTurn.length) return;
    turns.push(currentTurn);
    currentTurn = [];
  };
  for (const entry of cueLines) {
    const cue = normalizeCueEntry(entry);
    const cleaned = collapseInlineRepeats(cue.raw);
    if (!cleaned) continue;
    if (currentTurn.length && shouldStartNewSpeakerTurn(currentTurn[currentTurn.length - 1], cleaned)) {
      flushTurn();
    }
    appendLineToTurn(currentTurn, cleaned);
  }
  flushTurn();
  return turns.filter((turn) => turn.length > 0);
}

function mergePrefixSpeakerBlocks(blocks) {
  const merged = [];
  for (const current of blocks) {
    const currentKey = normalizeForComparison(current);
    if (merged.length) {
      const lastKey = normalizeForComparison(merged[merged.length - 1]);
      if (isPrefixOfLine(lastKey, currentKey)) {
        merged[merged.length - 1] = current;
        continue;
      }
      if (isPrefixOfLine(currentKey, lastKey)) continue;
    }
    merged.push(current);
  }
  return merged;
}

function formatSpeakerTurns(turns) {
  const blocks = turns.map((turn) => mergeTurnToScriptBlock(turn)).filter(Boolean);
  return mergePrefixSpeakerBlocks(blocks).join(SPEAKER_BREAK);
}

function formatTranscriptFromCues(cueLines, splitSpeakers = true) {
  const cleanedCues = removePrefixDuplicateLines(expandCueLinesFromRaw(cueLines));
  if (splitSpeakers) {
    const turns = processSpeakerTurns(cleanedCues);
    if (turns.length > 1) return formatSpeakerTurns(turns);
  }
  return mergeTurnToScriptBlock(cleanedCues);
}

function parseTranscriptTxt(raw, splitSpeakers = true) {
  if (!raw.includes('## Transcript')) return '';
  const body = (raw.split('## Transcript')[1] || '').split(/^---$/m)[0];
  return formatTranscriptFromCues(extractTranscriptCueLines(body), splitSpeakers);
}

function countRollingDuplicates(text) {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  let dupes = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const a = normalizeForComparison(lines[i]);
    const b = normalizeForComparison(lines[i + 1]);
    if (a && b && (a === b || b.startsWith(a))) dupes++;
  }
  return dupes;
}

export async function testVideo(videoId) {
  const url = `${TRANSCRIPT_API}/${encodeURIComponent(videoId)}.txt?lang=pt-BR`;
  const response = await fetch(url, { headers: { Accept: 'text/plain' } });
  const raw = await response.text();
  if (!response.ok) throw new Error(`API ${response.status}: ${raw.slice(0, 120)}`);
  const cues = extractTranscriptCueLines((raw.split('## Transcript')[1] || '').split(/^---$/m)[0]);
  const result = parseTranscriptTxt(raw, true);
  const blocks = result.split(SPEAKER_BREAK);
  const hasFalanteLabel = /Falante\s+\d/i.test(result);
  const shortLineCount = result.split(/\n+/).filter((l) => l.trim() && l.trim() !== '·').length;
  return {
    videoId,
    apiStatus: response.status,
    rawCueCount: cues.length,
    outputChars: result.length,
    speakerBlocks: blocks.length,
    hasFalanteLabel,
    shortLineCount,
    preview: result.slice(0, 900),
  };
}

const ids = process.argv.slice(2);
const defaults = ['dQw4w9WgXcQ', 'jNQXAC9IVRw'];
const toTest = ids.length ? ids : defaults;

for (const id of toTest) {
  try {
    const report = await testVideo(id);
    console.log('\n===', id, '===');
    console.log(JSON.stringify(report, null, 2));
    const ok =
      !report.hasFalanteLabel &&
      report.rawCueCount > report.speakerBlocks &&
      report.outputChars > 50;
    console.log(ok ? 'PASS' : 'CHECK');
  } catch (error) {
    console.error('\n===', id, 'FAIL ===');
    console.error(error.message);
  }
}
