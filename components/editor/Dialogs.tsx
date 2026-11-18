"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEditor, type Locale } from "@/lib/store";
import { pitchRangeLabel } from "@/lib/pitch";
import { ALL_ROLES, ROLE_META, type Role } from "@/lib/types";
import type { OmrStatus } from "@/lib/omr";

function tr(locale: Locale, zh: string, en: string) {
  return locale === "zh" ? zh : en;
}

export function AssignDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const project = useEditor((s) => s.project);
  const locale = useEditor((s) => s.locale);
  if (!open || !project) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <span />
      </Dialog>
    );
  }
  return <AssignBody key={project.streams.map((stream) => `${stream.id}:${stream.role}`).join("|")} project={project} locale={locale} onOpenChange={onOpenChange} />;
}

function AssignBody({
  project,
  locale,
  onOpenChange,
}: {
  project: NonNullable<ReturnType<typeof useEditor.getState>["project"]>;
  locale: Locale;
  onOpenChange: (open: boolean) => void;
}) {
  const initial = useMemo(() => {
    const map: Record<string, Role> = {};
    for (const stream of project.streams) map[stream.id] = stream.role;
    return map;
  }, [project]);
  const [roles, setRoles] = useState<Record<string, Role>>(initial);
  const streams = project.streams;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title={tr(locale, "声部分配", "Part assignment")}
        description={tr(
          locale,
          "每一行是谱面上的一条来源（声部 + 谱表 + 声部号）。改完会把这些音符整轨挪走。",
          "Each row is a source stream from the score. Changing it moves every note from that stream.",
        )}
      >
        <div className="overflow-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs text-[#9c968a]">
              <tr>
                <th className="py-2 pr-3 font-medium">{tr(locale, "来源", "Source")}</th>
                <th className="py-2 pr-3 font-medium">{tr(locale, "音域", "Range")}</th>
                <th className="py-2 pr-3 font-medium">{tr(locale, "判定", "Why")}</th>
                <th className="py-2 font-medium">{tr(locale, "分配到", "Assign")}</th>
              </tr>
            </thead>
            <tbody>
              {streams.map((stream) => {
                const notes = project?.notes.filter((note) => note.streamId === stream.id) ?? [];
                return (
                  <tr key={stream.id} className="border-t border-[#2c3142]">
                    <td className="py-2 pr-3">
                      <div>{stream.partName}</div>
                      <div className="text-xs text-[#9c968a]">
                        {tr(locale, `谱表 ${stream.staff}`, `staff ${stream.staff}`)}
                        {stream.voice ? ` · ${tr(locale, `声部 ${stream.voice}`, `voice ${stream.voice}`)}` : ""}
                        {stream.layer !== "all"
                          ? ` · ${stream.layer === "upper" ? tr(locale, "上层", "upper") : tr(locale, "下层", "lower")}`
                          : ""}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {notes.length} · {pitchRangeLabel(notes.map((note) => note.midi))}
                    </td>
                    <td className="max-w-[220px] py-2 pr-3 text-xs text-[#c7c1b6]">
                      {locale === "zh" ? stream.reasonZh : stream.reasonEn}
                    </td>
                    <td className="py-2">
                      <Select
                        value={roles[stream.id] ?? stream.role}
                        onValueChange={(value) => setRoles((prev) => ({ ...prev, [stream.id]: value as Role }))}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ALL_ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {locale === "zh" ? ROLE_META[role].nameZh : ROLE_META[role].name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tr(locale, "取消", "Cancel")}
          </Button>
          <Button
            onClick={() => {
              useEditor.getState().reassignStreams(roles);
              onOpenChange(false);
            }}
          >
            {tr(locale, "应用", "Apply")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function OmrDialog({
  open,
  onOpenChange,
  status,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: OmrStatus | null;
}) {
  const locale = useEditor((s) => s.locale);
  const info = status;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={tr(locale, "扫描件识别（OMR）", "Scan recognition (OMR)")}
        description={tr(
          locale,
          "这一步先不跑识别。接口已经按「上传 → MusicXML → 现有分轨」接好。",
          "Recognition itself is not bundled. The path is upload → MusicXML → the separator you already have.",
        )}
      >
        <p className="text-sm leading-6 text-[#d9d3c7]">
          {info ? (locale === "zh" ? info.messageZh : info.messageEn) : tr(locale, "正在询问接口…", "Asking the hook…")}
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-[#c7c1b6]">
          <li>{tr(locale, "安装引擎，并保证命令能把结果写成 MusicXML 或 MXL。", "Install an engine that can write MusicXML or MXL.")}</li>
          <li>
            <code className="text-[#f0d7a8]">OMR_COMMAND</code>
            {tr(locale, " 设成可执行文件，", " is the executable, ")}
            <code className="text-[#f0d7a8]">OMR_ARGS</code>
            {tr(locale, " 用逗号分隔，可用 {input} 和 {outdir}。", " is a comma-separated arg list with {input} and {outdir}.")}
          </li>
          <li>{tr(locale, "重启应用后再上传 PDF 或图片。成功后会直接进钢琴卷帘。", "Restart, then upload a PDF or image. A successful result opens in the roll.")}</li>
        </ol>
        <div className="mt-4 space-y-3">
          {info?.suggestedEngines.map((engine) => (
            <article key={engine.name} className="rounded-lg border border-[#2e3342] p-3">
              <h3 className="text-sm font-medium">
                {engine.url ? (
                  <a className="text-[#f0d7a8] underline-offset-2 hover:underline" href={engine.url} target="_blank" rel="noreferrer">
                    {engine.name}
                  </a>
                ) : (
                  engine.name
                )}
              </h3>
              <p className="mt-1 text-sm text-[#c7c1b6]">{locale === "zh" ? engine.noteZh : engine.noteEn}</p>
            </article>
          ))}
        </div>
        <p className="mt-4 font-mono text-xs leading-5 text-[#9c968a]">
          OMR_COMMAND=audiveris
          <br />
          OMR_ARGS=-batch,-export,-output,{"{outdir}"},{"{input}"}
        </p>
      </DialogContent>
    </Dialog>
  );
}

export function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const locale = useEditor((s) => s.locale);
  const rows =
    locale === "zh"
      ? [
          ["空格", "播放 / 暂停"],
          ["Shift + 空格", "只播放选中的音符"],
          ["拖音符", "改开始时间和音高"],
          ["拖边缘", "改时值"],
          ["框选 / Shift 点选", "多选"],
          ["方向键", "微调；Shift 为八度或整拍"],
          ["Delete", "删除"],
          ["Ctrl/⌘ Z / Y", "撤销 / 重做"],
          ["滚轮", "纵向滚动；Shift 横向；Ctrl 缩放"],
          ["点时间尺", "跳转播放头"],
          ["轨道上的 S", "独奏；Shift 再叠加一条"],
        ]
      : [
          ["Space", "Play / pause"],
          ["Shift + Space", "Play only the selection"],
          ["Drag a note", "Move start time and pitch"],
          ["Drag an edge", "Change duration"],
          ["Drag box / shift-click", "Multi-select"],
          ["Arrows", "Nudge; Shift is an octave or a whole beat"],
          ["Delete", "Delete"],
          ["Ctrl/⌘ Z / Y", "Undo / redo"],
          ["Wheel", "Scroll; Shift sideways; Ctrl zoom"],
          ["Click the ruler", "Seek"],
          ["S on a track", "Solo; Shift-click adds another"],
        ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={tr(locale, "怎么改谱", "How to edit")}>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
          {rows.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-[#d7a15e]">{key}</dt>
              <dd className="text-[#e7e1d6]">{value}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
