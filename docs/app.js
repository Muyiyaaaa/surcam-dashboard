// 盯盯车数据面板 —— 纯静态、无外部依赖
// 数据来自 docs/data/（由本机 sync.js 只读同步生成，可选 AES-GCM 加密）
'use strict';

/* ================= 工具 ================= */
const $ = (s) => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = (n) => (n == null || isNaN(+n)) ? '—' : (+n).toFixed(1).replace(/\.0$/, '');
const fkm = (n) => (n == null || isNaN(+n)) ? '—' : f1(n) + ' km';
const fy = (n) => (n == null || isNaN(+n)) ? '—' : '¥' + f1(n);
const fdur = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}小时${m}分` : `${m}分钟`; };
const fhm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fms = (ms) => new Date(ms).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const fday = (ymd) => `${+ymd.slice(4, 6)}/${+ymd.slice(6, 8)}`;
const fdate = (ymd) => `${+ymd.slice(4, 6)}月${+ymd.slice(6, 8)}日 周${'日一二三四五六'[new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)).getDay()]}`;
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64e = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const TE = new TextEncoder();

async function sha256hex(str) {
  const h = await crypto.subtle.digest('SHA-256', TE.encode(str));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function decryptBlob(pass, blob) {
  const [tag, s, i, c] = blob.trim().split('.');
  if (tag !== 'SURCAM1') throw new Error('格式不对');
  const km = await crypto.subtle.importKey('raw', TE.encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64d(s), iterations: 200000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(i) }, key, b64d(c));
  return new TextDecoder().decode(pt);
}

/* ================= 启动 ================= */
let S = null;       // 解密后的数据仓库
let DEV = '';       // 当前车辆
let RANGE = '7';    // 汇总区间

async function boot() {
  let meta;
  try { meta = await (await fetch('data/meta.json', { cache: 'no-store' })).json(); }
  catch { $('#loading').textContent = '缺少 data/meta.json —— 请先在本机运行 sync.js'; return; }

  if (!meta.encrypted) {
    try { S = await (await fetch('data/data.json', { cache: 'no-store' })).json(); }
    catch { $('#loading').textContent = '缺少 data/data.json'; return; }
    return start();
  }

  const res = await fetch('data/data.enc', { cache: 'no-store' });
  const blob = await res.text();
  const hash = await sha256hex(blob);
  // 命中缓存则免输口令
  try {
    const cache = JSON.parse(localStorage.getItem('surcam_cache') || 'null');
    if (cache && cache.h === hash && cache.d) { S = JSON.parse(cache.d); return start(); }
  } catch { /* 缓存损坏则走口令 */ }

  $('#loading').hidden = true;
  const gate = $('#gate'); gate.hidden = false;
  const tryUnlock = async () => {
    $('#gateErr').textContent = '';
    const pass = $('#pass').value.trim();
    if (!pass) return;
    if (!(window.crypto && window.crypto.subtle)) {
      $('#gateErr').textContent = '此浏览器不支持网页加密：请用系统浏览器（Safari / Chrome）打开本页，不要用微信内置浏览器';
      return;
    }
    $('#unlock').textContent = '解密中…';
    try {
      const json = await decryptBlob(pass, blob);
      S = JSON.parse(json);
      if (json.length < 2000000) localStorage.setItem('surcam_cache', JSON.stringify({ h: hash, d: json }));
      gate.hidden = true; start();
    } catch {
      $('#gateErr').textContent = '口令不正确：请点 👁 核对输入（注意大小写，前后不能有空格）';
    } finally { $('#unlock').textContent = '解锁'; }
  };
  $('#unlock').onclick = tryUnlock;
  $('#pass').onkeydown = (e) => { if (e.key === 'Enter') tryUnlock(); };
  $('#eye').onclick = () => { const p = $('#pass'); p.type = p.type === 'password' ? 'text' : 'password'; };
  $('#pass').focus();
}

function start() {
  $('#loading').hidden = true;
  $('#app').hidden = false;
  const vs = S.vehicles || [];
  DEV = (vs.find((v) => v.isDefault) || vs[0] || {}).deviceId || '';
  renderTabs();
  renderAll();
}

function renderTabs() {
  const vs = S.vehicles || [];
  if (vs.length < 2) return;
  const t = $('#vtabs'); t.hidden = false; t.innerHTML = '';
  for (const v of vs) {
    const b = document.createElement('button');
    b.className = 'vtab' + (v.deviceId === DEV ? ' on' : '');
    b.textContent = v.displayName || v.modelCode || v.deviceId.slice(0, 6);
    b.onclick = () => { DEV = v.deviceId; renderTabs(); renderAll(); };
    t.appendChild(b);
  }
}

function renderAll() {
  renderHeader(); renderHero(); renderEntitle();
  renderRange(); renderCharts(); renderTrips();
  renderDurationLogs(); renderCodes(); renderLedgers();
  renderFences(); renderComp(); renderNotifs(); renderCoverage();
}

/* ================= 头部 ================= */
function renderHeader() {
  const v = curVehicle();
  $('#vName').textContent = v?.displayName || v?.modelCode || '未绑定车辆';
  $('#syncTime').textContent = S.syncedAt ? '同步于 ' + fms(S.syncedAt) : '';
  const us = S.usageStatus || {};
  const until = us.availableUntil || S.profile?.availableUntil;
  const ok = us.expired === false && !(until && until < Date.now());
  $('#liveDot').className = 'dot' + (ok ? '' : ' off');
}

/* ================= 车况 ================= */
function curVehicle() { return (S.vehicles || []).find((v) => v.deviceId === DEV); }

function renderHero() {
  const v = curVehicle(); const r = (v && v.realtime) || {};
  const soc = (r.fullChargeRangeKm && r.rangeEvKm != null) ? Math.round(100 * r.rangeEvKm / r.fullChargeRangeKm) : null;
  const charging = r.chargingPowerKw != null;
  const box = (k, val, extra = '') => `<div class="big${extra}"><div class="v">${val}</div><div class="k">${k}</div></div>`;
  let h = '';
  h += box('电量', soc != null ? soc + '<small>%</small>' : '—') +
       (soc != null ? `<div class="wide" style="margin-top:-6px"><div class="battbar"><i style="width:${Math.min(100, soc)}%"></i></div></div>` : '');
  h += box('纯电续航', r.rangeEvKm != null ? f1(r.rangeEvKm) + '<small>km</small>' : '—');
  h += box(r.powerType === 2 ? '总里程' : '燃油续航', r.powerType === 2
    ? (r.totalMileageKm != null ? Math.round(r.totalMileageKm) + '<small>km</small>' : '—')
    : (r.rangeFuelKm != null ? f1(r.rangeFuelKm) + '<small>km</small>' : '—'));
  h += box(r.powerType === 2 ? '里程排名' : '总里程', r.powerType === 2
    ? (r.totalMileageRank != null ? '#' + r.totalMileageRank : '—')
    : (r.totalMileageKm != null ? Math.round(r.totalMileageKm) + '<small>km</small>' : '—'));
  h += box('当前状态', charging
    ? `充电<small>${f1(r.chargingPowerKw)}kW${r.chargingRemainMin != null ? ' ' + Math.round(r.chargingRemainMin) + '分' : ''}</small>`
    : (r.parkingActive ? '停车' : '静止'), charging ? ' wide' : '');
  h += box('百公里能耗', r.energyConsumptionValue != null ? f1(r.energyConsumptionValue) + '<small>' + (r.energyConsumptionUnit === 'kWh/100km' ? 'kWh' : '') + '</small>' : '—');
  h += box('每公里成本', r.costPerKmYuan != null ? '¥' + (+r.costPerKmYuan).toFixed(3) : '—');
  h += `<div class="big wide"><div class="k">位置 <span style="color:var(--faint)">${r.updatedAt ? fms(r.updatedAt) : ''}</span></div><div class="loc">${esc(r.address || '—')}</div></div>`;
  // 胎压 / 保养 / 存储
  const tp = [r.tirePressureLf, r.tirePressureRf, r.tirePressureLr, r.tirePressureRr];
  if (tp.some((x) => x != null)) {
    h += `<div class="big wide"><div class="k">胎压 bar（左前/右前/左后/右后）</div><div class="loc">${tp.map((x) => x ?? '—').join(' / ')}</div></div>`;
  }
  h += box('保养剩余', r.maintenanceRemainKm != null ? Math.round(r.maintenanceRemainKm / 1000) + '<small>千km</small>' : '—');
  h += box('存储剩余', r.usbStorageFreeGb != null ? f1(r.usbStorageFreeGb) + '<small>/' + f1(r.usbStorageTotalGb) + 'G</small>' : '—');
  h += box('哨兵视频', r.sentryVideoGb != null ? f1(r.sentryVideoGb) + '<small>G·' + (r.sentryVideoCount ?? 0) + '条</small>' : '—');
  // 累计成本
  const cost = [
    ['电费', r.cumElecCostYuan], ['油费', r.cumFuelCostYuan], ['过路', r.cumTollCostYuan],
    ['停车', r.cumParkingCostYuan], ['保养', r.cumMaintenanceCostYuan], ['其他', r.cumOtherCostYuan],
  ].filter(([, x]) => x != null && +x > 0);
  if (cost.length) {
    h += `<div class="big wide"><div class="k">累计费用明细</div><div class="loc">${cost.map(([k, x]) => `${k} ¥${f1(x)}`).join(' · ')}</div></div>`;
  }
  $('#hero').innerHTML = h;
  $('#realtimeAt').textContent = r.updatedAt ? '更新 ' + fms(r.updatedAt) : '';
}

/* ================= 权益 ================= */
function renderEntitle() {
  const p = S.profile || {}; const us = S.usageStatus || {};
  const until = us.availableUntil || p.availableUntil;
  const days = us.expired ? 0 : Math.max(0, Math.ceil(((until || 0) - Date.now()) / 86400e3));
  const item = (k, v, cls = '') => `<div class="mini"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
  const medals = S.medals?.total ?? 0;
  $('#entGrid').innerHTML =
    item('使用时长', us.expired ? '已过期' : `剩 ${days} 天`, days > 3 ? 'good' : 'warn') +
    item('RT 额度', f1(us.realtimeQuotaMinutes ?? p.realtimeQuotaMinutes) + ' 分钟', (us.realtimeQuotaMinutes ?? 0) > 29 ? 'good' : '') +
    item('积分', p.pointsBalance ?? '—') +
    item('连续签到', (p.signStreakDays ?? 0) + ' 天' + (p.signedToday ? ' ·今日已签' : ''), p.signedToday ? 'good' : 'warn') +
    item('勋章', medals + ' 枚') +
    item('抽奖机会', p.lotteryChances ?? 0) +
    item('补签机会', p.supplementProcessChances ?? 0) +
    item('会员', p.userPlanType === '1' ? '年卡' : p.userPlanType === '9' ? '超级会员' : '普通');
}

