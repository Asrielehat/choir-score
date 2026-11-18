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

上传 PDF、PNG 或 JPG，或点「识别缩谱 / 识别开大谱」。`POST /api/omr` 用 [Audiveris 5.11](https://github.com/Audiveris/audiveris) 把每一页转成 MusicXML，再接到同一条时间线上。PDF 页码留空就认全部页（最多 16 页）；填了数字就只认那一页。声部按谱号、八度记号和上下位置对齐，某一页少了一行谱也不会把后面的声部挤错位。大提琴单独成轨，钢琴仍是右手 / 左手。页末多出来的空小节会去掉。谱面没有速度、但页眉能读出 `♩ = 80` 这类记号时，用那个速度。

选 Audiveris 是因为它按系统保留多行谱表。`oemer` 和 `homr` 更轻，但会把 SATB 多行谱收成一个声部。没有找到可直接安装的 `satb-line-omr`。要换引擎时设置 `OMR_COMMAND`（不要设成单词 `audiveris`，那会走内置安装）和逗号分隔的 `OMR_ARGS`，占位符是 `{input}` 和 `{outdir}`。

安装（Ubuntu 24.04，需要 Java 21）：

```bash
sudo apt-get install -y tesseract-ocr poppler-utils ffmpeg
curl -L -o /tmp/audiveris.deb \
  https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-ubuntu24.04-x86_64.deb
sudo dpkg -i /tmp/audiveris.deb
sudo mkdir -p /opt/audiveris/tessdata
curl -L -o /opt/audiveris/tessdata/eng.traineddata \
  https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata
```

Audiveris 的文字识别走 Tesseract 的 legacy 引擎。发行版自带的 `eng` 数据往往只有 LSTM，歌词会是空的，所以上面要另下一份 `tessdata`。中文歌词再加一份 `chi_sim.traineddata`（同一个 tessdata 仓库）；文件在时，接口会让 Audiveris 用 `chi_sim+eng`。接口在 `/opt/audiveris/bin/Audiveris` 存在时就会用它。扫描页先栅格化成 300 DPI PNG。400 DPI 在最密的一页上少了一些时值错误，但会漏掉升降号、也会少音符，所以仍用 300 DPI，时值错误交给后面的小节修复。识别结果旁边可以对照缩小后的原页。

小节若比拍号长，不会删掉越过小节线的音符。会先试这些改法：照同一小节里已经对齐的声部改时值、把一串被认长一倍的音符缩短、去掉多出来的附点或休止、把三个等长音符当三连音、拿掉一个离前后音很远的音。都不合适时，全部音符按比例压进拍号，并在警告里标出这一小节。连线只在同音、紧挨着、歌词不是两个不同的字时合并；占满整小节又接到下一小节的长音，多半是圆滑线，不再并成一个超长音。

两份测试谱在 `public/samples/omr/`：

- `abide-with-me.png`：《Abide with Me》四部缩谱（女高女低一行、男高男低一行）。曲调与歌词是公有领域，排版来自 Timeless Truths，这里按 300 DPI 栅格化。这一版没有另外的钢琴伴奏，钢琴弹的就是声部本身。
- `gounod-daughters.png`：古诺《Daughters of Jerusalem》（1915 年 Novello 版，公有领域）第 12 页扫描，开大谱四行声部加钢琴。原书在 Internet Archive，条目 `daughtersofjerus00goun`。

## 限制

- 音色是合成钢琴（泛音加琴槌噪声），不是采样三角钢琴。所有声部共用这一种音色。
- 播放中改音符，要再按一次播放才会听到新的。静音、独奏和音量是即时的。
- MusicXML 的音高按实音读。谱号上的八度记号（男高音高音谱号低八度）只影响显示，不再移调。某个声部的中位音高出或低出常用音区六度以上时，按整八度拉回，并在警告里说明。移调乐器的 `<transpose>` 会加上。
- 中文歌词需要中文的 Tesseract 数据；只有英文包时，歌词多半是空的。斜向水印如果被认成音符，不会按某一首曲子单独过滤。
- 极短的倚音、提示音（cue）会跳过。连音线会收成一个长音。
- MIDI 最好是「一个声部一条轨」，并用轨名标明 Soprano / Alto / Tenor / Bass / Piano。单轨里塞进全部 SATB 时，只能当成一条旋律或钢琴，不会自动猜出四个声部。
- `score-timewise` 能读，但主流导出仍是 `score-partwise`。
- 歌词识别依赖 Audiveris 能加载 legacy 版 `eng.traineddata`。没有这份数据时，声部仍然按谱表位置拆，但歌词经常是空的。
- 低音谱号如果没被认出来，男低音和钢琴左手会整轨偏高，需要在卷帘里改，或在「声部分配」里看音域。
- 一次只认 PDF 的一页。封面、目录页认出来会是空的或很碎。
- Google 图书那种对比度差、谱表很密的扫描（例如韩德尔《Blessed are they》的某些页）可能几乎认不出音符。干净的铜版或矢量谱可靠得多。

## 示例

`public/samples/chen-guang.musicxml` 是为本应用写的公有领域练习曲，不是某首受版权保护的合唱作品。第 1–6 小节用两个声部号和符干方向；第 7–8 小节改成单声部和弦，其中有一个同音，用来演示另一种缩谱写法。
