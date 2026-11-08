# 01 · 剪辑与合成

> 目标：把多段素材拼成一条没有硬伤的母版（master）。母版不带字幕、不带封面。

## 一、先建时间轴，再动剪刀

多机位最常见的死法：以为两台设备同时开录，两边都用同一个 `-ss`，结果丢开场、音画差几十秒。

### 正确做法

1. 查每台设备的真实起始时间：
   ```bash
   ffprobe -v error -show_entries format_tags=creation_time -of default=nw=1 屏幕录制.mov
   ffprobe -v error -show_entries format_tags=creation_time -of default=nw=1 Pocket.mov
   ```
2. 算出偏移（例：屏幕 18:35:46 开录，Pocket 18:37:37 开录 → Pocket 的 0s = 屏幕的第 111s）：
   ```
   屏幕：-ss 111    Pocket：-ss 0
   ```
3. 没有 creation_time 就用**拍手**或**音频互相关**对齐，不要凭感觉。
4. 把这张偏移表写进 `manifest.json`，后面所有切片都引用它。

### 对齐验收

抽开头、中段、结尾 3 个点，各截一帧 + 听 3 秒，口型与声音误差应 < 100ms（约 3 帧）。

```bash
# 抽 3 帧拼成一张对齐检查图
ffmpeg -v error -y -ss 2 -i out.mp4 -frames:v 1 f1.png
ffmpeg -v error -y -ss 60 -i out.mp4 -frames:v 1 f2.png
ffmpeg -v error -y -ss 180 -i out.mp4 -frames:v 1 f3.png
```

---

## 二、拼接：两种场景，别混用

| 场景 | 方法 | 命令要点 |
|---|---|---|
| 所有片段**参数完全一致**（同编码/同分辨率/同帧率） | concat demuxer | 写 `list.txt`，`ffmpeg -f concat -safe 0 -i list.txt -c copy` |
| 参数不一致 / 要加滤镜 | filter_complex | 每段 `trim+setpts`，再 `concat=n=N:v=1:a=1` |

### filter_complex 模板（按时间码裁段再拼）

```bash
ffmpeg -i src.mp4 -filter_complex "\
[0:v]trim=start=12.5:end=48,setpts=PTS-STARTPTS[v0];\
[0:a]atrim=start=12.5:end=48,asetpts=PTS-STARTPTS[a0];\
[0:v]trim=start=61:end=120,setpts=PTS-STARTPTS[v1];\
[0:a]atrim=start=61:end=120,asetpts=PTS-STARTPTS[a1];\
[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]" \
-map "[v]" -map "[a]" -c:v libx264 -crf 18 -c:a aac out.mp4
```

**三个必踩的雷**：

1. 同一路流被多处使用时必须 `split` / `asplit`：
   ```
   [0:v]split=3[v0][v1][v2]
   ```
2. 音频 concat 写 `a=1`，视频 concat 写 `v=1:a=0`，写错报 `Media type mismatch`。
3. `-c copy` 只对参数完全一致的片段成立，混用会花屏/音画错位。

---

## 三、竖屏切片版式（1080×1920）

一条竖屏切片固定的四层，从上到下：

| 层 | 位置（1080×1920） | 内容 | 参数 |
|---|---|---|---|
| 1 底 | 全屏 | 纯色/浅渐变背景图 | 1080×1920，静态 |
| 2 画面 | y=0 起，高 608 | 横屏原片按宽缩放居中 | `scale=1080:608:force_original_aspect_ratio=decrease,pad=1080:608:(ow-iw)/2:(oh-ih)/2` |
| 3 标题+要点 | y≈690–1100 | 3 行以内大字 | 标题 88–120px，要点 64px，左对齐 x=64 |
| 4 字幕 | 距底 340 | 说话内容 | 见 `02-SUBTITLE.md` |

合成命令：

```bash
ffmpeg -loop 1 -i bg.png -i clip.mp4 -filter_complex "\
[1:v]scale=1080:608:force_original_aspect_ratio=decrease,pad=1080:608:(ow-iw)/2:(oh-ih)/2:black[v];\
[0:v][v]overlay=0:0[bg];[bg]ass=clip.ass[vout]" \
-map "[vout]" -map 1:a -t 95 \
-c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k \
-movflags +faststart out.mp4
```

> 要点和标题**别写进 ASS 的 Dialogue 里靠换行**，用独立 `Style` + `\pos()` 定位，改字不动时间轴。

---

## 四、横屏长版（1920×1080）

- 分辨率 1920×1080，码率 9–10 Mbps，`-crf 18` 足够。
- 章节标题用 `Alignment=7`（左上）+ `\pos()` 固定在安全区。
- 长视频**必须** `-movflags +faststart`，否则网页端拖动要等全下完。

## 五、切片矩阵

一条长视频切 N 条：每条独立成片、独立 manifest、独立封面。**不要把同一条切片裁成不同长度反复发**——容易被判重复内容。

| 项 | 建议 |
|---|---|
| 单条时长 | 45–120 秒 |
| 开头 3 秒 | 必须抛结论，不要自我介绍 |
| 切片数量 | 一条 25 分钟长视频切 5–8 条，宁少勿多 |
| 复用 | 同一素材跨平台发，文案/封面按平台改，视频可以同一条 |

## 六、交付前自检（母版阶段）

- [ ] 全片播一遍，无黑帧、无跳帧、无丢段
- [ ] 开头/中段/结尾音画对齐
- [ ] 时长与 manifest 一致（`ffprobe` 实测）
- [ ] 没有在母版上烧过字幕或封面（烧了就回不到原片）
- [ ] 音轨存在且不是静音（`ffmpeg -af volumedetect` 看 mean_volume）