/* ================= 聚合 ================= */
function dayAgg() {
  // 返回 { 'YYYYMMDD': {km,sec,cnt,elec,fuel,toll,rate,evW,fuW,evKm,fuKm} }（当前车辆）
  const out = {};
  const days = (S.trips || {})[DEV] || {};
  for (const [day, pack] of Object.entries(days)) {
    const recs = pack.records || [];
    if (!recs.length) { out[day] = null; continue; }
    const a = { km: 0, sec: 0, cnt: recs.length, elec: 0, fuel: 0, toll: 0, rate: 0, evW: 0, fuW: 0, evKm: 0, fuKm: 0, lights: 0 };
    for (const r of recs) {
      const km = +r.tripKm || 0;
      a.km += km; a.sec += +r.tripDurationSec || 0;
      a.elec += +r.estimatedElecYuan || 0; a.fuel += +r.estimatedFuelYuan || 0; a.toll += +r.estimatedTollYuan || 0;
      a.rate += (+r.tripAchievementRate || 0) * km; a.lights += +r.trafficLightCount || 0;
      const ev = r.energyConsumptionValue, fu = r.fuelConsumptionValue;
      if (ev != null && km > 0) { a.evW += ev * km; a.evKm += km; }
      if (fu != null && km > 0) { a.fuW += fu * km; a.fuKm += km; }
    }
    out[day] = a;
  }
  return out;
}
const eoc = (ev, fu) => (ev == null && fu == null) ? null : 3.15 * (fu || 0) + 0.9 * (ev || 0);

