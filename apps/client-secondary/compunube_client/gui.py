"""Graphical window of the secondary (Python) client, built with Tkinter.

Same public boundary as the CLI: HTTP E45 and WebSocket E43 against Go. Network
work runs on background threads (`GuiController`) and reaches the window only
through a queue drained by Tk's `after()`, so the window never blocks. Go stays
the authority: the window draws the latest confirmed snapshot and sends intents.

    python -m compunube_client --server http://127.0.0.1:8080 gui
"""

from __future__ import annotations

import queue
import threading
import time
from pathlib import Path

from . import theme, view
from .api import MAP_IDS, ApiError, GoApi, Mutation
from .autopilot import Intent, decide
from .cli import load_session
from .game import INPUT_INTERVAL, TERMINAL, GameSession
from .realtime import REDUCE_CHOICES, RealtimeError

POLL_MS = 50
ACTION_LABELS = {"buy": "compra", "craft": "fabricación", "equip": "equipado", "exchange": "canje"}


class Controls:
    """Keyboard state turned into intents; the autopilot can replace it."""

    def __init__(self):
        self.lock = threading.Lock()
        self.left = self.right = self.boost = False
        self.net_side = 1
        self.jump_pending = False
        self.autopilot = False

    def intent(self, snapshot: dict, course: dict, self_id: str) -> Intent:
        with self.lock:
            if self.autopilot:
                return decide(snapshot, course, self_id)
            jump, self.jump_pending = self.jump_pending, False
            return Intent(float(self.right) - float(self.left), self.net_side, self.boost, jump)


