const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT_DIR = __dirname;
const DATA_FILE = path.join(ROOT_DIR, 'data', 'store.json');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const DEFAULT_PRIMARY_COLOR = '#B8BDC6';
const DEFAULT_SECONDARY_COLOR = '#D8B062';
const ADMIN_USERNAME = sanitizeText(process.env.ADMIN_USERNAME, 'admin') || 'admin';
const ADMIN_PASSWORD = sanitizeText(process.env.ADMIN_PASSWORD, '') || 'Heavy-CREDPQWSTR';
const ADMIN_SESSION_COOKIE = 'admin_session';
const ADMIN_SESSION_TTL_MS =
  Math.max(1, Number.parseInt(process.env.ADMIN_SESSION_TTL_MINUTES || '20', 10) || 20) * 60 * 1000;

let activeAdminSession = null;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/assets', express.static(ASSETS_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS_DIR),
  filename: (_, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;
    cb(null, fileName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
      cb(new Error('Only image files are allowed.'));
      return;
    }

    cb(null, true);
  }
});

function sanitizeText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.trim();
}

function sanitizePrice(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Number(parsed.toFixed(2));
}

function normalizeProductExtras(rawExtras) {
  if (!Array.isArray(rawExtras)) return [];

  const normalized = [];

  for (let index = 0; index < rawExtras.length; index += 1) {
    const extra = rawExtras[index];
    const name = sanitizeText(extra?.name);
    const price = sanitizePrice(extra?.price);

    if (!name || price === null) continue;

    const fallbackIdBase = slugify(name) || `extra-${index + 1}`;
    const id = sanitizeText(extra?.id, `${fallbackIdBase}-${index + 1}`);

    normalized.push({
      id,
      name,
      price
    });
  }

  return normalized;
}

function parseExtrasPayload(rawExtras) {
  if (rawExtras === undefined || rawExtras === null || rawExtras === '') {
    return [];
  }

  let parsed = rawExtras;

  if (typeof rawExtras === 'string') {
    try {
      parsed = JSON.parse(rawExtras);
    } catch {
      return null;
    }
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  const normalized = [];

  for (const extra of parsed) {
    const name = sanitizeText(extra?.name);
    const price = sanitizePrice(extra?.price);

    if (!name || price === null) {
      return null;
    }

    normalized.push({
      id: makeId('extra'),
      name,
      price
    });
  }

  return normalized;
}

function sanitizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function sanitizeHexColor(value, fallback) {
  const candidate = sanitizeText(value, fallback).toUpperCase();
  return /^#[0-9A-F]{6}$/.test(candidate) ? candidate : fallback;
}

function withSettingsDefaults(settings = {}) {
  return {
    storeName: sanitizeText(settings.storeName, 'Nocturna Store') || 'Nocturna Store',
    whatsappNumber: sanitizePhone(settings.whatsappNumber || ''),
    whatsappFooter:
      sanitizeText(settings.whatsappFooter, 'Sigue disponible? Me interesa comprar por WhatsApp.') ||
      'Sigue disponible? Me interesa comprar por WhatsApp.',
    currency: sanitizeText(settings.currency, 'ARS').toUpperCase() || 'ARS',
    currencySymbol: sanitizeText(settings.currencySymbol, '$') || '$',
    primaryColor: sanitizeHexColor(settings.primaryColor, DEFAULT_PRIMARY_COLOR),
    secondaryColor: sanitizeHexColor(settings.secondaryColor, DEFAULT_SECONDARY_COLOR)
  };
}

function parseCookies(rawCookieHeader = '') {
  const jar = {};
  const parts = String(rawCookieHeader || '').split(';');

  for (const part of parts) {
    const [key, ...rest] = part.trim().split('=');
    if (!key) continue;
    const rawValue = rest.join('=') || '';
    try {
      jar[key] = decodeURIComponent(rawValue);
    } catch {
      jar[key] = rawValue;
    }
  }

  return jar;
}

function getSessionTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return sanitizeText(cookies[ADMIN_SESSION_COOKIE], '');
}

function clearExpiredAdminSession() {
  if (activeAdminSession && activeAdminSession.expiresAt <= Date.now()) {
    activeAdminSession = null;
  }
}

function sessionRemainingSeconds() {
  if (!activeAdminSession) return 0;
  return Math.max(0, Math.ceil((activeAdminSession.expiresAt - Date.now()) / 1000));
}