function rangeDays(r) {
  const all = Object.keys(dayAgg()).sort();
  const today = new Date();
  const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  if (r === 'today') return all.filter((d) => d === ymd(today));
  if (r === 'all') return all;
  const from = new Date(today.getTime() - (+r - 1) * 86400e3);
  return all.filter((d) => d >= ymd(from) && d <= ymd(today));
}

function renderRange() {
  const agg = dayAgg();
  const days = rangeDays(RANGE).filter((d) => agg[d]);
  let km = 0, sec = 0, cnt = 0, elec = 0, fuel = 0, toll = 0, rate = 0, evW = 0, fuW = 0, evKm = 0, fuKm = 0;
  for (const d of days) { const a = agg[d]; km += a.km; sec += a.sec; cnt += a.cnt; elec += a.elec; fuel += a.fuel; toll += a.toll; rate += a.rate; evW += a.evW; fuW += a.fuW; evKm += a.evKm; fuKm += a.fuKm; }
  const ev = evKm > 0 ? evW / evKm : null, fu = fuKm > 0 ? fuW / fuKm : null;
  const kpi = (v, k, unit = '') => `<div class="kpi"><div class="v">${v}<small>${unit}</small></div><div class="k">${k}</div></div>`;
  $('#kpis').innerHTML =
    kpi(f1(km), '里程', 'km') + kpi(fdur(sec), '时长') + kpi(fy(elec + fuel + toll), '费用') + kpi(cnt, '行程', '次');
  $('#kpis2').innerHTML =
    kpi(f1(ev), '电耗', 'kWh/100km') + kpi(f1(fu), '油耗', 'L/100km') + kpi(km > 0 ? f1(rate / km) + '%' : '—', '达成率');
  $('#rangeInfo').textContent = days.length ? `${fdate(days[0])} 起 · ${days.length} 天` : '该区间无数据';
  document.querySelectorAll('#rangeSeg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.r === RANGE);
    b.onclick = () => { RANGE = b.dataset.r; renderRange(); };
  });
}

