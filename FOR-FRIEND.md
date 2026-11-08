# 给拿到这个包的人

这是一套**已经在真实账号上跑过的短视频生产流程**：剪辑 → 字幕 → 封面 → 首帧融合 → 四平台发布 → 回查。
不是教程合集，是可执行的脚本 + 验收标准。

## 三步开始

1. 解压，把整个目录放进你的工作区（比如 `~/你的项目/video-kit/`）。
2. 把 `AGENTS.md` 复制到工作区根目录（Claude Code 改名为 `CLAUDE.md`）。
3. 跑自测，两条都过：
   ```bash
   cd scripts && python3 preflight.py --selftest
   cd ../publish && node test-guard.js
   ```

装不上是依赖问题：`brew install ffmpeg`、`python3 -m pip install pillow`、`cd publish && npm i`。

## 然后，把这句话发给你的 agent

```
读 video-kit/README.md 和 video-kit/00-PIPELINE.md，然后按 video-kit/templates/开工卡.md
的 10 条开始。先不要上传、发布、删除任何线上内容；先给我目标平台、画布、版本号和验收计划。
```

## 你会得到什么

| 你现在怎么做 | 用这套之后 |
|---|---|
| 凭感觉调字幕大小，手机上才发现看不清 | 查表：1080×1920 用 88px，脚本自动套 |
| 封面做一版，发出去标题被平台裁掉 | 代码压字 + 四个比例 + 裁切模拟，先看再发 |
| 手动上传，等半天不知道传完没 | 轮询真实完成信号，超时才报错 |
| 点完发布就当完成 | 回列表核对 + 截图，没截图等于没发 |
| 改封面时误删别的作品 | 危险操作先锁对象，任一不符即停 |

## 哪些能直接用

- `scripts/` 五个 Python 工具：**直接用**，只依赖 ffmpeg 和 Pillow。
- `specs/` 四份规范：**直接用**，当验收标准抄进任务里。
- `publish/` 发布脚本：**先改一处再跑**——`start-cdp.sh` 里的浏览器 App 和 profile 目录要换成你自己的（见 `04-PUBLISH.md` 第二节）。平台改版后选择器会失效，先 dry-run。

## 出问题看哪

| 症状 | 看 |
|---|---|
| 字幕看不清 / 断词 | `02-SUBTITLE.md`、`specs/字幕规范.md` |
| 封面被裁 / 太冷 / 压脸 | `03-COVER.md`、`specs/封面规范.md` |
| 发布后没作品 / 传不上去 | `04-PUBLISH.md`、`specs/发布坑位清单.md` |
| 不知道该先做什么 | `00-PIPELINE.md` 的六阶段 |
| 想改规则 | `VERSION.md` 的「怎么改」 |

## 一句话

这套东西的价值不在脚本，在**门禁**：每一步都有「做到什么算做完」的定义。
把它当规则用，比当工具用有用得多。
