const MAP_NAMES = Object.freeze({ maracaibo: 'Lago de Maracaibo', orinoco: 'Río Orinoco' });
const CHARACTER_NAMES = Object.freeze({ nico: 'Nico', luna: 'Luna', amara: 'Amara', samuel: 'Samuel' });
const FRIENDLY_ERRORS = Object.freeze({
  ROOM_FULL: 'Esa sala ya tiene sus cuatro surfistas. Pide otro código o crea una sala.',
  ROOM_NOT_FOUND: 'No encontramos esa sala. Revisa el código con quien te invitó.',
  INCOMPATIBLE_VERSION: 'La sala usa otra versión del juego. Actualiza la página y vuelve a intentarlo.',
  SESSION_REQUIRED: 'Necesitamos recuperar tu sesión antes de entrar. Actualiza la página y vuelve a intentarlo.',
  NOT_A_MEMBER: 'Ya no estás en esa sala. Puedes volver a entrar con su código.',
  CONNECTION_LOST: 'Se perdió la conexión con la sala. Vuelve a entrar cuando tengas conexión.',
  CONNECTION_FAILED: 'No pudimos conectar con la sala. Inténtalo de nuevo.',
  DISCONNECTED: 'Se perdió la conexión con la sala. Vuelve a entrar cuando tengas conexión.',
  INVALID_RESPONSE: 'No pudimos recuperar esta sala. Vuelve a entrar con su código.',
  INVALID_REQUEST: 'Revisa tu nombre y el código antes de volver a entrar.',
  ALREADY_CONNECTED: 'Sal de tu sala actual antes de entrar a otra.',
  NOT_CONFIGURED: 'El modo con amigos estará disponible cuando conectemos el servicio de partidas.',
  RACE_NOT_ACTIVE: 'La carrera aún no está disponible. Espera a que la sala prepare la salida.',
  CLIENT_CALLBACK: 'No pudimos preparar esta partida. Puedes volver a la carrera local.',
  INVALID_ACTION: 'La sala no pudo confirmar ese cambio. Inténtalo de nuevo.',
  NOT_OWNED: 'Una pieza de tu equipo aún no está disponible en esta sala. Vuelve al club para cambiarla.',
  INVALID_ITEM: 'Una pieza de tu equipo aún no está disponible en esta sala. Vuelve al club para cambiarla.',
  INVALID_APPEARANCE: 'No pudimos confirmar tu apariencia. Vuelve al club para cambiarla.',
  TIMEOUT: 'La sala tardó demasiado en responder. Inténtalo de nuevo.',
  INVALID_STATE: 'Ya perteneces a otra sala o esta no admite el cambio. Recarga la página para recuperarla o sal de ella.',
  INVALID_READY: 'Elige qué llevas para hidratarte y actualiza tu perfil online antes de estar listo.',
  PROFILE_STALE: 'Tu perfil online cambió. Actualízalo en Mi progreso y vuelve a marcar Listo.',
  PROFILE_UNAVAILABLE: 'El perfil online no está disponible ahora. La sala sigue abierta; vuelve a marcar Listo en unos momentos.',
  ROOM_CLOSED: 'La sala se cerró. Puedes crear otra o entrar con un nuevo código.',
  SERVICE_UNAVAILABLE: 'El servicio de partidas no está disponible ahora. El modo local sigue disponible.',
  INTERNAL_ERROR: 'El servicio de partidas tuvo un problema. La sala sigue su curso.',
});
const REDUCE_LABELS = Object.freeze({ reusable: 'botella reutilizable', disposable: 'botella desechable' });
const PARTICIPANT_LABELS = Object.freeze({ reconnecting: 'Reconectando', finished: 'Llegó', disqualified: 'Sin vidas', left: 'Salió', dnf: 'No terminó' });

/**
 * Room UI only. Participants and ready flags always come from client.state;
 * opening this panel never creates local rivals, rewards or an online session.
 */
