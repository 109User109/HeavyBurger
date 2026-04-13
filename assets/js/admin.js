const state = {
  store: null,
  editingProductId: null,
  heartbeatTimerId: null,
  activeSection: 'products',
  productView: {
    query: '',
    categoryId: 'all',
    sort: 'date_desc'
  },
  image: {
    mode: 'none',
    url: '',
    file: null,
    localObjectUrl: '',
    dirty: false
  },
  editor: {
    ready: false,
    active: false,
    stageWidth: 0,
    stageHeight: 0,
    naturalWidth: 0,
    naturalHeight: 0,
    baseScale: 1,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    pointerId: null,
    lastX: 0,
    lastY: 0
  }
};

const DEFAULT_PRIMARY_COLOR = '#B8BDC6';
const DEFAULT_SECONDARY_COLOR = '#D8B062';
const HEARTBEAT_INTERVAL_MS = 60000;

const dom = {
  status: document.getElementById('status'),
  logoutAdminBtn: document.getElementById('logout-admin-btn'),
  adminTabs: Array.from(document.querySelectorAll('[data-admin-tab]')),
  adminSections: Array.from(document.querySelectorAll('[data-admin-section]')),
  generalForm: document.getElementById('general-form'),
  messagesForm: document.getElementById('messages-form'),
  addCategoryForm: document.getElementById('add-category-form'),
  categoriesList: document.getElementById('categories-list'),
  productForm: document.getElementById('product-form'),
  cancelEdit: document.getElementById('cancel-edit'),
  productsList: document.getElementById('products-list'),
  productSearch: document.getElementById('admin-product-search'),
  productCategoryFilter: document.getElementById('admin-product-category-filter'),
  productSort: document.getElementById('admin-product-sort'),
  addExtraBtn: document.getElementById('add-extra-btn'),
  productExtrasList: document.getElementById('product-extras-list'),
  primaryColorPicker: document.getElementById('primary-color-picker'),
  primaryColorHex: document.getElementById('primary-color-hex'),
  primaryColorChip: document.getElementById('primary-color-chip'),
  secondaryColorPicker: document.getElementById('secondary-color-picker'),
  secondaryColorHex: document.getElementById('secondary-color-hex'),
  secondaryColorChip: document.getElementById('secondary-color-chip'),
  imageFileInput: document.getElementById('image-file-input'),
  capturePhotoBtn: document.getElementById('capture-photo-btn'),
  cameraInput: document.getElementById('camera-input'),
  toggleImageAdjust: document.getElementById('toggle-image-adjust'),
  resetImageFrame: document.getElementById('reset-image-frame'),
  imageZoom: document.getElementById('image-zoom'),
  imageAdjustHint: document.getElementById('image-adjust-hint'),
  previewThumb: document.getElementById('preview-thumb'),
  previewImage: document.getElementById('preview-image'),
  previewEmpty: document.getElementById('preview-empty'),
  previewCategory: document.getElementById('preview-category'),
  previewName: document.getElementById('preview-name'),
  previewDescription: document.getElementById('preview-description'),
  previewPrice: document.getElementById('preview-price')
};

init().catch((error) => {
  if (error?.status === 401 || error?.status === 423 || error?.code === 'AUTH_REDIRECT') {
    return;
  }

  console.error(error);
  showStatus('No se pudo cargar el panel admin.', 'error');
});

async function init() {
  bindEvents();
  applyThemeFromForm();
  await ensureAuthenticatedSession();
  startHeartbeat();
  await refreshStore();
  setActiveSection(state.activeSection);
  resetProductForm();
}

function bindEvents() {
  dom.logoutAdminBtn.addEventListener('click', onLogout);

  for (const tab of dom.adminTabs) {
    tab.addEventListener('click', () => {
      setActiveSection(tab.dataset.adminTab);
    });
  }

  dom.generalForm.addEventListener('submit', onSaveGeneral);
  dom.messagesForm.addEventListener('submit', onSaveMessages);
  bindHexEditor({
    hexInput: dom.primaryColorHex,
    pickerInput: dom.primaryColorPicker,
    chip: dom.primaryColorChip,
    fallback: DEFAULT_PRIMARY_COLOR
  });
  bindHexEditor({
    hexInput: dom.secondaryColorHex,
    pickerInput: dom.secondaryColorPicker,
    chip: dom.secondaryColorChip,
    fallback: DEFAULT_SECONDARY_COLOR
  });
  dom.addCategoryForm.addEventListener('submit', onAddCategory);
  dom.categoriesList.addEventListener('click', onCategoryAction);
  dom.productForm.addEventListener('submit', onSaveProduct);
  dom.productsList.addEventListener('click', onProductAction);
  dom.cancelEdit.addEventListener('click', resetProductForm);
  dom.addExtraBtn.addEventListener('click', () => appendExtraEditorRow());
  dom.productExtrasList.addEventListener('click', onProductExtrasAction);

  dom.productSearch.addEventListener('input', (event) => {
    state.productView.query = event.target.value.trim().toLowerCase();
    renderProducts();
  });

  dom.productCategoryFilter.addEventListener('change', (event) => {
    state.productView.categoryId = event.target.value;
    renderProducts();
  });

  dom.productSort.addEventListener('change', (event) => {
    state.productView.sort = event.target.value;
    renderProducts();
  });

  dom.productForm.elements.name.addEventListener('input', renderPreviewCard);
  dom.productForm.elements.description.addEventListener('input', renderPreviewCard);
  dom.productForm.elements.price.addEventListener('input', renderPreviewCard);
  dom.productForm.elements.categoryId.addEventListener('change', renderPreviewCard);

  dom.imageFileInput.addEventListener('change', (event) => onImageInputChange(event, 'gallery'));
  dom.cameraInput.addEventListener('change', (event) => onImageInputChange(event, 'camera'));
  dom.capturePhotoBtn.addEventListener('click', () => {
    dom.cameraInput.value = '';
    dom.cameraInput.click();
  });
  dom.productForm.elements.removeImage.addEventListener('change', onRemoveImageToggle);

  dom.toggleImageAdjust.addEventListener('click', onToggleImageAdjust);
  dom.resetImageFrame.addEventListener('click', onResetImageFrame);
  dom.imageZoom.addEventListener('input', onImageZoom);

  dom.previewThumb.addEventListener('pointerdown', onPreviewPointerDown);
  dom.previewThumb.addEventListener('pointermove', onPreviewPointerMove);
  dom.previewThumb.addEventListener('pointerup', onPreviewPointerUp);
  dom.previewThumb.addEventListener('pointercancel', onPreviewPointerUp);
  dom.previewThumb.addEventListener('lostpointercapture', onPreviewPointerUp);

  window.addEventListener('resize', () => {
    if (!state.editor.ready) return;
    measureEditorStage();
    computeEditorBaseScale();
    clampEditorOffsets();
    renderEditorTransform();
  });

  window.addEventListener('beforeunload', onBeforeUnload);
}

