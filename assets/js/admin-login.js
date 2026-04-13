const state = {
  lockSeconds: 0,
  lockTicker: null,
  sessionPoller: null
};

const dom = {
  form: document.getElementById('admin-login-form'),
  submit: document.getElementById('login-submit-btn'),
  status: document.getElementById('login-status')
};

init().catch((error) => {
  console.error(error);
  showStatus('No se pudo iniciar el login admin.', 'error');
});

async function init() {
  bindEvents();

  const session = await fetchSessionStatus();
  if (session.authenticated) {
    window.location.replace('/admin-panel');
    return;
  }

  if (session.locked) {
    lockAccess(session.retryAfterSeconds);
  } else {
    unlockAccess();
    applyReasonFromQuery();
  }

  state.sessionPoller = window.setInterval(checkSessionStatusSilently, 10000);
}

function bindEvents() {
  dom.form.addEventListener('submit', onSubmit);
}

function applyReasonFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const reason = params.get('reason');
  if (!reason) return;
  showStatus(reason, 'error');
}

async function onSubmit(event) {
  event.preventDefault();

  if (state.lockSeconds > 0) {
    showStatus(`Panel bloqueado. Intenta en ${formatDuration(state.lockSeconds)}.`, 'error');
    return;
  }

  const payload = {
    username: dom.form.elements.username.value.trim(),
    password: dom.form.elements.password.value
  };

  if (!payload.username || !payload.password) {
    showStatus('Completa usuario y contrasena.', 'error');
    return;
  }

  dom.submit.disabled = true;

  try {
    const response = await requestJson('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.authenticated) {
      window.location.replace('/admin-panel');
      return;
    }

    showStatus('No se pudo iniciar sesion.', 'error');
  } catch (error) {
    if (error.status === 423) {
      lockAccess(error.payload?.retryAfterSeconds || 0);
      return;
    }

    showStatus(error.message || 'Credenciales invalidas.', 'error');
  } finally {
    dom.submit.disabled = false;
  }
}

async function checkSessionStatusSilently() {
  try {
    const session = await fetchSessionStatus();
    if (session.authenticated) {
      window.location.replace('/admin-panel');
      return;
    }

    if (session.locked) {
      lockAccess(session.retryAfterSeconds || 0);
      return;
    }

    if (state.lockSeconds > 0) {
      unlockAccess();
      showStatus('El panel ya esta disponible. Puedes iniciar sesion.', 'success');
    }
  } catch {
    // Poll silencioso
  }
}

async function fetchSessionStatus() {
  try {
    const response = await requestJson('/api/admin/session');
    return {
      authenticated: Boolean(response.authenticated),
      locked: Boolean(response.locked),
      retryAfterSeconds: Number(response.retryAfterSeconds || 0)
    };
  } catch (error) {
    if (error.status === 423) {
      return {
        authenticated: false,
        locked: true,
        retryAfterSeconds: Number(error.payload?.retryAfterSeconds || 0)
      };
    }

    throw error;
  }
}

function lockAccess(seconds) {
  const next = Math.max(0, Number(seconds) || 0);
  state.lockSeconds = next;
  renderLockMessage();
  dom.submit.disabled = state.lockSeconds > 0;

  if (state.lockTicker) return;

  state.lockTicker = window.setInterval(() => {
    if (state.lockSeconds <= 0) {
      unlockAccess();
      return;
    }

    state.lockSeconds -= 1;
    renderLockMessage();

    if (state.lockSeconds <= 0) {
      unlockAccess();
      showStatus('El panel quedo liberado. Ya puedes intentar ingresar.', 'success');
    }
  }, 1000);
}

function unlockAccess() {
  state.lockSeconds = 0;
  dom.submit.disabled = false;

  if (state.lockTicker) {
    window.clearInterval(state.lockTicker);
    state.lockTicker = null;
  }
}

function renderLockMessage() {
  if (state.lockSeconds <= 0) return;
  showStatus(`Panel ocupado por otra sesion. Reintenta en ${formatDuration(state.lockSeconds)}.`, 'error');
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();

  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
  }

  if (!response.ok) {
    const error = new Error(payload.error || 'Request failed');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