export function mountMultiplayerLobby({ client, getEquipment, getMap, getAppearance, getDisplayName, getProfileRevision, onLocalRace }) {
  if (!client || typeof client.subscribe !== 'function') throw new TypeError('A multiplayer client is required.');
  if (document.getElementById('online-lobby')) throw new Error('The multiplayer lobby is already mounted.');
  const dialog = document.createElement('dialog');
  dialog.id = 'online-lobby';
  dialog.className = 'online-lobby';
  dialog.setAttribute('aria-labelledby', 'online-lobby-title');
  dialog.setAttribute('aria-describedby', 'online-lobby-description');
  // This template is constant. Every value from players, room codes and service
  // errors is assigned through textContent or value, never interpolated as HTML.
  dialog.innerHTML = `
    <button type="button" class="ol-close" aria-label="Cerrar sala con amigos">×</button>
    <div class="ol-layout">
      <aside class="ol-story">
        <span class="ol-eyebrow">COMPUNUBE / EN COMPAÑÍA</span>
        <h2 id="online-lobby-title" tabindex="-1">Una ola,<br>cuatro tablas<span>.</span></h2>
        <p id="online-lobby-description">El mismo recorrido. Una orilla más limpia entre todos.</p>
        <div class="ol-seascape" aria-hidden="true"><span class="ol-sun"></span><span class="ol-horizon"></span><span class="ol-wave ol-wave-back"></span><span class="ol-board"><i></i></span><span class="ol-wave ol-wave-front"></span><span class="ol-foam"></span></div>
        <p class="ol-story-note">Hasta cuatro amigos.<br>Cada quien con su propio estilo.</p>
      </aside>
      <section class="ol-content" aria-label="Sala con amigos">
        <div class="ol-service" role="status" aria-live="polite"><i aria-hidden="true"></i><span></span></div>
        <div class="ol-notice" hidden><strong>Nos vemos pronto en el agua.</strong><p>El modo con amigos estará disponible cuando conectemos el servicio de partidas.</p></div>
        <div class="ol-error" role="alert" hidden></div>
        <div class="ol-entry">
          <div class="ol-modes" role="group" aria-label="Entrar a una sala">
            <button type="button" data-ol-mode="create" aria-pressed="true">Crear una sala</button>
            <button type="button" data-ol-mode="join" aria-pressed="false">Tengo un código</button>
          </div>
          <form class="ol-form" novalidate>
            <fieldset class="ol-fields">
              <legend class="sr-only">Tu entrada al agua</legend>
              <input id="online-display-name" name="displayName" type="hidden">
              <p class="ol-hint">En la sala te verán con el nombre de tu personaje.</p>
              <div class="ol-create-fields">
                <span class="ol-field-label">Destino de esta sala</span>
                <div class="ol-destination"><span class="ol-map-mark" aria-hidden="true">≈</span><span><strong class="ol-map-name"></strong><small>El recorrido que elegiste en el club</small></span><span aria-hidden="true">↗</span></div>
                <p class="ol-hint ol-mode-hint">Crea la sala y comparte su código con tus amigos.</p>
              </div>
              <div class="ol-join-fields" hidden>
                <label for="online-room-code">Código de la sala</label>
                <input id="online-room-code" name="roomId" maxlength="64" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="online-code-hint">
                <p id="online-code-hint" class="ol-hint">Pégalo tal como te lo compartieron.</p>
              </div>
              <button type="submit" class="ol-primary ol-enter">Crear sala <span aria-hidden="true">↗</span></button>
            </fieldset>
          </form>
          <button type="button" class="ol-cancel-connection" hidden>Cancelar conexión</button>
        </div>
        <div class="ol-room" hidden>
          <div class="ol-room-heading"><div><span class="ol-eyebrow">SU PRÓXIMA OLA</span><h3 class="ol-room-map" tabindex="-1"></h3></div><span class="ol-count"></span></div>
          <label class="ol-field-label" for="online-share-code">Comparte este código</label>
          <div class="ol-share"><input id="online-share-code" readonly aria-label="Código para compartir la sala"><button type="button" class="ol-copy">Copiar</button></div>
          <p class="ol-copy-status ol-hint" role="status" aria-live="polite"></p>
          <ul class="ol-members" aria-label="Surfistas en la sala"></ul>
          <fieldset class="ol-reduce">
            <legend class="ol-field-label">¿Qué llevas para hidratarte?</legend>
            <div class="ol-modes" role="group" aria-label="Reducir antes de la carrera">
              <button type="button" data-ol-reduce="reusable" aria-pressed="false">Botella reutilizable</button>
              <button type="button" data-ol-reduce="disposable" aria-pressed="false">Botella desechable</button>
            </div>
            <p class="ol-hint ol-reduce-note">No cambia la carrera ni da premios. Elige antes de marcar Listo.</p>
          </fieldset>
          <p class="ol-result" role="status" aria-live="polite" hidden></p>
          <p class="ol-room-note">Cuando todos estén listos, la sala preparará la salida.</p>
          <button type="button" class="ol-primary ol-ready" aria-pressed="false">Estoy listo <span aria-hidden="true">✓</span></button>
          <button type="button" class="ol-leave">Salir de la sala</button>
        </div>
        <div class="ol-exit-confirm" hidden>
          <h3>¿Dejamos esta ola?</h3><p>Saldrás de la sala. Para volver, necesitarás su código.</p>
          <div><button type="button" class="ol-primary ol-stay">Seguir en la sala</button><button type="button" class="ol-exit">Salir de la sala</button></div>
        </div>
        <footer class="ol-footer"><span>Mientras tanto, hay agua por recorrer.</span><button type="button" class="ol-local">Jugar una carrera local <span aria-hidden="true">↗</span></button></footer>
      </section>
    </div>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  const fields = $('.ol-fields'), entry = $('.ol-entry'), roomPanel = $('.ol-room');
  const nameInput = $('#online-display-name'), codeInput = $('#online-room-code');
  const primary = $('.ol-enter'), readyButton = $('.ol-ready');
  const modeButtons = [...dialog.querySelectorAll('[data-ol-mode]')];
  let state = client.state || { status: 'unconfigured', room: null };
  let mode = 'create', operation = null, localError = '', readyPending = null, readyTimer = null, reduceChoice = null;
  const reduceButtons = [...dialog.querySelectorAll('[data-ol-reduce]')];
  let restoreFocus = null, disposed = false, wantsLocalRace = false, confirmExit = false, membersSignature = '';

  const currentMap = () => {
    const map = getMap?.();
    return typeof map === 'string' ? { id: map, name: MAP_NAMES[map] || 'Tu recorrido' } : map || { id: 'maracaibo', name: MAP_NAMES.maracaibo };
  };
  const defaultName = () => String(getDisplayName?.() || CHARACTER_NAMES[getEquipment?.()?.character] || 'Surfista').slice(0, 24);
  const roomMembers = () => state.room?.members || [];
  const selfMember = () => roomMembers().find(member => member.playerId === state.selfPlayerId);
  const canCloseImmediately = () => state.status === 'racing' || (!state.room && state.status !== 'connecting' && !operation);
  const configured = () => state.status !== 'unconfigured';
  const busy = () => !!operation || state.status === 'connecting';
  const errorText = error => FRIENDLY_ERRORS[error?.code] || 'No pudimos completar la conexión. Inténtalo de nuevo.';

  function clearReadyPending() {
    readyPending = null;
    clearTimeout(readyTimer);
    readyTimer = null;
  }

  function renderMembers() {
    const members = roomMembers().slice(0, 4);
    const signature = JSON.stringify([state.selfPlayerId, members]);
    if (signature === membersSignature) return;
    membersSignature = signature;
    const list = $('.ol-members');
    list.replaceChildren();
    for (let index = 0; index < 4; index++) {
      const member = members[index], item = document.createElement('li');
      item.className = 'ol-member';
      const mark = document.createElement('span');
      mark.className = `ol-member-mark ol-mark-${index}`;
      mark.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'), name = document.createElement('strong'), note = document.createElement('small');
      label.append(name, note);
      if (member) {
        const displayName = String(member.displayName || 'Surfista');
        mark.textContent = (Array.from(displayName.trim())[0] || '').toLocaleUpperCase('es');
        name.textContent = displayName;
        if (member.playerId === state.selfPlayerId) {
          const you = document.createElement('b'); you.className = 'ol-you'; you.textContent = 'TÚ'; name.append(you);
        }
        const character = CHARACTER_NAMES[member.equipment?.character];
        note.textContent = member.controller === 'bot' ? `${character || 'Surfista'} · Rival simulado` : character || 'Surfista del club';
        const flag = document.createElement('span');
        flag.className = 'ol-member-status';
        const connected = member.connected !== false;
        const participant = PARTICIPANT_LABELS[member.participantState];
        flag.textContent = participant || (!connected ? 'Sin conexión' : member.ready ? 'Listo ✓' : 'Preparándose');
        flag.dataset.state = member.participantState === 'reconnecting' || !connected ? 'offline' : member.ready ? 'ready' : 'waiting';
        item.append(mark, label, flag);
      } else {
        item.classList.add('ol-member-empty'); mark.textContent = '+';
        name.textContent = 'Plaza disponible'; note.textContent = 'Invita a otro amigo'; item.append(mark, label);
      }
      list.append(item);
    }
    $('.ol-count').textContent = `${members.length} / 4 surfistas`;
  }

  function render() {
    if (disposed) return;
    const hasRoom = !!state.room;
    const activeRoom = state.status === 'room';
    const unavailable = !configured();
    const pending = busy();
    if (readyPending && (state.status !== 'room' || state.room?.roomId !== readyPending.roomId || selfMember()?.ready === readyPending.ready)) clearReadyPending();
    const service = $('.ol-service');
    service.dataset.state = state.status;
    service.querySelector('span').textContent = unavailable ? 'Con amigos · Próximamente' : state.status === 'connecting' ? 'Buscando su próxima ola…' : state.status === 'reconnecting' ? 'Reconectando con la sala…' : state.status === 'disconnected' ? 'Conexión interrumpida' : hasRoom && activeRoom ? 'Están en la misma sala' : state.status === 'error' ? 'No pudimos entrar' : 'Listos para encontrarse';
    $('.ol-notice').hidden = !unavailable;
    const error = localError || (state.error ? errorText(state.error) : state.status === 'disconnected' ? hasRoom ? 'Se perdió la conexión. Sal de esta sala para volver a entrar.' : 'Se perdió la conexión. Puedes volver a entrar con el código de la sala.' : '');
    $('.ol-error').hidden = !error;
    $('.ol-error').textContent = error;
    entry.hidden = hasRoom || confirmExit;
    roomPanel.hidden = !hasRoom || confirmExit;
    $('.ol-exit-confirm').hidden = !confirmExit;
    $('.ol-footer').hidden = hasRoom || confirmExit || pending;
    fields.disabled = unavailable || pending;
    for (const button of modeButtons) {
      button.disabled = pending;
      button.setAttribute('aria-pressed', String(button.dataset.olMode === mode));
    }
    $('.ol-create-fields').hidden = mode !== 'create';
    $('.ol-join-fields').hidden = mode !== 'join';
    codeInput.required = mode === 'join';
    nameInput.placeholder = defaultName();
    $('.ol-map-name').textContent = currentMap().name || MAP_NAMES[currentMap().id] || 'Tu recorrido';
    primary.replaceChildren(document.createTextNode(pending ? mode === 'create' ? 'Creando la sala…' : 'Entrando a la sala…' : mode === 'create' ? 'Crear sala' : 'Unirme a la sala'));
    const arrow = document.createElement('span'); arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = pending ? '…' : '↗'; primary.append(arrow);
    $('.ol-cancel-connection').hidden = !pending;
    $('.ol-cancel-connection').disabled = operation === 'leave';
    $('.ol-stay').disabled = operation === 'leave';
    $('.ol-exit').disabled = operation === 'leave';
    $('.ol-exit').textContent = operation === 'leave' ? 'Saliendo…' : 'Salir de la sala';
    if (hasRoom) {
      $('.ol-room-map').textContent = MAP_NAMES[state.room.mapId] || 'Su recorrido';
      $('#online-share-code').value = String(state.room.roomId || '');
      renderMembers();
      const self = selfMember();
      const countdown = state.room.state === 'countdown' || state.room.state === 'running';
      const ended = state.room.state === 'ended';
      const confirmedChoice = self?.reduceChoice || null;
      if (self?.ready && confirmedChoice) reduceChoice = confirmedChoice;
      for (const button of reduceButtons) {
        button.disabled = !activeRoom || state.room.state !== 'waiting' || !!self?.ready || !!readyPending;
        button.setAttribute('aria-pressed', String(button.dataset.olReduce === reduceChoice));
      }
      $('.ol-reduce').hidden = state.room.state === 'ended';
      $('.ol-reduce-note').textContent = self?.ready && confirmedChoice ? `La sala confirmó tu ${REDUCE_LABELS[confirmedChoice]}.` : 'No cambia la carrera ni da premios. Elige antes de marcar Listo.';
      const result = state.result;
      $('.ol-result').hidden = !(ended && result);
      if (ended && result) {
        const outcome = result.outcome === 'finished' ? `Llegaste en el puesto ${result.rank}.` : result.outcome === 'disqualified' ? 'Te quedaste sin vidas.' : result.outcome === 'dnf' ? 'No llegaste antes del cierre.' : 'Saliste de la carrera.';
        const credit = result.outcome === 'finished' ? ` ${result.credited.plastic} de plástico y ${result.credited.metal} de chatarra: ${result.settlementState === 'confirmed' ? 'ya están en tu perfil online.' : 'acreditación pendiente; se confirmará sin duplicarse.'}` : ' Esta carrera no acredita materiales.';
        const reduce = result.reduceChoice === 'reusable' ? ' Reducir: elegiste una botella reutilizable antes de la carrera.' : result.reduceChoice === 'disposable' ? ' Reducir: esta vez elegiste una botella desechable; prueba una reutilizable en la próxima.' : '';
        $('.ol-result').textContent = outcome + credit + reduce;
      }
      readyButton.disabled = !activeRoom || !self || self.connected === false || state.room.state !== 'waiting' || !!readyPending || pending || (!self.ready && !reduceChoice);
      readyButton.setAttribute('aria-pressed', String(!!self?.ready));
      readyButton.replaceChildren(document.createTextNode(ended ? 'Esta ola terminó' : countdown ? 'Preparando la salida…' : readyPending ? 'Confirmando…' : self?.ready ? 'Listo para salir' : 'Estoy listo'));
      const mark = document.createElement('span'); mark.setAttribute('aria-hidden', 'true'); mark.textContent = self?.ready ? '✓' : '↗'; readyButton.append(mark);
      $('.ol-room-note').textContent = state.status === 'reconnecting' ? 'Reconectando… la sala te espera durante unos segundos.' : ended ? 'Esta ola ya terminó. Sal de la sala para preparar otra.' : countdown ? 'Su próxima ola está por comenzar. Espera la salida.' : self?.ready ? 'Todo listo de tu lado. Puedes pulsar otra vez si necesitas esperar.' : 'Cuando todos estén listos, la sala preparará la salida.';
    }
  }

  function finishClose() {
    if (!dialog.open) return;
    dialog.close();
    confirmExit = false;
    wantsLocalRace = false;
    clearReadyPending();
    if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
    restoreFocus = null;
  }

  async function leaveAndClose() {
    if (operation === 'leave') return;
    operation = 'leave'; localError = ''; render();
    try {
      await client.leave();
      if (disposed || state.status === 'racing') return;
      const local = wantsLocalRace;
      operation = null;
      finishClose();
      if (local) onLocalRace?.();
    } catch {
      operation = null; localError = 'No pudimos salir de la sala. Inténtalo de nuevo.'; render();
    }
  }

  function requestClose(localRace = false) {
    if (!dialog.open || disposed) return;
    wantsLocalRace = localRace;
    if (canCloseImmediately()) {
      finishClose();
      if (localRace) onLocalRace?.();
    } else if (state.room) {
      confirmExit = true; render(); $('.ol-stay').focus();
    } else {
      void leaveAndClose();
    }
  }

  for (const button of modeButtons) button.addEventListener('click', () => {
    if (busy()) return;
    mode = button.dataset.olMode;
    localError = '';
    codeInput.removeAttribute('aria-invalid');
    render();
    if (mode === 'join' && configured()) codeInput.focus();
  });
  $('.ol-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!configured() || busy() || state.room) return;
    const roomId = codeInput.value.trim();
    if (mode === 'join' && (!roomId || roomId.length > 64)) {
      localError = 'Escribe el código que te compartieron, de hasta 64 caracteres.';
      codeInput.setAttribute('aria-invalid', 'true'); render(); codeInput.focus(); return;
    }
    codeInput.removeAttribute('aria-invalid');
    operation = mode; localError = ''; render();
    const entryMode = mode;
    const values = { equipment: getEquipment?.(), appearance: getAppearance?.(), displayName: nameInput.value.trim() || defaultName() };
    try {
      const success = entryMode === 'join' ? await client.joinRoom({ ...values, roomId }) : await client.createRoom({ ...values, mapId: currentMap().id });
      if (disposed || operation !== entryMode) return;
      if (success === false && !state.error) localError = 'No pudimos entrar a la sala. Inténtalo de nuevo.';
    } catch {
      if (operation !== entryMode) return;
      localError = 'No pudimos conectar con la sala. Inténtalo de nuevo.';
    } finally {
      if (!disposed && operation === entryMode) { operation = null; render(); if (dialog.open && state.room) $('.ol-room-map').focus?.(); }
    }
  });
  codeInput.addEventListener('input', () => {
    if (codeInput.hasAttribute('aria-invalid')) { codeInput.removeAttribute('aria-invalid'); localError = ''; render(); }
  });
  readyButton.addEventListener('click', () => {
    const self = selfMember();
    if (!self || readyButton.disabled) return;
    localError = '';
    readyPending = { ready: !self.ready, roomId: state.room.roomId };
    render();
    try {
      // Go verifies this profile revision against Player/Profile before confirming.
      const accepted = client.setReady(readyPending.ready, { profileRevision: getProfileRevision?.(), reduceChoice });
      if (accepted === false) { clearReadyPending(); if (!state.error) localError = 'No pudimos confirmar que estás listo. Inténtalo de nuevo.'; render(); return; }
      if (readyPending) readyTimer = setTimeout(() => {
        if (disposed) return;
        clearReadyPending(); localError = 'La sala aún no confirmó tu cambio. Inténtalo de nuevo.'; render();
      }, 10000);
    } catch {
      clearReadyPending(); localError = 'No pudimos confirmar que estás listo. Inténtalo de nuevo.'; render();
    }
  });
  for (const button of reduceButtons) button.addEventListener('click', () => {
    if (button.disabled) return;
    reduceChoice = button.dataset.olReduce; localError = ''; render();
  });
  $('.ol-copy').addEventListener('click', async () => {
    const value = $('#online-share-code').value;
    try {
      await navigator.clipboard.writeText(value);
      if (!disposed && dialog.open) $('.ol-copy-status').textContent = 'Código copiado. Compártelo con tus amigos.';
    } catch {
      if (disposed || !dialog.open) return;
      $('#online-share-code').focus(); $('#online-share-code').select();
      $('.ol-copy-status').textContent = 'Código seleccionado. Cópialo y compártelo con tus amigos.';
    }
  });
  $('.ol-close').addEventListener('click', () => requestClose());
  $('.ol-local').addEventListener('click', () => requestClose(true));
  $('.ol-leave').addEventListener('click', () => requestClose());
  $('.ol-cancel-connection').addEventListener('click', () => void leaveAndClose());
  $('.ol-exit').addEventListener('click', () => void leaveAndClose());
  $('.ol-stay').addEventListener('click', () => { confirmExit = false; wantsLocalRace = false; render(); readyButton.focus(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!confirmExit) requestClose(); else $('.ol-stay').click(); });
  dialog.addEventListener('close', () => { clearReadyPending(); });

  const unsubscribe = client.subscribe(next => {
    if (disposed) return;
    const previousError = state.error;
    state = next || client.state;
    if (state.error && state.error !== previousError) clearReadyPending();
    if (state.status === 'racing') { operation = null; reduceChoice = null; finishClose(); return; }
    if (!state.room) reduceChoice = null;
    render();
  });
  return {
    open() {
      if (disposed || dialog.open || state.status === 'racing') return;
      restoreFocus = document.activeElement;
      confirmExit = false; localError = ''; $('.ol-copy-status').textContent = '';
      render(); dialog.showModal(); $('#online-lobby-title').focus({ preventScroll: true });
    },
    close() { requestClose(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe?.(); clearReadyPending();
      if (state.room || state.status === 'connecting') { try { Promise.resolve(client.leave()).catch(() => {}); } catch {} }
      finishClose(); dialog.remove();
    },
  };
}