async function ensureAuthenticatedSession() {
  const payload = await requestJson('/api/admin/session');
  if (!payload.authenticated) {
    redirectToLogin('Tu sesion de admin no esta activa.');
    const error = new Error('Admin session missing');
    error.code = 'AUTH_REDIRECT';
    throw error;
  }
}

function startHeartbeat() {
  stopHeartbeat();

  state.heartbeatTimerId = window.setInterval(async () => {
    try {
      await requestJson('/api/admin/heartbeat', { method: 'POST' });
    } catch (error) {
      if (error.status === 401 || error.status === 423) return;
      console.error('Heartbeat error', error);
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (!state.heartbeatTimerId) return;
  window.clearInterval(state.heartbeatTimerId);
  state.heartbeatTimerId = null;
}

async function onLogout() {
  stopHeartbeat();

  try {
    await requestJson('/api/admin/logout', { method: 'POST' });
  } catch {
    // Ignorar error de red y redirigir igual
  }

  redirectToLogin('Sesion cerrada.');
}

function onBeforeUnload() {
  stopHeartbeat();

  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/admin/logout');
    } else {
      fetch('/api/admin/logout', { method: 'POST', keepalive: true });
    }
  } catch {
    // Ignorar errores al cerrar pestaña
  }
}

function redirectToLogin(reason = '') {
  const target = reason
    ? `/admin-panel/login?reason=${encodeURIComponent(reason)}`
    : '/admin-panel/login';
  window.location.replace(target);
}

function bindHexEditor({ hexInput, pickerInput, chip, fallback }) {
  const setPreview = (hex) => {
    chip.style.background = hex;
  };

  const commitColor = (value, options = {}) => {
    const normalized = normalizeHexColor(value);
    if (!normalized) {
      if (options.forceFallback) {
        hexInput.value = fallback;
        pickerInput.value = fallback;
        setPreview(fallback);
        hexInput.classList.remove('invalid');
        return fallback;
      }

      hexInput.classList.add('invalid');
      return '';
    }

    hexInput.value = normalized;
    pickerInput.value = normalized;
    setPreview(normalized);
    hexInput.classList.remove('invalid');
    return normalized;
  };

  pickerInput.addEventListener('input', () => {
    commitColor(pickerInput.value, { forceFallback: true });
    applyThemeFromForm();
  });

  hexInput.addEventListener('input', () => {
    let raw = String(hexInput.value || '')
      .toUpperCase()
      .replace(/[^#0-9A-F]/g, '');

    if (!raw.startsWith('#')) {
      raw = `#${raw.replaceAll('#', '')}`;
    }

    hexInput.value = raw.slice(0, 7);
    commitColor(hexInput.value);
    applyThemeFromForm();
  });

  hexInput.addEventListener('blur', () => {
    commitColor(hexInput.value, { forceFallback: true });
    applyThemeFromForm();
  });

  commitColor(fallback, { forceFallback: true });
}

function normalizeHexColor(value) {
  if (!value) return '';

  let candidate = String(value).trim().toUpperCase();
  if (candidate && !candidate.startsWith('#')) {
    candidate = `#${candidate}`;
  }

  return /^#[0-9A-F]{6}$/.test(candidate) ? candidate : '';
}

function applyThemeFromForm() {
  const primaryColor = normalizeHexColor(dom.primaryColorHex.value) || DEFAULT_PRIMARY_COLOR;
  const secondaryColor = normalizeHexColor(dom.secondaryColorHex.value) || DEFAULT_SECONDARY_COLOR;
  applyThemeVariables(primaryColor, secondaryColor);
}

function applyThemeFromSettings(settings = {}) {
  const primaryColor = normalizeHexColor(settings.primaryColor) || DEFAULT_PRIMARY_COLOR;
  const secondaryColor = normalizeHexColor(settings.secondaryColor) || DEFAULT_SECONDARY_COLOR;
  applyThemeVariables(primaryColor, secondaryColor);
}

function applyThemeVariables(primaryColor, secondaryColor) {
  const root = document.documentElement;
  const primaryRgb = hexToRgb(primaryColor);
  const secondaryRgb = hexToRgb(secondaryColor);
  const secondaryLight = mixHex(secondaryColor, '#FFFFFF', 0.24);

  root.style.setProperty('--theme-primary', primaryColor);
  root.style.setProperty('--theme-secondary', secondaryColor);
  root.style.setProperty('--theme-primary-rgb', `${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}`);
  root.style.setProperty('--theme-secondary-rgb', `${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b}`);
  root.style.setProperty('--theme-secondary-light', secondaryLight);
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex) || '#000000';
  const parsed = Number.parseInt(normalized.slice(1), 16);

  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255
  };
}

function mixHex(baseColor, mixWithColor, mixRatio) {
  const ratio = clamp(mixRatio, 0, 1);
  const a = hexToRgb(baseColor);
  const b = hexToRgb(mixWithColor);

  const r = Math.round(a.r + (b.r - a.r) * ratio);
  const g = Math.round(a.g + (b.g - a.g) * ratio);
  const bChannel = Math.round(a.b + (b.b - a.b) * ratio);

  return `#${toHex(r)}${toHex(g)}${toHex(bChannel)}`;
}

function toHex(value) {
  return value.toString(16).padStart(2, '0').toUpperCase();
}

function setActiveSection(sectionId) {
  state.activeSection = sectionId;

  for (const tab of dom.adminTabs) {
    const isActive = tab.dataset.adminTab === sectionId;
    tab.classList.toggle('active', isActive);
  }

  for (const section of dom.adminSections) {
    const isActive = section.dataset.adminSection === sectionId;
    section.hidden = !isActive;
    section.classList.toggle('active', isActive);
  }
}

async function refreshStore() {
  const response = await fetch('/api/store');
  if (!response.ok) {
    throw new Error('Could not load store');
  }

  state.store = await response.json();
  renderAll();
}

function renderAll() {
  applyThemeFromSettings(state.store.settings || {});
  renderSettings();
  renderCategories();
  renderProductCategorySelect();
  renderProductCategoryFilterOptions();
  renderProducts();
  renderPreviewCard();
}

function renderSettings() {
  const settings = state.store.settings || {};
  const primaryColor = normalizeHexColor(settings.primaryColor) || DEFAULT_PRIMARY_COLOR;
  const secondaryColor = normalizeHexColor(settings.secondaryColor) || DEFAULT_SECONDARY_COLOR;

  dom.generalForm.elements.storeName.value = settings.storeName || '';
  dom.generalForm.elements.currency.value = settings.currency || 'ARS';
  dom.generalForm.elements.currencySymbol.value = settings.currencySymbol || '$';
  dom.generalForm.elements.primaryColor.value = primaryColor;
  dom.generalForm.elements.secondaryColor.value = secondaryColor;

  dom.primaryColorPicker.value = primaryColor;
  dom.secondaryColorPicker.value = secondaryColor;
  dom.primaryColorChip.style.background = primaryColor;
  dom.secondaryColorChip.style.background = secondaryColor;
  dom.primaryColorHex.classList.remove('invalid');
  dom.secondaryColorHex.classList.remove('invalid');

  dom.messagesForm.elements.whatsappNumber.value = settings.whatsappNumber || '';
  dom.messagesForm.elements.whatsappFooter.value = settings.whatsappFooter || '';
}

function renderCategories() {
  if (!state.store.categories.length) {
    dom.categoriesList.innerHTML = '<p class="empty-list">No hay categorias todavia.</p>';
    return;
  }

  dom.categoriesList.innerHTML = state.store.categories
    .map(
      (category) => `
      <article class="category-item" data-category-id="${category.id}">
        <input type="text" value="${escapeAttribute(category.name)}" />
        <button type="button" class="outline-btn" data-action="save-category">Guardar</button>
        <button type="button" class="danger-btn" data-action="delete-category">Eliminar</button>
      </article>
    `
    )
    .join('');
}

function renderProductCategorySelect() {
  const select = dom.productForm.elements.categoryId;
  const previousValue = select.value;

  select.innerHTML = '';

  for (const category of state.store.categories) {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.name;
    select.appendChild(option);
  }

  if (state.store.categories.some((category) => category.id === previousValue)) {
    select.value = previousValue;
  }

  if (!select.value && state.store.categories[0]) {
    select.value = state.store.categories[0].id;
  }
}

function renderProductCategoryFilterOptions() {
  const select = dom.productCategoryFilter;
  const previousValue = state.productView.categoryId;

  select.innerHTML = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = 'all';
  defaultOption.textContent = 'Todas';
  select.appendChild(defaultOption);

  for (const category of state.store.categories) {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.name;
    select.appendChild(option);
  }

  const canKeepPrevious =
    previousValue === 'all' || state.store.categories.some((cat) => cat.id === previousValue);
  state.productView.categoryId = canKeepPrevious ? previousValue : 'all';
  select.value = state.productView.categoryId;
}

function getVisibleProducts() {
  const query = state.productView.query;
  const categoryId = state.productView.categoryId;
  const sort = state.productView.sort;

  let items = [...state.store.products];

  if (categoryId !== 'all') {
    items = items.filter((product) => product.categoryId === categoryId);
  }

  if (query) {
    items = items.filter((product) => {
      const searchable = `${product.name || ''} ${product.description || ''}`.toLowerCase();
      return searchable.includes(query);
    });
  }

  items.sort((a, b) => {
    if (sort === 'date_asc') return getProductTimestamp(a) - getProductTimestamp(b);
    if (sort === 'date_desc') return getProductTimestamp(b) - getProductTimestamp(a);
    if (sort === 'name_asc') return String(a.name || '').localeCompare(String(b.name || ''), 'es');
    if (sort === 'name_desc') return String(b.name || '').localeCompare(String(a.name || ''), 'es');
    if (sort === 'price_asc') return Number(a.price || 0) - Number(b.price || 0);
    if (sort === 'price_desc') return Number(b.price || 0) - Number(a.price || 0);
    return getProductTimestamp(b) - getProductTimestamp(a);
  });

  return items;
}

function getProductTimestamp(product) {
  const timestamp = Date.parse(product?.createdAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatDate(dateValue) {
  const timestamp = Date.parse(dateValue || '');
  if (!Number.isFinite(timestamp)) return 'Sin fecha';

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium'
  }).format(new Date(timestamp));
}

function renderProducts() {
  const visibleProducts = getVisibleProducts();

  if (!visibleProducts.length) {
    const hasAnyProducts = state.store.products.length > 0;
    dom.productsList.innerHTML = hasAnyProducts
      ? '<p class="empty-list">No hay productos para ese filtro.</p>'
      : '<p class="empty-list">No hay productos cargados.</p>';
    return;
  }

  dom.productsList.innerHTML = visibleProducts
    .map(
      (product) => `
      <article class="product-item" data-product-id="${product.id}">
        ${
          product.image
            ? `<img src="${escapeAttribute(product.image)}" alt="${escapeAttribute(product.name)}" />`
            : '<div class="product-placeholder">Sin imagen</div>'
        }
        <div>
          <h3>${escapeHtml(product.name)}</h3>
          <div class="product-meta">
            <span>${formatMoney(product.price)}</span>
            <span>Categoria: ${escapeHtml(getCategoryName(product.categoryId))}</span>
            <span>Publicado: ${escapeHtml(formatDate(product.createdAt))}</span>
            <span>Extras configurados: ${normalizeProductExtras(product.extras).length}</span>
            <span>${escapeHtml(product.description || 'Sin descripcion')}</span>
          </div>
        </div>
        <div class="product-actions">
          <button type="button" class="outline-btn" data-action="edit-product">Editar</button>
          <button type="button" class="danger-btn" data-action="delete-product">Eliminar</button>
        </div>
      </article>
    `
    )
    .join('');
}

function normalizeProductExtras(rawExtras) {
  if (!Array.isArray(rawExtras)) return [];

  const normalized = [];

  for (const extra of rawExtras) {
    const name = String(extra?.name || '').trim();
    const parsedPrice = Number(extra?.price);

    if (!name || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      continue;
    }

    normalized.push({
      name,
      price: Number(parsedPrice.toFixed(2))
    });
  }

  return normalized;
}

function renderProductExtrasEditor(extras = []) {
  dom.productExtrasList.innerHTML = '';

  if (!Array.isArray(extras) || !extras.length) {
    dom.productExtrasList.innerHTML =
      '<p class="empty-list" data-empty-extras>Sin extras por ahora. Agrega uno si aplica.</p>';
    return;
  }

  for (const extra of extras) {
    appendExtraEditorRow(extra);
  }
}

function appendExtraEditorRow(extra = {}) {
  const emptyState = dom.productExtrasList.querySelector('[data-empty-extras]');
  if (emptyState) {
    emptyState.remove();
  }

  const row = document.createElement('article');
  row.className = 'extra-row';
  row.innerHTML = `
    <label>
      Nombre del extra
      <input type="text" data-extra-field="name" value="${escapeAttribute(extra.name || '')}" placeholder="Ej: Doble queso" />
    </label>
    <label>
      Precio adicional
      <input type="number" data-extra-field="price" min="0" step="0.01" value="${escapeAttribute(
        extra.price ?? ''
      )}" placeholder="0" />
    </label>
    <button type="button" class="danger-btn" data-action="remove-extra">Quitar</button>
  `;

  dom.productExtrasList.appendChild(row);
}

function onProductExtrasAction(event) {
  const button = event.target.closest('button[data-action="remove-extra"]');
  if (!button) return;

  const row = button.closest('.extra-row');
  if (!row) return;

  row.remove();

  if (!dom.productExtrasList.querySelector('.extra-row')) {
    renderProductExtrasEditor([]);
  }
}

function collectProductExtrasFromEditor() {
  const rows = Array.from(dom.productExtrasList.querySelectorAll('.extra-row'));
  const extras = [];

  for (const row of rows) {
    const name = row.querySelector('[data-extra-field="name"]')?.value.trim() || '';
    const priceRaw = row.querySelector('[data-extra-field="price"]')?.value.trim() || '';
    const hasAnyValue = Boolean(name || priceRaw);

    if (!hasAnyValue) {
      continue;
    }

    const parsedPrice = Number(priceRaw);
    if (!name || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      return {
        ok: false,
        error: 'Revisa extras: cada uno debe tener nombre y precio valido.'
      };
    }

    extras.push({
      name,
      price: Number(parsedPrice.toFixed(2))
    });
  }

  return { ok: true, extras };
}

function getCategoryName(categoryId) {
  const category = state.store.categories.find((item) => item.id === categoryId);
  return category ? category.name : 'Sin categoria';
}

async function onSaveGeneral(event) {
  event.preventDefault();

  const primaryColor = normalizeHexColor(dom.generalForm.elements.primaryColor.value);
  const secondaryColor = normalizeHexColor(dom.generalForm.elements.secondaryColor.value);

  const payload = {
    storeName: dom.generalForm.elements.storeName.value.trim(),
    currency: dom.generalForm.elements.currency.value.trim().toUpperCase(),
    currencySymbol: dom.generalForm.elements.currencySymbol.value.trim(),
    primaryColor,
    secondaryColor
  };

  if (!payload.storeName || !payload.currency || !payload.currencySymbol || !primaryColor || !secondaryColor) {
    showStatus('Completa general y usa colores HEX validos (#RRGGBB).', 'error');
    return;
  }

  dom.primaryColorHex.value = primaryColor;
  dom.secondaryColorHex.value = secondaryColor;
  dom.primaryColorPicker.value = primaryColor;
  dom.secondaryColorPicker.value = secondaryColor;
  dom.primaryColorChip.style.background = primaryColor;
  dom.secondaryColorChip.style.background = secondaryColor;
  dom.primaryColorHex.classList.remove('invalid');
  dom.secondaryColorHex.classList.remove('invalid');

  applyThemeVariables(primaryColor, secondaryColor);
  await saveSettings(payload, 'Configuracion general actualizada.');
}

async function onSaveMessages(event) {
  event.preventDefault();

  const payload = {
    whatsappNumber: dom.messagesForm.elements.whatsappNumber.value.trim(),
    whatsappFooter: dom.messagesForm.elements.whatsappFooter.value.trim()
  };

  if (!payload.whatsappNumber || !payload.whatsappFooter) {
    showStatus('Completa los campos de mensajes.', 'error');
    return;
  }

  await saveSettings(payload, 'Mensajes actualizados.');
}

async function saveSettings(partialPayload, successMessage) {
  const current = state.store.settings || {};

  const payload = {
    storeName: current.storeName || '',
    whatsappNumber: current.whatsappNumber || '',
    whatsappFooter: current.whatsappFooter || '',
    currency: current.currency || 'ARS',
    currencySymbol: current.currencySymbol || '$',
    primaryColor: normalizeHexColor(current.primaryColor) || DEFAULT_PRIMARY_COLOR,
    secondaryColor: normalizeHexColor(current.secondaryColor) || DEFAULT_SECONDARY_COLOR,
    ...partialPayload
  };

  try {
    await requestJson('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    showStatus(successMessage, 'success');
    await refreshStore();
  } catch (error) {
    showStatus(error.message, 'error');
  }
}

async function onAddCategory(event) {
  event.preventDefault();

  const name = dom.addCategoryForm.elements.name.value.trim();
  if (!name) return;

  try {
    await requestJson('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    dom.addCategoryForm.reset();
    showStatus('Categoria creada.', 'success');
    await refreshStore();
  } catch (error) {
    showStatus(error.message, 'error');
  }
}

async function onCategoryAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const row = button.closest('[data-category-id]');
  if (!row) return;

  const categoryId = row.dataset.categoryId;
  const action = button.dataset.action;

  if (action === 'save-category') {
    const name = row.querySelector('input').value.trim();
    if (!name) {
      showStatus('El nombre de la categoria no puede estar vacio.', 'error');
      return;
    }

    try {
      await requestJson(`/api/categories/${categoryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });

      showStatus('Categoria actualizada.', 'success');
      await refreshStore();
    } catch (error) {
      showStatus(error.message, 'error');
    }

    return;
  }

  if (action === 'delete-category') {
    const confirmed = window.confirm(
      'Si eliminas la categoria, los productos asociados pasaran a "Uncategorized". Continuar?'
    );

    if (!confirmed) return;

    try {
      await requestEmpty(`/api/categories/${categoryId}`, { method: 'DELETE' });
      showStatus('Categoria eliminada.', 'success');
      await refreshStore();

      if (state.editingProductId) {
        const stillExists = state.store.products.some((item) => item.id === state.editingProductId);
        if (!stillExists) {
          resetProductForm();
        }
      }
    } catch (error) {
      showStatus(error.message, 'error');
    }
  }
}

async function onSaveProduct(event) {
  event.preventDefault();

  if (!state.store.categories.length) {
    showStatus('Primero crea al menos una categoria.', 'error');
    return;
  }

  const form = dom.productForm;
  const productId = form.elements.productId.value.trim();
  const isEditing = Boolean(productId);

  const name = form.elements.name.value.trim();
  const description = form.elements.description.value.trim();
  const price = Number(form.elements.price.value);
  const categoryId = form.elements.categoryId.value;
  const removeImage = form.elements.removeImage.checked;

  if (!name || !Number.isFinite(price) || price < 0 || !categoryId) {
    showStatus('Nombre, precio y categoria son obligatorios.', 'error');
    return;
  }

  const extrasResult = collectProductExtrasFromEditor();
  if (!extrasResult.ok) {
    showStatus(extrasResult.error, 'error');
    return;
  }

  const formData = new FormData();
  formData.append('name', name);
  formData.append('description', description);
  formData.append('price', String(price));
  formData.append('categoryId', categoryId);
  formData.append('extras', JSON.stringify(extrasResult.extras));
  formData.append('removeImage', removeImage ? 'true' : 'false');

  if (!removeImage && shouldUploadEditedImage()) {
    const editedFile = await buildEditedImageFile();
    if (!editedFile) {
      showStatus('No se pudo generar la imagen ajustada.', 'error');
      return;
    }

    formData.append('image', editedFile, editedFile.name);
  }

  try {
    const endpoint = isEditing ? `/api/products/${productId}` : '/api/products';
    const method = isEditing ? 'PUT' : 'POST';

    await requestJson(endpoint, { method, body: formData });

    showStatus(isEditing ? 'Producto actualizado.' : 'Producto creado.', 'success');
    await refreshStore();
    resetProductForm();
    setActiveSection('products');
  } catch (error) {
    showStatus(error.message, 'error');
  }
}

function shouldUploadEditedImage() {
  if (!state.image.url || !state.editor.ready) return false;

  if (state.image.mode === 'new') return true;
  if (state.image.mode === 'existing' && state.image.dirty) return true;

  return false;
}

function onProductAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const row = button.closest('[data-product-id]');
  if (!row) return;

  const productId = row.dataset.productId;
  const action = button.dataset.action;

  if (action === 'edit-product') {
    loadProductIntoForm(productId).catch((error) => {
      console.error(error);
      showStatus('No se pudo cargar el producto en el formulario.', 'error');
    });
    return;
  }

  if (action === 'delete-product') {
    deleteProduct(productId).catch((error) => {
      console.error(error);
      showStatus(error.message || 'No se pudo eliminar el producto.', 'error');
    });
  }
}

async function deleteProduct(productId) {
  const confirmed = window.confirm('Eliminar este producto? Esta accion no se puede deshacer.');
  if (!confirmed) return;

  await requestEmpty(`/api/products/${productId}`, { method: 'DELETE' });

  showStatus('Producto eliminado.', 'success');
  await refreshStore();

  if (state.editingProductId === productId) {
    resetProductForm();
  }
}

async function loadProductIntoForm(productId) {
  const product = state.store.products.find((item) => item.id === productId);
  if (!product) return;

  state.editingProductId = productId;

  const form = dom.productForm;
  form.elements.productId.value = product.id;
  form.elements.name.value = product.name;
  form.elements.description.value = product.description || '';
  form.elements.price.value = product.price;
  form.elements.categoryId.value = product.categoryId;
  renderProductExtrasEditor(normalizeProductExtras(product.extras));
  dom.imageFileInput.value = '';
  dom.cameraInput.value = '';
  form.elements.removeImage.checked = false;

  if (product.image) {
    await setImageSource({ url: product.image, mode: 'existing', file: null, dirty: false });
  } else {
    clearImageState();
  }

  dom.cancelEdit.hidden = false;
  dom.productForm.querySelector('button[type="submit"]').textContent = 'Actualizar producto';

  renderPreviewCard();
  setActiveSection('products');
  dom.productForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetProductForm() {
  state.editingProductId = null;

  dom.productForm.reset();
  dom.productForm.elements.productId.value = '';
  dom.imageFileInput.value = '';
  dom.cameraInput.value = '';
  renderProductExtrasEditor([]);

  if (state.store?.categories?.[0]) {
    dom.productForm.elements.categoryId.value = state.store.categories[0].id;
  }

  clearImageState();

  dom.cancelEdit.hidden = true;
  dom.productForm.querySelector('button[type="submit"]').textContent = 'Guardar producto';

  renderPreviewCard();
}

async function onImageInputChange(event, source) {
  const file = event.target.files?.[0] || null;

  if (source === 'gallery') {
    dom.cameraInput.value = '';
  } else if (source === 'camera') {
    dom.imageFileInput.value = '';
  }

  if (!file) {
    const editingProduct = getEditingProduct();

    if (!dom.productForm.elements.removeImage.checked && editingProduct?.image) {
      await setImageSource({ url: editingProduct.image, mode: 'existing', file: null, dirty: false });
    } else {
      clearImageState();
    }

    renderPreviewCard();
    return;
  }

  dom.productForm.elements.removeImage.checked = false;

  const objectUrl = URL.createObjectURL(file);
  await setImageSource({ url: objectUrl, mode: 'new', file, dirty: true, localObjectUrl: objectUrl });

  setEditorActive(true);
  dom.imageAdjustHint.textContent = 'Arrastra dentro de la tarjeta y usa zoom para ajustar.';
  renderPreviewCard();
  showStatus('Imagen seleccionada. Ajustala directamente en la tarjeta.', 'success');
}

async function onRemoveImageToggle() {
  const removeImage = dom.productForm.elements.removeImage.checked;

  if (removeImage) {
    dom.imageFileInput.value = '';
    dom.cameraInput.value = '';
    clearImageState();
    state.image.mode = 'remove';
    state.image.dirty = true;
    dom.imageAdjustHint.textContent = 'La imagen actual se eliminara al guardar el producto.';
    renderPreviewCard();
    return;
  }

  const selectedFile = getSelectedImageFile();

  if (selectedFile) {
    const objectUrl = URL.createObjectURL(selectedFile);
    await setImageSource({ url: objectUrl, mode: 'new', file: selectedFile, dirty: true, localObjectUrl: objectUrl });
    setEditorActive(true);
    dom.imageAdjustHint.textContent = 'Arrastra dentro de la tarjeta y usa zoom para ajustar.';
    renderPreviewCard();
    return;
  }

  const editingProduct = getEditingProduct();
  if (editingProduct?.image) {
    await setImageSource({ url: editingProduct.image, mode: 'existing', file: null, dirty: false });
  } else {
    clearImageState();
  }

  renderPreviewCard();
}

function onToggleImageAdjust() {
  if (!canAdjustImage()) return;
  setEditorActive(!state.editor.active);
}

function onResetImageFrame() {
  if (!state.editor.ready) return;

  state.editor.zoom = 1;
  state.editor.offsetX = 0;
  state.editor.offsetY = 0;
  dom.imageZoom.value = '1';

  updateDirtyStateFromTransform();
  renderEditorTransform();
}

function onImageZoom(event) {
  if (!state.editor.ready || !state.editor.active) return;

  const nextZoom = Number(event.target.value);
  if (!Number.isFinite(nextZoom)) return;

  const previousScale = getEditorScale();
  state.editor.zoom = nextZoom;

  const nextScale = getEditorScale();
  const ratio = nextScale / previousScale;

  state.editor.offsetX *= ratio;
  state.editor.offsetY *= ratio;

  clampEditorOffsets();
  updateDirtyStateFromTransform();
  renderEditorTransform();
}

function onPreviewPointerDown(event) {
  if (!state.editor.active || !canAdjustImage()) return;

  event.preventDefault();

  state.editor.dragging = true;
  state.editor.pointerId = event.pointerId;
  state.editor.lastX = event.clientX;
  state.editor.lastY = event.clientY;

  dom.previewThumb.setPointerCapture(event.pointerId);
}

function onPreviewPointerMove(event) {
  if (!state.editor.dragging || state.editor.pointerId !== event.pointerId) return;

  const deltaX = event.clientX - state.editor.lastX;
  const deltaY = event.clientY - state.editor.lastY;

  state.editor.lastX = event.clientX;
  state.editor.lastY = event.clientY;

  state.editor.offsetX += deltaX;
  state.editor.offsetY += deltaY;

  clampEditorOffsets();
  updateDirtyStateFromTransform();
  renderEditorTransform();
}

function onPreviewPointerUp(event) {
  if (state.editor.pointerId !== event.pointerId) return;

  state.editor.dragging = false;
  state.editor.pointerId = null;

  if (dom.previewThumb.hasPointerCapture(event.pointerId)) {
    dom.previewThumb.releasePointerCapture(event.pointerId);
  }
}

async function setImageSource({ url, mode, file, dirty, localObjectUrl = '' }) {
  releaseLocalObjectUrl();

  state.image.mode = mode;
  state.image.url = url || '';
  state.image.file = file || null;
  state.image.localObjectUrl = localObjectUrl || '';
  state.image.dirty = Boolean(dirty);

  resetEditorState();

  if (!state.image.url) {
    updateEditorControls();
    return;
  }

  dom.previewImage.hidden = false;
  dom.previewEmpty.hidden = true;
  dom.previewImage.src = state.image.url;

  await waitForImageLoad(dom.previewImage);

  state.editor.ready = true;
  state.editor.naturalWidth = dom.previewImage.naturalWidth;
  state.editor.naturalHeight = dom.previewImage.naturalHeight;
  state.editor.zoom = 1;
  state.editor.offsetX = 0;
  state.editor.offsetY = 0;

  dom.imageZoom.value = '1';

  measureEditorStage();
  computeEditorBaseScale();
  clampEditorOffsets();

  renderEditorTransform();
  updateEditorControls();
}

function clearImageState() {
  releaseLocalObjectUrl();

  state.image.mode = 'none';
  state.image.url = '';
  state.image.file = null;
  state.image.localObjectUrl = '';
  state.image.dirty = false;

  dom.previewImage.hidden = true;
  dom.previewImage.removeAttribute('src');
  dom.previewEmpty.hidden = false;

  resetEditorState();
  updateEditorControls();
}

function resetEditorState() {
  state.editor.ready = false;
  state.editor.active = false;
  state.editor.stageWidth = 0;
  state.editor.stageHeight = 0;
  state.editor.naturalWidth = 0;
  state.editor.naturalHeight = 0;
  state.editor.baseScale = 1;
  state.editor.zoom = 1;
  state.editor.offsetX = 0;
  state.editor.offsetY = 0;
  state.editor.dragging = false;
  state.editor.pointerId = null;
  state.editor.lastX = 0;
  state.editor.lastY = 0;

  dom.imageZoom.value = '1';
  dom.previewThumb.classList.remove('adjusting');
  dom.previewImage.style.transform = 'translate(-50%, -50%) scale(1)';
}

function releaseLocalObjectUrl() {
  if (!state.image.localObjectUrl) return;

  URL.revokeObjectURL(state.image.localObjectUrl);
  state.image.localObjectUrl = '';
}

function canAdjustImage() {
  return Boolean(state.image.url) && state.editor.ready && !dom.productForm.elements.removeImage.checked;
}

function setEditorActive(active) {
  state.editor.active = Boolean(active && canAdjustImage());
  updateEditorControls();
}

function updateEditorControls() {
  const canAdjust = canAdjustImage();
  const active = canAdjust && state.editor.active;

  dom.toggleImageAdjust.disabled = !canAdjust;
  dom.resetImageFrame.disabled = !canAdjust;
  dom.imageZoom.disabled = !canAdjust;

  dom.toggleImageAdjust.textContent = active ? 'Bloquear ajuste' : 'Activar ajuste';

  dom.previewThumb.classList.toggle('adjusting', active);

  if (!canAdjust) {
    if (dom.productForm.elements.removeImage.checked) {
      dom.imageAdjustHint.textContent = 'La imagen se eliminara al guardar.';
    } else {
      dom.imageAdjustHint.textContent = 'Selecciona una imagen para editarla dentro de la tarjeta.';
    }
    return;
  }

  dom.imageAdjustHint.textContent = active
    ? 'Arrastra la imagen sobre la tarjeta y ajusta zoom en tiempo real.'
    : 'Puedes activar ajuste para mover/zoomear la imagen en la tarjeta.';
}

function measureEditorStage() {
  const rect = dom.previewThumb.getBoundingClientRect();
  state.editor.stageWidth = rect.width;
  state.editor.stageHeight = rect.height;
}

function computeEditorBaseScale() {
  if (!state.editor.naturalWidth || !state.editor.naturalHeight) return;

  const widthRatio = state.editor.stageWidth / state.editor.naturalWidth;
  const heightRatio = state.editor.stageHeight / state.editor.naturalHeight;
  state.editor.baseScale = Math.max(widthRatio, heightRatio);
}

function getEditorScale() {
  return state.editor.baseScale * state.editor.zoom;
}

function clampEditorOffsets() {
  const scale = getEditorScale();
  const displayWidth = state.editor.naturalWidth * scale;
  const displayHeight = state.editor.naturalHeight * scale;

  const maxX = Math.max(0, (displayWidth - state.editor.stageWidth) / 2);
  const maxY = Math.max(0, (displayHeight - state.editor.stageHeight) / 2);

  state.editor.offsetX = clamp(state.editor.offsetX, -maxX, maxX);
  state.editor.offsetY = clamp(state.editor.offsetY, -maxY, maxY);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function renderEditorTransform() {
  if (!state.editor.ready || dom.previewImage.hidden) return;

  clampEditorOffsets();

  const scale = getEditorScale();
  dom.previewImage.style.transform = `translate(calc(-50% + ${state.editor.offsetX}px), calc(-50% + ${state.editor.offsetY}px)) scale(${scale})`;
}

function updateDirtyStateFromTransform() {
  if (state.image.mode === 'new') {
    state.image.dirty = true;
    return;
  }

  if (state.image.mode === 'existing') {
    const moved = Math.abs(state.editor.offsetX) > 0.5 || Math.abs(state.editor.offsetY) > 0.5;
    const zoomed = Math.abs(state.editor.zoom - 1) > 0.001;
    state.image.dirty = moved || zoomed;
    return;
  }

  state.image.dirty = false;
}

function renderPreviewCard() {
  const form = dom.productForm;

  const name = form.elements.name.value.trim() || 'Nombre del producto';
  const description = form.elements.description.value.trim() || 'Descripcion del producto';
  const rawPrice = Number(form.elements.price.value);
  const category = state.store.categories.find((item) => item.id === form.elements.categoryId.value);

  dom.previewName.textContent = name;
  dom.previewDescription.textContent = description;
  dom.previewCategory.textContent = category ? category.name : 'Categoria';
  dom.previewPrice.textContent = Number.isFinite(rawPrice) && rawPrice >= 0 ? formatMoney(rawPrice) : '$0';

  const shouldHideImage = dom.productForm.elements.removeImage.checked || !state.image.url;

  if (shouldHideImage) {
    dom.previewImage.hidden = true;
    dom.previewEmpty.hidden = false;
  } else {
    dom.previewImage.hidden = false;
    dom.previewEmpty.hidden = true;
    renderEditorTransform();
  }

  updateEditorControls();
}

function getEditingProduct() {
  if (!state.editingProductId) return null;
  return state.store.products.find((item) => item.id === state.editingProductId) || null;
}

function getSelectedImageFile() {
  return dom.imageFileInput.files?.[0] || dom.cameraInput.files?.[0] || null;
}

async function buildEditedImageFile() {
  if (!state.editor.ready || !state.image.url) return null;

  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 900;

  const context = canvas.getContext('2d');
  if (!context) return null;

  const scale = getEditorScale();
  const imageLeft = state.editor.stageWidth / 2 - (state.editor.naturalWidth * scale) / 2 + state.editor.offsetX;
  const imageTop = state.editor.stageHeight / 2 - (state.editor.naturalHeight * scale) / 2 + state.editor.offsetY;

  let sx = (0 - imageLeft) / scale;
  let sy = (0 - imageTop) / scale;
  let sw = state.editor.stageWidth / scale;
  let sh = state.editor.stageHeight / scale;

  sx = clamp(sx, 0, state.editor.naturalWidth);
  sy = clamp(sy, 0, state.editor.naturalHeight);
  sw = clamp(sw, 1, state.editor.naturalWidth - sx);
  sh = clamp(sh, 1, state.editor.naturalHeight - sy);

  context.drawImage(dom.previewImage, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.92);
  });

  if (!blob) return null;

  return new File([blob], `product-${Date.now()}.jpg`, { type: 'image/jpeg' });
}

function waitForImageLoad(imageElement) {
  return new Promise((resolve, reject) => {
    if (imageElement.complete && imageElement.naturalWidth) {
      resolve();
      return;
    }

    const onLoad = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error('Image load error'));
    };

    const cleanup = () => {
      imageElement.removeEventListener('load', onLoad);
      imageElement.removeEventListener('error', onError);
    };

    imageElement.addEventListener('load', onLoad);
    imageElement.addEventListener('error', onError);
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();

  let parsed = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  }

  if (!response.ok) {
    const message = parsed.error || 'Request failed';

    if (response.status === 401 || response.status === 423) {
      stopHeartbeat();
      redirectToLogin(message);
    }

    const error = new Error(message);
    error.status = response.status;
    error.payload = parsed;
    throw error;
  }

  return parsed;
}

async function requestEmpty(url, options = {}) {
  const response = await fetch(url, options);
  if (response.ok) return;

  let parsed = {};
  try {
    parsed = await response.json();
  } catch {
    parsed = {};
  }

  const message = parsed.error || 'Request failed';

  if (response.status === 401 || response.status === 423) {
    stopHeartbeat();
    redirectToLogin(message);
  }

  const error = new Error(message);
  error.status = response.status;
  error.payload = parsed;
  throw error;
}

function formatMoney(value) {
  const settings = state.store.settings || {};
  const currency = settings.currency || 'ARS';

  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return `${settings.currencySymbol || '$'}${Number(value).toLocaleString('es-AR')}`;
  }
}

function showStatus(message, type = '') {
  dom.status.textContent = message;
  dom.status.className = `status show ${type}`.trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}