function setAdminCookie(res, token) {
  const maxAge = Math.ceil(ADMIN_SESSION_TTL_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
  );
}

function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function createAdminSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();

  activeAdminSession = {
    token,
    createdAt: now,
    expiresAt: now + ADMIN_SESSION_TTL_MS,
    lastSeenAt: now
  };

  return activeAdminSession;
}

function touchAdminSession() {
  if (!activeAdminSession) return;
  const now = Date.now();
  activeAdminSession.lastSeenAt = now;
  activeAdminSession.expiresAt = now + ADMIN_SESSION_TTL_MS;
}

function isRequesterSessionOwner(req) {
  clearExpiredAdminSession();

  if (!activeAdminSession) return false;

  const token = getSessionTokenFromRequest(req);
  return Boolean(token) && token === activeAdminSession.token;
}

function requireAdminAuth(req, res, next) {
  if (!isRequesterSessionOwner(req)) {
    clearAdminCookie(res);
    res.status(401).json({ error: 'Sesion de administrador requerida.' });
    return;
  }

  touchAdminSession();
  next();
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function readStore() {
  const file = await fs.readFile(DATA_FILE, 'utf8');
  return JSON.parse(file.replace(/^\uFEFF/, ''));
}

async function writeStore(store) {
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function getCategoryById(store, id) {
  return store.categories.find((category) => category.id === id);
}

async function removeImageIfNeeded(imagePath) {
  if (!imagePath || !imagePath.startsWith('/uploads/')) return;

  const filePath = path.join(ROOT_DIR, imagePath.replace(/^\//, ''));

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function ensureUncategorizedCategory(store) {
  let uncategorized = store.categories.find((category) => category.slug === 'uncategorized');

  if (!uncategorized) {
    uncategorized = {
      id: makeId('cat'),
      slug: 'uncategorized',
      name: 'Uncategorized'
    };
    store.categories.push(uncategorized);
  }

  return uncategorized;
}

app.get('/', (_, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

app.get('/admin-panel/login', (req, res) => {
  if (isRequesterSessionOwner(req)) {
    res.redirect('/admin-panel');
    return;
  }

  res.sendFile(path.join(ROOT_DIR, 'admin-panel', 'login.html'));
});

app.get('/admin-panel/login/', (req, res) => {
  if (isRequesterSessionOwner(req)) {
    res.redirect('/admin-panel');
    return;
  }

  res.sendFile(path.join(ROOT_DIR, 'admin-panel', 'login.html'));
});

app.get('/admin-panel', (req, res) => {
  if (isRequesterSessionOwner(req)) {
    touchAdminSession();
    res.sendFile(path.join(ROOT_DIR, 'admin-panel', 'index.html'));
    return;
  }

  res.redirect('/admin-panel/login');
});

app.get('/admin-panel/', (req, res) => {
  if (isRequesterSessionOwner(req)) {
    touchAdminSession();
    res.sendFile(path.join(ROOT_DIR, 'admin-panel', 'index.html'));
    return;
  }

  res.redirect('/admin-panel/login');
});

app.get('/api/admin/session', (req, res) => {
  clearExpiredAdminSession();

  if (!activeAdminSession) {
    clearAdminCookie(res);
    res.json({
      authenticated: false,
      locked: false,
      sessionTtlMinutes: Math.round(ADMIN_SESSION_TTL_MS / 60000)
    });
    return;
  }

  if (isRequesterSessionOwner(req)) {
    touchAdminSession();
    res.json({
      authenticated: true,
      locked: true,
      expiresInSeconds: sessionRemainingSeconds(),
      sessionTtlMinutes: Math.round(ADMIN_SESSION_TTL_MS / 60000)
    });
    return;
  }

  res.status(423).json({
    authenticated: false,
    locked: true,
    retryAfterSeconds: sessionRemainingSeconds(),
    error: 'El panel ya esta en uso por otro administrador.'
  });
});

app.post('/api/admin/login', (req, res) => {
  const username = sanitizeText(req.body.username);
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Credenciales invalidas.' });
    return;
  }

  clearExpiredAdminSession();

  if (activeAdminSession) {
    if (isRequesterSessionOwner(req)) {
      touchAdminSession();
      setAdminCookie(res, activeAdminSession.token);
      res.json({
        authenticated: true,
        expiresInSeconds: sessionRemainingSeconds(),
        sessionTtlMinutes: Math.round(ADMIN_SESSION_TTL_MS / 60000)
      });
      return;
    }

    res.status(423).json({
      error: 'El panel ya esta en uso por otro administrador. Espera logout o expiracion.',
      retryAfterSeconds: sessionRemainingSeconds()
    });
    return;
  }

  const session = createAdminSession();
  setAdminCookie(res, session.token);

  res.json({
    authenticated: true,
    expiresInSeconds: sessionRemainingSeconds(),
    sessionTtlMinutes: Math.round(ADMIN_SESSION_TTL_MS / 60000)
  });
});

app.post('/api/admin/heartbeat', requireAdminAuth, (_, res) => {
  res.json({
    ok: true,
    expiresInSeconds: sessionRemainingSeconds(),
    sessionTtlMinutes: Math.round(ADMIN_SESSION_TTL_MS / 60000)
  });
});

app.post('/api/admin/logout', (req, res) => {
  if (isRequesterSessionOwner(req)) {
    activeAdminSession = null;
  }

  clearAdminCookie(res);
  res.json({ ok: true });
});

app.get('/api/store', async (_, res) => {
  try {
    const store = await readStore();
    store.settings = withSettingsDefaults(store.settings);
    store.products = Array.isArray(store.products)
      ? store.products.map((product) => ({
          ...product,
          extras: normalizeProductExtras(product.extras)
        }))
      : [];
    res.json(store);
  } catch {
    res.status(500).json({ error: 'Could not read store data.' });
  }
});

app.put('/api/settings', requireAdminAuth, async (req, res) => {
  try {
    const store = await readStore();
    const currentSettings = withSettingsDefaults(store.settings);

    const storeName = sanitizeText(req.body.storeName, currentSettings.storeName);
    const whatsappNumber = sanitizePhone(req.body.whatsappNumber || currentSettings.whatsappNumber);
    const whatsappFooter = sanitizeText(req.body.whatsappFooter, currentSettings.whatsappFooter);
    const currency = sanitizeText(req.body.currency, currentSettings.currency).toUpperCase();
    const currencySymbol = sanitizeText(req.body.currencySymbol, currentSettings.currencySymbol);
    const primaryColor = sanitizeHexColor(req.body.primaryColor, currentSettings.primaryColor);
    const secondaryColor = sanitizeHexColor(req.body.secondaryColor, currentSettings.secondaryColor);

    if (
      !storeName ||
      !whatsappNumber ||
      !whatsappFooter ||
      !currency ||
      !currencySymbol ||
      !primaryColor ||
      !secondaryColor
    ) {
      res.status(400).json({ error: 'Invalid settings payload.' });
      return;
    }

    store.settings = {
      ...currentSettings,
      storeName,
      whatsappNumber,
      whatsappFooter,
      currency,
      currencySymbol,
      primaryColor,
      secondaryColor
    };

    await writeStore(store);
    res.json(store.settings);
  } catch {
    res.status(500).json({ error: 'Could not update settings.' });
  }
});

app.post('/api/categories', requireAdminAuth, async (req, res) => {
  try {
    const store = await readStore();
    const name = sanitizeText(req.body.name);

    if (!name) {
      res.status(400).json({ error: 'Category name is required.' });
      return;
    }

    const exists = store.categories.some((category) => category.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      res.status(409).json({ error: 'Category already exists.' });
      return;
    }

    const category = {
      id: makeId('cat'),
      slug: slugify(name) || makeId('cat'),
      name
    };

    store.categories.push(category);
    await writeStore(store);

    res.status(201).json(category);
  } catch {
    res.status(500).json({ error: 'Could not create category.' });
  }
});

app.put('/api/categories/:id', requireAdminAuth, async (req, res) => {
  try {
    const store = await readStore();
    const categoryId = req.params.id;
    const name = sanitizeText(req.body.name);

    if (!name) {
      res.status(400).json({ error: 'Category name is required.' });
      return;
    }

    const category = getCategoryById(store, categoryId);
    if (!category) {
      res.status(404).json({ error: 'Category not found.' });
      return;
    }

    const exists = store.categories.some(
      (item) => item.id !== categoryId && item.name.toLowerCase() === name.toLowerCase()
    );

    if (exists) {
      res.status(409).json({ error: 'Category already exists.' });
      return;
    }

    category.name = name;
    category.slug = slugify(name) || category.slug;

    await writeStore(store);
    res.json(category);
  } catch {
    res.status(500).json({ error: 'Could not update category.' });
  }
});

app.delete('/api/categories/:id', requireAdminAuth, async (req, res) => {
  try {
    const store = await readStore();
    const categoryId = req.params.id;

    const index = store.categories.findIndex((category) => category.id === categoryId);
    if (index === -1) {
      res.status(404).json({ error: 'Category not found.' });
      return;
    }

    const hasLinkedProducts = store.products.some((product) => product.categoryId === categoryId);
    let uncategorized = null;

    if (hasLinkedProducts) {
      uncategorized = ensureUncategorizedCategory(store);

      for (const product of store.products) {
        if (product.categoryId === categoryId) {
          product.categoryId = uncategorized.id;
        }
      }
    }

    store.categories.splice(index, 1);
    await writeStore(store);

    res.status(204).end();
  } catch {
    res.status(500).json({ error: 'Could not delete category.' });
  }
});

app.post('/api/products', requireAdminAuth, upload.single('image'), async (req, res) => {
  try {
    const store = await readStore();

    const name = sanitizeText(req.body.name);
    const description = sanitizeText(req.body.description);
    const categoryId = sanitizeText(req.body.categoryId);
    const price = sanitizePrice(req.body.price);
    const extras = parseExtrasPayload(req.body.extras);

    if (!name || !categoryId || price === null) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(400).json({ error: 'Name, category and price are required.' });
      return;
    }

    if (extras === null) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(400).json({ error: 'Invalid extras payload.' });
      return;
    }

    const category = getCategoryById(store, categoryId);
    if (!category) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(404).json({ error: 'Category not found.' });
      return;
    }

    const product = {
      id: makeId('prod'),
      name,
      description,
      price,
      categoryId,
      extras,
      image: req.file ? `/uploads/${req.file.filename}` : '',
      createdAt: new Date().toISOString()
    };

    store.products.push(product);
    await writeStore(store);

    res.status(201).json(product);
  } catch {
    if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
    res.status(500).json({ error: 'Could not create product.' });
  }
});

app.put('/api/products/:id', requireAdminAuth, upload.single('image'), async (req, res) => {
  try {
    const store = await readStore();
    const productId = req.params.id;

    const product = store.products.find((item) => item.id === productId);
    if (!product) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    const name = sanitizeText(req.body.name, product.name);
    const description = sanitizeText(req.body.description, product.description);
    const categoryId = sanitizeText(req.body.categoryId, product.categoryId);
    const price = req.body.price !== undefined ? sanitizePrice(req.body.price) : product.price;
    const extras =
      req.body.extras !== undefined
        ? parseExtrasPayload(req.body.extras)
        : normalizeProductExtras(product.extras);
    const removeImage = String(req.body.removeImage || 'false') === 'true';

    if (!name || price === null || !categoryId) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(400).json({ error: 'Name, category and price are required.' });
      return;
    }

    if (extras === null) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(400).json({ error: 'Invalid extras payload.' });
      return;
    }

    const category = getCategoryById(store, categoryId);
    if (!category) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(404).json({ error: 'Category not found.' });
      return;
    }

    const previousImage = product.image;

    product.name = name;
    product.description = description;
    product.price = price;
    product.categoryId = categoryId;
    product.extras = extras;

    if (req.file) {
      product.image = `/uploads/${req.file.filename}`;
    } else if (removeImage) {
      product.image = '';
    }

    await writeStore(store);

    if ((req.file || removeImage) && previousImage !== product.image) {
      await removeImageIfNeeded(previousImage);
    }

    res.json(product);
  } catch {
    if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
    res.status(500).json({ error: 'Could not update product.' });
  }
});

app.delete('/api/products/:id', requireAdminAuth, async (req, res) => {
  try {
    const store = await readStore();
    const productId = req.params.id;

    const index = store.products.findIndex((item) => item.id === productId);
    if (index === -1) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    const [removed] = store.products.splice(index, 1);
    await writeStore(store);
    await removeImageIfNeeded(removed.image);

    res.status(204).end();
  } catch {
    res.status(500).json({ error: 'Could not delete product.' });
  }
});

app.use((error, _, res, __) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (error?.message === 'Only image files are allowed.') {
    res.status(400).json({ error: error.message });
    return;
  }

  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
