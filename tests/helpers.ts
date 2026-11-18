export function partwise(partList: string, parts: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Fixture</work-title></work>
  <part-list>${partList}</part-list>
  ${parts}
</score-partwise>`;
}

export function scorePart(id: string, name: string): string {
  return `<score-part id="${id}"><part-name>${name}</part-name></score-part>`;
}

export function pitch(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const alter = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0][pc];
  const step = ["C", "D", "D", "E", "E", "F", "G", "G", "A", "A", "B", "B"][pc];
  const octave = Math.floor(midi / 12) - 1;
  return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>`;
}

export function note(options: {
  midi?: number;
  duration: number;
  voice?: number;
  staff?: number;
  stem?: "up" | "down";
  chord?: boolean;
  rest?: boolean;
  lyric?: string;
  tie?: "start" | "stop";
}): string {
  const voice = options.voice ?? 1;
  const staff = options.staff ?? 1;
  const tie = options.tie ? `<tie type="${options.tie}"/>` : "";
  if (options.rest) {
    return `<note><rest/><duration>${options.duration}</duration><voice>${voice}</voice><staff>${staff}</staff></note>`;
  }
  const lyric = options.lyric
    ? `<lyric number="1"><syllabic>single</syllabic><text>${options.lyric}</text></lyric>`
    : "";
  const stem = options.stem ? `<stem>${options.stem}</stem>` : "";
  return `<note>${options.chord ? "<chord/>" : ""}${pitch(options.midi ?? 60)}<duration>${options.duration}</duration>${tie}<voice>${voice}</voice>${stem}<staff>${staff}</staff>${lyric}</note>`;
}
