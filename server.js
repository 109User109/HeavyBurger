const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');


// Revisar feedback, retroalimentacion para el usuario: App y panel de administracion

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT_DIR = __dirname;
const PERSISTENT_STORAGE_PATH = sanitizeText(
  process.env.PERSISTENT_STORAGE_PATH || process.env.RENDER_DISK_MOUNT_PATH,
  ''
);
const STORAGE_ROOT = PERSISTENT_STORAGE_PATH ? path.resolve(PERSISTENT_STORAGE_PATH) : ROOT_DIR;
const DATA_DIR = path.join(STORAGE_ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const UPLOADS_DIR = path.join(STORAGE_ROOT, 'uploads');

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const ALLOWED_PROMOTION_TYPES = new Set(['percentage', 'fixed_price']);
const PRODUCT_MODE_SINGLE = 'single';
const PRODUCT_MODE_VARIANTS = 'variants';
const ALLOWED_PRODUCT_MODES = new Set([PRODUCT_MODE_SINGLE, PRODUCT_MODE_VARIANTS]);
const DEFAULT_PRIMARY_COLOR = '#15314B';
const DEFAULT_SECONDARY_COLOR = '#2E7EB8';
const ADMIN_USERNAME = sanitizeText(process.env.ADMIN_USERNAME, 'admin') || 'admin';
const ADMIN_PASSWORD = sanitizeText(process.env.ADMIN_PASSWORD, '') || 'Heavy-CREDPQWSTR';
const ADMIN_SESSION_COOKIE = 'admin_session';
const ADMIN_COOKIE_SECURE =
  sanitizeText(process.env.ADMIN_COOKIE_SECURE, process.env.NODE_ENV === 'production' ? 'true' : 'false')
    .toLowerCase() === 'true';
const ADMIN_SESSION_TTL_MS =
  Math.max(1, Number.parseInt(process.env.ADMIN_SESSION_TTL_MINUTES || '20', 10) || 20) * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS =
  Math.max(1, Number.parseInt(process.env.ADMIN_LOGIN_MAX_ATTEMPTS || '5', 10) || 5);
const LOGIN_RATE_LIMIT_WINDOW_MS =
  Math.max(1, Number.parseInt(process.env.ADMIN_LOGIN_WINDOW_MINUTES || '10', 10) || 10) * 60 * 1000;
const LOGIN_RATE_LIMIT_BLOCK_MS =
  Math.max(1, Number.parseInt(process.env.ADMIN_LOGIN_BLOCK_MINUTES || '10', 10) || 10) * 60 * 1000;
const TRUST_PROXY_HOPS = Math.max(0, Number.parseInt(process.env.TRUST_PROXY_HOPS || '1', 10) || 1);
const PROMOTION_CLEANUP_INTERVAL_MS =
  Math.max(1, Number.parseInt(process.env.PROMOTION_CLEANUP_INTERVAL_SECONDS || '60', 10) || 60) * 1000;

let activeAdminSession = null;
let storeWriteQueue = Promise.resolve();
const failedLoginAttempts = new Map();

app.set('trust proxy', TRUST_PROXY_HOPS);
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
    const mimetype = sanitizeText(file.mimetype, '').toLowerCase();

    if (!ALLOWED_IMAGE_EXTENSIONS.has(extension) || !ALLOWED_IMAGE_MIME_TYPES.has(mimetype)) {
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

function normalizeProductVariants(rawVariants) {
  if (!Array.isArray(rawVariants)) return [];

  const normalized = [];

  for (let index = 0; index < rawVariants.length; index += 1) {
    const variant = rawVariants[index];
    const name = sanitizeText(variant?.name);
    const price = sanitizePrice(variant?.price);

    if (!name || price === null) continue;

    const fallbackIdBase = slugify(name) || `variant-${index + 1}`;
    const id = sanitizeText(variant?.id, `${fallbackIdBase}-${index + 1}`);

    normalized.push({
      id,
      name,
      price
    });
  }

  return normalized;
}

function parseVariantsPayload(rawVariants) {
  if (rawVariants === undefined || rawVariants === null || rawVariants === '') {
    return [];
  }

  let parsed = rawVariants;

  if (typeof rawVariants === 'string') {
    try {
      parsed = JSON.parse(rawVariants);
    } catch {
      return null;
    }
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  const normalized = [];

  for (const variant of parsed) {
    const name = sanitizeText(variant?.name);
    const price = sanitizePrice(variant?.price);

    if (!name || price === null) {
      return null;
    }

    normalized.push({
      id: makeId('variant'),
      name,
      price
    });
  }

  return normalized;
}

function resolveProductMode(rawMode, variants = []) {
  const mode = sanitizeText(rawMode, '').toLowerCase();

  if (!ALLOWED_PRODUCT_MODES.has(mode)) {
    return variants.length ? PRODUCT_MODE_VARIANTS : PRODUCT_MODE_SINGLE;
  }

  if (mode === PRODUCT_MODE_VARIANTS) {
    return variants.length ? PRODUCT_MODE_VARIANTS : PRODUCT_MODE_SINGLE;
  }

  if (mode === PRODUCT_MODE_SINGLE) return PRODUCT_MODE_SINGLE;

  return variants.length ? PRODUCT_MODE_VARIANTS : PRODUCT_MODE_SINGLE;
}

function normalizeProductForStore(rawProduct = {}, nowMs = Date.now()) {
  const product = rawProduct && typeof rawProduct === 'object' ? rawProduct : {};
  const variants = normalizeProductVariants(product.variants);
  const productMode = resolveProductMode(product.productMode, variants);
  const basePrice =
    productMode === PRODUCT_MODE_VARIANTS && variants.length
      ? variants[0].price
      : sanitizePrice(product.price);
  const safePrice = basePrice === null ? 0 : basePrice;
  const normalizedPromotion = normalizeStoredPromotion(product.promotion, safePrice, nowMs);

  const normalized = {
    ...product,
    productMode,
    variants: productMode === PRODUCT_MODE_VARIANTS ? variants : [],
    extras: normalizeProductExtras(product.extras),
    price: safePrice
  };

  if (normalizedPromotion) {
    normalized.promotion = normalizedPromotion;
  } else {
    delete normalized.promotion;
  }

  return normalized;
}

function parsePromotionDate(value) {
  const rawValue = sanitizeText(value, '');
  if (!rawValue) return null;

  const timestamp = Date.parse(rawValue);
  if (!Number.isFinite(timestamp)) return null;

  return new Date(timestamp).toISOString();
}

function normalizeStoredPromotion(rawPromotion, basePrice, nowMs = Date.now()) {
  if (!rawPromotion || typeof rawPromotion !== 'object') return null;

  const type = sanitizeText(rawPromotion.type, '').toLowerCase();
  if (!ALLOWED_PROMOTION_TYPES.has(type)) return null;

  const startAt = parsePromotionDate(rawPromotion.startAt || rawPromotion.startDate);
  const endAt = parsePromotionDate(rawPromotion.endAt || rawPromotion.endDate);

  if (!startAt || !endAt) return null;

  const startTimestamp = Date.parse(startAt);
  const endTimestamp = Date.parse(endAt);

  if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp) || startTimestamp >= endTimestamp) {
    return null;
  }

  if (nowMs > endTimestamp) {
    return null;
  }

  if (type === 'percentage') {
    const percentage = Number(rawPromotion.discountPercentage ?? rawPromotion.percentage);
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) return null;

    return {
      type: 'percentage',
      discountPercentage: Number(percentage.toFixed(2)),
      startAt,
      endAt
    };
  }

  const promotionalPrice = sanitizePrice(rawPromotion.promotionalPrice ?? rawPromotion.price);
  if (promotionalPrice === null) return null;
  if (!Number.isFinite(basePrice) || promotionalPrice >= basePrice) return null;

  return {
    type: 'fixed_price',
    promotionalPrice,
    startAt,
    endAt
  };
}

