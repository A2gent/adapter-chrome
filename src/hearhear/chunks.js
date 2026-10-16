export const MAX_CHUNK_LENGTH = 400;

export function splitChunks(text, language = 'en') {
  const chunks = [];
  for (const paragraph of text.matchAll(/[^\r\n]+/g)) {
    let start = paragraph.index;
    const end = start + paragraph[0].length;
    while (start < end) {
      while (start < end && /\s/u.test(text[start])) start++;
      if (start === end) break;
      let cut = Math.min(start + MAX_CHUNK_LENGTH, end);
      if (cut < end) {
        const space = text.slice(start, cut).search(/\s+\S*$/u);
        if (space > 0) cut = start + space;
        else if (/[\uD800-\uDBFF]/.test(text[cut - 1])) cut--;
      }
      const value = text.slice(start, cut).trimEnd();
      const words = [...new Intl.Segmenter(language, {granularity:'word'}).segment(value)]
        .filter(w => w.isWordLike)
        .map(w => ({text:w.segment, start:start + w.index, end:start + w.index + w.segment.length}));
      chunks.push({text:value, start, end:start + value.length, words});
      start = cut;
    }
  }
  return chunks;
}

// The raw-audio API has no alignment. Estimate within each short chunk, never
// across the whole article, so timing drift resets at every paragraph boundary.
export function wordAtTime(chunk, currentTime, duration) {
  if (!chunk?.words.length || !Number.isFinite(duration) || duration <= 0) return null;
  const total = chunk.words.reduce((sum, word) => sum + word.text.length + 1, 0);
  let position = Math.max(0, Math.min(1, currentTime / duration)) * total;
  for (const word of chunk.words) {
    position -= word.text.length + 1;
    if (position < 0) return word;
  }
  return chunk.words.at(-1);
}
