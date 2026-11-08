#!/usr/bin/env python3
"""
成片预检（preflight）：发布前最后一道闸。
不过就退出码 1，不许再往下走。

用法:
  python3 preflight.py --video final.mp4 --cover cover-3x4.jpg --canvas 1080x1920
  python3 preflight.py --video final.mp4 --platform douyin --title "标题" \
                       --first-frame cover-9x16.jpg --title-top 0.30 --title-bottom 0.52
  python3 preflight.py --selftest

检查项:
  - 文件存在且非空
  - 有视频流、有音频流、时长 > 0、不是静音
  - 分辨率与 --canvas 一致（可 --no-canvas-check 关闭）
  - 封面存在、比例对、尺寸够
  - 标题字数不超平台上限
  - 首帧与封面一致（均值差阈值，可调 --frame-tolerance）
  - 标题区落在垂直 12.5%-87.5% 中心裁切安全区
"""
import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

FAIL = []
WARN = []
OK = []


def ok(msg):
    OK.append(msg)
    print("  PASS  " + msg)


def fail(msg):
    FAIL.append(msg)
    print("  FAIL  " + msg)


def warn(msg):
    WARN.append(msg)
    print("  WARN  " + msg)


def need_ffmpeg():
    for b in ("ffmpeg", "ffprobe"):
        if not shutil.which(b):
            print("缺少 %s，请先安装 ffmpeg（brew install ffmpeg / apt install ffmpeg）" % b)
            sys.exit(2)


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path],
        capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip()[:400])
    return json.loads(out.stdout)


def sizes(path):
    """返回所有视频流的 (宽, 高)。"""
    m = probe(path)
    return [(int(s["width"]), int(s["height"])) for s in m.get("streams", [])
            if s.get("codec_type") == "video"]


def image_size(path):
    try:
        from PIL import Image
    except ImportError:
        raise RuntimeError("需要 Pillow：python3 -m pip install pillow")
    with Image.open(path) as im:
        return im.size


def mean_volume(path):
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "volumedetect", "-f", "null", "-"],
        capture_output=True, text=True)
    for line in out.stderr.splitlines():
        if "mean_volume:" in line:
            try:
                return float(line.split("mean_volume:")[1].split("dB")[0].strip())
            except ValueError:
                return None
    return None


def frame_diff(video, cover, at=0.2):
    """把视频首帧和封面都缩到 64 宽，比较平均绝对差（0-255）。"""
    try:
        from PIL import Image
        import io
    except ImportError:
        raise RuntimeError("需要 Pillow")
    tmp = tempfile.mkdtemp()
    try:
        a = os.path.join(tmp, "a.png")
        b = os.path.join(tmp, "b.png")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(at), "-i", video,
                        "-frames:v", "1", "-vf", "scale=64:-2", a], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", cover,
                        "-frames:v", "1", "-vf", "scale=64:-2", b], check=True)
        ia = Image.open(a).convert("RGB").resize((64, 64))
        ib = Image.open(b).convert("RGB").resize((64, 64))
        pa, pb = list(ia.getdata()), list(ib.getdata())
        total = 0
        for x, y in zip(pa, pb):
            total += abs(x[0] - y[0]) + abs(x[1] - y[1]) + abs(x[2] - y[2])
        return total / (len(pa) * 3.0)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


TITLE_LIMIT = {"douyin": 30, "xhs": 20, "channels": 16, "bili": 80, "video号": 16}


