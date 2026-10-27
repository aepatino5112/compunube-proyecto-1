"""Surf Club: Acción por las Aguas look for the Tk window.

Same palette as the web client (`apps/web/dist/brand.css`): deep green ink,
sand background, coral accent. Only presentation lives here.
"""

from __future__ import annotations

INK = "#1d473b"
TEXT = "#2f5245"
MUTED = "#4a6255"
GREEN = "#285746"
GREEN_HOVER = "#1f4a3b"
GREEN_PRESSED = "#173d31"
CORAL = "#e0674b"
CORAL_LIGHT = "#f4a58f"
SAND = "#f6f5ef"
PAPER = "#fffef8"
TILE = "#eef2e6"
LINE = "#d8decf"
FIELD_LINE = "#c5d1bd"
DISABLED = "#a9bcb1"
WATER = "#1d6f8c"
WATER_BANDS = ("#7cc6c9", "#5fb3bd", "#47a0b1", "#3790a6", "#2a809b", "#1f7391", "#1a6886", "#165d7a")
OK_BG, OK_FG = "#e5efcf", "#2f5a25"
ERROR_BG, ERROR_FG = "#f7e2da", "#8a3a22"


def fonts(root) -> dict[str, tuple]:
    import tkinter.font as tkfont

    family = tkfont.nametofont("TkDefaultFont", root=root).actual("family")
    for preferred in ("Segoe UI", "SF Pro Text", "Ubuntu", "Cantarell", "DejaVu Sans"):
        if preferred in tkfont.families(root):
            family = preferred
            break
    return {"base": (family, 10), "small": (family, 9), "bold": (family, 10, "bold"),
            "title": (family, 12, "bold"), "brand": (family, 18, "bold"), "eyebrow": (family, 8, "bold"),
            "stat": (family, 18, "bold"), "kbd": (family, 9, "bold"), "big": (family, 13, "bold")}


