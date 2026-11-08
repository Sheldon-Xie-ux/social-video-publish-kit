#!/usr/bin/env python3
"""
字幕烧制：srt/json -> ASS（按画布套字号）-> ffmpeg 烧进成片。

用法:
  python3 burn_subs.py --video master.mp4 --srt sub.srt --canvas 1080x1920 --out final.mp4
  python3 burn_subs.py --video master.mp4 --srt sub.srt --canvas 1920x1080 --dry-run
  python3 burn_subs.py --selftest

规则来自 specs/字幕规范.md：字号按画布查表，断行交给 libass，每条 >=0.8s。
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

# 画布 -> (字号, 每行字数, 左右边距, 距底, 描边, 阴影)
STYLE = {
    (1080, 1920): (88, 11, 56, 340, 6, 2),
    (1080, 1440): (76, 10, 48, 240, 5, 2),
    (1920, 1080): (64, 16, 120, 60, 5, 2),
    (1080, 1080): (72, 9, 48, 140, 5, 2),
}

FONT_CANDIDATES = [
    "Hiragino Sans GB", "PingFang SC", "Noto Sans CJK SC",
    "Source Han Sans SC", "Microsoft YaHei", "WenQuanYi Zen Hei",
]


def pick_font(requested=None):
    if requested:
        return requested
    if shutil.which("fc-list"):
        out = subprocess.run(["fc-list", ":lang=zh", "family"], capture_output=True, text=True).stdout
        fams = []
        for line in out.splitlines():
            for f in line.split(","):
                fams.append(f.strip())
        for cand in FONT_CANDIDATES:
            if cand in fams:
                return cand
    for cand in FONT_CANDIDATES:
        if os.path.isdir("/System/Library/Fonts") and cand in ("Hiragino Sans GB", "PingFang SC"):
            return cand
    return "sans-serif"


def ts_to_sec(ts):
    ts = ts.strip().replace(",", ".")
    m = re.match(r"(\d+):(\d+):(\d+(?:\.\d+)?)$", ts)
    if not m:
        raise ValueError("时间码不合法: %s" % ts)
    h, mi, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return h * 3600 + mi * 60 + s


def ass_time(sec):
    if sec < 0:
        sec = 0
    cs = int(round(sec * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return "%d:%02d:%02d.%02d" % (h, m, s, cs)


def parse_srt(path):
    raw = open(path, encoding="utf-8-sig", errors="replace").read().replace("\r\n", "\n")
    blocks = re.split(r"\n\s*\n", raw.strip())
    items = []
    for b in blocks:
        lines = [l for l in b.split("\n") if l.strip() != ""]
        if not lines:
            continue
        idx = 0
        if re.match(r"^\d+$", lines[0].strip()):
            idx = 1
        if idx >= len(lines) or "-->" not in lines[idx]:
            continue
        a, _, b2 = lines[idx].partition("-->")
        text = " ".join(l.strip() for l in lines[idx + 1:])
        text = re.sub(r"<[^>]+>", "", text).strip()
        if not text:
            continue
        items.append({"start": ts_to_sec(a), "end": ts_to_sec(b2), "text": text})
    return items


def parse_json(path):
    data = json.load(open(path, encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("subtitles") or data.get("segments") or []
    items = []
    for s in data:
        if "start_us" in s:
            a, b = s["start_us"] / 1e6, s.get("end_us", 0) / 1e6
        else:
            a, b = float(s["start"]), float(s["end"])
        items.append({"start": a, "end": b, "text": str(s["text"]).strip()})
    return items


def load(path):
    return parse_json(path) if path.lower().endswith(".json") else parse_srt(path)


def fix_timing(items, min_dur=0.8, min_gap=0.08):
    items = sorted(items, key=lambda x: x["start"])
    notes = []
    for i, it in enumerate(items):
        if it["end"] - it["start"] < min_dur:
            it["end"] = it["start"] + min_dur
            notes.append("延长到 0.8s: %s" % it["text"][:14])
        if i + 1 < len(items):
            nxt = items[i + 1]
            if it["end"] > nxt["start"] - min_gap:
                it["end"] = max(it["start"] + 0.3, nxt["start"] - min_gap)
    return items, notes


def build_ass(items, canvas, font, max_chars=None):
    w, h = canvas
    fs, chars, ml, mv, outline, shadow = STYLE.get((w, h), STYLE[(1080, 1920)])
    head = """[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,{font},{fs},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,{outline},{shadow},2,{ml},{ml},{mv},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
""".format(w=w, h=h, font=font, fs=fs, outline=outline, shadow=shadow, ml=ml, mv=mv)

    lines = [head]
    too_long = []
    for it in items:
        txt = it["text"].replace("\n", " ").replace("{", "(").replace("}", ")")
        if max_chars and len(txt) > max_chars:
            too_long.append(txt)
        lines.append("Dialogue: 0,%s,%s,Sub,,0,0,0,,%s\n"
                     % (ass_time(it["start"]), ass_time(it["end"]), txt))
    return "".join(lines), too_long, (fs, chars, ml, mv)


def render(video, ass_path, out, cwd):
    ass_name = os.path.basename(ass_path)
    cmd = ["ffmpeg", "-v", "warning", "-y", "-i", os.path.abspath(video),
           "-vf", "ass=%s" % ass_name,
           "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
           "-c:a", "copy", "-movflags", "+faststart", os.path.abspath(out)]
    subprocess.run(cmd, cwd=cwd, check=True)


def run(args):
    if not os.path.isfile(args.video):
        print("视频不存在: %s" % args.video)
        return 2
    if not os.path.isfile(args.srt):
        print("字幕不存在: %s" % args.srt)
        return 2
    try:
        cw, ch = [int(x) for x in args.canvas.lower().split("x")]
    except ValueError:
        print("--canvas 格式应为 1080x1920")
        return 2

    items = load(args.srt)
    if not items:
        print("没解析出任何字幕行，检查 srt 格式")
        return 2
    if args.offset:
        for it in items:
            it["start"] += args.offset
            it["end"] += args.offset
        items = [i for i in items if i["end"] > 0]
        for it in items:
            it["start"] = max(0.0, it["start"])
    items, notes = fix_timing(items)
    font = pick_font(args.font)
    ass, too_long, spec = build_ass(items, (cw, ch), font, args.max_chars)

    outdir = os.path.dirname(os.path.abspath(args.out)) if args.out else os.getcwd()
    if not os.path.isdir(outdir):
        os.makedirs(outdir, exist_ok=True)
    ass_path = os.path.join(outdir, os.path.splitext(os.path.basename(args.out or "subs"))[0] + ".ass")
    open(ass_path, "w", encoding="utf-8").write(ass)

    print("字幕 %d 条 | 画布 %dx%d | 字号 %d | 字体 %s" % (len(items), cw, ch, spec[0], font))
    print("ASS: %s" % ass_path)
    for n in notes[:8]:
        print("  修正 " + n)
    for t in too_long[:5]:
        print("  过长(>%d字) %s" % (args.max_chars, t[:30]))

    if args.dry_run:
        print("dry-run：未渲染。确认 ASS 后去掉 --dry-run 重跑。")
        return 0

    render(args.video, ass_path, args.out, outdir)
    if os.path.isfile(args.out):
        print("完成 %s  %.1f MB" % (args.out, os.path.getsize(args.out) / 1048576.0))
    return 0


def selftest():
    tmp = tempfile.mkdtemp(prefix="burnsubs-selftest-")
    try:
        vid = os.path.join(tmp, "t.mp4")
        subprocess.run(["ffmpeg", "-v", "error", "-y",
                        "-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=30:duration=6",
                        "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", vid],
                       check=True)
        srt = os.path.join(tmp, "t.srt")
        open(srt, "w", encoding="utf-8").write(
            "1\n00:00:00,500 --> 00:00:02,500\n第一条字幕测试\n\n"
            "2\n00:00:02,600 --> 00:00:04,000\n第二条 DeepSeek 专名不拆\n")
        out = os.path.join(tmp, "out.mp4")
        sys.argv = ["burn_subs.py", "--video", vid, "--srt", srt,
                    "--canvas", "1080x1920", "--out", out]
        rc = run(parse())
        if rc != 0 or not os.path.isfile(out) or os.path.getsize(out) == 0:
            print("SELFTEST FAIL: 渲染失败")
            return 1
        ass = out.replace(".mp4", ".ass")
        body = open(ass, encoding="utf-8").read()
        m = re.search(r"Style: Sub,[^,]*,(\d+)", body)
        if not m or int(m.group(1)) != 88:
            print("SELFTEST FAIL: 字号不是 88")
            return 1
        print("SELFTEST PASS（解析、ASS、烧制全链路通过）")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def parse():
    p = argparse.ArgumentParser(description="srt/json -> ASS -> 烧制")
    p.add_argument("--video")
    p.add_argument("--srt", help=".srt 或 .json（[{'start','end','text'}]）")
    p.add_argument("--canvas", default="1080x1920")
    p.add_argument("--out")
    p.add_argument("--font")
    p.add_argument("--offset", type=float, default=0.0, help="整体位移秒数，负=提前")
    p.add_argument("--max-chars", dest="max_chars", type=int, default=0,
                   help="超过该字数只提示不拆（默认按画布）")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--selftest", action="store_true")
    return p.parse_args()


def main():
    a = parse()
    if a.selftest:
        sys.exit(selftest())
    if not a.video or not a.srt or not a.out:
        print("需要 --video --srt --out（或 --selftest）")
        sys.exit(2)
    sys.exit(run(a))


if __name__ == "__main__":
    main()