def run(args):
    print("\n== 成片预检 ==")
    if not os.path.isfile(args.video) or os.path.getsize(args.video) == 0:
        fail("视频不存在或为空: %s" % args.video)
        return
    ok("视频存在: %.1f MB" % (os.path.getsize(args.video) / 1048576.0))

    try:
        meta = probe(args.video)
    except Exception as e:
        fail("ffprobe 读不了: %s" % e)
        return

    streams = meta.get("streams", [])
    v = [s for s in streams if s.get("codec_type") == "video"]
    a = [s for s in streams if s.get("codec_type") == "audio"]
    if not v:
        fail("没有视频流")
    else:
        w, h = int(v[0]["width"]), int(v[0]["height"])
        ok("视频流 %dx%d %s" % (w, h, v[0].get("codec_name", "")))
    if not a:
        fail("没有音频流（平台会判定为无声视频）")
    else:
        ok("音频流 %s %s Hz" % (a[0].get("codec_name", ""), a[0].get("sample_rate", "?")))

    dur = float(meta.get("format", {}).get("duration", 0) or 0)
    if dur <= 0:
        fail("时长无效")
    elif dur < 3:
        warn("时长只有 %.1fs，短视频平台可能拒绝" % dur)
    else:
        ok("时长 %.2fs" % dur)

    if args.canvas and v:
        try:
            cw, ch = [int(x) for x in args.canvas.lower().split("x")]
        except ValueError:
            fail("--canvas 格式应为 1080x1920")
            cw = ch = 0
        if cw and (w, h) != (cw, ch):
            if not args.no_canvas_check:
                fail("分辨率 %dx%d 与画布 %dx%d 不一致" % (w, h, cw, ch))
            else:
                warn("分辨率与画布不一致（已按 --no-canvas-check 忽略）")

    if a:
        mv = mean_volume(args.video)
        if mv is None:
            warn("读不到音量，跳过静音检测")
        elif mv < -45:
            fail("整体音量 %.1f dB，基本是静音" % mv)
        else:
            ok("音量 %.1f dB" % mv)

    if args.cover:
        if not os.path.isfile(args.cover) or os.path.getsize(args.cover) == 0:
            fail("封面不存在或为空: %s" % args.cover)
        else:
            iw, ih = image_size(args.cover)
            ok("封面 %dx%d" % (iw, ih))
            if iw < 720:
                fail("封面宽度 %d < 720，平台会糊" % iw)
            want = args.cover_ratio
            if want:
                rw, rh = [float(x) for x in want.split(":")]
                got = iw / float(ih)
                if abs(got - rw / rh) > 0.02:
                    fail("封面比例 %.3f 与要求的 %s 不符" % (got, want))
                else:
                    ok("封面比例 %s 正确" % want)

    if args.title and args.platform:
        limit = TITLE_LIMIT.get(args.platform)
        if limit:
            n = len(args.title)
            if n > limit:
                fail("标题 %d 字，超过 %s 上限 %d 字" % (n, args.platform, limit))
            else:
                ok("标题 %d/%d 字" % (n, limit))

    if args.first_frame:
        if not os.path.isfile(args.first_frame):
            fail("首帧对照图不存在: %s" % args.first_frame)
        else:
            d = frame_diff(args.video, args.first_frame)
            ok("首帧与封面差异 %.1f（阈值 %.0f）" % (d, args.frame_tolerance))
            if d > args.frame_tolerance:
                fail("首帧与封面不一致（差 %.1f），平台抓首帧会显示错画面" % d)

    if args.title_top is not None and args.title_bottom is not None:
        t, b = float(args.title_top), float(args.title_bottom)
        if t < 0.125 or b > 0.875 or b <= t:
            fail("标题区 %.3f-%.3f 超出中心裁切安全区 0.125-0.875" % (t, b))
        else:
            ok("标题区 %.3f-%.3f 在安全区内" % (t, b))

    if args.subs:
        if not os.path.isfile(args.subs):
            fail("字幕文件不存在: %s" % args.subs)
        else:
            text = open(args.subs, encoding="utf-8", errors="ignore").read()
            ok("字幕文件存在（%d 字节）" % len(text.encode("utf-8")))
            if args.subs.lower().endswith(".ass"):
                import re
                m = re.search(r"Style:\s*Sub,[^,]*,\s*(\d+)", text)
                if not m:
                    warn("ASS 里没找到名为 Sub 的样式，请确认脚本里的样式名")
                else:
                    fs = int(m.group(1))
                    if args.canvas == "1080x1920" and fs < 80:
                        fail("竖屏字幕字号 %d < 80，手机上读不清（标准 88）" % fs)
                    else:
                        ok("字幕字号 %d" % fs)
                if "WrapStyle: 0" not in text and "WrapStyle:0" not in text:
                    warn("WrapStyle 不是 0，断行可能劈开专名")


def selftest():
    need_ffmpeg()
    tmp = tempfile.mkdtemp(prefix="preflight-selftest-")
    try:
        vid = os.path.join(tmp, "t.mp4")
        cov = os.path.join(tmp, "c.jpg")
        subprocess.run(["ffmpeg", "-v", "error", "-y",
                        "-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=30:duration=3",
                        "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", vid],
                       check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", vid, "-frames:v", "1", cov], check=True)
        sys.argv = ["preflight.py", "--video", vid, "--cover", cov,
                    "--canvas", "1080x1920", "--cover-ratio", "9:16",
                    "--platform", "douyin", "--title", "自测标题",
                    "--first-frame", cov, "--title-top", "0.3", "--title-bottom", "0.5",
                    "--quiet"]
        args = parse()
        run(args)
        if FAIL:
            print("\nSELFTEST FAIL:")
            for f in FAIL:
                print(" - " + f)
            return 1
        print("\nSELFTEST PASS（4 项核心检查全部跑通）")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def parse():
    p = argparse.ArgumentParser(description="成片发布前硬校验")
    p.add_argument("--video")
    p.add_argument("--cover")
    p.add_argument("--cover-ratio", help="如 3:4 / 9:16 / 4:3")
    p.add_argument("--canvas", default="", help="如 1080x1920")
    p.add_argument("--platform", choices=["douyin", "xhs", "channels", "bili"])
    p.add_argument("--title")
    p.add_argument("--subs", help=".ass 或 .srt")
    p.add_argument("--first-frame", dest="first_frame", help="设计封面，用于和视频首帧比对")
    p.add_argument("--frame-tolerance", dest="frame_tolerance", type=float, default=22.0)
    p.add_argument("--title-top", dest="title_top", type=float)
    p.add_argument("--title-bottom", dest="title_bottom", type=float)
    p.add_argument("--no-canvas-check", action="store_true")
    p.add_argument("--selftest", action="store_true")
    p.add_argument("--quiet", action="store_true")
    return p.parse_args()


def main():
    args = parse()
    if args.selftest:
        sys.exit(selftest())
    if not args.video:
        print("需要 --video（或 --selftest）")
        sys.exit(2)
    need_ffmpeg()
    run(args)
    print("\n结果: %d 通过 / %d 警告 / %d 失败" % (len(OK), len(WARN), len(FAIL)))
    if FAIL:
        print("PREFLIGHT FAIL")
        sys.exit(1)
    print("PREFLIGHT PASS")


if __name__ == "__main__":
    main()