/* ================= 图表 ================= */
function svgWrap(width, height) {
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', width: '100%' });
  svg.style.maxWidth = width + 'px';
  return svg;
}
const CSS = getComputedStyle(document.documentElement);
const cv = (n) => CSS.getPropertyValue(n).trim();

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

function barChart(mount, items, { color = '--accent', onPick, caption }) {
  mount.innerHTML = '';
  const W = Math.max(320, items.length * 24 + 20), H = 150, pb = 16, pl = 6;
  const svg = svgWrap(W, H);
  const max = niceMax(Math.max(...items.map((i) => i.value), 0.1));
  const bw = (W - pl * 2) / items.length;
  for (let g = 0; g <= 4; g++) {
    const y = pb + (H - 30 - pb) * (1 - g / 4);
    svg.append(el('line', { x1: pl, x2: W - pl, y1: y, y2: y, stroke: cv('--line'), 'stroke-width': 0.5, 'stroke-dasharray': g ? '2 3' : '' }));
  }
  items.forEach((it, i) => {
    const h = it.value > 0 ? Math.max(2, (H - 30 - pb) * it.value / max) : 0;
    const x = pl + i * bw + bw * 0.18, w = bw * 0.64;
    const bar = el('rect', { x, y: H - 30 - h, width: w, height: h, rx: 2, fill: cv(color), opacity: it.value > 0 ? 0.92 : 0.15 });
    if (it.value > 0 && onPick) bar.classList.add('bar'), bar.addEventListener('click', () => onPick(it));
    svg.append(bar);
    if (i % 5 === 0 || i === items.length - 1) {
      const t = el('text', { x: pl + i * bw + bw / 2, y: H - 16, 'text-anchor': 'middle' });
      t.textContent = it.label; svg.append(t);
    }
  });
  mount.appendChild(svg);
}

