const state = {
  store: null,
  selectedCategoryId: 'all',
  searchTerm: '',
  cart: [],
  cartOpen: false,
  toastTimerId: null,
  configurator: {
    open: false,
    productId: '',
    extras: []
  }
};

const DEFAULT_PRIMARY_COLOR = '#B8BDC6';
const DEFAULT_SECONDARY_COLOR = '#D8B062';

const dom = {
  storeName: document.getElementById('store-name'),
  menuToggle: document.getElementById('menu-toggle'),
  topnav: document.getElementById('topnav'),
  searchInput: document.getElementById('search-input'),
  categoryFilters: document.getElementById('category-filters'),
  productsGrid: document.getElementById('products-grid'),
  productTemplate: document.getElementById('product-card-template'),
  cartDrawer: document.getElementById('cart-drawer'),
  cartBackdrop: document.getElementById('cart-backdrop'),
  openCartBtn: document.getElementById('open-cart-btn'),
  floatingCartBtn: document.getElementById('floating-cart-btn'),
  closeCartBtn: document.getElementById('close-cart-btn'),
  cartItems: document.getElementById('cart-items'),
  cartCount: document.getElementById('cart-count'),
  cartTriggerCount: document.getElementById('cart-trigger-count'),
  floatingCartCount: document.getElementById('floating-cart-count'),
  cartTotal: document.getElementById('cart-total'),
  cartNote: document.getElementById('cart-note'),
  checkoutBtn: document.getElementById('checkout-btn'),
  cartToast: document.getElementById('cart-toast'),
  productConfigModal: document.getElementById('product-config-modal'),
  productConfigBackdrop: document.getElementById('product-config-backdrop'),
  productConfigForm: document.getElementById('product-config-form'),
  closeProductConfigBtn: document.getElementById('close-product-config-btn'),
  configProductName: document.getElementById('config-product-name'),
  configBasePrice: document.getElementById('config-base-price'),
  configExtrasList: document.getElementById('config-extras-list'),
  configNote: document.getElementById('config-note'),
  configQuantity: document.getElementById('config-quantity'),
  configQtyDecrease: document.getElementById('config-qty-decrease'),
  configQtyIncrease: document.getElementById('config-qty-increase'),
  configTotalPrice: document.getElementById('config-total-price')
};

init().catch((error) => {
  console.error(error);
  dom.productsGrid.innerHTML = '<p class="no-results">No se pudo cargar la tienda.</p>';
});

async function init() {
  bindEvents();
  initVisualEffects();
  setCartOpen(false);
  setProductConfiguratorOpen(false);
  await loadStore();
}

