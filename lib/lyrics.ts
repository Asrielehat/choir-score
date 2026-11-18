const HAN = /\p{Script=Han}/u;
const TRAILING = /[，。、！？；：\s]/g;

/**
 * On a page whose lyrics are mostly Chinese, drop tokens that are not Chinese
 * words. Watermarks and broken OCR produce brackets, Latin letters, and
 * punctuation mixed into the syllable. English pages are left alone.
 */
export function sanitizeLyrics<T extends { lyric?: string }>(notes: T[]): T[] {
  const lyrics = notes.map((note) => note.lyric).filter((lyric): lyric is string => !!lyric);
  if (!lyrics.length) return notes;
  const han = lyrics.filter((lyric) => HAN.test(lyric)).length;
  if (han < lyrics.length * 0.4) return notes;
  for (const note of notes) {
    if (!note.lyric) continue;
    const core = note.lyric.replace(TRAILING, "");
    // A syllable under one note is one or two characters. Longer runs are watermark scraps.
    if (core && core.length <= 2 && [...core].every((char) => HAN.test(char))) note.lyric = core;
    else delete note.lyric;
  }
  return notes;
}