class GuiController:
    """Everything that talks to Go, off the Tk thread; results go to `events`."""

    def __init__(self, server: str, token_file: Path | None = None):
        self.api = GoApi(server)
        self.server = self.api.base_url
        self.token_file = token_file
        self.events: queue.Queue = queue.Queue()
        self.controls = Controls()
        self.game: GameSession | None = None
        self.player_id: str | None = None
        self.profile: dict | None = None
        self.catalog: dict | None = None
        # Uncertain mutations keep their requestId until Go answers definitively.
        self.pending: dict[tuple, Mutation] = {}
        self._loop: threading.Thread | None = None
        self._stop = threading.Event()

    # Background work ---------------------------------------------------------
    def _spawn(self, label: str, work):
        def run():
            try:
                work()
            except ApiError as error:
                self.events.put(("error", f"{label}: {view.error_text(error.status, error.code, self.server)}"))
            except (RealtimeError, TimeoutError, ValueError) as error:
                self.events.put(("error", f"{label}: {error}"))
        threading.Thread(target=run, name=f"gui-{label}", daemon=True).start()

    def _refresh_profile(self):
        self.profile = self.api.profile()
        self.events.put(("profile", self.profile))

    def start_session(self):
        def work():
            self.player_id = load_session(self.api, self.token_file)
            self.events.put(("session", self.player_id))
            self._refresh_profile()
            self.catalog = self.api.catalog()
            self.events.put(("catalog", self.catalog))
        self._spawn("Sesión", work)

    def _mutate(self, key: tuple, build):
        def work():
            if self.catalog is None:
                raise ValueError("el catálogo aún no está cargado")
            mutation = self.pending.get(key) or build(self.catalog["catalogVersion"])
            self.pending[key] = mutation
            try:
                result = self.api.mutate(mutation)
            except ApiError as error:
                if not error.uncertain:
                    del self.pending[key]
                    raise
                self.events.put(("error", f"No sabemos si se aplicó ({error.code}). Repite la misma acción: se "
                                          f"reenviará con el mismo requestId {mutation.request_id}."))
                return
            del self.pending[key]
            self.profile = result["profile"]
            self.events.put(("profile", self.profile))
            self.events.put(("ok", ("Operación ya registrada (replay)" if result["replayed"]
                                    else "Operación confirmada por Go") + f" · {self._describe(key)}"))
        self._spawn("Perfil", work)

    def _describe(self, key: tuple) -> str:
        kind, target = key
        if kind == "exchange":
            amount, material = target.split(" ", 1)
            return f"canje de {amount} de {view.MATERIAL_LABELS.get(material, material).lower()}"
        names = {item["itemId"]: item["name"] for item in (self.catalog or {}).get("items", [])}
        return f"{ACTION_LABELS.get(kind, kind)}: {names.get(target, target)}"

    def item_action(self, kind: str, item_id: str):
        self._mutate((kind, item_id), lambda version: GoApi.item_mutation(kind, item_id, version))

    def exchange(self, material: str, amount: int):
        self._mutate(("exchange", f"{amount} {material}"),
                     lambda version: GoApi.exchange_mutation(material, amount, version))

    def enter_room(self, map_id: str | None = None, room_id: str | None = None):
        def work():
            if self.game is not None:
                raise ValueError("ya estás en una sala; sal antes de entrar a otra")
            game = GameSession(self.api, log=lambda line: self.events.put(("notice", line)))
            if map_id:
                game.create(map_id)
            else:
                game.join(room_id.strip())
            game.connect()
            self.game = game
            self.events.put(("room-code", game.room_id))
            self._stop.clear()
            self._loop = threading.Thread(target=self._realtime_loop, args=(game,), name="gui-realtime",
                                          daemon=True)
            self._loop.start()
        self._spawn("Sala", work)

    def ready(self, reduce_choice: str):
        if reduce_choice not in REDUCE_CHOICES:
            self.events.put(("error", "Elige qué llevas para hidratarte antes de marcar Listo."))
            return
        self._spawn("Listo", lambda: self.game.ready(reduce_choice))

    def leave(self):
        game, self.game = self.game, None
        self._stop.set()
        if self._loop and self._loop is not threading.current_thread():
            # Stop receiving before closing, so the loop never tries to reconnect a closed socket.
            self._loop.join(2.0)
        if game:
            game.leave()
            game.close()
        self.events.put(("left", None))

    def _realtime_loop(self, game: GameSession):
        """Receive E43 messages and, while racing, send at most 20 intents per second."""
        last_sent = 0.0
        settled = None
        try:
            while not self._stop.is_set():
                message = game.receive(0.05)
                if message:
                    self.events.put(("realtime", message["type"]))
                me = game.view.me()
                now = time.monotonic()
                if (me and game.view.result is None and me["participantState"] not in TERMINAL
                        and now - last_sent >= INPUT_INTERVAL):
                    last_sent = now
                    game.send_intent(self.controls.intent(game.view.snapshot, game.view.start["course"],
                                                          game.view.self_player_id))
                result = game.view.result
                mine = result and next((p for p in result["participants"]
                                        if p["playerId"] == game.view.self_player_id), None)
                if mine and mine["settlementState"] == "confirmed" and settled != result["raceId"]:
                    settled = result["raceId"]
                    self._spawn("Perfil", self._refresh_profile)
        except (RealtimeError, OSError) as error:
            if not self._stop.is_set():
                self.events.put(("error", f"Tiempo real: {error}"))

    def close(self):
        self.leave()


def build_window(controller: GuiController, root=None):  # pragma: no cover - exercised under Xvfb
    import tkinter as tk
    from tkinter import ttk

    return Window(controller, root or tk.Tk(), tk, ttk)


class CatalogTable:
    """Treeview of the catalog with the small list API the window and validation use."""

    def __init__(self, parent, ttk):
        self.tree = ttk.Treeview(parent, columns=("name", "kind", "status"), show="headings", height=7,
                                 selectmode="browse")
        for column, title, width, stretch in (("name", "OBJETO", 190, True), ("kind", "TIPO", 90, False),
                                              ("status", "ESTADO", 190, True)):
            self.tree.heading(column, text=title, anchor="w")
            self.tree.column(column, width=width, minwidth=70, stretch=stretch, anchor="w")
        self.tree.tag_configure("equipped", foreground=theme.GREEN)
        self.tree.tag_configure("locked", foreground="#5f7270")
        self.tree.tag_configure("odd", background="#fff3e6")
        self.rows: list[view.CatalogRow] = []

    def set_rows(self, rows: list[view.CatalogRow]):
        if rows == self.rows:
            return
        selected = self.curselection()
        self.tree.delete(*self.tree.get_children())
        for index, row in enumerate(rows):
            tags = (row.state,) + (("odd",) if index % 2 else ())
            self.tree.insert("", "end", iid=str(index), values=(row.name, row.kind, row.status), tags=tags)
        self.rows = rows
        if selected and selected[0] < len(rows):
            self.selection_set(selected[0])

    def size(self) -> int:
        return len(self.tree.get_children())

    def curselection(self) -> tuple[int, ...]:
        return tuple(int(iid) for iid in self.tree.selection())

    def selection_set(self, index: int):
        self.tree.selection_set(str(index))
        self.tree.see(str(index))


