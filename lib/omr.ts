export interface OmrStatus {
  ok: false;
  code: "omr_not_configured" | "omr_failed";
  messageZh: string;
  messageEn: string;
  accepts: string[];
  returns: string;
  suggestedEngines: { name: string; noteZh: string; noteEn: string; url?: string }[];
  command?: string;
}

export function omrUnavailable(filename?: string | null): OmrStatus {
  return {
    ok: false,
    code: "omr_not_configured",
    messageZh: filename
      ? `已收到「${filename}」，但本机还没有配置 OMR 引擎。MusicXML / MIDI 导入不受影响。`
      : "光学乐谱识别接口已留好，当前没有配置引擎。",
    messageEn: filename
      ? `Received “${filename}”, but no OMR engine is configured. MusicXML and MIDI import still work.`
      : "The optical music recognition hook is ready, and no engine is configured yet.",
    accepts: ["application/pdf", "image/png", "image/jpeg", "image/tiff"],
    returns: "application/vnd.recordare.musicxml+xml",
    suggestedEngines: [
      {
        name: "Audiveris",
        url: "https://github.com/Audiveris/audiveris",
        noteZh: "适合合唱总谱。能把多行谱表导出成 MusicXML，再交给本应用做 SATB 分轨。扫描件建议 300 DPI 以上。",
        noteEn: "Best fit for choir scores. Exports MusicXML from multiple staves; this app then separates SATB. Prefer 300 DPI scans.",
      },
      {
        name: "oemer / homr",
        url: "https://github.com/BreezeWhite/oemer",
        noteZh: "更轻，但经常把 SATB 多行谱压成一个声部，共享谱表会丢。只适合单旋律或钢琴大谱表的试验。",
        noteEn: "Lighter, but they often collapse SATB staves into one part. Fine for a melody or piano grand staff, not for choir.",
      },
      {
        name: "satb-line-omr",
        noteZh: "按你之后要接的工具预留。把可执行文件接到 OMR_COMMAND 即可，不需要改前端。",
        noteEn: "Reserved for the SATB line tool you want to plug in later. Point OMR_COMMAND at the binary; the UI stays the same.",
      },
    ],
  };
}