function parsePromotionPayload(rawPromotion, basePrice, nowMs = Date.now()) {
  if (rawPromotion === undefined || rawPromotion === null || rawPromotion === '') {
    return { ok: true, promotion: null };
  }

  let parsed = rawPromotion;

  if (typeof rawPromotion === 'string') {
    try {
      parsed = JSON.parse(rawPromotion);
    } catch {
      return { ok: false, error: 'Payload de promocion invalido.' };
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Payload de promocion invalido.' };
  }

  if (parsed.enabled === false) {
    return { ok: true, promotion: null };
  }

  const normalized = normalizeStoredPromotion(parsed, basePrice, nowMs);
  if (!normalized) {
    return { ok: false, error: 'Datos de promocion invalidos.' };
  }

  const endTimestamp = Date.parse(normalized.endAt);
  if (nowMs > endTimestamp) {
    return { ok: false, error: 'La fecha de fin de promocion debe estar en el futuro.' };
  }

  return { ok: true, promotion: normalized };
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

function buildInitialStore() {
  return {
    settings: withSettingsDefaults({}),
    categories: [],
    products: []
  };
}

function getRequesterIp(req) {
  const forwarded = req.headers['x-forwarded-for'];

  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  if (Array.isArray(forwarded) && forwarded.length) {
    return String(forwarded[0] || '')
      .split(',')[0]
      .trim();
  }

  return sanitizeText(req.ip || req.socket?.remoteAddress || 'unknown-ip', 'unknown-ip');
}

function clearExpiredLoginRateState() {
  const now = Date.now();
  const retentionMs = LOGIN_RATE_LIMIT_WINDOW_MS + LOGIN_RATE_LIMIT_BLOCK_MS;

  for (const [key, record] of failedLoginAttempts.entries()) {
    const lastSeen = Math.max(record.firstAttemptAt || 0, record.blockedUntil || 0);
    if (now - lastSeen > retentionMs) {
      failedLoginAttempts.delete(key);
    }
  }
}

function getLoginRateLimitRemainingSeconds(req) {
  clearExpiredLoginRateState();

  const key = getRequesterIp(req);
  const record = failedLoginAttempts.get(key);
  if (!record) return 0;

  const now = Date.now();
  if (!record.blockedUntil || record.blockedUntil <= now) return 0;

  return Math.max(1, Math.ceil((record.blockedUntil - now) / 1000));
}

function registerFailedLoginAttempt(req) {
  clearExpiredLoginRateState();

  const now = Date.now();
  const key = getRequesterIp(req);
  const record = failedLoginAttempts.get(key);

  let nextRecord = record;
  if (!record || !record.firstAttemptAt || now - record.firstAttemptAt > LOGIN_RATE_LIMIT_WINDOW_MS) {
    nextRecord = {
      firstAttemptAt: now,
      attempts: 0,
      blockedUntil: 0
    };
  }

  nextRecord.attempts += 1;

  if (nextRecord.attempts >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    nextRecord.firstAttemptAt = now;
    nextRecord.attempts = 0;
    nextRecord.blockedUntil = now + LOGIN_RATE_LIMIT_BLOCK_MS;
  }

  failedLoginAttempts.set(key, nextRecord);

  if (nextRecord.blockedUntil > now) {
    return Math.max(1, Math.ceil((nextRecord.blockedUntil - now) / 1000));
  }

  return 0;
}

function clearFailedLoginAttempts(req) {
  failedLoginAttempts.delete(getRequesterIp(req));
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
  const secureSegment = ADMIN_COOKIE_SECURE ? '; Secure' : '';

  res.setHeader(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureSegment}`
  );
}

function clearAdminCookie(res) {
  const secureSegment = ADMIN_COOKIE_SECURE ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureSegment}`);
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

async function ensureStorageBootstrap() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });

  try {
    await fs.access(DATA_FILE);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }

    const legacyDataFile = path.join(ROOT_DIR, 'data', 'store.json');

    if (STORAGE_ROOT !== ROOT_DIR) {
      try {
        const legacyPayload = await fs.readFile(legacyDataFile, 'utf8');
        await atomicWriteFile(DATA_FILE, legacyPayload);
        return;
      } catch (legacyError) {
        if (legacyError?.code !== 'ENOENT') {
          throw legacyError;
        }
      }
    }

    await atomicWriteFile(DATA_FILE, JSON.stringify(buildInitialStore(), null, 2));
  }

  await seedUploadsFromLegacyIfNeeded();
}

