#!/usr/bin/env python3
"""
转写：视频/音频 -> srt + json（带时间码），供 burn_subs.py 使用。

依赖（可选装，不装也能跑通其余流程）:
  python3 -m pip install faster-whisper

用法:
  python3 transcribe.py --input master.mp4 --out sub --model small --prompt "FDE、AI BP、Codex"
  python3 transcribe.py --input a.m4a --out sub --model large-v3 --lang zh

输出: sub.srt（可直接烧）+ sub.json（[{"start","end","text"}]）
先用 small 出稿校对，定稿不必用大模型重跑——错字在校对阶段改。
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile


def audio_from(path):
    tmp = tempfile.mkdtemp(prefix="asr-")
    wav = os.path.join(tmp, "a16k.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path,
                    "-vn", "-ac", "1", "-ar", "16000", wav], check=True)
    return tmp, wav


def srt_time(t):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return "%02d:%02d:%02d,%03d" % (h, m, s, ms)


def to_srt(rows):
    out = []
    for i, r in enumerate(rows, 1):
        out.append("%d\n%s --> %s\n%s\n" % (i, srt_time(r["start"]), srt_time(r["end"]), r["text"]))
    return "\n".join(out)


def run(args):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("没装 faster-whisper。安装：")
        print("  python3 -m pip install faster-whisper")
        print("（首次运行会自动下载模型，small 约 500MB）")
        return 2
    if not os.path.isfile(args.input):
        print("输入不存在: %s" % args.input)
        return 2

    tmp, wav = audio_from(args.input)
    try:
        print("加载模型 %s ..." % args.model)
        model = WhisperModel(args.model, device=args.device, compute_type=args.compute)
        segs, info = model.transcribe(
            wav, language=args.lang, beam_size=5, vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=300),
            initial_prompt=args.prompt or None,
            condition_on_previous_text=False)
        rows = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
                for s in segs]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    if not rows:
        print("没有识别出内容，检查音轨或换 --model medium")
        return 1
    base = os.path.splitext(args.out)[0]
    with open(base + ".json", "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
    with open(base + ".srt", "w", encoding="utf-8") as f:
        f.write(to_srt(rows))
    print("识别 %d 段，总时长 %.1fs" % (len(rows), rows[-1]["end"]))
    print("  %s.srt / %s.json" % (base, base))
    print("\n下一步：人工校对人名/专名（AI 一定会在专名上错），再用 burn_subs.py 烧制。")
    return 0


def parse():
    p = argparse.ArgumentParser(description="faster-whisper 转写")
    p.add_argument("--input", help="视频或音频")
    p.add_argument("--out", default="sub", help="输出前缀，生成 .srt 和 .json")
    p.add_argument("--model", default="small", help="small / medium / large-v3")
    p.add_argument("--lang", default="zh")
    p.add_argument("--prompt", help="专名提示，减少人名/术语错字")
    p.add_argument("--device", default="cpu")
    p.add_argument("--compute", default="int8")
    return p.parse_args()


def main():
    a = parse()
    if not a.input:
        print("需要 --input")
        sys.exit(2)
    sys.exit(run(a))


if __name__ == "__main__":
    main()
