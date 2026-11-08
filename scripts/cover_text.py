#!/usr/bin/env python3
"""
封面压字：一张底图 -> 四个比例 + 代码压标题（AI 只出人和景，文字全用代码）。

用法:
  python3 cover_text.py --base bg.jpg --lines "企业AI落地" "其实就三步" --accent 2 --outdir covers/
  python3 cover_text.py --base bg.jpg --lines "标题" --ratio 3x4 --pos bottom
  python3 cover_text.py --selftest

输出: 9x16.jpg 1080x1920 / 3x4.jpg 1080x1440 / 4x3.jpg 1600x1200 / 16x9.jpg 1920x1080
规则: 文字块必须落在垂直 12.5%-87.5% 中心裁切安全区内；不许小字。
"""
import argparse
import os
import shutil
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

RATIOS = {
    "9x16": (1080, 1920),
    "3x4": (1080, 1440),
    "4x3": (1600, 1200),
    "16x9": (1920, 1080),
}

WHITE = (255, 255, 255)
WARM_YELLOW = (255, 213, 79)
WARM_ORANGE = (255, 138, 61)
BLACK = (0, 0, 0)

FONT_PATHS = [
    ("/System/Library/Fonts/Hiragino Sans GB.ttc", 1),
    ("/System/Library/Fonts/PingFang.ttc", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 0),
    ("/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 0),
    ("C:/Windows/Fonts/msyhbd.ttc", 0),
    ("C:/Windows/Fonts/msyh.ttc", 0),
]


def find_font():
    for path, idx in FONT_PATHS:
        if os.path.isfile(path):
            return path, idx
    return None, 0


def font_at(size, spec):
    path, idx = spec
    if not path:
        return ImageFont.load_default()
    try:
        return ImageFont.truetype(path, size, index=idx)
    except Exception:
        return ImageFont.truetype(path, size)


def cover_crop(im, W, H):
    r = max(W / float(im.width), H / float(im.height))
    im2 = im.resize((max(1, int(im.width * r + 0.5)), max(1, int(im.height * r + 0.5))), Image.LANCZOS)
    left = (im2.width - W) // 2
    top = int((im2.height - H) * 0.42)  # 略偏上，保人脸
    top = max(0, min(top, im2.height - H))
    return im2.crop((left, top, left + W, top + H))


def fit_text(lines, W, H, spec):
    """从大到小试字号，保证所有行宽 <= 88% 宽、总高 <= 55% 高。"""
    max_w = W * 0.88
    max_h = H * 0.55
    lo, hi = 24, int(H * 0.22)
    best = lo
    tmp = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    while lo <= hi:
        mid = (lo + hi) // 2
        f = font_at(mid, spec)
        widest = max(tmp.textlength(t, font=f) for t in lines)
        total_h = mid * 1.16 * len(lines)
        if widest <= max_w and total_h <= max_h:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return best


def draw_text_block(im, lines, accent, pos, spec, line_color=None):
    W, H = im.size
    fs = fit_text(lines, W, H, spec)
    f = font_at(fs, spec)
    lh = int(fs * 1.16)
    total = lh * len(lines)
    if pos == "top":
        y0 = int(H * 0.16)
    elif pos == "bottom":
        y0 = int(H * 0.855) - total
    else:
        y0 = (H - total) // 2
    # 强制落在 12.5%-87.5% 安全区
    y0 = max(int(H * 0.125), min(y0, int(H * 0.875) - total))

    d = ImageDraw.Draw(im)
    stroke = max(6, int(fs * 0.065))
    for i, line in enumerate(lines):
        y = y0 + i * lh
        color = WARM_YELLOW if (accent and i + 1 == accent) else (line_color or WHITE)
        x = (W - d.textlength(line, font=f)) / 2.0
        d.text((x, y), line, font=f, fill=color, stroke_width=stroke, stroke_fill=BLACK)
    return fs, (y0 / float(H), (y0 + total) / float(H))


def run(args):
    if not os.path.isfile(args.base):
        print("底图不存在: %s" % args.base)
        return 2
    targets = [args.ratio] if args.ratio else list(RATIOS.keys())
    os.makedirs(args.outdir, exist_ok=True)
    spec = find_font()
    if not spec[0]:
        print("警告：没找到中文字体，可能显示方框。用 --font 指定 ttc 路径。")
    base = Image.open(args.base).convert("RGB")

    for name in targets:
        if name not in RATIOS:
            print("未知比例 %s，可选：%s" % (name, ", ".join(RATIOS)))
            continue
        W, H = RATIOS[name]
        canvas = cover_crop(base, W, H)
        fs, band = draw_text_block(canvas, args.lines, args.accent, args.pos, spec)
        out = os.path.join(args.outdir, "%s.jpg" % name)
        canvas.save(out, quality=94)
        print("%-5s %4dx%-4d 字号 %3d  文字区 %.2f-%.2f  %s"
              % (name, W, H, fs, band[0], band[1], out))
    if args.accent and args.accent > len(args.lines):
        print("提示：--accent %d 超过行数 %d，未高亮" % (args.accent, len(args.lines)))
    return 0


def selftest():
    tmp = tempfile.mkdtemp(prefix="cover-selftest-")
    try:
        base = os.path.join(tmp, "base.jpg")
        Image.new("RGB", (1024, 1536), (245, 230, 211)).save(base)
        out = os.path.join(tmp, "out")
        sys.argv = ["cover_text.py", "--base", base, "--lines", "企业AI落地", "其实就三步",
                    "--accent", "2", "--outdir", out]
        rc = run(parse())
        if rc != 0:
            return 1
        for n, (W, H) in RATIOS.items():
            p = os.path.join(out, n + ".jpg")
            if not os.path.isfile(p):
                print("SELFTEST FAIL: 缺 %s" % n)
                return 1
            im = Image.open(p)
            if im.size != (W, H):
                print("SELFTEST FAIL: %s 尺寸 %s" % (n, im.size))
                return 1
        print("SELFTEST PASS（4 个比例全部生成，尺寸正确）")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def parse():
    p = argparse.ArgumentParser(description="封面代码压字")
    p.add_argument("--base", help="底图路径")
    p.add_argument("--lines", nargs="+", help="标题行，2-3 行为宜")
    p.add_argument("--accent", type=int, default=0, help="第几行用暖黄高亮（1 开始，0=不高亮）")
    p.add_argument("--pos", choices=["top", "center", "bottom"], default="bottom",
                   help="文字块位置；默认 bottom（正脸封面的安全选择，center 容易压脸）")
    p.add_argument("--ratio", help="只出某个比例：9x16/3x4/4x3/16x9")
    p.add_argument("--outdir", default="covers")
    p.add_argument("--selftest", action="store_true")
    return p.parse_args()


def main():
    a = parse()
    if a.selftest:
        sys.exit(selftest())
    if not a.base or not a.lines:
        print("需要 --base 和 --lines（或 --selftest）")
        sys.exit(2)
    sys.exit(run(a))


if __name__ == "__main__":
    main()
