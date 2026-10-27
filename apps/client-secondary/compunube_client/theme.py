"""Surf Club: Acción por las Aguas look for the Tk window.

Same identity as the web client (`apps/web/dist/brand.css`): the game's sunset
over the water. Lagoon ink outlines, sunset coral for the main action, sun
yellow, peach sky and mint water, and sticker-like buttons with an ink border.
The wordmark is a pre-rendered PNG (`assets/surf-club-logo.png`, drawn by
`tools/make_logo.py`) because Tk cannot load a font file at run time. Only
presentation lives here.
"""

from __future__ import annotations

from pathlib import Path

INK = "#12393b"
TEXT = "#23484a"
MUTED = "#44605f"
GREEN = "#1d5552"
CORAL = "#ff7452"
CORAL_HOVER = "#ff8b6e"
CORAL_PRESSED = "#f0623f"
CORAL_LIGHT = "#f4a58f"
SUN = "#ffd166"
SKY = "#ffe6d0"
SAND = "#eaf5f0"          # window background: lagoon mint
PAPER = "#fffaf3"
WATER_PALE = "#c9f0e6"
LINE = "#c9d6d2"
DISABLED_BG, DISABLED_FG = "#f2d2c6", "#5f7a78"
WATER = "#1d6f8c"
# Tiles use the in-game material colours: coins sun, plastic water, scrap sunset.
TILES = {"coins": "#fff1c9", "plastic": "#d9f3ec", "metal": "#ffe3d8"}
SKY_BANDS = ("#ffd9bd", "#ffe2c8", "#ffead4", "#fff1df")
WATER_BANDS = ("#7cd1c6", "#5fc0b9", "#47adab", "#36999c", "#2a868e", "#1f7480", "#196372")
OK_BG, OK_FG = "#d9f3ec", "#16514a"
ERROR_BG, ERROR_FG = "#ffe1d8", "#9c3218"
LOGO = Path(__file__).resolve().parent / "assets" / "surf-club-logo.png"


def fonts(root) -> dict[str, tuple]:
    import tkinter.font as tkfont

    family = tkfont.nametofont("TkDefaultFont", root=root).actual("family")
    for preferred in ("Segoe UI", "SF Pro Text", "Ubuntu", "Cantarell", "DejaVu Sans"):
        if preferred in tkfont.families(root):
            family = preferred
            break
    return {"base": (family, 10), "small": (family, 9), "bold": (family, 10, "bold"),
            "title": (family, 13, "bold"), "brand": (family, 18, "bold"), "eyebrow": (family, 8, "bold"),
            "stat": (family, 20, "bold"), "kbd": (family, 9, "bold"), "big": (family, 13, "bold"),
            "button": (family, 11, "bold")}


def _button(style, name, background, hover, pressed, font):
    style.configure(name, background=background, foreground=INK, bordercolor=INK, lightcolor=background,
                    darkcolor=background, borderwidth=2, padding=(16, 8), font=font, focuscolor=INK)
    states = {"background": [("disabled", DISABLED_BG), ("pressed", pressed), ("active", hover)]}
    style.map(name, **states, lightcolor=states["background"], darkcolor=states["background"],
              foreground=[("disabled", DISABLED_FG)], bordercolor=[("disabled", "#9fb1ae")])