def apply(root, ttk) -> dict[str, tuple]:
    """Configure ttk styles on `clam`, which lets every colour be set on all platforms."""
    font = fonts(root)
    root.configure(background=SAND)
    style = ttk.Style(root)
    style.theme_use("clam")
    style.configure(".", background=SAND, foreground=TEXT, font=font["base"], bordercolor=LINE,
                    lightcolor=SAND, darkcolor=SAND, troughcolor=TILE, focuscolor=CORAL,
                    selectbackground=GREEN, selectforeground="white", insertcolor=INK)
    style.configure("App.TFrame", background=SAND)
    style.configure("Card.TFrame", background=PAPER, bordercolor=LINE, lightcolor=PAPER, darkcolor=PAPER,
                    relief="solid", borderwidth=1)
    style.configure("Inner.TFrame", background=PAPER)
    style.configure("Tile.TFrame", background=TILE)
    style.configure("Card.TLabel", background=PAPER, foreground=TEXT)
    style.configure("CardTitle.TLabel", background=PAPER, foreground=INK, font=font["title"])
    style.configure("CardHint.TLabel", background=PAPER, foreground=MUTED, font=font["small"])
    style.configure("Field.TLabel", background=PAPER, foreground=MUTED, font=font["bold"])
    style.configure("TileValue.TLabel", background=TILE, foreground=INK, font=font["stat"])
    style.configure("TileCaption.TLabel", background=TILE, foreground=MUTED, font=font["eyebrow"])
    style.configure("Room.TLabel", background=TILE, foreground=TEXT, padding=(10, 8))
    style.configure("Hud.TLabel", background=INK, foreground=SAND, font=font["bold"], padding=(12, 8))

    for name, background, foreground, border in (("TButton", "#e9efe0", GREEN, FIELD_LINE),
                                                ("Primary.TButton", GREEN, "white", GREEN)):
        style.configure(name, background=background, foreground=foreground, bordercolor=border,
                        lightcolor=background, darkcolor=background, padding=(14, 7), font=font["bold"])
    style.map("TButton", background=[("disabled", "#eef0ea"), ("pressed", "#d3e0cb"), ("active", "#dfe9d6")],
              lightcolor=[("disabled", "#eef0ea"), ("pressed", "#d3e0cb"), ("active", "#dfe9d6")],
              darkcolor=[("disabled", "#eef0ea"), ("pressed", "#d3e0cb"), ("active", "#dfe9d6")],
              foreground=[("disabled", "#8a9a8c")], bordercolor=[("focus", GREEN)])
    style.map("Primary.TButton",
              background=[("disabled", DISABLED), ("pressed", GREEN_PRESSED), ("active", GREEN_HOVER)],
              lightcolor=[("disabled", DISABLED), ("pressed", GREEN_PRESSED), ("active", GREEN_HOVER)],
              darkcolor=[("disabled", DISABLED), ("pressed", GREEN_PRESSED), ("active", GREEN_HOVER)],
              bordercolor=[("disabled", DISABLED), ("focus", CORAL)], foreground=[("disabled", "#f2f5f1")])

    for name in ("TEntry", "TCombobox", "TSpinbox"):
        style.configure(name, fieldbackground=PAPER, background=TILE, foreground=INK, bordercolor=FIELD_LINE,
                        lightcolor=PAPER, darkcolor=PAPER, arrowcolor=GREEN, padding=5)
        style.map(name, fieldbackground=[("readonly", PAPER), ("disabled", "#f1f2ec")],
                  foreground=[("disabled", "#8a9a8c")], bordercolor=[("focus", GREEN)],
                  lightcolor=[("focus", PAPER)])
    root.option_add("*TCombobox*Listbox.background", PAPER)
    root.option_add("*TCombobox*Listbox.foreground", INK)
    root.option_add("*TCombobox*Listbox.selectBackground", GREEN)
    root.option_add("*TCombobox*Listbox.selectForeground", "white")
    root.option_add("*TCombobox*Listbox.font", font["base"])

    for name in ("Card.TRadiobutton", "Card.TCheckbutton"):
        style.configure(name, background=PAPER, foreground=TEXT, indicatorbackground=PAPER,
                        indicatorforeground=GREEN, indicatormargin=(0, 0, 6, 0))
        style.map(name, background=[("active", PAPER)], indicatorbackground=[("selected", PAPER)])

    import tkinter.font as tkfont
    row_height = tkfont.Font(root=root, font=font["base"]).metrics("linespace") + 12
    style.configure("Treeview", background=PAPER, fieldbackground=PAPER, foreground=TEXT, bordercolor=LINE,
                    lightcolor=PAPER, darkcolor=PAPER, rowheight=row_height)
    style.map("Treeview", background=[("selected", GREEN)], foreground=[("selected", "white")])
    style.configure("Treeview.Heading", background=TILE, foreground=MUTED, font=font["eyebrow"],
                    bordercolor=LINE, lightcolor=TILE, darkcolor=TILE, relief="flat", padding=(8, 6))
    style.map("Treeview.Heading", background=[("active", "#e3e9da")])
    style.configure("Vertical.TScrollbar", background=TILE, troughcolor=PAPER, bordercolor=PAPER,
                    lightcolor=TILE, darkcolor=TILE, arrowcolor=MUTED)
    style.configure("TSeparator", background=LINE)
    style.configure("TNotebook", background=SAND, bordercolor=LINE, lightcolor=SAND, darkcolor=SAND,
                    tabmargins=(0, 0, 0, 0))
    style.configure("TNotebook.Tab", background="#e9efe0", foreground=MUTED, bordercolor=LINE,
                    lightcolor="#e9efe0", darkcolor="#e9efe0", padding=(16, 7), font=font["bold"])
    style.map("TNotebook.Tab", background=[("selected", PAPER), ("active", "#dfe9d6")],
              lightcolor=[("selected", PAPER)], foreground=[("selected", INK)], expand=[("selected", (0, 2, 0, 0))])
    return font
