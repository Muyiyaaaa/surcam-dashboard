// surcam-webviewer 只读同步脚本
// 原则：只用本账号 token 做 GET 读取（写操作/权益接口一律不碰），
//       拉取结果增量合并到本地存储，可选 AES-GCM 加密后写入 docs/data/ 供 GitHub Pages 使用。
// 用法：node sync.js   （配置见 config.json，参考 config.example.json）
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'docs', 'data');
const ENC_FILE = path.join(DATA_DIR, 'data.enc');
const PLAIN_FILE = path.join(DATA_DIR, 'data.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const STORE_BYTES_CAP = 6 * 1024 * 1024; // 超过则从最旧的行程明细开始剥离轨迹

// ---------- 配置 ----------
function loadConfig() {
  const cfgPath = path.join(__dirname, 'config.json');
  let cfg = {};
  if (fs.existsSync(cfgPath)) cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  const def = {
    tokenFile: '../autosign/token.txt',
    base: 'https://car.sunslin.com',
    encrypt: true,
    passphrase: '',
    maxDays: 400,
    tripDetails: true,
    tripCostDetail: true,
    includeNotifications: true,
    requestDelayMs: 150,
  };
  const c = { ...def, ...cfg };
  if (process.env.SURCAM_PASS) c.passphrase = process.env.SURCAM_PASS;
  return c;
}

function loadToken(cfg) {
  if (process.env.SURCAM_TOKEN) return process.env.SURCAM_TOKEN.trim();
  const tf = path.isAbsolute(cfg.tokenFile) ? cfg.tokenFile : path.join(__dirname, cfg.tokenFile);
  if (fs.existsSync(tf)) {
    const t = fs.readFileSync(tf, 'utf-8').trim();
    if (t) return t;
  }
  console.error(`[x] 未找到 token：请先抓包获取 Authorization Bearer 写入 ${tf}，或设置环境变量 SURCAM_TOKEN`);
  process.exit(2);
}

// ---------- HTTP（仅 GET）----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let authFails = 0;

async function get(cfg, p, { retry = 1 } = {}) {
  const url = cfg.base + p;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${cfg.__token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 401 || res.status === 403) {
        authFails++;
        if (authFails >= 3) throw new AuthError();
        return { status: res.status, json: null };
      }
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* 保留 null */ }
      return { status: res.status, json };
    } catch (e) {
      if (e instanceof AuthError) throw e;
      if (attempt >= retry) return { status: 0, json: null, err: String(e.message || e) };
      await sleep(800);
    } finally {
      await sleep(cfg.requestDelayMs);
    }
  }
}

class AuthError extends Error {
  constructor() { super('token 失效'); this.auth = true; }
}

// best-effort GET：失败只记录，不中断
const failures = [];
async function tryGet(cfg, p, opts) {
  const r = await get(cfg, p, opts);
  if (!r.json || r.status !== 200) {
    failures.push({ path: p.split('?')[0], status: r.status, err: r.err || null });
    return null;
  }
  return r.json;
}

// ---------- 加密（与浏览器 WebCrypto 兼容）----------
const b64 = (b) => Buffer.from(b).toString('base64');
const unb64 = (s) => Buffer.from(s, 'base64');

async function deriveKey(pass, salt, usage) {
  const km = await crypto.subtle.importKey('raw', Buffer.from(pass, 'utf-8'), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, usage,
  );
}

async function encryptText(pass, text) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveKey(pass, salt, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, Buffer.from(text, 'utf-8'));
  return `SURCAM1.${b64(salt)}.${b64(iv)}.${b64(ct)}`;
}

async function decryptText(pass, blob) {
  const [tag, s, i, c] = blob.trim().split('.');
  if (tag !== 'SURCAM1') throw new Error('未知加密格式');
  const key = await deriveKey(pass, unb64(s), ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(i) }, key, unb64(c));
  return Buffer.from(pt).toString('utf-8');
}

