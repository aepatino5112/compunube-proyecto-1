const FRIENDLY_ERRORS = Object.freeze({
  NOT_CONFIGURED: 'El perfil online estará disponible cuando conectemos el servicio.',
  SESSION_REQUIRED: 'No pudimos recuperar tu perfil online. Vuelve a consultarlo en unos momentos.',
  CONNECTION_FAILED: 'No pudimos consultar tu progreso. Comprueba tu conexión y vuelve a intentarlo.',
  CONNECTION_LOST: 'La conexión se interrumpió. Tu última confirmación sigue aquí; puedes volver a consultarla.',
  TIMEOUT: 'La consulta tardó más de lo esperado. Puedes volver a intentarlo.',
  INVALID_RESPONSE: 'No pudimos confirmar la información recibida. Vuelve a consultar tu perfil.',
  INVALID_PROFILE: 'No pudimos confirmar la información recibida. Vuelve a consultar tu perfil.',
  LOAD_FAILED: 'No pudimos consultar tu progreso. Comprueba tu conexión y vuelve a intentarlo.',
  IDENTITY_CHANGED: 'La sesión del perfil cambió. Vuelve a consultar tu progreso antes de continuar.',
  PROFILE_REQUIRED: 'Consulta tu perfil online antes de continuar.',
  PROFILE_CONFLICT: 'Tu progreso cambió en otra sesión. Actualiza el perfil antes de continuar.',
  REVISION_CONFLICT: 'Tu progreso cambió en otra sesión. Actualiza el perfil antes de continuar.',
  INSUFFICIENT_FUNDS: 'No hay suficientes monedas para ese cambio.',
  INSUFFICIENT_COINS: 'No hay suficientes monedas para ese cambio.',
  INSUFFICIENT_MATERIALS: 'Todavía faltan materiales para ese cambio.',
  NOT_OWNED: 'Primero necesitas conseguir ese objeto.',
  ALREADY_OWNED: 'Ese objeto ya forma parte de tu equipo.',
  INVALID_ACTION: 'No pudimos confirmar ese cambio. Consulta tu perfil antes de continuar.',
  INVALID_ITEM: 'Ese objeto no está disponible. Actualiza el perfil antes de continuar.',
  INVALID_APPEARANCE: 'No pudimos confirmar esa apariencia. Actualiza el perfil antes de continuar.',
  INVALID_REQUEST_ID: 'No pudimos preparar ese cambio. Consulta tu perfil antes de continuar.',
  ACTION_UNCERTAIN: 'El cambio sigue pendiente de confirmación. Puedes volver a consultarlo.',
  PROFILE_UNAVAILABLE: 'El perfil y la economía online no están disponibles ahora. Tu última confirmación se conserva; vuelve a intentarlo en unos momentos.',
  INVALID_REQUEST: 'El servicio no aceptó esa solicitud. Actualiza el perfil antes de continuar.',
  IDEMPOTENCY_CONFLICT: 'Esa operación ya se registró con otros datos. Actualiza el perfil antes de continuar.',
  INVALID_CATALOG_VERSION: 'El catálogo cambió. Actualiza el perfil y vuelve a elegir.',
});

const STATUS_TEXT = Object.freeze({
  unconfigured: 'Online · Próximamente',
  idle: 'Online · Por consultar',
  loading: 'Consultando tu progreso…',
  ready: 'Progreso online confirmado',
  pending: 'Confirmando tu cambio…',
  uncertain: 'Un cambio por confirmar',
  error: 'No pudimos confirmar el progreso',
});

