# 短视频生产流水线 · 标准包 v1

一套「剪辑 → 字幕 → 封面 → 首帧融合 → 发布 → 回查」的标准化流程。
不是教程，是**可执行的门禁**：每一步都有脚本校验，不通过就不许进下一步。

- 适用：竖屏口播 / 横屏长视频 / 切片矩阵，抖音、小红书、视频号、B站
- 环境：macOS 为主；`scripts/` 五个 Python 工具在 Linux 同样可跑（发布脚本仅 macOS）
- 依赖：`ffmpeg`、`python3` + `Pillow`、`node` + `ws`

---

## 一、5 分钟装好

```bash
# 1. 依赖
brew install ffmpeg          # Linux: apt install ffmpeg
python3 -m pip install pillow

# 2. 放进你的工作区，把 AGENTS.md 拷到工作区根目录
cp AGENTS.md ../AGENTS.md     # Claude Code 用 CLAUDE.md

# 3. 自测（必须两条都过）
cd scripts && python3 preflight.py --selftest
cd ../publish && node test-guard.js
```

预期输出：`SELFTEST PASS`、`GUARD OK`。装不上就是依赖缺，不是代码问题。

---

## 二、包内导航

| 文件 | 什么时候看 |
|---|---|
| `AGENTS.md` | 放工作区根目录，agent 自动读，是硬规则 |
| `00-PIPELINE.md` | **先看这个**。六阶段流水线，每阶段的输入/输出/验收门 |
| `01-EDIT.md` | 多机位对齐、拼接、切片版式、ffmpeg 命令 |
| `02-SUBTITLE.md` | 字幕字号/断行/时间轴，含 ASS 模板 |
| `03-COVER.md` | 封面三层结构、代码压字、裁切安全区 |
| `04-PUBLISH.md` | 四平台发布脚本、门禁、回查 |
| `specs/` | 四份原始规范（可直接当验收标准抄进任务里） |
| `templates/开工卡.md` | 每次开新任务，整段贴给 agent |
| `templates/manifest.json` | 一个视频一个 manifest，版本/hash 的单一真相 |
| `scripts/` | `preflight.py` 预检 · `transcribe.py` 转写 · `burn_subs.py` 字幕烧制 · `cover_text.py` 压字 · `crop_check.py` 裁切模拟 |
| `publish/` | 四平台 CDP 发布脚本 + 门禁 + 轮询等待 |

---

## 三、完整跑一遍（以一条竖屏切片为例）

```bash
# ① 预检：分辨率/音轨/时长/封面尺寸，不过就停
python3 scripts/preflight.py --video in.mp4 --cover cover-3x4.jpg --canvas 1080x1920

# ② 字幕：转写（可选）→ 人工校专名 → ASS → 烧制
python3 scripts/transcribe.py --input in.mp4 --out sub --model small
python3 scripts/burn_subs.py --video in.mp4 --srt sub.srt --canvas 1080x1920 --out out-sub.mp4

# ③ 封面：底图 + 代码压字，一次出 4 个比例
python3 scripts/cover_text.py --base bg.jpg --lines "企业AI落地" "分三步" --accent 2 --outdir covers/

# ④ 裁切模拟：确认 3:4 / 4:3 / 16:9 都不切字
python3 scripts/crop_check.py --image covers/3x4.jpg --outdir crops/

# ⑤ 首帧融合：把封面做成前 0.6 秒，平台抓首帧就是它
ffmpeg -loop 1 -t 0.6 -i covers/9x16.jpg -i out-sub.mp4 \
  -filter_complex "[0:v]scale=1080:1920,setsar=1,trim=duration=0.6,setpts=PTS-STARTPTS[a];[1:v]setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0[v];[1:a]adelay=600|600,apad=pad_dur=0.6[aud]" \
  -map "[v]" -map "[aud]" -c:v libx264 -crf 18 -c:a aac out-final.mp4

# ⑥ 发布预检 + dry-run（不带 --publish 就只填表）
cd publish && node preflight.js --platform douyin --video ../out-final.mp4 --title "标题"
node publish.js --platform douyin --video ../out-final.mp4 --cover ../covers/3x4.jpg --title "标题" --desc "正文"

# ⑦ 确认后加 --publish；发完必须回列表核对并截图
```