function lineChart(mount, series, { onPick, caption }) {
  mount.innerHTML = '';
  const n = Math.max(...series.map((s) => s.pts.length), 2);
  const W = Math.max(320, n * 24 + 30), H = 150, pb = 12;
  const svg = svgWrap(W, H);
  const vals = series.flatMap((s) => s.pts.filter((p) => p.y != null).map((p) => p.y));
  if (!vals.length) { mount.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  const min = Math.min(...vals), max = niceMax(Math.max(...vals));
  const lo = min > 0 ? min * 0.85 : 0;
  const X = (i, len) => 12 + i * ((W - 30) / Math.max(1, len - 1));
  const Y = (v) => pb + (H - 34 - pb) * (1 - (v - lo) / (max - lo || 1));
  for (let g = 0; g <= 4; g++) {
    const y = pb + (H - 34 - pb) * (1 - g / 4);
    svg.append(el('line', { x1: 10, x2: W - 14, y1: y, y2: y, stroke: cv('--line'), 'stroke-width': 0.5, 'stroke-dasharray': g ? '2 3' : '' }));
    const t = el('text', { x: W - 12, y: y + 3, 'text-anchor': 'start' });
    t.textContent = f1(lo + (max - lo) * g / 4); svg.append(t);
  }
  for (const s of series) {
    const seg = s.pts.map((p, i) => p.y == null ? null : `${X(i, s.pts.length)},${Y(p.y)}`).filter(Boolean).join(' ');
    if (seg) svg.append(el('polyline', { points: seg, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    s.pts.forEach((p, i) => {
      if (p.y == null || !onPick) return;
      const c = el('circle', { cx: X(i, s.pts.length), cy: Y(p.y), r: 9, fill: 'transparent' });
      const dot = el('circle', { cx: X(i, s.pts.length), cy: Y(p.y), r: 2.5, fill: s.color });
      c.classList.add('bar');
      c.addEventListener('click', () => onPick(p, s));
      svg.append(dot, c);
    });
  }
  const base = series[0];
  base.pts.forEach((p, i) => {
    if (i % 5 === 0 || i === base.pts.length - 1) {
      const t = el('text', { x: X(i, base.pts.length), y: H - 16, 'text-anchor': 'middle' });
      t.textContent = p.label; svg.append(t);
    }
  });
  mount.appendChild(svg);
}

function stackedBar(mount, items, parts, { onPick }) {
  mount.innerHTML = '';
  const W = Math.max(280, items.length * 56 + 20), H = 150, pb = 12;
  const svg = svgWrap(W, H);
  const totals = items.map((it) => parts.reduce((a, p) => a + (it.parts[p.key] || 0), 0));
  const max = niceMax(Math.max(...totals, 0.1));
  const bw = (W - 12) / items.length;
  items.forEach((it, i) => {
    let y = H - 30;
    for (const p of parts) {
      const v = it.parts[p.key] || 0;
      if (v <= 0) continue;
      const h = (H - 30 - pb) * v / max;
      y -= h;
      const r = el('rect', { x: 12 + i * bw + bw * 0.2, y, width: bw * 0.6, height: h, fill: p.color, opacity: 0.9 });
      r.classList.add('bar');
      r.addEventListener('click', () => onPick(it));
      svg.append(r);
    }
    const t = el('text', { x: 12 + i * bw + bw / 2, y: H - 16, 'text-anchor': 'middle' });
    t.textContent = it.label; svg.append(t);
  });
  for (let g = 0; g <= 4; g++) {
    const y = pb + (H - 30 - pb) * (1 - g / 4);
    const t = el('text', { x: W - 4, y: y + 3, 'text-anchor': 'end' });
    t.textContent = f1(max * g / 4); svg.append(t);
  }
  mount.appendChild(svg);
}

function renderCharts() {
  const agg = dayAgg();
  const allDays = Object.keys(agg).sort().slice(-30);
  const today = new Date();
  const ymdNow = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

  // 每日里程
  const items = allDays.map((d) => ({ label: fday(d), value: agg[d] ? +agg[d].km.toFixed(1) : 0, day: d }));
  barChart($('#chartKm'), items, {
    onPick: (it) => {
      const a = agg[it.day];
      $('#capKm').innerHTML = a
        ? `<b>${fdate(it.day)}</b> · ${f1(a.km)} km · ${fdur(a.sec)} · ${a.cnt} 次 · 费用 ${fy(a.elec + a.fuel + a.toll)}`
        : `<b>${fdate(it.day)}</b> · 无行程`;
    },
  });

  // 能耗趋势（仅有行程的日）
  const edays = allDays.filter((d) => agg[d] && agg[d].km > 0);
  const evPts = edays.map((d) => ({ label: fday(d), y: agg[d].evKm > 0 ? +((agg[d].evW / agg[d].evKm)).toFixed(1) : null, day: d }));
  const fuPts = edays.map((d) => ({ label: fday(d), y: agg[d].fuKm > 0 ? +((agg[d].fuW / agg[d].fuKm)).toFixed(1) : null, day: d }));
  const hasEv = evPts.some((p) => p.y != null), hasFu = fuPts.some((p) => p.y != null && p.y > 0);
  const series = [];
  if (hasEv) series.push({ name: '电耗 kWh/100km', color: cv('--elec'), pts: evPts });
  if (hasFu) series.push({ name: '油耗 L/100km', color: cv('--oil'), pts: fuPts });
  if (series.length) {
    lineChart($('#chartEnergy'), series, {
      onPick: (p) => {
        const a = agg[p.day];
        $('#capEnergy').innerHTML = `<b>${fdate(p.day)}</b> · 电耗 ${a.evKm > 0 ? f1(a.evW / a.evKm) : '—'} kWh · 油耗 ${a.fuKm > 0 ? f1(a.fuW / a.fuKm) : '—'} L · 综合能耗 ${f1(eoc(a.evKm > 0 ? a.evW / a.evKm : null, a.fuKm > 0 ? a.fuW / a.fuKm : null))}`;
      },
    });
  } else $('#chartEnergy').innerHTML = '<div class="empty">暂无能耗数据</div>';
  $('#legEnergy').innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('') +
    (series.length ? '<span><i style="background:var(--txt)"></i>综合能耗 = 3.15×油 + 0.9×电</span>' : '');

  // 达成率
  if (edays.length) {
    lineChart($('#chartRate'), [{ name: '达成率%', color: cv('--accent'), pts: edays.map((d) => ({ label: fday(d), y: agg[d].km > 0 ? +(agg[d].rate / agg[d].km).toFixed(0) : null, day: d })) }], {
      onPick: (p) => { $('#capRate').innerHTML = `<b>${fdate(p.day)}</b> · 达成率 ${f1(agg[p.day].rate / agg[p.day].km)}% · ${f1(agg[p.day].km)} km`; },
    });
  } else $('#chartRate').innerHTML = '<div class="empty">暂无数据</div>';

  // 月度费用
  const byMonth = {};
  for (const [d, a] of Object.entries(agg)) {
    if (!a) continue;
    const m = d.slice(0, 6);
    byMonth[m] ||= { elec: 0, fuel: 0, toll: 0 };
    byMonth[m].elec += a.elec; byMonth[m].fuel += a.fuel; byMonth[m].toll += a.toll;
  }
  const months = Object.keys(byMonth).sort();
  const mItems = months.map((m) => ({ label: +m.slice(4, 6) + '月', parts: byMonth[m], month: m }));
  stackedBar($('#chartCost'), mItems, [
    { key: 'elec', color: cv('--elec') }, { key: 'fuel', color: cv('--oil') }, { key: 'toll', color: cv('--toll') },
  ], {
    onPick: (it) => {
      $('#capCost').innerHTML = `<b>${it.month.slice(0, 4)}年${+it.month.slice(4, 6)}月</b> · 电 ${fy(it.parts.elec)} · 油 ${fy(it.parts.fuel)} · 过路 ${fy(it.parts.toll)} · 合计 ${fy(it.parts.elec + it.parts.fuel + it.parts.toll)}`;
    },
  });
  $('#legCost').innerHTML = [['电费', '--elec'], ['油费', '--oil'], ['过路费', '--toll']].map(([n, c]) => `<span><i style="background:var(${c})"></i>${n}</span>`).join('');

  // 日历热力（本月）
  const ymNow = ymdNow.slice(0, 6);
  const calDays = Object.keys(agg).filter((d) => d.startsWith(ymNow));
  const maxKm = Math.max(...calDays.map((d) => agg[d]?.km || 0), 1);
  const y = today.getFullYear(), mo = today.getMonth();
  const first = new Date(y, mo, 1);
  const dim = new Date(y, mo + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // 周一开头
  let ch = '';
  for (const w of ['一', '二', '三', '四', '五', '六', '日']) ch += `<div class="wd">${w}</div>`;
  for (let i = 0; i < lead; i++) ch += '<div class="cell"></div>';
  for (let d = 1; d <= dim; d++) {
    const key = ymNow + String(d).padStart(2, '0');
    const a = agg[key];
    const km = a?.km || 0;
    const alpha = km > 0 ? (0.18 + 0.82 * Math.sqrt(km / maxKm)).toFixed(2) : 0;
    const todayCls = key === ymdNow ? ' today' : '';
    const fut = key > ymdNow ? ' future' : '';
    ch += `<div class="cell${km > 0 ? ' has' : ''}${todayCls}${fut}" data-d="${key}" style="${km > 0 ? `background:rgba(74,222,128,${alpha})` : ''}">${d}</div>`;
  }
  $('#cal').innerHTML = ch;
  $('#calMonth').textContent = `${y}年${mo + 1}月`;
  $('#cal').querySelectorAll('.cell').forEach((c) => {
    c.addEventListener('click', () => {
      const a = agg[c.dataset.d];
      $('#capCal').innerHTML = a
        ? `<b>${fdate(c.dataset.d)}</b> · ${f1(a.km)} km · ${a.cnt} 次 · ${fdur(a.sec)} · 费用 ${fy(a.elec + a.fuel + a.toll)}`
        : `<b>${fdate(c.dataset.d)}</b> · 无行程`;
    });
  });
}

/* ================= 行程列表 ================= */
function renderTrips() {
  const days = Object.keys((S.trips || {})[DEV] || {}).sort().reverse();
  const box = $('#trips');
  let html = '', total = 0;
  for (const day of days) {
    const pack = S.trips[DEV][day];
    const recs = (pack.records || []).slice().sort((a, b) => (b.tripStartedAt || 0) - (a.tripStartedAt || 0));
    if (!recs.length) continue;
    total += recs.length;
    const s = pack.summary || {};
    html += `<div class="dayhead"><b>${fdate(day)}</b><span>${f1(s.tripKm ?? recs.reduce((a, r) => a + (+r.tripKm || 0), 0))} km · ${recs.length} 次${s.trafficLightCount != null ? ' · 红绿灯 ' + s.trafficLightCount : ''}</span></div>`;
    for (const r of recs) html += tripHtml(r);
  }
  box.innerHTML = html || '<div class="empty">暂无行程记录（车辆绑定后自动记录）</div>';
  $('#tripCount').textContent = total ? `共 ${total} 条` : '';
  box.querySelectorAll('.trip').forEach((t) => { t.addEventListener('click', (e) => { if (e.target.closest('a')) return; t.classList.toggle('open'); }); });
}

function tripHtml(r) {
  const id = r.id ?? r.tripId ?? '';
  const km = +r.tripKm || 0;
  const cost = (+r.estimatedElecYuan || 0) + (+r.estimatedFuelYuan || 0) + (+r.estimatedTollYuan || 0);
  const t0 = r.tripStartedAt || r.createdAt, t1 = r.tripEndAt;
  const badges = [];
  if (r.rapidAccelerationCount) badges.push(['急加速 ' + r.rapidAccelerationCount, 1]);
  if (r.hardBrakeCount) badges.push(['急刹 ' + r.hardBrakeCount, 1]);
  if (r.sharpTurnCount) badges.push(['急转 ' + r.sharpTurnCount, 1]);
  if (r.tripIccKm) badges.push(['内燃 ' + f1(r.tripIccKm) + 'km', 0]);
  const dl = [
    ['起点', r.tripStartAddress || r.address || '—'], ['终点', r.address || '—'],
    ['电量消耗', r.tripEvCostKm != null ? f1(r.tripEvCostKm) + ' km' : '—'], ['油量消耗', r.tripFuelCostKm != null ? f1(r.tripFuelCostKm) + ' km' : '—'],
    ['电费 / 油费', `${fy(r.estimatedElecYuan)} / ${fy(r.estimatedFuelYuan)}`], ['过路费', fy(r.estimatedTollYuan) + (r.tollDistanceKm ? `（${f1(r.tollDistanceKm)}km）` : '')],
    ['最高速度', r.tripMaxSpeedKmh != null ? r.tripMaxSpeedKmh + ' km/h' : '—'],
    ['平均速度', (r.tripDurationSec && km) ? f1(km / (r.tripDurationSec / 3600)) + ' km/h' : '—'],
    ['红绿灯', r.trafficLightCount ?? '—'], ['达成率', r.tripAchievementRate != null ? f1(r.tripAchievementRate) + '%' : '—'],
  ];
  if (r.totalMileageKm != null) dl.push(['总里程', Math.round(r.totalMileageKm) + ' km']);
  if (r.tripStartRangeEvKm != null && r.rangeEvKm != null) dl.push(['续航(起→终)', `${f1(r.tripStartRangeEvKm)} → ${f1(r.rangeEvKm)} km`]);
  let costNote = '';
  const cd = (S.tripCosts?.[DEV] || {})[id];
  if (cd) {
    const parts = [];
    if (cd.elec?.yuanPerKwh) parts.push(`电价 ¥${cd.elec.yuanPerKwh}/度（${cd.elec.sourceLabel || cd.elec.source}）`);
    if (cd.fuel?.yuanPerLiter92) parts.push(`油价 ¥${cd.fuel.yuanPerLiter92}/L（${cd.fuel.sourceLabel || cd.fuel.source}）`);
    if (cd.note) parts.push(esc(cd.note));
    if (parts.length) costNote = `<div class="costnote">费用口径：${parts.join('；')}。公式：${esc(cd.fuel?.formula || cd.elec?.formula || '')}</div>`;
  }
  return `<div class="trip">
    <div class="t1"><span class="km">${f1(r.tripKm)}<small> km</small></span><span class="rate">达成率 ${f1(r.tripAchievementRate)}%</span></div>
    <div class="t2"><span>${t0 ? fhm(t0) : '—'}${t1 ? ' – ' + fhm(t1) : ''}</span><span>${fdur(r.tripDurationSec)}</span><span>${cost ? '费用 ' + fy(cost) : ''}</span><span>#${id}</span></div>
    <div class="route">📍 ${esc(r.tripStartAddress || '')} → ${esc(r.address || '')}</div>
    ${badges.length ? `<div class="badges">${badges.map(([t, hot]) => `<span class="badge${hot ? ' hot' : ''}">${t}</span>`).join('')}</div>` : ''}
    <div class="detail">
      <dl class="dl">${dl.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      ${costNote}
    </div>
  </div>`;
}

/* ================= 其他版块 ================= */
function rowItem(title, sub, dateMs, pill = '') {
  return `<div class="rowitem"><div class="rh"><span class="t">${title}${pill}</span><span class="d">${dateMs ? fms(dateMs) : ''}</span></div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}

function renderDurationLogs() {
  const recs = (S.durationLogs?.records || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  $('#durationLogs').innerHTML = recs.length
    ? recs.map((r) => rowItem(
      `+${r.addedDays ?? (r.addedMs ? Math.round(r.addedMs / 86400e3) : '?')} 天${r.remark ? ' · ' + esc(r.remark) : ''}`,
      `有效期至 ${r.afterEndAt ? fms(r.afterEndAt) : '—'}`,
      r.createdAt)).join('')
    : '<div class="empty">暂无记录</div>';
}

function renderCodes() {
  let h = '';
  const subs = S.subscriptionCodes?.records || [];
  if (subs.length) h += subs.map((r) => rowItem(
    `订阅码 <b>${esc(r.code)}</b>`,
    r.boundDeviceId ? `已绑定设备 ${esc(r.boundDeviceId.slice(0, 8))}…` : '未绑定',
    r.createdAt,
    `<span class="pill ${r.expired ? 'bad' : 'ok'}">${r.expired ? '已过期' : '有效至 ' + fms(r.expireAt)}</span>`)).join('');
  const auths = S.authCodes?.records || [];
  if (auths.length) h += auths.map((r) => rowItem(
    `授权码 <b>${esc(r.code)}</b>`,
    r.usedAt ? '已使用' : '未使用（可用于激活用量时长）',
    r.createdAt,
    `<span class="pill ${r.used ? 'bad' : 'ok'}">${r.used ? '已用' : '未用'}</span>`)).join('');
  $('#codes').innerHTML = h || '<div class="empty">暂无订阅码 / 授权码</div>';
}

function renderLedgers() {
  let h = '';
  const pl = [...(S.pointsLedger?.in?.records || []).map((r) => ({ ...r, dir: '积分+' })), ...(S.pointsLedger?.out?.records || []).map((r) => ({ ...r, dir: '积分-' }))];
  for (const r of pl.sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)) {
    h += rowItem(`${r.dir}${r.deltaPoints > 0 ? '+' : ''}${r.deltaPoints}`, r.remark ? esc(r.remark) : r.entryType, r.createdAt, `<span class="pill">余 ${r.balanceAfter}</span>`);
  }
  const rl = [...(S.rtQuotaLedger?.in?.records || []).map((r) => ({ ...r, dir: 'RT+' })), ...(S.rtQuotaLedger?.out?.records || []).map((r) => ({ ...r, dir: 'RT-' }))];
  for (const r of rl.sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)) {
    h += rowItem(`${r.dir}${f1(r.deltaMinutes ?? r.minutes)} 分钟`, r.remark ? esc(r.remark) : (r.sourceType || ''), r.createdAt);
  }
  $('#ledgers').innerHTML = h || '<div class="empty">暂无积分 / RT 额度流水</div>';
}

function renderFences() {
  const g = (S.geofences || {})[DEV] || {};
  const so = (S.sentryOverview || {})[DEV] || {};
  const pc = (S.parkingCurrent || {})[DEV];
  let h = '';
  h += rowItem('哨兵监控', so.sentinelActive ? '哨兵开启中' : '哨兵未开启', null, `<span class="pill ${so.sentinelActive ? 'ok' : ''}">${so.sentinelActive ? '开' : '关'}</span>`);
  const fence = (name, j) => rowItem(`${name}围栏`, `${(j?.spots || []).length} 个点位${j?.maxSpots != null ? '（上限 ' + j.maxSpots + '）' : ''}`);
  if (g.sentryGeofence) h += fence('哨兵', g.sentryGeofence);
  if (g.chargingGeofence) h += fence('充电', g.chargingGeofence);
  if (g.parkingGeofence) h += fence('停车', g.parkingGeofence) + (g.parkingGeofence.monthlyParkingRentYuan ? rowItem('停车月租', `¥${f1(g.parkingGeofence.monthlyParkingRentYuan)}/月`) : '');
  if (pc && pc.t) h += rowItem('当前停车计费', `${fy(pc.estimatedAmountYuan ?? pc.estimatedYuan)} · ${esc(pc.parkingName || pc.poiName || '点位待补充')}`, pc.t);
  $('#fences').innerHTML = h;
}

function renderComp() {
  let h = '';
  const cs = S.competitions?.records || [];
  for (const c of cs.slice(0, 3)) {
    h += rowItem(esc(c.title || c.competitionCode), esc(c.subtitle || ''), c.registrationStartAt, `<span class="pill">${({ 0: '未开始', 1: '报名中', 2: '进行中', 4: '已结束' })[c.status] || '状态' + c.status}</span>`);
  }
  const hm = S.honorMileage?.stats || [];
  if (hm.length) h += rowItem(`${S.honorMileage.year} 赛事荣誉`, hm.map((x) => `${x.label} ${x.value}${x.unit || ''}`).join(' · '));
  const md = S.medals?.medals || [];
  for (const m of md.slice(0, 5)) h += rowItem(`🏅 ${esc(m.medalName || m.typeName || '勋章')}`, esc(m.subtitle || ''), m.obtainedAt);
  $('#comp').innerHTML = h || '<div class="empty">暂无赛事与勋章</div>';
}

function renderNotifs() {
  const ns = S.notifications?.records || [];
  $('#unread').textContent = S.notifications?.unreadCount ? S.notifications.unreadCount + ' 条未读' : '';
  $('#notifs').innerHTML = ns.length
    ? ns.map((n) => rowItem(
      `${esc(n.title || '通知')}${n.pinned ? ' 📌' : ''}`,
      esc((n.content || '').replace(/[#*`\n>\[\]!-]/g, ' ').replace(/\s+/g, ' ').slice(0, 80)),
      n.createdAt,
      `<span class="pill ${n.read ? '' : 'ok'}">${n.read ? '已读' : '未读'}</span>`)).join('')
    : '<div class="empty">暂无通知</div>';
}

function renderCoverage() {
  const days = Object.keys((S.trips || {})[DEV] || {}).sort();
  const fails = (S.meta?.failures) || [];
  $('#coverage').textContent = days.length
    ? `数据覆盖 ${fdate(days[0])} ~ ${fdate(days[days.length - 1])}（${days.length} 天）`
    : '暂无历史数据';
}

/* ================= 尾部按钮 ================= */
$('#btnReload').onclick = () => location.reload();
$('#btnLock').onclick = () => { localStorage.removeItem('surcam_cache'); location.reload(); };

boot();