function bindEvents() {
  dom.searchInput.addEventListener('input', (event) => {
    state.searchTerm = event.target.value.trim().toLowerCase();
    renderProducts();
  });

  dom.categoryFilters.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-category-id]');
    if (!button) return;

    state.selectedCategoryId = button.dataset.categoryId;
    renderCategories();
    renderProducts();
  });

  dom.productsGrid.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-product-id]');
    if (!button) return;

    openProductConfigurator(button.dataset.productId);
  });

  dom.cartItems.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const cartItemId = button.dataset.cartItemId;
    const action = button.dataset.action;

    if (action === 'increase') updateCartQuantity(cartItemId, 1);
    if (action === 'decrease') updateCartQuantity(cartItemId, -1);
  });

  dom.openCartBtn.addEventListener('click', () => setCartOpen(true));
  dom.floatingCartBtn.addEventListener('click', () => setCartOpen(true));
  dom.closeCartBtn.addEventListener('click', () => setCartOpen(false));
  dom.cartBackdrop.addEventListener('click', () => setCartOpen(false));

  dom.productConfigBackdrop.addEventListener('click', closeProductConfigurator);
  dom.closeProductConfigBtn.addEventListener('click', closeProductConfigurator);
  dom.productConfigForm.addEventListener('submit', onSubmitProductConfigurator);
  dom.configExtrasList.addEventListener('change', updateProductConfiguratorTotal);
  dom.configQuantity.addEventListener('input', () => {
    readConfiguratorQuantity();
    updateProductConfiguratorTotal();
  });
  dom.configQtyDecrease.addEventListener('click', () => {
    adjustConfiguratorQuantity(-1);
  });
  dom.configQtyIncrease.addEventListener('click', () => {
    adjustConfiguratorQuantity(1);
  });

  if (dom.menuToggle && dom.topnav) {
    dom.menuToggle.addEventListener('click', () => {
      const isOpen = dom.topnav.classList.toggle('is-open');
      dom.menuToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    dom.topnav.addEventListener('click', (event) => {
      const link = event.target.closest('a');
      if (!link) return;
      closeTopNav();
    });

    document.addEventListener('click', (event) => {
      if (!dom.topnav.classList.contains('is-open')) return;
      const clickedInsideNav = event.target.closest('#topnav');
      const clickedToggle = event.target.closest('#menu-toggle');
      if (!clickedInsideNav && !clickedToggle) {
        closeTopNav();
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    if (state.configurator.open) {
      closeProductConfigurator();
      return;
    }

    if (state.cartOpen) setCartOpen(false);
    if (dom.topnav?.classList.contains('is-open')) closeTopNav();
  });

  dom.checkoutBtn.addEventListener('click', checkoutByWhatsapp);
}

function initVisualEffects() {
  const revealItems = Array.from(document.querySelectorAll('.reveal'));
  if (!revealItems.length) return;

  if (!('IntersectionObserver' in window)) {
    for (const item of revealItems) {
      item.classList.add('in-view');
    }
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.14, rootMargin: '0px 0px -8% 0px' }
  );

  for (const item of revealItems) {
    observer.observe(item);
  }
}

function closeTopNav() {
  if (!dom.topnav || !dom.menuToggle) return;
  dom.topnav.classList.remove('is-open');
  dom.menuToggle.setAttribute('aria-expanded', 'false');
}

async function loadStore() {
  const response = await fetch('/api/store');
  if (!response.ok) {
    throw new Error('Could not load store data');
  }

  state.store = await response.json();

  if (!Array.isArray(state.store.categories)) state.store.categories = [];
  if (!Array.isArray(state.store.products)) state.store.products = [];

  state.store.products = state.store.products.map((product) => ({
    ...product,
    extras: normalizeProductExtras(product.extras),
    promotion: normalizePromotion(product.promotion, Number(product.price))
  }));

  applyThemeFromSettings(state.store.settings || {});

  const title = state.store.settings?.storeName || 'Tienda';
  dom.storeName.textContent = title;
  dom.storeName.classList.remove('is-loading');
  document.title = title;

  dom.cartNote.textContent = state.store.settings?.whatsappFooter || '';

  renderCategories();
  renderProducts();
  renderCart();
}

function setCartOpen(nextState) {
  state.cartOpen = Boolean(nextState);
  document.body.classList.toggle('cart-open', state.cartOpen);
  dom.cartDrawer.setAttribute('aria-hidden', state.cartOpen ? 'false' : 'true');
  if (state.cartOpen) closeTopNav();
}

function setProductConfiguratorOpen(nextState) {
  state.configurator.open = Boolean(nextState);
  dom.productConfigModal.hidden = false;
  dom.productConfigModal.classList.toggle('is-open', state.configurator.open);
  dom.productConfigModal.setAttribute('aria-hidden', state.configurator.open ? 'false' : 'true');
  document.body.classList.toggle('modal-open', state.configurator.open);
}

function normalizeHexColor(value) {
  if (!value) return '';

  let candidate = String(value).trim().toUpperCase();
  if (candidate && !candidate.startsWith('#')) {
    candidate = `#${candidate}`;
  }

  return /^#[0-9A-F]{6}$/.test(candidate) ? candidate : '';
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
  const ratio = Math.min(1, Math.max(0, Number(mixRatio) || 0));
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

function applyThemeFromSettings(settings = {}) {
  const primaryColor = normalizeHexColor(settings.primaryColor) || DEFAULT_PRIMARY_COLOR;
  const secondaryColor = normalizeHexColor(settings.secondaryColor) || DEFAULT_SECONDARY_COLOR;

  const primaryRgb = hexToRgb(primaryColor);
  const secondaryRgb = hexToRgb(secondaryColor);
  const secondaryLight = mixHex(secondaryColor, '#FFFFFF', 0.24);

  const root = document.documentElement;
  root.style.setProperty('--theme-primary', primaryColor);
  root.style.setProperty('--theme-secondary', secondaryColor);
  root.style.setProperty('--theme-primary-rgb', `${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}`);
  root.style.setProperty('--theme-secondary-rgb', `${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b}`);
  root.style.setProperty('--theme-secondary-light', secondaryLight);
}

function formatMoney(value) {
  const currency = state.store?.settings?.currency || 'ARS';
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    const symbol = state.store?.settings?.currencySymbol || '$';
    return `${symbol}${Number(value).toLocaleString('es-AR')}`;
  }
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

function normalizePromotion(rawPromotion, basePrice) {
  if (!rawPromotion || typeof rawPromotion !== 'object') return null;

  const type = String(rawPromotion.type || '').trim().toLowerCase();
  const startTimestamp = Date.parse(rawPromotion.startAt || rawPromotion.startDate || '');
  const endTimestamp = Date.parse(rawPromotion.endAt || rawPromotion.endDate || '');

  if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp)) return null;
  if (startTimestamp >= endTimestamp) return null;

  if (type === 'percentage') {
    const discountPercentage = Number(rawPromotion.discountPercentage ?? rawPromotion.percentage);
    if (!Number.isFinite(discountPercentage) || discountPercentage <= 0 || discountPercentage > 100) return null;

    return {
      type: 'percentage',
      discountPercentage: Number(discountPercentage.toFixed(2)),
      startAt: new Date(startTimestamp).toISOString(),
      endAt: new Date(endTimestamp).toISOString()
    };
  }

  if (type === 'fixed_price') {
    const promotionalPrice = Number(rawPromotion.promotionalPrice ?? rawPromotion.price);
    if (!Number.isFinite(promotionalPrice) || promotionalPrice < 0) return null;
    if (Number.isFinite(basePrice) && promotionalPrice >= basePrice) return null;

    return {
      type: 'fixed_price',
      promotionalPrice: Number(promotionalPrice.toFixed(2)),
      startAt: new Date(startTimestamp).toISOString(),
      endAt: new Date(endTimestamp).toISOString()
    };
  }

  return null;
}

function formatPromotionBadge(discountPercentage) {
  const percentage = Number(discountPercentage);
  if (!Number.isFinite(percentage)) return 'Oferta';
  const display = Number.isInteger(percentage) ? String(percentage) : percentage.toFixed(1);
  return `${display}% OFF`;
}

function getEffectiveProductPricing(product, nowMs = Date.now()) {
  const basePrice = Number(product?.price);

  if (!Number.isFinite(basePrice) || basePrice < 0) {
    return {
      hasPromotion: false,
      originalPrice: 0,
      finalPrice: 0,
      badgeText: ''
    };
  }

  const promotion = normalizePromotion(product?.promotion, basePrice);
  if (!promotion) {
    return {
      hasPromotion: false,
      originalPrice: Number(basePrice.toFixed(2)),
      finalPrice: Number(basePrice.toFixed(2)),
      badgeText: ''
    };
  }

  const startTs = Date.parse(promotion.startAt);
  const endTs = Date.parse(promotion.endAt);
  const isActive = nowMs >= startTs && nowMs <= endTs;

  if (!isActive) {
    return {
      hasPromotion: false,
      originalPrice: Number(basePrice.toFixed(2)),
      finalPrice: Number(basePrice.toFixed(2)),
      badgeText: ''
    };
  }

  if (promotion.type === 'percentage') {
    const finalPrice = Number((basePrice * (1 - promotion.discountPercentage / 100)).toFixed(2));

    return {
      hasPromotion: true,
      originalPrice: Number(basePrice.toFixed(2)),
      finalPrice: Math.max(0, finalPrice),
      badgeText: formatPromotionBadge(promotion.discountPercentage)
    };
  }

  return {
    hasPromotion: true,
    originalPrice: Number(basePrice.toFixed(2)),
    finalPrice: Number(promotion.promotionalPrice.toFixed(2)),
    badgeText: 'Oferta'
  };
}

function getCategoryName(categoryId) {
  const category = state.store.categories.find((item) => item.id === categoryId);
  return category ? category.name : 'Sin categoria';
}

function filteredProducts() {
  return state.store.products.filter((product) => {
    const inCategory =
      state.selectedCategoryId === 'all' || product.categoryId === state.selectedCategoryId;

    if (!inCategory) return false;

    if (!state.searchTerm) return true;

    const searchable = `${product.name || ''} ${product.description || ''}`.toLowerCase();
    return searchable.includes(state.searchTerm);
  });
}

function renderCategories() {
  const categories = [
    {
      id: 'all',
      name: 'Todos'
    },
    ...state.store.categories
  ];

  dom.categoryFilters.innerHTML = categories
    .map((category) => {
      const active = category.id === state.selectedCategoryId ? 'active' : '';
      return `<button type="button" class="filter-btn ${active}" data-category-id="${category.id}">${escapeHtml(
        category.name
      )}</button>`;
    })
    .join('');
}

function renderProducts() {
  const products = filteredProducts();
  dom.productsGrid.innerHTML = '';

  if (!products.length) {
    dom.productsGrid.innerHTML =
      '<p class="no-results">No hay productos para ese filtro. Proba con otra categoria.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const product of products) {
    const node = dom.productTemplate.content.cloneNode(true);
    const card = node.querySelector('.product-card');
    const thumb = node.querySelector('.thumb');

    if (product.image) {
      thumb.innerHTML = `<span class="promo-badge" hidden>Oferta</span><img src="${escapeAttribute(
        product.image
      )}" alt="${escapeAttribute(product.name)}" loading="lazy" />`;
    } else {
      thumb.innerHTML = '<span class="promo-badge" hidden>Oferta</span>Sin imagen';
    }

    node.querySelector('.category').textContent = getCategoryName(product.categoryId);
    node.querySelector('h3').textContent = product.name;
    node.querySelector('.description').textContent = product.description || 'Sin descripcion';
    const pricing = getEffectiveProductPricing(product);
    const priceElement = node.querySelector('.price');
    const promoBadge = node.querySelector('.promo-badge');

    if (pricing.hasPromotion) {
      priceElement.innerHTML = `<span class="price-old">${escapeHtml(
        formatMoney(pricing.originalPrice)
      )}</span><strong class="price-current">${escapeHtml(formatMoney(pricing.finalPrice))}</strong>`;
      if (promoBadge) {
        promoBadge.hidden = false;
        promoBadge.textContent = pricing.badgeText;
      }
    } else {
      priceElement.textContent = formatMoney(pricing.finalPrice);
      if (promoBadge) {
        promoBadge.hidden = true;
        promoBadge.textContent = '';
      }
    }

    const addButton = node.querySelector('.add-btn');
    addButton.dataset.productId = product.id;

    card.dataset.productId = product.id;
    fragment.appendChild(node);
  }

  dom.productsGrid.appendChild(fragment);
}

function getProductById(productId) {
  return state.store?.products?.find((item) => item.id === productId) || null;
}

function openProductConfigurator(productId) {
  const product = getProductById(productId);
  if (!product) return;

  state.configurator.productId = product.id;
  state.configurator.extras = normalizeProductExtras(product.extras);
  const pricing = getEffectiveProductPricing(product);

  dom.configProductName.textContent = product.name;
  dom.configBasePrice.textContent = `Precio base: ${formatMoney(pricing.finalPrice)}`;
  dom.configNote.value = '';
  dom.configQuantity.value = '1';

  renderConfiguratorExtras();
  updateProductConfiguratorTotal();
  setProductConfiguratorOpen(true);
}

function closeProductConfigurator() {
  state.configurator.productId = '';
  state.configurator.extras = [];
  setProductConfiguratorOpen(false);
}

function renderConfiguratorExtras() {
  dom.configExtrasList.innerHTML = '';

  if (!state.configurator.extras.length) {
    dom.configExtrasList.innerHTML =
      '<p class="empty-cart">Este producto no tiene extras configurados.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (let index = 0; index < state.configurator.extras.length; index += 1) {
    const extra = state.configurator.extras[index];

    const label = document.createElement('label');
    label.className = 'config-extra-option';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = String(index);

    const textWrap = document.createElement('div');

    const nameLine = document.createElement('span');
    nameLine.textContent = extra.name;

    const priceLine = document.createElement('small');
    priceLine.textContent = `+${formatMoney(extra.price)}`;

    textWrap.appendChild(nameLine);
    textWrap.appendChild(priceLine);

    label.appendChild(checkbox);
    label.appendChild(textWrap);

    fragment.appendChild(label);
  }

  dom.configExtrasList.appendChild(fragment);
}

function readConfiguratorQuantity() {
  const parsed = Number.parseInt(dom.configQuantity.value, 10);
  const quantity = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  dom.configQuantity.value = String(quantity);
  return quantity;
}

function adjustConfiguratorQuantity(delta) {
  const current = readConfiguratorQuantity();
  const next = Math.max(1, current + delta);
  dom.configQuantity.value = String(next);
  updateProductConfiguratorTotal();
}

function getSelectedConfiguratorExtras() {
  const selected = [];
  const checkedInputs = Array.from(dom.configExtrasList.querySelectorAll('input[type="checkbox"]:checked'));

  for (const input of checkedInputs) {
    const index = Number.parseInt(input.value, 10);
    const extra = state.configurator.extras[index];
    if (!extra) continue;

    selected.push({
      name: extra.name,
      price: extra.price
    });
  }

  return selected;
}

function updateProductConfiguratorTotal() {
  const product = getProductById(state.configurator.productId);
  if (!product) {
    dom.configTotalPrice.textContent = formatMoney(0);
    return;
  }

  const quantity = readConfiguratorQuantity();
  const selectedExtras = getSelectedConfiguratorExtras();
  const extrasTotal = selectedExtras.reduce((sum, extra) => sum + extra.price, 0);
  const basePrice = getEffectiveProductPricing(product).finalPrice;
  const unitPrice = basePrice + extrasTotal;
  const itemTotal = unitPrice * quantity;

  dom.configTotalPrice.textContent = formatMoney(itemTotal);
}

function onSubmitProductConfigurator(event) {
  event.preventDefault();

  const product = getProductById(state.configurator.productId);
  if (!product) return;

  const quantity = readConfiguratorQuantity();
  const selectedExtras = getSelectedConfiguratorExtras();
  const note = String(dom.configNote.value || '').trim();

  addConfiguredProductToCart({
    product,
    quantity,
    selectedExtras,
    note
  });

  closeProductConfigurator();
  showCartToast(`${product.name} agregado al carrito`);
}

function addConfiguredProductToCart({ product, quantity, selectedExtras, note }) {
  const signature = buildCartSignature(product.id, selectedExtras, note);
  const existingItem = state.cart.find((item) => item.signature === signature);

  if (existingItem) {
    existingItem.quantity += quantity;
  } else {
    state.cart.push({
      id: createClientId('cart'),
      signature,
      productId: product.id,
      quantity,
      extras: selectedExtras.map((extra) => ({
        name: extra.name,
        price: extra.price
      })),
      note
    });
  }

  renderCart();
}

function buildCartSignature(productId, extras, note) {
  const normalizedNote = String(note || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const extrasSignature = [...extras]
    .map((extra) => `${String(extra.name || '').trim().toLowerCase()}::${Number(extra.price || 0).toFixed(2)}`)
    .sort()
    .join('|');

  return `${productId}::${extrasSignature}::${normalizedNote}`;
}

function createClientId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCartExtras(rawExtras) {
  return normalizeProductExtras(rawExtras);
}

function showCartToast(message) {
  if (!dom.cartToast) return;

  dom.cartToast.textContent = message;
  dom.cartToast.classList.add('show');

  if (state.toastTimerId) {
    window.clearTimeout(state.toastTimerId);
  }

  state.toastTimerId = window.setTimeout(() => {
    dom.cartToast.classList.remove('show');
    state.toastTimerId = null;
  }, 1600);
}

function updateCartQuantity(cartItemId, delta) {
  const index = state.cart.findIndex((item) => item.id === cartItemId);
  if (index === -1) return;

  const nextQty = state.cart[index].quantity + delta;

  if (nextQty <= 0) {
    state.cart.splice(index, 1);
  } else {
    state.cart[index].quantity = nextQty;
  }

  renderCart();
}

function renderCart() {
  if (!state.store) return;

  const fragment = document.createDocumentFragment();
  const nextCart = [];
  let totalItems = 0;
  let totalAmount = 0;

  for (const cartItem of state.cart) {
    const product = getProductById(cartItem.productId);
    if (!product) {
      continue;
    }

    const extras = normalizeCartExtras(cartItem.extras);
    const extrasTotal = extras.reduce((sum, extra) => sum + extra.price, 0);
    const basePrice = getEffectiveProductPricing(product).finalPrice;
    const unitPrice = basePrice + extrasTotal;
    const subtotal = unitPrice * cartItem.quantity;

    totalItems += cartItem.quantity;
    totalAmount += subtotal;

    const normalizedItem = {
      ...cartItem,
      extras,
      quantity: cartItem.quantity
    };

    nextCart.push(normalizedItem);

    const extrasHtml = extras.length
      ? `<ul class="cart-item-extras">${extras
          .map((extra) => `<li>${escapeHtml(extra.name)} (+${escapeHtml(formatMoney(extra.price))})</li>`)
          .join('')}</ul>`
      : '';

    const noteHtml = cartItem.note
      ? `<p class="cart-item-note">Nota: ${escapeHtml(cartItem.note)}</p>`
      : '';

    const row = document.createElement('article');
    row.className = 'cart-item';
    row.innerHTML = `
      <div>
        <h4>${escapeHtml(product.name)}</h4>
        <p class="unit">${formatMoney(unitPrice)} c/u</p>
        ${extrasHtml}
        ${noteHtml}
      </div>
      <div>
        <div class="qty-controls">
          <button class="qty-btn" data-action="decrease" data-cart-item-id="${escapeAttribute(
            cartItem.id
          )}" aria-label="Quitar uno">-</button>
          <span class="qty-value">${cartItem.quantity}</span>
          <button class="qty-btn" data-action="increase" data-cart-item-id="${escapeAttribute(
            cartItem.id
          )}" aria-label="Agregar uno">+</button>
        </div>
        <p class="item-subtotal">${formatMoney(subtotal)}</p>
      </div>
    `;

    fragment.appendChild(row);
  }

  state.cart = nextCart;

  dom.cartItems.innerHTML = '';
  if (!totalItems) {
    dom.cartItems.innerHTML = '<div class="empty-cart">Todavia no agregaste productos.</div>';
  } else {
    dom.cartItems.appendChild(fragment);
  }

  const countLabel = `${totalItems} item${totalItems === 1 ? '' : 's'}`;

  dom.cartCount.textContent = countLabel;
  dom.cartTriggerCount.textContent = String(totalItems);
  dom.floatingCartCount.textContent = String(totalItems);
  dom.cartTotal.textContent = formatMoney(totalAmount);
  dom.checkoutBtn.disabled = totalItems === 0;
}

function checkoutByWhatsapp() {
  if (!state.cart.length) return;

  const settings = state.store.settings || {};
  const phone = String(settings.whatsappNumber || '').replace(/\D/g, '');

  if (!phone) {
    alert('Configura un numero de WhatsApp valido en /admin-panel.');
    return;
  }

  let totalAmount = 0;
  const productLines = [];

  for (const cartItem of state.cart) {
    const product = getProductById(cartItem.productId);
    if (!product) continue;

    const extras = normalizeCartExtras(cartItem.extras);
    const extrasTotal = extras.reduce((sum, extra) => sum + extra.price, 0);
    const basePrice = getEffectiveProductPricing(product).finalPrice;
    const unitPrice = basePrice + extrasTotal;
    const subtotal = unitPrice * cartItem.quantity;

    totalAmount += subtotal;

    productLines.push(`- ${product.name} x${cartItem.quantity} (${formatMoney(subtotal)})`);

    if (extras.length) {
      const extrasText = extras
        .map((extra) => `${extra.name} (+${formatMoney(extra.price)})`)
        .join(', ');
      productLines.push(`  Extras: ${extrasText}`);
    }

    if (cartItem.note) {
      productLines.push(`  Comentario: ${cartItem.note}`);
    }
  }

  const lines = ['Hola! Quiero pedir:', '', '*Productos*'];
  lines.push(...(productLines.length ? productLines : ['- Sin productos validos']));
  lines.push('');
  lines.push('*Total*');
  lines.push(formatMoney(totalAmount));
  const footerText = String(settings.whatsappFooter || '').trim();
  if (footerText) {
    lines.push('');
    lines.push(footerText);
  }

  const message = lines.join('\n');
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
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
