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

from . import view
from .api import MAP_IDS, ApiError, GoApi, Mutation
from .autopilot import Intent, decide
from .cli import load_session
from .game import INPUT_INTERVAL, TERMINAL, GameSession
from .realtime import REDUCE_CHOICES, RealtimeError

POLL_MS = 50


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
                self.events.put(("error", f"{label}: Go respondió {error.status} {error.code}"))
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
                self.events.put(("error", f"Resultado incierto ({error.code}): repite la misma acción y se "
                                          f"reenviará con el mismo requestId {mutation.request_id}."))
                return
            del self.pending[key]
            self.profile = result["profile"]
            self.events.put(("profile", self.profile))
            self.events.put(("notice", ("Operación ya registrada (replay)" if result["replayed"]
                                        else "Operación confirmada por Go") + f" · {key[0]} {key[1]}"))
        self._spawn("Perfil", work)

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


class Window:
    """Tk widgets; reads controller state on the Tk thread only."""

    CANVAS_W, CANVAS_H = 420, 560

    def __init__(self, controller: GuiController, root, tk, ttk):
        self.c, self.root, self.tk = controller, root, tk
        root.title("Compunube · cliente Python")
        root.minsize(980, 640)
        self.status = tk.StringVar(value="Conectando con Go…")
        self.reduce = tk.StringVar(value="")
        self.map_id = tk.StringVar(value=MAP_IDS[0])
        self.room_code = tk.StringVar()
        self.material = tk.StringVar(value="plastic")
        self.amount = tk.IntVar(value=1)
        self.autopilot = tk.BooleanVar(value=False)
        self.hud = tk.StringVar(value="")

        left = ttk.Frame(root, padding=8)
        left.grid(row=0, column=0, sticky="nsew")
        right = ttk.Frame(root, padding=8)
        right.grid(row=0, column=1, sticky="nsew")
        root.columnconfigure(0, weight=1)
        root.rowconfigure(0, weight=1)

        ttk.Label(left, textvariable=self.status, wraplength=520).pack(anchor="w")
        profile_box = ttk.LabelFrame(left, text="Perfil online (Rust, a través de Go)", padding=6)
        profile_box.pack(fill="x", pady=4)
        self.profile_label = ttk.Label(profile_box, text="\n".join(view.profile_lines(None)), justify="left")
        self.profile_label.pack(anchor="w")

        shop = ttk.LabelFrame(left, text="Catálogo", padding=6)
        shop.pack(fill="both", expand=True, pady=4)
        self.catalog_list = tk.Listbox(shop, height=9, exportselection=False)
        self.catalog_list.pack(fill="both", expand=True)
        actions = ttk.Frame(shop)
        actions.pack(fill="x", pady=2)
        self.item_buttons = {}
        for kind, label in (("buy", "Comprar"), ("craft", "Fabricar"), ("equip", "Equipar")):
            self.item_buttons[kind] = ttk.Button(actions, text=label, command=lambda k=kind: self.on_item(k))
            self.item_buttons[kind].pack(side="left", padx=2)
        ttk.Combobox(actions, textvariable=self.material, values=("plastic", "metal"), width=8,
                     state="readonly").pack(side="left", padx=(12, 2))
        ttk.Spinbox(actions, from_=1, to=99, textvariable=self.amount, width=4).pack(side="left")
        self.exchange_button = ttk.Button(actions, text="Cambiar por monedas", command=self.on_exchange)
        self.exchange_button.pack(side="left", padx=2)

        room = ttk.LabelFrame(left, text="Sala multijugador", padding=6)
        room.pack(fill="x", pady=4)
        row = ttk.Frame(room)
        row.pack(fill="x")
        ttk.Combobox(row, textvariable=self.map_id, values=MAP_IDS, width=10, state="readonly").pack(side="left")
        self.create_button = ttk.Button(row, text="Crear sala", command=self.on_create)
        self.create_button.pack(side="left", padx=2)
        self.code_entry = ttk.Entry(row, textvariable=self.room_code, width=22)
        self.code_entry.pack(side="left", padx=(12, 2))
        self.join_button = ttk.Button(row, text="Entrar con código", command=self.on_join)
        self.join_button.pack(side="left")
        row = ttk.Frame(room)
        row.pack(fill="x", pady=4)
        ttk.Label(row, text="¿Qué llevas para hidratarte?").pack(side="left")
        for choice in REDUCE_CHOICES:
            ttk.Radiobutton(row, text=view.REDUCE_LABELS[choice], value=choice,
                            variable=self.reduce).pack(side="left", padx=4)
        row = ttk.Frame(room)
        row.pack(fill="x")
        self.ready_button = ttk.Button(row, text="Listo", command=self.on_ready)
        self.ready_button.pack(side="left")
        self.leave_button = ttk.Button(row, text="Salir de la sala", command=self.on_leave)
        self.leave_button.pack(side="left", padx=4)
        self.room_label = ttk.Label(room, text="Sin sala.", justify="left")
        self.room_label.pack(anchor="w", pady=4)

        self.canvas = tk.Canvas(right, width=self.CANVAS_W, height=self.CANVAS_H, background="#1d6f8c",
                                highlightthickness=0)
        self.canvas.pack()
        ttk.Label(right, textvariable=self.hud, wraplength=self.CANVAS_W).pack(anchor="w", pady=2)
        ttk.Checkbutton(right, text="Piloto automático", variable=self.autopilot,
                        command=self.on_autopilot).pack(anchor="w")
        ttk.Label(right, text="Teclas: ←/→ o A/D girar · Espacio saltar · ↑/W impulso · Z/X red",
                  wraplength=self.CANVAS_W).pack(anchor="w")
        self.result_label = ttk.Label(right, text="", justify="left", wraplength=self.CANVAS_W)
        self.result_label.pack(anchor="w", pady=4)

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

    # Actions -----------------------------------------------------------------
    def selected_item(self) -> str | None:
        selection = self.catalog_list.curselection()
        rows = view.catalog_rows(self.c.catalog, self.c.profile)
        return rows[selection[0]][0] if selection and selection[0] < len(rows) else None

    def on_item(self, kind: str):
        item_id = self.selected_item()
        if item_id is None:
            self.status.set("Selecciona un objeto del catálogo.")
        else:
            self.c.item_action(kind, item_id)

    def on_exchange(self):
        try:
            self.c.exchange(self.material.get(), int(self.amount.get()))
        except (ValueError, self.tk.TclError):
            self.status.set("Cantidad no válida.")

    def on_create(self):
        self.c.enter_room(map_id=self.map_id.get())

    def on_join(self):
        if not self.room_code.get().strip():
            self.status.set("Escribe el código de la sala.")
        else:
            self.c.enter_room(room_id=self.room_code.get())

    def on_ready(self):
        if self.c.game is None:
            self.status.set("Primero crea una sala o entra con un código.")
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
                self.status.set(f"Sesión emitida por Go · playerId {value}")
            elif kind == "room-code":
                self.room_code.set(value)
                self.status.set(f"En la sala {value}: comparte el código para que otros entren.")
            elif kind in ("error", "notice"):
                self.status.set(value)
            elif kind == "left":
                self.status.set("Saliste de la sala.")
        if changed:
            self.refresh()
        try:
            self.root.after(POLL_MS, self.poll)
        except self.tk.TclError:
            pass

    def refresh(self):
        c = self.c
        self.profile_label.configure(text="\n".join(view.profile_lines(c.profile)))
        rows = view.catalog_rows(c.catalog, c.profile)
        if self.catalog_list.size() != len(rows) or \
                list(self.catalog_list.get(0, "end")) != [label for _, label in rows]:
            selection = self.catalog_list.curselection()
            self.catalog_list.delete(0, "end")
            for _, label in rows:
                self.catalog_list.insert("end", label)
            if selection:
                self.catalog_list.selection_set(selection[0])
        game = c.game
        game_view = game.view if game else None
        room = game_view.room if game_view else None
        self.room_label.configure(text="\n".join(view.room_lines(room, c.player_id)) or "Sin sala.")
        in_room = game is not None
        for button in (self.create_button, self.join_button):
            button.state(["disabled"] if in_room else ["!disabled"])
        for button in (self.ready_button, self.leave_button):
            button.state(["!disabled"] if in_room else ["disabled"])
        self.draw(game_view)
        result = game_view.result if game_view else None
        self.result_label.configure(text="\n".join(view.result_lines(result, c.player_id)))

    def draw(self, game_view):
        canvas = self.canvas
        canvas.delete("all")
        if not game_view or not game_view.start or not game_view.snapshot:
            canvas.create_text(self.CANVAS_W / 2, self.CANVAS_H / 2, fill="white",
                               text="La carrera aparecerá aquí cuando Go la inicie.")
            self.hud.set("")
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