// ---------- 日期工具 ----------
function ymd(d) { return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; }
function ym(d) { return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`; }
function dayRange(fromDate, toDate) {
  const out = [];
  for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) out.push(ymd(d));
  return out;
}
function monthRange(fromDate, toDate) {
  const out = [];
  const d = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
  const end = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
  for (; d <= end; d.setMonth(d.getMonth() + 1)) out.push(ym(d));
  return out;
}

// ---------- 旧数据加载与合并 ----------
function emptyStore() {
  return { v: 1, syncedAt: 0, profile: null, usageStatus: null, top3: null, vehicles: [], snapshots: {}, trips: {}, tripDetails: {}, tripCosts: {}, calendars: {}, footprints: {}, sentryOverview: {}, parkingCurrent: {}, geofences: {}, medals: null, medalTypes: null, points: null, pointsLedger: {}, rtQuotaLedger: {}, durationLogs: null, subscriptionCodes: null, authCodes: null, lottery: null, supplement: null, lockPushErrors: null, robotNotify: null, eagleCaptures: null, notifications: null, competitions: null, honorMileage: null };
}

async function loadPrevStore(cfg) {
  if (fs.existsSync(PLAIN_FILE)) {
    try { return JSON.parse(fs.readFileSync(PLAIN_FILE, 'utf-8')); } catch { /* 重建 */ }
  }
  if (fs.existsSync(ENC_FILE) && cfg.passphrase) {
    try { return JSON.parse(await decryptText(cfg.passphrase, fs.readFileSync(ENC_FILE, 'utf-8'))); } catch { /* 口令变了则重建 */ }
  }
  return null;
}

function pruneStore(s) {
  // 体积超限时，从最旧的日子开始剥离 tripDetails 中的轨迹字段
  let size = () => Buffer.byteLength(JSON.stringify(s));
  if (size() <= STORE_BYTES_CAP) return;
  for (const dev of Object.keys(s.tripDetails || {})) {
    const days = Object.keys(s.trips[dev] || {}).sort();
    for (const day of days) {
      const recs = (s.trips[dev][day] && s.trips[dev][day].records) || [];
      for (const r of recs) {
        const id = r.tripId ?? r.id ?? r.recordId;
        const det = id && s.tripDetails[dev][id];
        if (det) {
          for (const k of ['tripTrackJson', 'trackJson', 'track']) {
            if (det[k]) { delete det[k]; det.__stripped = true; }
          }
        }
      }
      if (size() <= STORE_BYTES_CAP) return;
    }
  }
}

// ---------- 主流程 ----------
async function main() {
  const cfg = loadConfig();
  cfg.__token = loadToken(cfg);
  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log('[1/6] 拉取账号与车辆快照 …');
  const store = (await loadPrevStore(cfg)) || emptyStore();
  const bootstrap = await tryGet(cfg, '/api/surcam/mp/home/bootstrap');
  if (!bootstrap) {
    console.error('[x] home/bootstrap 拉取失败（token 过期或网络问题）。若 token 过期请先运行 autosign\\refresh_token.bat');
    process.exit(3);
  }
  store.profile = bootstrap.profile || store.profile;
  store.top3 = bootstrap.todayMileageTop3 || null;
  store.usageStatus = await tryGet(cfg, '/api/surcam/mp/usageStatus');
  await tryGet(cfg, '/api/surcam/mp/profile'); // 保持与官方一致的心跳读取，失败不记

  const vehicles = (bootstrap.vehicles || []).map((v) => ({ ...v }));
  store.vehicles = vehicles;
  const now = new Date();
  const todayStr = ymd(now);

  console.log('[2/6] 记录实时快照（供长期趋势）…');
  for (const v of vehicles) {
    const arr = (store.snapshots[v.deviceId] ||= []);
    const last = arr[arr.length - 1];
    if (!last || now - last.t > 10 * 60 * 1000) arr.push({ t: now.getTime(), realtime: v.realtime });
    while (arr.length > 720) arr.shift();
  }

  console.log('[3/6] 逐日拉取行程历史 …');
  let totalDays = 0;
  for (const v of vehicles) {
    const bound = v.boundAt ? new Date(v.boundAt) : new Date(now.getTime() - 30 * 86400e3);
    const from = new Date(Math.max(bound.getTime(), now.getTime() - cfg.maxDays * 86400e3));
    const days = dayRange(from, now);
    store.trips[v.deviceId] ||= {};
    for (const day of days) {
      const j = await tryGet(cfg, `/api/surcam/mp/vehicle/${v.deviceId}/tripHistory?day=${day}`);
      if (j) { store.trips[v.deviceId][day] = { summary: j.summary ?? null, records: j.records ?? [] }; totalDays++; }
    }
  }
  console.log(`      ${totalDays} 天数据已入库`);

  console.log('[4/6] 拉取行程明细/费用/月历/足迹 …');
  let detailNew = 0;
  for (const v of vehicles) {
    const dev = v.deviceId;
    store.tripDetails[dev] ||= {};
    store.tripCosts[dev] ||= {};
    store.calendars[dev] ||= {};

    if (cfg.tripDetails) {
      for (const [day, pack] of Object.entries(store.trips[dev])) {
        for (const r of pack.records || []) {
          const id = r.tripId ?? r.id ?? r.recordId;
          if (!id) continue;
          const isToday = day === todayStr;
          if (store.tripDetails[dev][id] && !isToday) continue; // 增量：已有且非当日
          const his = r.hisFlag ? 'tripRecordHis' : 'tripRecord';
          const det = await tryGet(cfg, `/api/surcam/mp/vehicle/${dev}/${his}/${id}`);
          if (det) { store.tripDetails[dev][id] = det; detailNew++; }
          if (cfg.tripCostDetail && (isToday || !store.tripCosts[dev][id])) {
            const cost = await tryGet(cfg, `/api/surcam/mp/vehicle/${dev}/${his}/${id}/tripCostDetail`);
            if (cost) store.tripCosts[dev][id] = cost;
          }
        }
      }
    }

    const bound = v.boundAt ? new Date(v.boundAt) : new Date(now.getTime() - 30 * 86400e3);
    const from = new Date(Math.max(bound.getTime(), now.getTime() - cfg.maxDays * 86400e3));
    for (const m of monthRange(from, now)) {
      const j = await tryGet(cfg, `/api/surcam/mp/vehicle/${dev}/tripCalendar/month?month=${m}`);
      if (j) store.calendars[dev][m] = j;
    }
    const fp = await tryGet(cfg, `/api/surcam/mp/vehicle/${dev}/tripFootprint?days=7`);
    if (fp) store.footprints[dev] = fp;

    const so = await tryGet(cfg, `/api/surcam/mp/vehicle/${dev}/sentryOverview`);
    if (so) store.sentryOverview[dev] = so;
    if (v.realtime && v.realtime.parkingActive) {
      const pc = await tryGet(cfg, `/api/surcam/mp/vehicle/${dev}/parking/current`);
      if (pc) store.parkingCurrent[dev] = { t: now.getTime(), ...pc };
    }
    const gf = {};
    for (const kind of ['sentryGeofence', 'chargingGeofence', 'parkingGeofence']) {
      const j = await tryGet(cfg, `/api/surcam/mp/vehicle/${dev}/${kind}`);
      if (j) gf[kind] = j;
    }
    if (Object.keys(gf).length) store.geofences[dev] = gf;
  }
  console.log(`      新增行程明细 ${detailNew} 条`);

  console.log('[5/6] 拉取账号权益/勋章/积分/媒体列表 …');
  store.medals = await tryGet(cfg, '/api/surcam/mp/medals');
  store.medalTypes = await tryGet(cfg, '/api/surcam/mp/medalTypes');
  store.points = await tryGet(cfg, '/api/surcam/mp/points/balance');
  const plIn = await tryGet(cfg, '/api/surcam/mp/points/ledger?direction=in&page=1&size=50');
  const plOut = await tryGet(cfg, '/api/surcam/mp/points/ledger?direction=out&page=1&size=50');
  if (plIn || plOut) store.pointsLedger = { in: plIn, out: plOut };
  const rtIn = await tryGet(cfg, '/api/surcam/mp/rtQuota/ledger?direction=in&page=1&size=50');
  const rtOut = await tryGet(cfg, '/api/surcam/mp/rtQuota/ledger?direction=out&page=1&size=50');
  if (rtIn || rtOut) store.rtQuotaLedger = { in: rtIn, out: rtOut };
  store.durationLogs = await tryGet(cfg, '/api/surcam/mp/durationIncreaseLogs?page=1&size=50');
  store.subscriptionCodes = await tryGet(cfg, '/api/surcam/mp/subscriptionCodes');
  store.authCodes = await tryGet(cfg, '/api/surcam/mp/authCodes');
  store.lottery = await tryGet(cfg, '/api/surcam/mp/duration/lottery/status');
  store.supplement = await tryGet(cfg, '/api/surcam/mp/supplementProcess/status?page=1&size=20');
  store.lockPushErrors = await tryGet(cfg, '/api/surcam/mp/lockPushErrors?page=1&size=20');
  store.robotNotify = await tryGet(cfg, '/api/surcam/mp/robotNotify/settings');
  store.eagleCaptures = await tryGet(cfg, `/api/surcam/mp/eagleCapture/list?deviceId=${vehicles[0]?.deviceId || ''}&page=1&size=50`);
  if (cfg.includeNotifications) store.notifications = await tryGet(cfg, '/api/surcam/mp/notifications?page=1&size=20');
  store.competitions = await tryGet(cfg, '/api/surcam/mp/competitions/current');
  store.honorMileage = await tryGet(cfg, `/api/surcam/mp/competitions/honor-mileage?year=${now.getFullYear()}`);

  console.log('[6/6] 写出数据文件 …');
  store.syncedAt = now.getTime();
  pruneStore(store);
  const json = JSON.stringify(store);
  if (cfg.encrypt && cfg.passphrase) {
    const enc = await encryptText(cfg.passphrase, json);
    fs.writeFileSync(ENC_FILE, enc, 'utf-8');
    if (fs.existsSync(PLAIN_FILE)) fs.unlinkSync(PLAIN_FILE);
  } else {
    fs.writeFileSync(PLAIN_FILE, json, 'utf-8');
    if (fs.existsSync(ENC_FILE)) fs.unlinkSync(ENC_FILE);
  }
  const tripCount = Object.values(store.trips).reduce((a, d) => a + Object.values(d).reduce((b, p) => b + (p.records || []).length, 0), 0);
  fs.writeFileSync(META_FILE, JSON.stringify({
    v: 1, syncedAt: store.syncedAt, encrypted: !!(cfg.encrypt && cfg.passphrase),
    vehicles: vehicles.length, trips: tripCount, details: Object.values(store.tripDetails).reduce((a, d) => a + Object.keys(d).length, 0),
    bytes: json.length, failures: failures.slice(0, 20),
  }, null, 2));

  console.log(`[√] 完成：车辆 ${vehicles.length}、行程 ${tripCount} 条、新增明细 ${detailNew} 条、数据 ${(json.length / 1024).toFixed(0)} KB${cfg.encrypt ? '（已加密）' : ''}`);
  if (failures.length) console.log(`    ${failures.length} 个端点本次失败（多为无数据/未开通，不影响其他）`);
}

main().catch((e) => {
  if (e && e.auth) {
    console.error('[x] token 已失效：请先运行 autosign\\refresh_token.bat 刷新 token.txt，再重新执行 sync。');
    process.exit(2);
  }
  console.error('[x] 同步失败：', e);
  process.exit(1);
});
