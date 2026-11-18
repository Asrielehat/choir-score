# 合唱分轨 Choir Roll

把合唱 SATB 和钢琴伴奏拆成独立声部，在**一条连续的时间线**上用钢琴卷帘改音符，独奏某一声部，再用钢琴音色听，最后导出。

Split a choir score into soprano, alto, tenor, bass, and piano, edit the notes on one continuous piano roll, solo a part, listen with a piano timbre, and export.

## 运行 Run

```bash
npm install
npm run dev
```

打开 [http://127.0.0.1:3847](http://127.0.0.1:3847)。开发服务器把 `127.0.0.1` 写进了 `allowedDevOrigins`，否则浏览器会把 HMR 当成跨源请求，页面停在服务端 HTML 上、按钮没有反应。第一次进入会载入示例曲《晨光》：缩谱（女高女低共用高音谱表，男高男低共用低音谱表）加钢琴，中间有 4/4 → 3/4 → 4/4 和速度变化。

```bash
npm test          # 分轨、时值、导入导出
npm run sample    # 重新生成 public/samples/chen-guang.musicxml
npm run lint
```

工程会自动写到浏览器 `localStorage`（键 `choir-roll.project.v1`）。也可以导出 JSON 再导入。

## 能做什么

- 导入 MusicXML（`.musicxml` / `.xml`）、压缩的 `.mxl`，以及 MIDI。
- 识别开大谱（四个声部各一行）和缩谱（两个声部共用一行）。符干向上归上方声部，符干向下归下方声部；没有符干时，声部号小的在上。
- 一行谱里如果只有一个声部却写成和弦：高音给上方声部，低音给下方声部；这一小节里单独的音当作同音，两个声部都唱。
- 钢琴大谱表进右手 / 左手，不会被拆成 SATB。声部名称支持中英文（女高音、Soprano、钢琴、Piano RH…）。
- 分错了可以在「声部分配」里改整条来源，或框选音符后「移动到」另一轨。
- 钢琴卷帘：连续时间，小节线只是网格。拖音符改时间和音高，拖边缘改时值，吸附可关。框选、Shift 点选、撤销 / 重做。
- 播放：播放头、点时间尺跳转、速度倍率、每轨静音 / 独奏 / 音量。独奏按钮单击只留这一轨，Shift 再加一条。也可以只播放选区。
- 四个声部和钢琴都用同一种钢琴音色。导出的 MIDI 每轨一个钢琴节目。
- 导出 MIDI、MusicXML，或工程 JSON。

## 结构

| 路径 | 作用 |
| --- | --- |
| `lib/musicxml/parse.ts` | 按 MusicXML 的光标、`<backup>`、`<chord>` 把每个声部放上同一条四分音符时间轴 |
| `lib/separate.ts` | SATB / 钢琴判定，以及共享谱表的拆分 |
| `lib/timing.ts` | 速度图、拍号、小节边界。换拍不插入空隙 |
| `lib/musicxml/export.ts`、`lib/midi.ts` | 导出 |
| `components/editor/PianoRoll.tsx` | Canvas 卷帘 |
| `lib/audio.ts` | Web Audio 钢琴合成 |
| `app/api/omr/route.ts` | 扫描件接口。默认不跑识别 |

时间轴单位是四分音符。3/4 小节占 3 拍，6/8 占 3 个四分音符，下一小节紧挨着开始。只有休止符才是静音。速度变化记在拍点上，播放时按速度图换算成秒。

## 光学乐谱识别 OMR

这一版**不带**识别引擎。PDF / 图片会交给 `POST /api/omr`。没配置时返回 `501`，并说明怎么接。

合唱谱建议用 [Audiveris](https://github.com/Audiveris/audiveris)（能保留多行谱表，扫描件最好 300 DPI 以上）。`oemer`、`homr` 更轻，但经常把 SATB 压成一个声部，不适合缩谱。名为 `satb-line-omr` 的工具如果之后有可执行文件，用同一套环境变量接上即可，不用改界面。

```bash
OMR_COMMAND=audiveris
OMR_ARGS=-batch,-export,-output,{outdir},{input}
```

`OMR_ARGS` 用逗号分开，不要经过 shell。`{input}` 是上传的文件，`{outdir}` 是空目录。命令退出码为 0 后，接口会在目录里找 `.musicxml` / `.xml` / `.mxl`，再走和手动导入一样的分轨。

## 限制

- 音色是合成钢琴（泛音加琴槌噪声），不是采样三角钢琴。所有声部共用这一种音色。
- 播放中改音符，要再按一次播放才会听到新的。静音、独奏和音量是即时的。
- MusicXML 的音高按实音读。谱号上的八度记号（男高音高音谱号低八度）只影响显示，不再移调。移调乐器的 `<transpose>` 会加上。
- 极短的倚音、提示音（cue）会跳过。连音线会收成一个长音。
- MIDI 最好是「一个声部一条轨」，并用轨名标明 Soprano / Alto / Tenor / Bass / Piano。单轨里塞进全部 SATB 时，只能当成一条旋律或钢琴，不会自动猜出四个声部。
- `score-timewise` 能读，但主流导出仍是 `score-partwise`。
- OMR 本身没有实现。

## 示例

`public/samples/chen-guang.musicxml` 是为本应用写的公有领域练习曲，不是某首受版权保护的合唱作品。第 1–6 小节用两个声部号和符干方向；第 7–8 小节改成单声部和弦，其中有一个同音，用来演示另一种缩谱写法。