def apply(root, ttk) -> dict[str, tuple]:
    """Configure ttk styles on `clam`, which lets every colour be set on all platforms."""
    font = fonts(root)
    root.configure(background=SAND)
    style = ttk.Style(root)
    style.theme_use("clam")
    style.configure(".", background=SAND, foreground=TEXT, font=font["base"], bordercolor=LINE,
                    lightcolor=SAND, darkcolor=SAND, troughcolor=WATER_PALE, focuscolor=CORAL,
                    selectbackground=INK, selectforeground="white", insertcolor=INK)
    style.configure("App.TFrame", background=SAND)
    # Panels: ink outline, like the comic-panel frames of the web menus.
    style.configure("Card.TFrame", background=PAPER, bordercolor=INK, lightcolor=PAPER, darkcolor=PAPER,
                    relief="solid", borderwidth=2)
    style.configure("Inner.TFrame", background=PAPER)
    style.configure("Card.TLabel", background=PAPER, foreground=TEXT)
    style.configure("CardTitle.TLabel", background=PAPER, foreground=INK, font=font["title"])
    style.configure("CardHint.TLabel", background=PAPER, foreground=MUTED, font=font["small"])
    style.configure("Field.TLabel", background=PAPER, foreground=MUTED, font=font["bold"])
    for key, background in TILES.items():
        style.configure(f"{key}.Tile.TFrame", background=background)
        style.configure(f"{key}.TileValue.TLabel", background=background, foreground=INK, font=font["stat"])
        style.configure(f"{key}.TileCaption.TLabel", background=background, foreground=MUTED, font=font["eyebrow"])
    style.configure("Room.TLabel", background=WATER_PALE, foreground=INK, padding=(10, 8))
    style.configure("Hud.TLabel", background=INK, foreground="#fff1e4", font=font["bold"], padding=(12, 8))

    _button(style, "TButton", WATER_PALE, "#b5e8db", "#a2dfd0", font["button"])
    _button(style, "Primary.TButton", CORAL, CORAL_HOVER, CORAL_PRESSED, font["button"])

    for name in ("TEntry", "TCombobox", "TSpinbox"):
        style.configure(name, fieldbackground=PAPER, background=WATER_PALE, foreground=INK, bordercolor=INK,
                        lightcolor=PAPER, darkcolor=PAPER, arrowcolor=INK, padding=5)
        style.map(name, fieldbackground=[("readonly", PAPER), ("disabled", "#eef2ef")],
                  foreground=[("disabled", DISABLED_FG)], bordercolor=[("focus", CORAL), ("disabled", "#9fb1ae")],
                  lightcolor=[("focus", PAPER)])
    root.option_add("*TCombobox*Listbox.background", PAPER)
    root.option_add("*TCombobox*Listbox.foreground", INK)
    root.option_add("*TCombobox*Listbox.selectBackground", INK)
    root.option_add("*TCombobox*Listbox.selectForeground", "white")
    root.option_add("*TCombobox*Listbox.font", font["base"])

    for name in ("Card.TRadiobutton", "Card.TCheckbutton"):
        style.configure(name, background=PAPER, foreground=TEXT, indicatorbackground=PAPER,
                        indicatorforeground=INK, indicatormargin=(0, 0, 6, 0), upperbordercolor=INK,
                        lowerbordercolor=INK)
        style.map(name, background=[("active", PAPER)], indicatorbackground=[("selected", SUN)])

    import tkinter.font as tkfont
    row_height = tkfont.Font(root=root, font=font["base"]).metrics("linespace") + 12
    style.configure("Treeview", background=PAPER, fieldbackground=PAPER, foreground=TEXT, bordercolor=INK,
                    lightcolor=PAPER, darkcolor=PAPER, rowheight=row_height)
    style.map("Treeview", background=[("selected", INK)], foreground=[("selected", SUN)])
    style.configure("Treeview.Heading", background=SKY, foreground=INK, font=font["eyebrow"],
                    bordercolor=INK, lightcolor=SKY, darkcolor=SKY, relief="flat", padding=(8, 6))
    style.map("Treeview.Heading", background=[("active", "#ffd9bd")])
    style.configure("Vertical.TScrollbar", background=WATER_PALE, troughcolor=PAPER, bordercolor=INK,
                    lightcolor=WATER_PALE, darkcolor=WATER_PALE, arrowcolor=INK)
    style.configure("TSeparator", background=LINE)
    # Tabs read as game menu tabs: the open one is an ink sticker with sun text.
    style.configure("TNotebook", background=SAND, bordercolor=INK, lightcolor=SAND, darkcolor=SAND,
                    tabmargins=(0, 0, 0, 0))
    style.configure("TNotebook.Tab", background="#d3ebe3", foreground=MUTED, bordercolor=INK,
                    lightcolor="#d3ebe3", darkcolor="#d3ebe3", padding=(18, 8), font=font["button"])
    style.map("TNotebook.Tab", background=[("selected", INK), ("active", "#c1e3d8")],
              lightcolor=[("selected", INK)], darkcolor=[("selected", INK)],
              foreground=[("selected", SUN), ("active", INK)], expand=[("selected", (0, 2, 0, 0))])
    return font