---

## 四、哪些能直接用，哪些要改（诚实说明）

| 模块 | 状态 |
|---|---|
| `scripts/*.py` | **直接可用**，纯本地 ffmpeg/PIL，无账号依赖 |
| `specs/*.md` | **直接可用**，是验收标准，换行业也成立 |
| `publish/publish.js`（抖音/小红书） | 可用，但**平台选择器会随改版失效**，跑前先 dry-run 看填表结果 |
| `publish/publish-channels.js`（视频号） | 可用，Shadow DOM 注入方案已验证 |
| `publish/publish-bili.js`（B站） | 可用，需自己补创作声明选项 |
| `start-cdp.sh` | **要改**：`Chrome-Agent.app` 和 profile 目录是原机器的，按 `04-PUBLISH.md` 第二节自己建一份，或用环境变量覆盖 |

**发布脚本的定位**：省掉 80% 重复劳动，但平台 UI 一变就要修。所以规则是——先 dry-run，看填表对不对，再决定发不发。

---

## 新手三步 + 交给 agent 的话

1. 解压，把整个目录放进你的工作区（比如 `~/你的项目/video-kit/`）。
2. 把 `AGENTS.md` 复制到工作区根目录（Claude Code 改名为 `CLAUDE.md`）。
3. 跑自测，两条都过：
   ```bash
   cd scripts && python3 preflight.py --selftest
   cd ../publish && node test-guard.js
   ```
   装不上是依赖问题：`brew install ffmpeg`、`python3 -m pip install pillow`、`cd publish && npm i`。

然后把这句话发给你的 agent（先做 dry-run，不上传）：

```
读 video-kit/README.md 和 video-kit/00-PIPELINE.md，然后按 video-kit/templates/开工卡.md
的 10 条开始。先不要上传、发布、删除任何线上内容；先给我目标平台、画布、版本号和验收计划。
```

**你会得到什么**

| 你现在怎么做 | 用这套之后 |
|---|---|
| 凭感觉调字幕大小，手机上才发现看不清 | 查表：1080×1920 用 88px，脚本自动套 |
| 封面做一版，发出去标题被平台裁掉 | 代码压字 + 四个比例 + 裁切模拟，先看再发 |
| 手动上传，等半天不知道传完没 | 轮询真实完成信号，超时才报错 |
| 点完发布就当完成 | 回列表核对 + 截图，没截图等于没发 |
| 改封面时误删别的作品 | 危险操作先锁对象，任一不符即停 |

> 一句话：这套东西的价值不在脚本，在**门禁**——每一步都有「做到什么算做完」的定义。把它当规则用，比当工具用有用得多。

---

## 五、五条最容易踩的坑

1. **封面文字放在顶部** → 所有平台按中心裁 3:4，标题被切。文字必须落在垂直 12.5%–87.5%。
2. **字幕 52px** → 手机上看不清。1080×1920 用 **88px**（ASS 字号是 em，视觉字高只有 72%）。
3. **上传没完成就点发布** → 页面跳了但没作品。必须轮询「上传完成/检测为高清/删除按钮」。
4. **在成片上二次加字幕** → 双字幕。永远从原片重剪。
5. **多机位用同一个 `-ss`** → 丢开场、音画差几十秒。先算出每台设备 0 秒的真实时间偏移。

---

## 六、这套包的来源

来自 4 次完整发布、17 次失败、30+ 条返工的真实记录，规范都是从事故里倒推出来的，不是拍脑袋定的。
细节和事故现场在 `specs/` 四份文件里，别删——那是这套流程的价值所在。
