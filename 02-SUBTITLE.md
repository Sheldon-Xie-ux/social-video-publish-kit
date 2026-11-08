# 02 · 字幕

> 唯一标准是 `specs/字幕规范.md`。本文是它的操作版，冲突时以规范为准。

## 一、一句话原则

**字号按画幅查表，断行交给 libass，时间轴跟着剪辑重排。**

## 二、字号表（实测校准，直接抄）

| 画幅 | 用途 | ASS Fontsize | 每行字数 | 左右边距 | 距底 | 描边 | 阴影 |
|---|---|---|---|---|---|---|---|
| 1080×1920 | 抖音/视频号/小红书竖屏 | **88** | 11 | 56 | 340 | 6 | 2 |
| 1080×1440 | 小红书竖版 | 76 | 10 | 48 | 240 | 5 | 2 |
| 1920×1080 | B站/横屏 | 64 | 16 | 120 | 60 | 5 | 2 |
| 1080×1080 | 方图 | 72 | 9 | 48 | 140 | 5 | 2 |

**为什么是 88**：ASS 的 Fontsize 是 em 尺寸，实际视觉字高只有它的 ~72%。写 52 出来只有 37px，手机上根本读不出来——这是真实返工过两次的坑。

换算：`ASS Fontsize ≈ 想要的行高 ÷ 0.72`。

## 三、ASS 头（直接复制）

```
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Hiragino Sans GB,88,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,6,2,2,56,56,340,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
```

| 参数 | 值 | 说明 |
|---|---|---|
| `WrapStyle=0` | 自动换行 | 别用自己写的"按字数劈开"算法，会把「MEM学院」「招股书」劈断 |
| `Bold=1` | 加粗 | 手机小屏可读性 |
| `Outline=6` | 黑描边 6px | 亮背景（白墙、天花板）上唯一能保证可读的 |
| `BackColour` 透明度 | `00` | 不加黑底条，加了显脏 |
| `Alignment=2` | 底部居中 | — |
| `MarginV=340` | 距底 340px | 避开抖音/视频号的按钮和进度条 |

字体：macOS `Hiragino Sans GB`；Linux 换 `Noto Sans CJK SC`；Windows 换 `Microsoft YaHei`。

## 四、先转写，再校对

```bash
python3 -m pip install faster-whisper          # 可选，不装就用剪映/飞书妙记自带的识别
python3 scripts/transcribe.py --input master.mp4 --out sub --model small \
  --prompt "FDE、AI BP、Codex、WorkBuddy"
```

- `--model small` 出初稿就够，**校对比换大模型更值钱**。专名（人名、产品名、英文缩写）AI 一定会错，必须逐条改。
- `--prompt` 把本期的专有名词塞进去，能显著减少错字。
- 输出 `sub.srt` + `sub.json`，两个都能直接喂给 `burn_subs.py`。

> 这段脚本是可选模块，本包未附带模型和转写质量验证。用剪映/妙记识别再导出 srt，效果一样。

## 五、用脚本生成，别手写 ASS

```bash
python3 scripts/burn_subs.py --video master.mp4 --srt sub.srt --canvas 1080x1920 --out final.mp4
```

脚本做的事：

1. 读 srt/json，解析时间码
2. 按 `--canvas` 查字号表，生成 ASS（自动处理字体回退）
3. `ffmpeg -vf ass=...` 烧制，CRF 18，音频直通
4. 输出 `ass` 文件和成片，方便你改一行重跑

常用参数：

| 参数 | 作用 |
|---|---|
| `--canvas 1080x1920` | 决定字号/边距（必填） |
| `--font "Noto Sans CJK SC"` | 指定字体 |
| `--offset -0.3` | 整体字幕提前 0.3s（配音偏慢时用） |
| `--dry-run` | 只生成 ASS，不渲染 |

## 六、断行规则

1. 默认交给 libass 自动换行（`WrapStyle=0`）。
2. 左右边距固定 56px，每行目标 ≤11 个汉字。
3. 数字和专名不能被拆：Anthropic、DeepSeek、FDE、MEM。
4. 单条 >22 字才拆两条，时间按字数比例分。
5. 相邻字幕间隔 <1.5s 时，前一条延长到后一条开始（否则说话中字幕会闪没）。
6. 只有自动换行明确劈开专名时，才人工加 `\N` 定点修正。

## 七、时间轴

| 规则 | 值 |
|---|---|
| 每条最短 | ≥ 0.8 秒（不够就合并到相邻条） |
| 相邻间隔 | ≥ 0.08 秒（太近会视觉连成一句） |
| 结尾 | 不超过语音结束 + 0.3 秒 |
| 剪辑后 | **必须重排**，不能沿用原片时间码 |

剪辑后重排的做法：不要手动挪时间码，而是**按剪切后的片段重新映射**——每个片段记录 `(源起点, 时长)`，字幕时间 = 源时间 - 片段源起点 + 片段在成片里的起点。

## 八、交付前自查（4 条，30 秒）

- [ ] 手机大小看一眼，最后一行字能一眼读出
- [ ] 找一帧**亮背景**（白墙/天花板），字幕是否还清楚
- [ ] 每行没劈开数字或专名
- [ ] 每条 ≥0.8 秒，没有一闪而过的

## 九、两个高频事故

| 事故 | 原因 | 处理 |
|---|---|---|
| 双字幕 | 拿已烧字幕的成片又叠了一次 | **从原片重剪**，成片只做一次字幕 |
| 字幕被平台 UI 挡 | 距底 < 340px | 固定 340，别为"好看"往上挪 |