async function seedUploadsFromLegacyIfNeeded() {
  if (STORAGE_ROOT === ROOT_DIR) return;

  const legacyUploadsDir = path.join(ROOT_DIR, 'uploads');

  let legacyEntries = [];
  try {
    legacyEntries = await fs.readdir(legacyUploadsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  const uploadEntries = await fs.readdir(UPLOADS_DIR, { withFileTypes: true });
  const hasFilesAlready = uploadEntries.some((entry) => entry.isFile() && entry.name !== '.gitkeep');
  if (hasFilesAlready) return;

  for (const entry of legacyEntries) {
    if (!entry.isFile()) continue;
    if (entry.name === '.gitkeep') continue;

    const sourcePath = path.join(legacyUploadsDir, entry.name);
    const targetPath = path.join(UPLOADS_DIR, entry.name);

    try {
      await fs.copyFile(sourcePath, targetPath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
  }
}

function applyProductCleanup(store, nowMs = Date.now()) {
  if (!Array.isArray(store?.products)) return false;

  let didChange = false;
  const normalizedProducts = [];

  for (const product of store.products) {
    const normalizedProduct = normalizeProductForStore(product, nowMs);
    normalizedProducts.push(normalizedProduct);

    if (JSON.stringify(product) !== JSON.stringify(normalizedProduct)) {
      didChange = true;
    }
  }

  if (didChange) {
    store.products = normalizedProducts;
  }

  return didChange;
}

async function readStoreWithPromotionCleanup() {
  const store = await readStore();
  const didChange = applyProductCleanup(store);
  if (didChange) {
    await writeStore(store);
  }

  return store;
}

async function writeStore(store) {
  const payload = JSON.stringify(store, null, 2);

  const writeJob = storeWriteQueue.then(() => atomicWriteFile(DATA_FILE, payload));
  storeWriteQueue = writeJob.catch(() => undefined);

  await writeJob;
}

async function atomicWriteFile(filePath, payload) {
  const directory = path.dirname(filePath);
  const tempName = `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.round(Math.random() * 1e6)}.tmp`;
  const tempPath = path.join(directory, tempName);

  try {
    await fs.writeFile(tempPath, payload, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignorar cleanup
    }

    throw error;
  }
}

async function cleanupExpiredPromotionsInStoreFile() {
  try {
    const store = await readStore();
    const didChange = applyProductCleanup(store);
    if (!didChange) return;

    await writeStore(store);
  } catch (error) {
    console.error('Promotion cleanup error:', error);
  }
}

function getCategoryById(store, id) {
  return store.categories.find((category) => category.id === id);
}

async function removeImageIfNeeded(imagePath) {
  if (!imagePath || !imagePath.startsWith('/uploads/')) return;

  const filename = path.basename(imagePath);
  if (!filename) return;

  const filePath = path.join(UPLOADS_DIR, filename);

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function bufferStartsWith(buffer, signature) {
  if (!Buffer.isBuffer(buffer) || !Array.isArray(signature)) return false;
  if (buffer.length < signature.length) return false;

  for (let index = 0; index < signature.length; index += 1) {
    if (buffer[index] !== signature[index]) return false;
  }

  return true;
}

async function hasValidImageSignature(filePath, extension) {
  const fileHandle = await fs.open(filePath, 'r');

  try {
    const maxBytes = 32;
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await fileHandle.read(buffer, 0, maxBytes, 0);
    const chunk = buffer.subarray(0, bytesRead);

    if (extension === '.png') {
      return bufferStartsWith(chunk, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }

    if (extension === '.jpg' || extension === '.jpeg') {
      return bufferStartsWith(chunk, [0xff, 0xd8, 0xff]);
    }

    if (extension === '.gif') {
      const header = chunk.toString('ascii', 0, 6);
      return header === 'GIF87a' || header === 'GIF89a';
    }

    if (extension === '.webp') {
      const riffHeader = chunk.toString('ascii', 0, 4);
      const webpHeader = chunk.toString('ascii', 8, 12);
      return riffHeader === 'RIFF' && webpHeader === 'WEBP';
    }

    return false;
  } finally {
    await fileHandle.close();
  }
}

async function ensureUploadedImageIsSafe(file) {
  if (!file) return true;

  const extension = path.extname(file.originalname || file.filename || '').toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) return false;

  const mimetype = sanitizeText(file.mimetype, '').toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimetype)) return false;

  return hasValidImageSignature(file.path, extension);
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

app.get('/healthz', (_, res) => {
  res.json({ ok: true });
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
  const rateLimitSeconds = getLoginRateLimitRemainingSeconds(req);

  if (rateLimitSeconds > 0) {
    res.setHeader('Retry-After', String(rateLimitSeconds));
    res.status(429).json({
      error: 'Demasiados intentos de login. Espera e intenta de nuevo.',
      retryAfterSeconds: rateLimitSeconds
    });
    return;
  }

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    const blockedSeconds = registerFailedLoginAttempt(req);
    if (blockedSeconds > 0) {
      res.setHeader('Retry-After', String(blockedSeconds));
      res.status(429).json({
        error: 'Demasiados intentos de login. Espera e intenta de nuevo.',
        retryAfterSeconds: blockedSeconds
      });
      return;
    }

    res.status(401).json({ error: 'Credenciales invalidas.' });
    return;
  }

  clearFailedLoginAttempts(req);

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
    const store = await readStoreWithPromotionCleanup();
    store.settings = withSettingsDefaults(store.settings);
    store.products = Array.isArray(store.products)
      ? store.products.map((product) => normalizeProductForStore(product))
      : [];
    res.json(store);
  } catch {
    res.status(500).json({ error: 'Could not read store data.' });
  }
});

app.put('/api/settings', requireAdminAuth, async (req, res) => {
  try {
    const store = await readStoreWithPromotionCleanup();
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
    const store = await readStoreWithPromotionCleanup();
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
    const store = await readStoreWithPromotionCleanup();
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
    const store = await readStoreWithPromotionCleanup();
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
    if (!(await ensureUploadedImageIsSafe(req.file))) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(400).json({ error: 'Invalid image file.' });
      return;
    }

    const store = await readStoreWithPromotionCleanup();

    const name = sanitizeText(req.body.name);
    const description = sanitizeText(req.body.description);
    const categoryId = sanitizeText(req.body.categoryId);
    const parsedVariants = parseVariantsPayload(req.body.variants);
    const requestedMode = sanitizeText(req.body.productMode, PRODUCT_MODE_SINGLE).toLowerCase();
    const productMode = resolveProductMode(requestedMode, Array.isArray(parsedVariants) ? parsedVariants : []);
    const variants = productMode === PRODUCT_MODE_VARIANTS ? parsedVariants : [];
    const price =
      productMode === PRODUCT_MODE_VARIANTS ? Number(variants?.[0]?.price) : sanitizePrice(req.body.price);
    const extras = parseExtrasPayload(req.body.extras);
    const promotionResult = parsePromotionPayload(req.body.promotion, Number(price));

    if (parsedVariants === null) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(400).json({ error: 'Invalid variants payload.' });
      return;
    }

    if (!name || !categoryId || price === null || !Number.isFinite(price)) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(400).json({ error: 'Name, category and price are required.' });
      return;
    }

    if (productMode === PRODUCT_MODE_VARIANTS && (!Array.isArray(variants) || !variants.length)) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(400).json({ error: 'Variants are required for variant products.' });
      return;
    }

    if (extras === null) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(400).json({ error: 'Invalid extras payload.' });
      return;
    }

    if (!promotionResult.ok) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(400).json({ error: promotionResult.error });
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
      productMode,
      variants: productMode === PRODUCT_MODE_VARIANTS ? variants : [],
      categoryId,
      extras,
      image: req.file ? `/uploads/${req.file.filename}` : '',
      createdAt: new Date().toISOString()
    };

    if (promotionResult.promotion) {
      product.promotion = promotionResult.promotion;
    }

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
    if (!(await ensureUploadedImageIsSafe(req.file))) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(400).json({ error: 'Invalid image file.' });
      return;
    }

    const store = await readStoreWithPromotionCleanup();
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
    const existingVariants = normalizeProductVariants(product.variants);
    const fallbackMode = resolveProductMode(product.productMode, existingVariants);
    const requestedMode =
      req.body.productMode !== undefined
        ? sanitizeText(req.body.productMode, fallbackMode).toLowerCase()
        : fallbackMode;
    const parsedVariants =
      req.body.variants !== undefined ? parseVariantsPayload(req.body.variants) : existingVariants;
    const productMode = resolveProductMode(requestedMode, Array.isArray(parsedVariants) ? parsedVariants : []);
    const variants = productMode === PRODUCT_MODE_VARIANTS ? parsedVariants : [];
    const price =
      productMode === PRODUCT_MODE_VARIANTS
        ? Number(variants?.[0]?.price)
        : req.body.price !== undefined
          ? sanitizePrice(req.body.price)
          : sanitizePrice(product.price);
    const extras =
      req.body.extras !== undefined
        ? parseExtrasPayload(req.body.extras)
        : normalizeProductExtras(product.extras);
    const promotionResult =
      req.body.promotion !== undefined
        ? parsePromotionPayload(req.body.promotion, Number(price))
        : { ok: true, promotion: normalizeStoredPromotion(product.promotion, Number(price)) };
    const removeImage = String(req.body.removeImage || 'false') === 'true';

    if (parsedVariants === null) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(400).json({ error: 'Invalid variants payload.' });
      return;
    }

    if (!name || price === null || !Number.isFinite(price) || !categoryId) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(400).json({ error: 'Name, category and price are required.' });
      return;
    }

    if (productMode === PRODUCT_MODE_VARIANTS && (!Array.isArray(variants) || !variants.length)) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(400).json({ error: 'Variants are required for variant products.' });
      return;
    }

    if (extras === null) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(400).json({ error: 'Invalid extras payload.' });
      return;
    }

    if (!promotionResult.ok) {
      if (req.file) await removeImageIfNeeded(`/uploads/${req.file.filename}`);
      res.status(400).json({ error: promotionResult.error });
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
    product.productMode = productMode;
    product.variants = productMode === PRODUCT_MODE_VARIANTS ? variants : [];
    product.categoryId = categoryId;
    product.extras = extras;
    if (promotionResult.promotion) {
      product.promotion = promotionResult.promotion;
    } else {
      delete product.promotion;
    }

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
    const store = await readStoreWithPromotionCleanup();
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
  console.error(error);

  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (error?.message === 'Only image files are allowed.') {
    res.status(400).json({ error: error.message });
    return;
  }

  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON payload.' });
    return;
  }

  res.status(500).json({ error: 'Unexpected server error.' });
});

async function startServer() {
  await ensureStorageBootstrap();

  if (process.env.NODE_ENV === 'production' && ADMIN_PASSWORD === 'Heavy-CREDPQWSTR') {
    console.warn('WARNING: ADMIN_PASSWORD is using the default value in production.');
  }

  await cleanupExpiredPromotionsInStoreFile();
  setInterval(cleanupExpiredPromotionsInStoreFile, PROMOTION_CLEANUP_INTERVAL_MS);

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Storage root: ${STORAGE_ROOT}`);
  });
}

startServer().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