/** A profile chooser only: it never creates, resets or credits a profile. */
export function mountProfilePanel({ store, getMode, setMode }) {
  if (!store || typeof store.subscribe !== 'function') throw new TypeError('A profile store is required.');
  if (typeof getMode !== 'function' || typeof setMode !== 'function') throw new TypeError('Profile mode accessors are required.');
  if (document.getElementById('profile-dialog')) throw new Error('The profile panel is already mounted.');
  const dialog = document.createElement('dialog');
  dialog.id = 'profile-dialog';
  dialog.setAttribute('aria-labelledby', 'profile-panel-title');
  dialog.setAttribute('aria-describedby', 'profile-panel-description');
  // This template is constant. Service values are assigned with textContent.
  dialog.innerHTML = `
    <button type="button" class="pp-close" aria-label="Cerrar mi progreso">×</button>
    <header class="pp-heading">
      <span class="pp-eyebrow">COMPUNUBE / TU HUELLA</span>
      <h2 id="profile-panel-title" tabindex="-1">Tu progreso,<br>a bordo<span>.</span></h2>
      <p id="profile-panel-description">Elige con qué progreso recorres el club.</p>
    </header>
    <div class="pp-choices" role="group" aria-label="Progreso del club">
      <button type="button" class="pp-choice" data-pp-mode="local" aria-pressed="true">
        <span class="pp-choice-top"><span class="pp-choice-label">Local</span><i aria-hidden="true">✓</i></span>
        <span class="pp-scope">EN ESTE NAVEGADOR</span>
        <span class="pp-choice-note">Tus carreras, materiales y equipo de aquí.</span>
      </button>
      <button type="button" class="pp-choice" data-pp-mode="online" aria-pressed="false" aria-describedby="profile-online-note" disabled>
        <span class="pp-choice-top"><span class="pp-choice-label">Online</span><i aria-hidden="true">✓</i></span>
        <span class="pp-scope">PERFIL DEL SERVICIO</span>
        <span class="pp-choice-note">Tu progreso confirmado al jugar en línea.</span>
      </button>
    </div>
    <p class="pp-selection" role="status" aria-live="polite"></p>
    <section class="pp-online" aria-labelledby="profile-online-title">
      <div class="pp-online-heading"><h3 id="profile-online-title">Tu huella online</h3><span class="pp-service" role="status" aria-live="polite"><i aria-hidden="true"></i><span></span></span></div>
      <p id="profile-online-note" class="pp-note"></p>
      <div class="pp-error" role="alert" hidden></div>
      <div class="pp-summary" hidden>
        <p class="pp-summary-label"></p>
        <dl class="pp-balances"><div><dt>Monedas</dt><dd data-pp-value="coins"></dd></div><div><dt>Plástico</dt><dd data-pp-value="plastic"></dd></div><div><dt>Chatarra</dt><dd data-pp-value="metal"></dd></div></dl>
        <p class="pp-history"></p>
      </div>
      <button type="button" class="pp-refresh"><span></span><span aria-hidden="true">↻</span></button>
    </section>
    <footer class="pp-footer"><p>El progreso local y el online se guardan por separado.</p><button type="button" class="pp-done">Volver al club <span aria-hidden="true">↗</span></button></footer>`;
  document.body.append(dialog);

  const $ = selector => dialog.querySelector(selector);
  const modeButtons = [...dialog.querySelectorAll('[data-pp-mode]')];
  const summary = $('.pp-summary'), refresh = $('.pp-refresh');
  const number = new Intl.NumberFormat('es-VE');
  let state = store.state || { status: 'unconfigured', profile: null };
  let disposed = false, actionPending = false, restoreFocus = null, localError = '';

  const pending = () => state.status === 'pending' || state.status === 'uncertain';
  const canUseOnline = () => !!state.profile && state.status === 'ready' && !actionPending;
  const formatCount = value => Number.isSafeInteger(value) && value >= 0 ? number.format(value) : '—';

  function render() {
    if (disposed) return;
    const mode = getMode() === 'online' ? 'online' : 'local';
    const unavailable = state.status === 'unconfigured';
    const loading = state.status === 'loading' || state.status === 'pending' || actionPending;
    const uncertain = state.status === 'uncertain';
    for (const button of modeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.ppMode === mode));
      button.disabled = button.dataset.ppMode === 'online' && !canUseOnline();
    }
    $('.pp-selection').textContent = mode === 'online'
      ? pending() ? 'Estás viendo el progreso online. Hay un cambio pendiente de confirmación.' : 'Estás usando el progreso online en el club.'
      : pending() ? 'Estás usando el progreso local. El cambio online sigue pendiente de confirmación.' : 'Estás usando el progreso de este navegador.';
    const status = $('.pp-service');
    status.dataset.state = state.status;
    status.querySelector('span').textContent = STATUS_TEXT[state.status] || STATUS_TEXT.error;
    $('.pp-online').setAttribute('aria-busy', String(loading));
    const note = unavailable
      ? 'Tu progreso local sigue en este navegador. El perfil online estará disponible al conectar el servicio.'
      : uncertain
        ? 'Falta confirmar la operación. Reintentar consultará la misma operación. Puedes cerrar este panel o mirar tu progreso local mientras tanto.'
        : state.status === 'pending'
          ? 'Estamos esperando la confirmación de tu cambio. Puedes seguir mirando tu progreso local; el cambio online continuará pendiente.'
          : state.status === 'loading'
            ? 'Estamos consultando tu última huella. El perfil local sigue disponible.'
            : state.status === 'ready'
              ? 'Este es el progreso confirmado por el servicio. Selecciona Online para usarlo en la tienda y el taller.'
              : state.profile
                ? 'Se muestra la última confirmación recibida. Actualiza el perfil antes de hacer otro cambio online.'
                : 'Consulta tu perfil para usar sus materiales y equipo en el club. Tu progreso local sigue disponible.';
    $('#profile-online-note').textContent = note;
    const error = localError || (['error', 'ready', 'uncertain'].includes(state.status) && state.error?.code !== 'ACTION_UNCERTAIN' && state.error ? FRIENDLY_ERRORS[state.error.code] || 'No pudimos confirmar el progreso. Vuelve a consultarlo antes de continuar.' : '');
    $('.pp-error').hidden = !error;
    $('.pp-error').textContent = error;
    summary.hidden = !state.profile;
    if (state.profile) {
      $('.pp-summary-label').textContent = state.status === 'ready' ? 'CONFIRMADO EN EL SERVICIO' : 'ÚLTIMA CONFIRMACIÓN RECIBIDA';
      for (const field of ['coins', 'plastic', 'metal']) $(`[data-pp-value="${field}"]`).textContent = formatCount(state.profile[field]);
      // The online service does not report history counters; never show invented zeros.
      const history = state.profile.totalCleaned !== null && state.profile.races !== null;
      $('.pp-history').hidden = !history;
      $('.pp-history').textContent = history ? `${formatCount(state.profile.totalCleaned)} residuos recuperados · ${formatCount(state.profile.races)} carreras` : '';
    }
    refresh.hidden = unavailable;
    refresh.disabled = loading;
    refresh.querySelector('span').textContent = uncertain ? 'Consultar el cambio pendiente' : loading ? state.status === 'pending' ? 'Esperando confirmación…' : 'Consultando…' : state.profile ? 'Actualizar perfil' : 'Consultar perfil online';
  }

  function restoreOpener() {
    if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
    restoreFocus = null;
  }

  function close() {
    if (!dialog.open) return;
    dialog.close();
    restoreOpener();
  }

  for (const button of modeButtons) button.addEventListener('click', () => {
    if (disposed || button.disabled) return;
    const requested = button.dataset.ppMode;
    if (requested === 'online' && !canUseOnline()) return;
    localError = '';
    try { setMode(requested); }
    catch { localError = 'No pudimos cambiar de progreso. Inténtalo de nuevo.'; }
    render();
  });

  refresh.addEventListener('click', async () => {
    if (disposed || refresh.disabled || state.status === 'unconfigured') return;
    const retry = state.status === 'uncertain';
    actionPending = true; localError = ''; render();
    try { await (retry ? store.retry() : store.load()); }
    catch { if (!disposed) localError = retry ? 'El cambio sigue pendiente de confirmación. Puedes volver a consultarlo.' : 'No pudimos consultar tu progreso. Inténtalo de nuevo.'; }
    finally { actionPending = false; if (!disposed) render(); }
  });
  $('.pp-close').addEventListener('click', close);
  $('.pp-done').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (!dialog.open) restoreOpener(); });
  const unsubscribe = store.subscribe(next => {
    if (disposed) return;
    state = next || store.state;
    localError = '';
    render();
  });
  render();
  return {
    open() {
      if (disposed || dialog.open) return;
      restoreFocus = document.activeElement;
      localError = ''; render(); dialog.showModal();
      $('#profile-panel-title').focus({ preventScroll: true });
    },
    close,
    render,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe?.(); close(); dialog.remove();
    },
  };
}