class Window:
    """Tk widgets; reads controller state on the Tk thread only."""

    CANVAS_W, CANVAS_H = 400, 470   # height follows the window
    STATUS_COLORS = {"info": (theme.PAPER, theme.TEXT, theme.MUTED), "ok": (theme.OK_BG, theme.OK_FG, theme.GREEN),
                     "error": (theme.ERROR_BG, theme.ERROR_FG, theme.CORAL)}

    def __init__(self, controller: GuiController, root, tk, ttk):
        self.c, self.root, self.tk = controller, root, tk
        root.title("Surf Club: Acción por las Aguas · cliente Python")
        root.minsize(1040, 720)
        self.font = theme.apply(root, ttk)
        self.status = tk.StringVar(value="Conectando con el servidor del juego…")
        self.player = tk.StringVar(value="Sin sesión")
        self.reduce = tk.StringVar(value="")
        self.map_id = tk.StringVar(value=MAP_IDS[0])
        self.map_label = tk.StringVar(value=view.MAP_LABELS[MAP_IDS[0]])
        self.room_code = tk.StringVar()
        self.material = tk.StringVar(value="plastic")
        self.material_label = tk.StringVar(value=view.MATERIAL_LABELS["plastic"])
        self.amount = tk.IntVar(value=1)
        self.autopilot = tk.BooleanVar(value=False)
        self.hud = tk.StringVar(value="")
        self.stats = {key: tk.StringVar(value="—") for key in ("coins", "plastic", "metal")}
        # The combo boxes show names; the id variables stay the source of truth.
        self.map_id.trace_add("write", lambda *_: self.map_label.set(view.MAP_LABELS.get(self.map_id.get(),
                                                                                          self.map_id.get())))
        self.material.trace_add("write", lambda *_: self.material_label.set(
            view.MATERIAL_LABELS.get(self.material.get(), self.material.get())))

        root.columnconfigure(0, weight=1)
        root.rowconfigure(1, weight=1)
        self._header(tk).grid(row=0, column=0, sticky="ew")
        body = ttk.Frame(root, style="App.TFrame", padding=(16, 14))
        body.grid(row=1, column=0, sticky="nsew")
        body.columnconfigure(0, weight=1)
        body.rowconfigure(0, weight=1)
        left = ttk.Frame(body, style="App.TFrame")
        left.grid(row=0, column=0, sticky="nsew", padx=(0, 14))
        left.columnconfigure(0, weight=1)
        left.rowconfigure(1, weight=1)
        self._profile_card(ttk, left).grid(row=0, column=0, sticky="ew", pady=(0, 12))
        self.tabs = ttk.Notebook(left)
        self.tabs.grid(row=1, column=0, sticky="nsew")
        self.play_tab = self._room_card(ttk, self.tabs)
        self.tabs.add(self.play_tab, text="Jugar con amigos")
        self.tabs.add(self._club_card(ttk, self.tabs), text="El club")
        self._race_card(tk, ttk, body).grid(row=0, column=1, sticky="ns")
        self.status_bar = self._status_bar(tk)
        self.status_bar.grid(row=2, column=0, sticky="ew")
        self.set_status("info")

        for keys, attribute in ((("Left", "a", "A"), "left"), (("Right", "d", "D"), "right"),
                                (("Up", "w", "W"), "boost")):
            for key in keys:
                root.bind(f"<KeyPress-{key}>", lambda _e, a=attribute: self.on_key(a, True))
                root.bind(f"<KeyRelease-{key}>", lambda _e, a=attribute: self.on_key(a, False))
        root.bind("<KeyPress-space>", lambda _e: self.on_jump())
        for key, side in (("z", -1), ("Z", -1), ("x", 1), ("X", 1)):
            root.bind(f"<KeyPress-{key}>", lambda _e, s=side: self.on_net(s))
        root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.refresh()
        controller.start_session()
        root.after(POLL_MS, self.poll)

    # Layout --------------------------------------------------------------------
    def _header(self, tk):
        # A strip of the game's sunset sky with the Surf Club decal; redrawn on resize.
        self.header = tk.Canvas(self.root, height=92, background=theme.SKY, highlightthickness=0)
        try:
            self.logo = tk.PhotoImage(file=str(theme.LOGO))
        except tk.TclError:  # Tk without PNG support: the name is drawn as text instead
            self.logo = None
        self.header.bind("<Configure>", lambda _e: self.draw_header())
        self.player.trace_add("write", lambda *_: self.draw_header())
        return self.header

    def draw_header(self):
        canvas, width = self.header, max(self.header.winfo_width(), 1)
        canvas.delete("all")
        band = 92 / len(theme.SKY_BANDS)
        for index, color in enumerate(theme.SKY_BANDS):
            canvas.create_rectangle(0, index * band, width, (index + 1) * band + 1, fill=color, outline="")
        wave = [coordinate for x in range(0, width + 28, 14) for coordinate in (x, 87 + (3 if (x // 14) % 2 else -2))]
        canvas.create_line(*wave, smooth=True, fill=theme.INK, width=2)
        if self.logo:
            canvas.create_image(18, 8, image=self.logo, anchor="nw")
        else:
            canvas.create_text(18, 46, text="Surf Club · Acción por las Aguas", anchor="w", fill=theme.INK,
                               font=self.font["brand"])
        chip = canvas.create_text(width - 30, 44, text=self.player.get(), anchor="e", fill=theme.SUN,
                                  font=self.font["bold"])
        left, top, right, bottom = canvas.bbox(chip)
        canvas.create_rectangle(left - 12, top - 7, right + 12, bottom + 7, fill=theme.INK, outline=theme.CORAL,
                                width=2)
        canvas.tag_raise(chip)
        canvas.create_text(left - 26, 44, text=f"Servidor {self.c.server}", anchor="e", fill=theme.MUTED,
                           font=self.font["small"])

    def _card(self, ttk, parent, title: str = "", hint: str = ""):
        card = ttk.Frame(parent, style="Card.TFrame", padding=(16, 12, 16, 14))
        head = ttk.Frame(card, style="Inner.TFrame")
        head.pack(fill="x", pady=(0, 10))
        if title:
            ttk.Label(head, text=title, style="CardTitle.TLabel").pack(side="left")
        if hint:
            ttk.Label(head, text=hint, style="CardHint.TLabel").pack(side="right" if title else "left")
        return card

    def _profile_card(self, ttk, parent):
        card = self._card(ttk, parent, "Tu perfil", "Confirmado por el servidor")
        tiles = ttk.Frame(card, style="Inner.TFrame")
        tiles.pack(fill="x")
        for column, (key, caption) in enumerate((("coins", "MONEDAS"), ("plastic", "PLÁSTICO"),
                                                 ("metal", "CHATARRA"))):
            tiles.columnconfigure(column, weight=1, uniform="tile")
            tile = ttk.Frame(tiles, style=f"{key}.Tile.TFrame", padding=(12, 6, 12, 8))
            tile.grid(row=0, column=column, sticky="ew", padx=(0 if column == 0 else 8, 0))
            ttk.Label(tile, textvariable=self.stats[key], style=f"{key}.TileValue.TLabel").pack(anchor="w")
            ttk.Label(tile, text=caption, style=f"{key}.TileCaption.TLabel").pack(anchor="w")
        self.profile_label = ttk.Label(card, text=view.equipment_line(None), style="CardHint.TLabel")
        self.profile_label.pack(anchor="w", pady=(10, 0))
        return card

    def _room_card(self, ttk, parent):
        card = self._card(ttk, parent, hint="Crea una sala o entra con el código de un amigo. Hasta 4 surfistas.")
        grid = ttk.Frame(card, style="Inner.TFrame")
        grid.pack(fill="x")
        grid.columnconfigure(1, weight=1)
        ttk.Label(grid, text="Destino", style="Field.TLabel").grid(row=0, column=0, sticky="w", padx=(0, 12))
        maps = ttk.Combobox(grid, textvariable=self.map_label, state="readonly", width=22,
                            values=[view.MAP_LABELS[map_id] for map_id in MAP_IDS])
        maps.grid(row=0, column=1, sticky="ew")
        maps.bind("<<ComboboxSelected>>", lambda _e: self.map_id.set(MAP_IDS[maps.current()]))
        self.create_button = ttk.Button(grid, text="Crear sala", style="Primary.TButton", command=self.on_create)
        self.create_button.grid(row=0, column=2, sticky="ew", padx=(8, 0))
        ttk.Label(grid, text="Código", style="Field.TLabel").grid(row=1, column=0, sticky="w", pady=(8, 0))
        self.code_entry = ttk.Entry(grid, textvariable=self.room_code)
        self.code_entry.grid(row=1, column=1, sticky="ew", pady=(8, 0))
        self.code_entry.bind("<Return>", lambda _e: self.on_join())
        self.join_button = ttk.Button(grid, text="Entrar", command=self.on_join)
        self.join_button.grid(row=1, column=2, sticky="ew", padx=(8, 0), pady=(8, 0))

        reduce_row = ttk.Frame(card, style="Inner.TFrame")
        reduce_row.pack(fill="x", pady=(12, 0))
        ttk.Label(reduce_row, text="Reducir · ¿Qué llevas para hidratarte?", style="Field.TLabel").pack(anchor="w")
        choices = ttk.Frame(reduce_row, style="Inner.TFrame")
        choices.pack(anchor="w", pady=(4, 0))
        for choice in REDUCE_CHOICES:
            ttk.Radiobutton(choices, text=view.REDUCE_LABELS[choice].capitalize(), value=choice,
                            variable=self.reduce, style="Card.TRadiobutton").pack(side="left", padx=(0, 18))
        actions = ttk.Frame(card, style="Inner.TFrame")
        actions.pack(fill="x", pady=(12, 0))
        self.ready_button = ttk.Button(actions, text="Estoy listo", style="Primary.TButton", command=self.on_ready)
        self.ready_button.pack(side="left")
        self.leave_button = ttk.Button(actions, text="Salir de la sala", command=self.on_leave)
        self.leave_button.pack(side="left", padx=8)
        self.copy_button = ttk.Button(actions, text="Copiar código", command=self.on_copy_code)
        self.copy_button.pack(side="left")
        self.room_label = ttk.Label(card, text="Sin sala.", style="Room.TLabel", justify="left")
        self.room_label.pack(fill="x", pady=(12, 0))
        return card

    def _club_card(self, ttk, parent):
        card = self._card(ttk, parent, hint="Elige un objeto y cómpralo, fabrícalo o equípalo.")
        # Packed bottom-up so the table, not the actions, shrinks on short windows.
        recycle = ttk.Frame(card, style="Inner.TFrame")
        recycle.pack(side="bottom", fill="x")
        ttk.Label(recycle, text="Reciclar", style="Field.TLabel").pack(side="left", padx=(0, 10))
        materials = ttk.Combobox(recycle, textvariable=self.material_label, state="readonly", width=10,
                                 values=list(view.MATERIAL_LABELS.values()))
        materials.pack(side="left")
        materials.bind("<<ComboboxSelected>>",
                       lambda _e: self.material.set(list(view.MATERIAL_LABELS)[materials.current()]))
        ttk.Spinbox(recycle, from_=1, to=99, textvariable=self.amount, width=4).pack(side="left", padx=8)
        self.exchange_button = ttk.Button(recycle, text="Cambiar por monedas", command=self.on_exchange)
        self.exchange_button.pack(side="left")
        ttk.Separator(card).pack(side="bottom", fill="x", pady=12)
        actions = ttk.Frame(card, style="Inner.TFrame")
        actions.pack(side="bottom", fill="x", pady=(10, 0))
        self.item_buttons = {}
        for kind, label in (("buy", "Comprar"), ("craft", "Fabricar"), ("equip", "Equipar")):
            self.item_buttons[kind] = ttk.Button(actions, text=label, command=lambda k=kind: self.on_item(k),
                                                 style="Primary.TButton" if kind == "buy" else "TButton")
            self.item_buttons[kind].pack(side="left", padx=(0, 8))
        table = ttk.Frame(card, style="Inner.TFrame")
        table.pack(fill="both", expand=True)
        self.catalog_list = CatalogTable(table, ttk)
        scroll = ttk.Scrollbar(table, orient="vertical", command=self.catalog_list.tree.yview)
        self.catalog_list.tree.configure(yscrollcommand=scroll.set)
        self.catalog_list.tree.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        return card

    def _race_card(self, tk, ttk, parent):
        card = self._card(ttk, parent, "Carrera", "Vista desde arriba")
        # Packed bottom-up so the canvas takes whatever height is left.
        self.result_label = ttk.Label(card, text="", style="Card.TLabel", justify="left",
                                      wraplength=self.CANVAS_W, font=self.font["small"])
        self.result_label.pack(side="bottom", anchor="w", pady=(8, 0))
        ttk.Checkbutton(card, text="Piloto automático (juega solo; útil para demostraciones)",
                        variable=self.autopilot, command=self.on_autopilot,
                        style="Card.TCheckbutton").pack(side="bottom", anchor="w", pady=(8, 0))
        keys = ttk.Frame(card, style="Inner.TFrame")
        keys.pack(side="bottom", fill="x", pady=(10, 0))
        for key, action in (("← →", "girar"), ("Espacio", "saltar"), ("↑ W", "impulso"), ("Z X", "red")):
            tk.Label(keys, text=key, font=self.font["kbd"], foreground=theme.INK, background=theme.SKY,
                     padx=6, pady=1, relief="solid", borderwidth=1).pack(side="left")
            ttk.Label(keys, text=action, style="CardHint.TLabel").pack(side="left", padx=(4, 10))
        ttk.Label(card, textvariable=self.hud, style="Hud.TLabel", wraplength=self.CANVAS_W - 24,
                  justify="left").pack(side="bottom", fill="x")
        self.canvas = tk.Canvas(card, width=self.CANVAS_W, height=self.CANVAS_H, background=theme.WATER,
                                highlightthickness=0)
        self.canvas.pack(side="top", fill="y", expand=True)
        self.canvas.bind("<Configure>", self.on_canvas_resize)
        return card

    def on_canvas_resize(self, event):
        if event.height != self.CANVAS_H:
            self.CANVAS_H = event.height
            game = self.c.game
            self.draw(game.view if game else None)

    def _status_bar(self, tk):
        bar = tk.Frame(self.root, padx=18, pady=8, borderwidth=0)
        self.status_dot = tk.Label(bar, text="●", font=self.font["small"])
        self.status_dot.pack(side="left", padx=(0, 8))
        self.status_label = tk.Label(bar, textvariable=self.status, font=self.font["base"], anchor="w",
                                     justify="left", wraplength=980)
        self.status_label.pack(side="left", fill="x", expand=True)
        return bar

    def set_status(self, kind: str, text: str | None = None):
        if text is not None:
            self.status.set(text)
        background, foreground, dot = self.STATUS_COLORS[kind]
        self.status_bar.configure(background=background)
        self.status_label.configure(background=background, foreground=foreground)
        self.status_dot.configure(background=background, foreground=dot)

    # Actions -----------------------------------------------------------------
    def selected_item(self) -> str | None:
        selection = self.catalog_list.curselection()
        rows = view.catalog_rows(self.c.catalog, self.c.profile)
        return rows[selection[0]].item_id if selection and selection[0] < len(rows) else None

    def on_item(self, kind: str):
        item_id = self.selected_item()
        if item_id is None:
            self.set_status("info", "Selecciona un objeto del catálogo.")
        else:
            self.c.item_action(kind, item_id)

    def on_exchange(self):
        try:
            self.c.exchange(self.material.get(), int(self.amount.get()))
        except (ValueError, self.tk.TclError):
            self.set_status("error", "Cantidad no válida.")

    def on_create(self):
        self.c.enter_room(map_id=self.map_id.get())

    def on_join(self):
        if self.c.game is not None:
            return
        if not self.room_code.get().strip():
            self.set_status("info", "Escribe el código de la sala.")
        else:
            self.c.enter_room(room_id=self.room_code.get())

    def on_copy_code(self):
        if self.c.game is not None:
            self.root.clipboard_clear()
            self.root.clipboard_append(self.c.game.room_id)
            self.set_status("ok", f"Código {self.c.game.room_id} copiado: compártelo para que otros entren.")

    def on_ready(self):
        if self.c.game is None:
            self.set_status("info", "Primero crea una sala o entra con un código.")
        else:
            self.c.ready(self.reduce.get())

    def on_leave(self):
        self.c.leave()

    def on_autopilot(self):
        with self.c.controls.lock:
            self.c.controls.autopilot = bool(self.autopilot.get())

    def on_key(self, attribute: str, pressed: bool):
        if self.root.focus_get() is self.code_entry:
            return
        with self.c.controls.lock:
            setattr(self.c.controls, attribute, pressed)

    def on_jump(self):
        with self.c.controls.lock:
            self.c.controls.jump_pending = True

    def on_net(self, side: int):
        if self.root.focus_get() is self.code_entry:
            return
        with self.c.controls.lock:
            self.c.controls.net_side = side

    def on_close(self):
        self.c.close()
        self.root.destroy()

    # Rendering -----------------------------------------------------------------
    def poll(self):
        changed = False
        while True:
            try:
                kind, value = self.c.events.get_nowait()
            except queue.Empty:
                break
            changed = True
            if kind == "session":
                self.player.set(f"Jugador {value}")
                self.set_status("ok", f"Sesión lista · jugador {value}")
            elif kind == "room-code":
                self.room_code.set(value)
                self.tabs.select(self.play_tab)
                self.set_status("ok", f"Estás en la sala {value}: comparte el código para que otros entren.")
            elif kind in ("error", "notice", "ok"):
                self.set_status({"notice": "info"}.get(kind, kind), value)
            elif kind == "left":
                self.set_status("info", "Saliste de la sala.")
        if changed:
            self.refresh()
        try:
            self.root.after(POLL_MS, self.poll)
        except self.tk.TclError:
            pass

    def refresh(self):
        c = self.c
        for key, value in view.profile_stats(c.profile).items():
            self.stats[key].set(value)
        self.profile_label.configure(text=view.equipment_line(c.profile, c.catalog))
        self.catalog_list.set_rows(view.catalog_rows(c.catalog, c.profile))
        game = c.game
        game_view = game.view if game else None
        room = game_view.room if game_view else None
        self.room_label.configure(text="\n".join(view.room_lines(room, c.player_id)) or "Sin sala.")
        in_room = game is not None
        for widget in (self.create_button, self.join_button, self.code_entry):
            widget.state(["disabled"] if in_room else ["!disabled"])
        for button in (self.ready_button, self.leave_button, self.copy_button):
            button.state(["!disabled"] if in_room else ["disabled"])
        self.draw(game_view)
        result = game_view.result if game_view else None
        self.result_label.configure(text="\n".join(view.result_lines(result, c.player_id)))

    def draw_idle(self, text: str):
        """Resting scene: the striped sun setting over the water, and a sticker with the next step."""
        canvas, w, h = self.canvas, self.CANVAS_W, self.CANVAS_H
        horizon = h * .42
        band = horizon / len(theme.SKY_BANDS)
        for index, color in enumerate(theme.SKY_BANDS):
            canvas.create_rectangle(0, index * band, w, (index + 1) * band + 1, fill=color, outline="", tags="decor")
        cx, r = w / 2, 52
        # Coral disc with a yellow cap; the water drawn next hides the lower half.
        canvas.create_oval(cx - r, horizon - r, cx + r, horizon + r, fill=theme.CORAL, outline="", tags="decor")
        canvas.create_arc(cx - r, horizon - r, cx + r, horizon + r, start=30, extent=120, style="chord",
                          fill=theme.SUN, outline="", tags="decor")
        for offset, height in ((-.42, 3), (-.28, 4), (-.14, 5)):
            y = horizon + offset * r
            canvas.create_rectangle(cx - r, y, cx + r, y + height, fill=theme.SKY_BANDS[-1], outline="", tags="decor")
        water = (h - horizon) / len(theme.WATER_BANDS)
        for index, color in enumerate(theme.WATER_BANDS):
            top = horizon + index * water
            canvas.create_rectangle(0, top, w, top + water + 1, fill=color, outline="", tags="decor")
        for row in range(4):
            y = horizon + 28 + row * water * 1.6
            points = [coordinate for x in range(-20, w + 40, 34)
                      for coordinate in (x + (row % 2) * 17, y + (5 if (x // 34) % 2 else -5))]
            canvas.create_line(*points, smooth=True, fill="#d8f6ef" if row < 2 else "#9fd9d3", width=2, tags="decor")
        label = canvas.create_text(w / 2, horizon + (h - horizon) * .55, fill="#fff1e4", text=text, width=w - 90,
                                   justify="center", font=self.font["bold"], tags="placeholder")
        left, top, right, bottom = canvas.bbox(label)
        sticker = canvas.create_rectangle(left - 16, top - 12, right + 16, bottom + 12, fill=theme.INK,
                                          outline=theme.CORAL, width=3, tags="decor")
        canvas.tag_lower(sticker, label)

    def draw(self, game_view):
        canvas = self.canvas
        canvas.delete("all")
        waiting = game_view and game_view.room and game_view.room["state"] in ("LOBBY", "COUNTDOWN")
        if not game_view or not game_view.start or not game_view.snapshot or waiting:
            # After the settled result Go returns the room to LOBBY (RF-035).
            if waiting and game_view.result:
                text = "La sala volvió al lobby: elige qué llevas y pulsa «Estoy listo» para otra carrera."
            elif game_view:
                text = "Cuando todos estén listos, la carrera empieza aquí."
            else:
                text = "Crea una sala o entra con un código. La carrera aparecerá aquí cuando empiece."
            self.draw_idle(text)
            self.hud.set("Sin carrera en curso.")
            return
        shapes = view.race_shapes(game_view.start, game_view.snapshot, game_view.self_player_id,
                                  self.CANVAS_W, self.CANVAS_H)
        for shape in shapes:
            x, y, r = shape.x, shape.y, shape.radius
            if shape.kind == "finish":
                canvas.create_line(0, y, self.CANVAS_W, y, fill=shape.color, width=4, tags="finish")
                canvas.create_text(x, y - 10, text=shape.label, fill="white", tags="finish")
            elif shape.kind == "player":
                canvas.create_oval(x - r, y - r, x + r, y + r, fill=shape.color, outline="white", width=2,
                                   tags="player")
                canvas.create_text(x, y + r + 8, text=shape.label, fill="white", tags="player")
            else:
                canvas.create_oval(x - r, y - r, x + r, y + r, fill=shape.color, outline="", tags=shape.kind)
        self.hud.set(view.hud_text(game_view.snapshot, game_view.self_player_id,
                                   game_view.start["course"]["lengthUnits"]))


def run_gui(server: str, token_file: Path | None = None) -> int:  # pragma: no cover - needs a display
    import tkinter

    try:
        window = build_window(GuiController(server, token_file))
    except tkinter.TclError as error:
        raise ValueError(f"no se pudo abrir la ventana ({error})") from None
    window.root.mainloop()
    return 0
