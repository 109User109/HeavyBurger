const state = {
  store: null,
  selectedCategoryId: 'all',
  searchTerm: '',
  cart: new Map(),
  cartOpen: false,
  toastTimerId: null
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
  cartToast: document.getElementById('cart-toast')
};

init().catch((error) => {
  console.error(error);
  dom.productsGrid.innerHTML = '<p class="no-results">No se pudo cargar la tienda.</p>';
});

async function init() {
  bindEvents();
  initVisualEffects();
  await loadStore();
  setCartOpen(false);
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

    addToCart(button.dataset.productId);
  });

  dom.cartItems.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const productId = button.dataset.productId;
    const action = button.dataset.action;

    if (action === 'increase') updateCartQuantity(productId, 1);
    if (action === 'decrease') updateCartQuantity(productId, -1);
  });

  dom.openCartBtn.addEventListener('click', () => setCartOpen(true));
  dom.floatingCartBtn.addEventListener('click', () => setCartOpen(true));
  dom.closeCartBtn.addEventListener('click', () => setCartOpen(false));
  dom.cartBackdrop.addEventListener('click', () => setCartOpen(false));

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
    if (event.key === 'Escape') {
      if (state.cartOpen) setCartOpen(false);
      if (dom.topnav?.classList.contains('is-open')) closeTopNav();
    }
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
      thumb.innerHTML = `<img src="${escapeAttribute(product.image)}" alt="${escapeAttribute(product.name)}" loading="lazy" />`;
    } else {
      thumb.textContent = 'Sin imagen';
    }

    node.querySelector('.category').textContent = getCategoryName(product.categoryId);
    node.querySelector('h3').textContent = product.name;
    node.querySelector('.description').textContent = product.description || 'Sin descripcion';
    node.querySelector('.price').textContent = formatMoney(product.price);

    const addButton = node.querySelector('.add-btn');
    addButton.dataset.productId = product.id;

    card.dataset.productId = product.id;
    fragment.appendChild(node);
  }

  dom.productsGrid.appendChild(fragment);
}

function addToCart(productId) {
  const currentQty = state.cart.get(productId) || 0;
  state.cart.set(productId, currentQty + 1);
  const product = state.store?.products?.find((item) => item.id === productId);
  showCartToast(`${product?.name || 'Producto'} agregado al carrito`);
  renderCart();
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

function updateCartQuantity(productId, delta) {
  const currentQty = state.cart.get(productId) || 0;
  const nextQty = currentQty + delta;

  if (nextQty <= 0) {
    state.cart.delete(productId);
  } else {
    state.cart.set(productId, nextQty);
  }

  renderCart();
}

function renderCart() {
  if (!state.store) return;

  const fragment = document.createDocumentFragment();
  let totalItems = 0;
  let totalAmount = 0;

  for (const [productId, qty] of state.cart.entries()) {
    const product = state.store.products.find((item) => item.id === productId);
    if (!product) {
      state.cart.delete(productId);
      continue;
    }

    totalItems += qty;
    const subtotal = product.price * qty;
    totalAmount += subtotal;

    const row = document.createElement('article');
    row.className = 'cart-item';
    row.innerHTML = `
      <div>
        <h4>${escapeHtml(product.name)}</h4>
        <p class="unit">${formatMoney(product.price)} c/u</p>
      </div>
      <div>
        <div class="qty-controls">
          <button class="qty-btn" data-action="decrease" data-product-id="${product.id}" aria-label="Quitar uno">-</button>
          <span class="qty-value">${qty}</span>
          <button class="qty-btn" data-action="increase" data-product-id="${product.id}" aria-label="Agregar uno">+</button>
        </div>
        <p class="item-subtotal">${formatMoney(subtotal)}</p>
      </div>
    `;

    fragment.appendChild(row);
  }

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
  const cartEntries = Array.from(state.cart.entries());
  if (!cartEntries.length) return;

  const settings = state.store.settings || {};
  const phone = String(settings.whatsappNumber || '').replace(/\D/g, '');

  if (!phone) {
    alert('Configura un numero de WhatsApp valido en /admin-panel.');
    return;
  }

  let totalAmount = 0;
  const lines = [
    `Hola! Quiero consultar/comprar estos productos en ${settings.storeName || 'la tienda'}:`,
    ''
  ];

  for (const [productId, qty] of cartEntries) {
    const product = state.store.products.find((item) => item.id === productId);
    if (!product) continue;

    const subtotal = product.price * qty;
    totalAmount += subtotal;
    lines.push(`- ${product.name} x${qty} (${formatMoney(subtotal)})`);
  }

  lines.push('');
  lines.push(`Total estimado: ${formatMoney(totalAmount)}`);
  lines.push('');
  lines.push(settings.whatsappFooter || 'Sigue disponible?');

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
