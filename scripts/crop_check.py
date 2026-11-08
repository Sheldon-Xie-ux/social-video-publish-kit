#!/usr/bin/env python3
"""
裁切模拟：把所有平台的中心裁切都模拟一遍，并标出 12.5%-87.5% 安全区。

用法:
  python3 crop_check.py --image covers/9x16.jpg --outdir crops/
  python3 crop_check.py --image covers/9x16.jpg --ratios 3:4,16:9 --outdir crops/
  python3 crop_check.py --selftest

输出:
  <name>-3x4.jpg   平台实际看到的 3:4 裁切
  <name>-16x9.jpg  平台实际看到的 16:9 裁切
  <name>-safe.jpg  原图 + 安全区框线（看关键元素有没有出界）
"""
import argparse
import os
import shutil
import sys
import tempfile

from PIL import Image, ImageDraw

SAFE_TOP = 0.125
SAFE_BOTTOM = 0.875
SAFE_LEFT = 0.125
SAFE_RIGHT = 0.875


def crop_center(im, W, H):
    r = max(W / float(im.width), H / float(im.height))
    im2 = im.resize((max(1, int(im.width * r + 0.5)), max(1, int(im.height * r + 0.5))), Image.LANCZOS)
    left = (im2.width - W) // 2
    top = (im2.height - H) // 2
    return im2.crop((left, top, left + W, top + H))


def parse_ratios(s):
    out = []
    for part in s.split(","):
        part = part.strip()
        if not part:
            continue
        a, _, b = part.partition(":")
        if not b:
            a, b = part.split("x")
        out.append((part.replace(":", "x"), int(a), int(b)))
    return out


def run(args):
    if not os.path.isfile(args.image):
        print("图片不存在: %s" % args.image)
        return 2
    os.makedirs(args.outdir, exist_ok=True)
    im = Image.open(args.image).convert("RGB")
    W, H = im.size
    base = os.path.splitext(os.path.basename(args.image))[0]

    for name, rw, rh in parse_ratios(args.ratios):
        # 目标尺寸：保持原图短边，按目标比例算
        target_w = min(W, 1600)
        target_h = int(round(target_w * rh / float(rw)))
        if target_h > H:
            target_h = H
            target_w = int(round(target_h * rw / float(rh)))
        out = crop_center(im, target_w, target_h)
        p = os.path.join(args.outdir, "%s-%s.jpg" % (base, name))
        out.save(p, quality=92)
        print("%-6s %dx%d -> %s" % (name, target_w, target_h, p))

    # 安全区叠加图
    safe = im.copy()
    d = ImageDraw.Draw(safe)
    box = [int(W * SAFE_LEFT), int(H * SAFE_TOP), int(W * SAFE_RIGHT), int(H * SAFE_BOTTOM)]
    d.rectangle(box, outline=(0, 210, 255), width=max(4, W // 180))
    # 3:4 裁切线
    ch = H
    cw = int(round(ch * 3 / 4.0))
    if cw <= W:
        left = (W - cw) // 2
        d.rectangle([left, 0, left + cw, H], outline=(255, 90, 90), width=max(3, W // 260))
    p = os.path.join(args.outdir, "%s-safe.jpg" % base)
    safe.save(p, quality=92)
    print("safe   安全区 + 3:4 裁切线 -> %s" % p)
    print("\n看图判断：蓝框内的关键元素在 3:4（红框）裁切后仍在吗？字有没有被切？脸有没有被切？")
    return 0


def selftest():
    tmp = tempfile.mkdtemp(prefix="crop-selftest-")
    try:
        src = os.path.join(tmp, "c.jpg")
        Image.new("RGB", (1080, 1920), (240, 225, 205)).save(src)
        out = os.path.join(tmp, "out")
        sys.argv = ["crop_check.py", "--image", src, "--ratios", "3:4,4:3,16:9", "--outdir", out]
        rc = run(parse())
        if rc != 0:
            return 1
        names = [f for f in os.listdir(out) if f.endswith(".jpg")]
        if len(names) < 4:
            print("SELFTEST FAIL: 输出文件不足 %s" % names)
            return 1
        print("SELFTEST PASS（3:4 / 4:3 / 16:9 + 安全区图）")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def parse():
    p = argparse.ArgumentParser(description="平台中心裁切模拟")
    p.add_argument("--image")
    p.add_argument("--ratios", default="3:4,4:3,16:9")
    p.add_argument("--outdir", default="crops")
    p.add_argument("--selftest", action="store_true")
    return p.parse_args()


def main():
    a = parse()
    if a.selftest:
        sys.exit(selftest())
    if not a.image:
        print("需要 --image（或 --selftest）")
        sys.exit(2)
    sys.exit(run(a))


if __name__ == "__main__":
    main()
