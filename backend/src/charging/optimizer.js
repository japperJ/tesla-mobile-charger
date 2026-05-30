/**
 * Charging window optimizer
 * Finds cheapest N consecutive or non-consecutive hours before departure
 */
const { getPricesForDate, storePrices } = require('../prices/energinet');
const { getDb } = require('../db/database');
const { getConfig, updateConfig } = require('../db/config');
const { addDays, resolveDepartureSettings, toDepartureInfo } = require('./schedule-mode');
const { getDkNow } = require('./time');
const { v4: uuidv4 } = require('uuid');

function hoursNeeded(targetSoc, currentSoc, batteryKwh, chargerKw) {
  if (currentSoc >= targetSoc) return 0;
  const kwhNeeded = ((targetSoc - currentSoc) / 100) * batteryKwh;
  return Math.ceil(kwhNeeded / chargerKw);
}

function buildSchedule(hours) {
  const sorted = [...hours].sort((a, b) => a - b);
  const windows = [];
  let windowStart = null;
  let prev = null;

  for (const hour of sorted) {
    if (windowStart === null) {
      windowStart = hour;
    } else if (hour !== prev + 1) {
      windows.push({ start: `${String(windowStart).padStart(2, '0')}:00`, end: `${String(prev + 1).padStart(2, '0')}:00` });
      windowStart = hour;
    }
    prev = hour;
  }
  if (windowStart !== null) {
    windows.push({ start: `${String(windowStart).padStart(2, '0')}:00`, end: `${String(prev + 1).padStart(2, '0')}:00` });
  }

  return windows;
}



async function calculateOptimalWindow(date, currentSoc) {
  const config = getConfig();
  const chargerKw = parseFloat(config.charger_kw);
  const batteryKwh = parseFloat(config.battery_kwh);

  const { date: todayStr, hour: nowHour } = getDkNow();
  const tomorrowStr = addDays(todayStr, 1);
  const effectiveSettings = resolveDepartureSettings({ config, todayStr, nowHour });
  const {
    departureDate,
    departureHour,
    targetSoc,
    isActiveDepartureDay,
    overnight,
  } = effectiveSettings;
  const departureInfo = isActiveDepartureDay ? toDepartureInfo(departureDate, departureHour) : null;

  updateConfig({
    last_departure_date: departureInfo?.date || '',
    last_departure_hour: departureInfo ? String(departureHour) : '',
  });

  if (!isActiveDepartureDay) {
    console.log(`[Schedule] ${departureDate} not active — clearing schedule`);
    clearPlannedSessions(todayStr, tomorrowStr);
    return {
      windows: [],
      needed: 0,
      currentSoc: currentSoc ?? 50,
      reason: 'not_active_day',
      departureDate,
      departureHour,
      departureInfo,
    };
  }

  const soc = currentSoc ?? 50;
  const needed = hoursNeeded(targetSoc, soc, batteryKwh, chargerKw);

  if (needed === 0) {
    console.log('[Schedule] Already at target SOC');
    clearPlannedSessions(todayStr, tomorrowStr);
    return {
      windows: [],
      needed: 0,
      currentSoc: soc,
      reason: 'at_target',
      departureDate,
      departureHour,
      departureInfo,
    };
  }

  let priceEntries = [];

  if (overnight) {
    const todayPrices = getPricesForDate(todayStr);
    priceEntries.push(...todayPrices
      .filter(p => p.hour >= nowHour)
      .map(p => ({ ...p, sessionDate: todayStr }))
    );

    let tomorrowPrices = getPricesForDate(tomorrowStr);
    if (!tomorrowPrices.length) {
      console.log('[Schedule] Fetching tomorrow prices for overnight window...');
      try { await storePrices(tomorrowStr); } catch (e) { console.warn('[Schedule] Could not fetch tomorrow prices:', e.message); }
      tomorrowPrices = getPricesForDate(tomorrowStr);
    }
    priceEntries.push(...tomorrowPrices
      .filter(p => p.hour < departureHour)
      .map(p => ({ ...p, sessionDate: tomorrowStr }))
    );
  } else {
    const prices = getPricesForDate(todayStr);
    priceEntries.push(...prices
      .filter(p => p.hour >= nowHour && p.hour < departureHour)
      .map(p => ({ ...p, sessionDate: todayStr }))
    );
  }

  if (!priceEntries.length) {
    console.warn('[Schedule] No price data available for window');
    return {
      windows: [],
      needed,
      currentSoc: soc,
      reason: 'no_price_data',
      departureDate,
      departureHour,
      departureInfo,
    };
  }

  if (priceEntries.length < needed) {
    console.warn(`[Schedule] Only ${priceEntries.length} hours available, need ${needed}`);
  }

  const cheapest = [...priceEntries]
    .sort((a, b) => a.total_dkk - b.total_dkk)
    .slice(0, needed);

  const byDate = {};
  for (const entry of cheapest) {
    if (!byDate[entry.sessionDate]) byDate[entry.sessionDate] = [];
    byDate[entry.sessionDate].push(entry.hour);
  }

  const db = getDb();
  clearPlannedSessions(todayStr, tomorrowStr);

  const insert = db.prepare(`
    INSERT INTO charging_sessions (id, date, planned_start, planned_end, start_soc, status)
    VALUES (?, ?, ?, ?, ?, 'planned')
  `);

  const allWindows = [];
  for (const [sessionDate, hours] of Object.entries(byDate)) {
    for (const w of buildSchedule(hours)) {
      insert.run(uuidv4(), sessionDate, w.start, w.end, soc);
      allWindows.push({ ...w, date: sessionDate });
    }
  }

  console.log(`[Schedule] Saved ${allWindows.length} window(s) for departure ${departureDate}`);
  return {
    windows: allWindows,
    needed,
    currentSoc: soc,
    departureDate,
    departureHour,
    departureInfo,
  };
}

function clearPlannedSessions(todayStr, tomorrowStr) {
  const db = getDb();
  db.prepare(`DELETE FROM charging_sessions WHERE date IN (?, ?) AND status = 'planned'`).run(todayStr, tomorrowStr);
}

function getTodaySchedule() {
  const db = getDb();
  const { date: today } = getDkNow();
  const tomorrow = addDays(today, 1);
  // Return upcoming sessions (today + tomorrow) so overnight windows show correctly
  return db.prepare(`
    SELECT * FROM charging_sessions WHERE date IN (?, ?) ORDER BY date ASC, planned_start ASC
  `).all(today, tomorrow);
}

function getSessionHistory(limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM charging_sessions ORDER BY date DESC, planned_start ASC LIMIT ?
  `).all(limit);
}

module.exports = { calculateOptimalWindow, getTodaySchedule, getSessionHistory };

