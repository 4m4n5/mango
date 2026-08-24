#!/usr/bin/env python3
"""Render Mango's eight-card Instagram launch carousel.

The renderer never invents product UI. It composes current capture plates from
``~/.cache/mango-marketing/raw`` inside a small, reproducible marketing frame.
Run without arguments to create 1080×1440 opaque sRGB PNGs plus a generated
evidence manifest and contact sheet.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


W = 1080
H = 1440
SAFE = 64
CANVAS = "#0B0B12"
UI_BASE = "#07080A"
SURFACE = "#12151A"
TEXT = "#F4F1EA"
MUTED = "#A6A39E"
DIM = "#6E6D6C"
AMBER = "#E8A020"
AMBER_SOFT = "#6F4A12"
GREEN = "#48C78E"
RED = "#FF7373"
IMAGE_BOX = (52, 360, 1028, 909)

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
DEFAULT_RAW = Path.home() / ".cache" / "mango-marketing" / "raw"
DEFAULT_OUT = HERE / "out" / "instagram-carousel"
FONT_PATH = Path("/System/Library/Fonts/HelveticaNeue.ttc")

FINAL_COPY = {
    1: {
        "header": "reclaim your TV.",
        "subheader": "one household-owned surface.",
        "title": ("movies, shows, youtube,", "and optional live television."),
        "subtitle": ("built for raspberry pi 5.",),
    },
    2: {
        "header": "it is all here.",
        "subheader": "one launcher, not an app switcher.",
        "title": ("mango adds no ads of its own.",),
        "subtitle": ("third-party services stay theirs.",),
    },
    3: {
        "header": "search across mango.",
        "subheader": "movies, shows, live, youtube.",
        "title": ("one query.",),
        "subtitle": ("every mango surface you configured.",),
    },
    4: {
        "header": "inspect, then play.",
        "subheader": "the launcher stays until mpv proves it.",
        "title": ("choose from available streams.",),
        "subtitle": ("quality, audio, and language at a glance.",),
    },
    5: {
        "header": "rate with fire and water.",
        "subheader": "teach the household rails.",
        "title": ("progress and saved stay local.",),
        "subtitle": ("for you only when the evidence exists.",),
    },
    6: {
        "header": "your content librarian.",
        "subheader": "ask from the phone if you want.",
        "title": ("describe. discuss. open detail.",),
        "subtitle": ("B still plays.",),
    },
    7: {
        "header": "youtube, built in.",
        "subheader": "household rails, not youtube home.",
        "title": ("subscriptions, takeout, and watches.",),
        "subtitle": ("cached on the device you own.",),
    },
    8: {
        "header": "build mango.",
        "subheader": "self-hosted public alpha.",
        "title": ("read the source. contribute.",),
        "subtitle": ("github.com/4m4n5/mango",),
    },
}


@dataclass(frozen=True)
class Card:
    number: int
    slug: str
    renderer: Callable[[Path], Image.Image]
    inputs: tuple[str, ...]
    evidence: str
    limitation: str | None = None
    publication_blocker: str | None = None

    @property
    def card_id(self) -> str:
        return f"{self.number:02d}-{self.slug}"


def font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont:
    if not FONT_PATH.exists():
        return ImageFont.load_default(size=size)
    # HelveticaNeue.ttc index 0 is regular. Stroke and size carry hierarchy;
    # avoid depending on private collection indices that vary across macOS.
    return ImageFont.truetype(str(FONT_PATH), size=size, index=0)


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius, fill=255)
    return mask


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def canvas(*, halo_y: int | None = None) -> Image.Image:
    img = Image.new("RGB", (W, H), CANVAS).convert("RGBA")
    if halo_y is None:
        return img
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for radius in range(600, 40, -16):
        alpha = int(18 * (1 - radius / 600))
        gd.ellipse(
            (W // 2 - radius, halo_y - radius, W // 2 + radius, halo_y + radius),
            fill=hex_rgb(AMBER) + (alpha,),
        )
    return Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(48)))


def text_width(draw: ImageDraw.ImageDraw, value: str, face: ImageFont.ImageFont) -> int:
    box = draw.textbbox((0, 0), value, font=face)
    return box[2] - box[0]


def draw_tracking(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    value: str,
    face: ImageFont.ImageFont,
    fill: str,
    tracking: int,
) -> None:
    x, y = xy
    for char in value:
        draw.text((x, y), char, font=face, fill=fill)
        x += text_width(draw, char, face) + tracking


def draw_chrome(img: Image.Image, number: int, *, large_wordmark: bool = False) -> None:
    draw = ImageDraw.Draw(img)
    word_size = 54 if large_wordmark else 28
    draw.text((SAFE, 54), "mango.", font=font(word_size), fill=AMBER)
    progress = f"{number:02d} / 08" if number < 8 else "08 / 08 · end"
    face = font(20)
    x = W - SAFE - text_width(draw, progress, face)
    draw_tracking(draw, (x, 64), progress, face, DIM, 1)


def draw_lines(
    img: Image.Image,
    lines: tuple[str, ...],
    *,
    y: int,
    size: int,
    color: str = TEXT,
    gap: int = 4,
    x: int = SAFE,
) -> int:
    draw = ImageDraw.Draw(img)
    face = font(size)
    line_h = size + gap
    for index, line in enumerate(lines):
        draw.text((x, y + index * line_h), line, font=face, fill=color)
    return y + len(lines) * line_h


def draw_support(
    img: Image.Image,
    lines: tuple[str, ...],
    *,
    y: int,
    color: str = MUTED,
    size: int = 32,
) -> int:
    return draw_lines(img, lines, y=y, size=size, color=color, gap=7)


def fitting_font(
    draw: ImageDraw.ImageDraw,
    value: str,
    *,
    maximum: int,
    minimum: int,
    max_width: int,
) -> ImageFont.ImageFont:
    size = maximum
    while size > minimum:
        face = font(size)
        if text_width(draw, value, face) <= max_width:
            return face
        size -= 2
    return font(minimum)


def draw_standard_copy(
    img: Image.Image,
    *,
    header: str,
    subheader: str,
    title: tuple[str, ...],
    subtitle: tuple[str, ...],
) -> None:
    """Draw the shared header, subheader, image, title, subtitle hierarchy."""
    draw = ImageDraw.Draw(img)
    header_face = fitting_font(
        draw,
        header,
        maximum=72,
        minimum=54,
        max_width=W - SAFE * 2,
    )
    draw.text((SAFE, 126), header, font=header_face, fill=TEXT)
    draw.text((SAFE, 232), subheader, font=font(34), fill=MUTED)
    draw_lines(img, title, y=1015, size=48, color=AMBER, gap=5)
    draw_lines(img, subtitle, y=1140, size=29, color=MUTED, gap=7)


def draw_pill(
    img: Image.Image,
    value: str,
    xy: tuple[int, int],
    *,
    fill: str = SURFACE,
    border: str = AMBER_SOFT,
    text: str = TEXT,
    size: int = 24,
    pad_x: int = 22,
    pad_y: int = 13,
) -> tuple[int, int, int, int]:
    draw = ImageDraw.Draw(img)
    face = font(size)
    width = text_width(draw, value, face)
    box = (xy[0], xy[1], xy[0] + width + pad_x * 2, xy[1] + size + pad_y * 2)
    draw.rounded_rectangle(box, radius=(size + pad_y * 2) // 2, fill=fill, outline=border, width=2)
    draw.text((xy[0] + pad_x, xy[1] + pad_y - 2), value, font=face, fill=text)
    return box


def source(raw: Path, name: str) -> Image.Image:
    path = raw / name
    if not path.exists():
        raise FileNotFoundError(f"missing carousel capture: {path}")
    return Image.open(path).convert("RGBA")


def crop_fraction(
    image: Image.Image,
    *,
    left: float = 0,
    top: float = 0,
    right: float = 1,
    bottom: float = 1,
) -> Image.Image:
    return image.crop(
        (
            round(image.width * left),
            round(image.height * top),
            round(image.width * right),
            round(image.height * bottom),
        )
    )


def paste_rounded(
    img: Image.Image,
    plate: Image.Image,
    box: tuple[int, int, int, int],
    *,
    radius: int = 24,
    fit: str = "contain",
    border: bool = True,
) -> None:
    x1, y1, x2, y2 = box
    target = (x2 - x1, y2 - y1)
    if fit == "cover":
        fitted = ImageOps.fit(plate, target, method=Image.Resampling.LANCZOS)
    else:
        fitted = ImageOps.contain(plate, target, method=Image.Resampling.LANCZOS)
        backing = Image.new("RGBA", target, hex_rgb(UI_BASE) + (255,))
        backing.alpha_composite(
            fitted,
            dest=((target[0] - fitted.width) // 2, (target[1] - fitted.height) // 2),
        )
        fitted = backing
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((x1 - 10, y1 + 8, x2 + 10, y2 + 26), radius + 8, fill=(0, 0, 0, 150))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(18)))
    mask = rounded_mask(target, radius)
    img.paste(fitted, (x1, y1), mask)
    if border:
        ImageDraw.Draw(img).rounded_rectangle(
            box,
            radius=radius,
            outline=(255, 255, 255, 30),
            width=2,
        )


def draw_tv(
    img: Image.Image,
    plate: Image.Image,
    *,
    x: int,
    y: int,
    width: int,
    radius: int = 24,
) -> tuple[int, int, int, int]:
    screen_h = round(width * 9 / 16)
    bezel = 15
    outer = (x, y, x + width, y + screen_h + bezel * 2)
    ImageDraw.Draw(img).rounded_rectangle(outer, radius=radius + 8, fill="#18191C", outline="#36383D", width=2)
    paste_rounded(
        img,
        plate,
        (x + bezel, y + bezel, x + width - bezel, y + bezel + screen_h),
        radius=radius,
        border=False,
    )
    stand_y = outer[3]
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(
        (x + width // 2 - 42, stand_y, x + width // 2 + 42, stand_y + 34),
        radius=10,
        fill="#24262A",
    )
    draw.rounded_rectangle(
        (x + width // 2 - 110, stand_y + 28, x + width // 2 + 110, stand_y + 42),
        radius=7,
        fill="#202226",
    )
    return outer


def render_01(raw: Path) -> Image.Image:
    img = canvas(halo_y=720)
    draw_chrome(img, 1)
    draw_standard_copy(img, **FINAL_COPY[1])
    draw_tv(img, source(raw, "pi-home-movies.png"), x=80, y=360, width=920)
    return img


def render_02(raw: Path) -> Image.Image:
    img = canvas(halo_y=780)
    draw_chrome(img, 2)
    draw_standard_copy(img, **FINAL_COPY[2])
    paste_rounded(img, source(raw, "pi-explore.png"), IMAGE_BOX, radius=26)
    return img


def render_03(raw: Path) -> Image.Image:
    img = canvas(halo_y=770)
    draw_chrome(img, 3)
    draw_standard_copy(img, **FINAL_COPY[3])
    mosaic = Image.new("RGBA", (976, 549), hex_rgb(UI_BASE) + (255,))
    search_plates = (
        source(raw, "pi-search-f1-movies.png"),
        source(raw, "pi-search-f1-series.png"),
        source(raw, "pi-search-f1-live.png"),
        source(raw, "pi-search-f1-youtube.png"),
    )
    cell_w, cell_h, gutter = 484, 270, 8
    for index, plate in enumerate(search_plates):
        fitted = ImageOps.fit(plate, (cell_w, cell_h), method=Image.Resampling.LANCZOS)
        x = (index % 2) * (cell_w + gutter)
        y = (index // 2) * (cell_h + gutter)
        mosaic.alpha_composite(fitted, dest=(x, y))
    paste_rounded(img, mosaic, IMAGE_BOX, radius=26)
    return img


def render_04(raw: Path) -> Image.Image:
    img = canvas(halo_y=760)
    draw_chrome(img, 4)
    draw_standard_copy(img, **FINAL_COPY[4])
    paste_rounded(img, source(raw, "pi-rrr-streams-fixed.png"), IMAGE_BOX, radius=26)
    return img


def render_05(raw: Path) -> Image.Image:
    img = canvas(halo_y=760)
    draw_chrome(img, 5)
    draw_standard_copy(img, **FINAL_COPY[5])
    plate = crop_fraction(source(raw, "pi-rating-rrr-chips.png"), right=0.74)
    paste_rounded(img, plate, IMAGE_BOX, radius=26, fit="cover")
    return img


def render_06(raw: Path) -> Image.Image:
    img = canvas(halo_y=820)
    draw_chrome(img, 6)
    draw_standard_copy(img, **FINAL_COPY[6])
    tv_plate = source(raw, "pi-librarian-badlapur.png")
    paste_rounded(img, tv_plate, IMAGE_BOX, radius=26)

    phone = source(raw, "companion-librarian-two-turn.png")
    # Remove the account header and subscription count from the public asset;
    # the conversation itself is the evidence this card needs.
    phone = crop_fraction(phone, top=0.13, bottom=0.94)
    phone = ImageOps.contain(phone, (270, 515), method=Image.Resampling.LANCZOS)
    phone_back = Image.new("RGBA", (phone.width + 18, phone.height + 18), (18, 18, 20, 255))
    phone_back.paste(phone, (9, 9), rounded_mask(phone.size, 42))
    phone_mask = rounded_mask(phone_back.size, 50)
    phone_x = 72
    phone_y = IMAGE_BOX[1] + (IMAGE_BOX[3] - IMAGE_BOX[1] - phone_back.height) // 2
    img.paste(phone_back, (phone_x, phone_y), phone_mask)
    ImageDraw.Draw(img).rounded_rectangle(
        (phone_x, phone_y, phone_x + phone_back.width, phone_y + phone_back.height),
        radius=50,
        outline=(255, 255, 255, 38),
        width=2,
    )
    return img


def render_07(raw: Path) -> Image.Image:
    img = canvas(halo_y=770)
    draw_chrome(img, 7)
    draw_standard_copy(img, **FINAL_COPY[7])
    paste_rounded(img, source(raw, "pi-youtube-home.png"), IMAGE_BOX, radius=26)
    return img


def render_08(raw: Path) -> Image.Image:
    img = canvas(halo_y=720)
    draw_chrome(img, 8)
    draw_standard_copy(img, **FINAL_COPY[8])
    draw_tv(img, source(raw, "pi-home-movies.png"), x=80, y=360, width=920)
    return img


CARDS: tuple[Card, ...] = (
    Card(1, "product", render_01, ("pi-home-movies.png",), "Pi capture"),
    Card(2, "breadth", render_02, ("pi-explore.png",), "Pi capture"),
    Card(
        3,
        "search",
        render_03,
        (
            "pi-search-f1-movies.png",
            "pi-search-f1-series.png",
            "pi-search-f1-live.png",
            "pi-search-f1-youtube.png",
        ),
        "Four scoped Pi captures",
    ),
    Card(
        4,
        "streams",
        render_04,
        ("pi-rrr-streams-fixed.png",),
        "Pi capture",
        limitation="Uses a real pre-play verified stream ladder; no advancing-video claim is made.",
    ),
    Card(
        5,
        "taste",
        render_05,
        ("pi-rating-rrr-chips.png",),
        "Pi capture",
        limitation="The existing real RRR household rating is Fire 5.0 / Water 5.0, not an asymmetric example.",
    ),
    Card(
        6,
        "librarian",
        render_06,
        ("companion-librarian-two-turn.png", "pi-librarian-badlapur.png"),
        "Phone/Pi composite from one real interaction",
    ),
    Card(
        7,
        "youtube",
        render_07,
        ("pi-youtube-home.png", "pi-youtube-regulars.png"),
        "Pi capture",
    ),
    Card(
        8,
        "contact",
        render_08,
        ("pi-home-movies.png",),
        "Pi Home capture with source CTA",
    ),
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_revision() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def contact_sheet(paths: list[Path], out: Path) -> None:
    thumb_w, thumb_h = 270, 360
    sheet = Image.new("RGB", (thumb_w * 4, thumb_h * 2), CANVAS)
    for index, path in enumerate(paths):
        thumb = Image.open(path).convert("RGB").resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        sheet.paste(thumb, ((index % 4) * thumb_w, (index // 4) * thumb_h))
    sheet.save(out, optimize=True)


def render(selected: set[str] | None, raw: Path, out: Path) -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)
    cards = [card for card in CARDS if not selected or card.card_id in selected]
    if selected and not cards:
        raise SystemExit(f"no card matched: {', '.join(sorted(selected))}")

    paths: list[Path] = []
    records: list[dict[str, object]] = []
    captured_at = datetime.now(timezone.utc).isoformat()

    for card in cards:
        for name in card.inputs:
            if not (raw / name).exists():
                raise FileNotFoundError(f"{card.card_id}: missing {raw / name}")
        image = card.renderer(raw).convert("RGB")
        if image.size != (W, H):
            raise RuntimeError(f"{card.card_id}: bad render size {image.size}")
        path = out / f"card-{card.card_id}.png"
        image.save(path, format="PNG", optimize=True)
        paths.append(path)
        records.append(
            {
                "card": card.number,
                "slug": card.slug,
                "output": path.name,
                "output_sha256": sha256(path),
                "dimensions": [W, H],
                "mode": "RGB",
                "copy": FINAL_COPY[card.number],
                "evidence": card.evidence,
                "inputs": [
                    {
                        "file": name,
                        "sha256": sha256(raw / name),
                        "dimensions": list(Image.open(raw / name).size),
                    }
                    for name in card.inputs
                ],
                "limitation": card.limitation,
                "publication_blocker": card.publication_blocker,
            }
        )
        print(f"rendered {path}")

    raw_label = str(raw)
    home_prefix = f"{Path.home()}/"
    if raw_label.startswith(home_prefix):
        raw_label = f"~/{raw_label.removeprefix(home_prefix)}"
    manifest = {
        "generated_at": captured_at,
        "repository_revision": git_revision(),
        "format": {"width": W, "height": H, "color": "sRGB RGB PNG"},
        "raw_directory": raw_label,
        "publication_ready": all(not item["publication_blocker"] for item in records)
        and len(records) == len(CARDS),
        "cards": records,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    if len(paths) == len(CARDS):
        contact_sheet(paths, out / "contact-sheet.png")
    return paths


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render Mango's Instagram launch carousel.")
    parser.add_argument("--raw", type=Path, default=DEFAULT_RAW, help="capture input directory")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="render output directory")
    parser.add_argument(
        "--only",
        help="comma-separated card ids, for example 01-product,06-librarian",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    selected = {part.strip() for part in args.only.split(",")} if args.only else None
    render(selected, args.raw.expanduser(), args.out)


if __name__ == "__main__":
    main()
