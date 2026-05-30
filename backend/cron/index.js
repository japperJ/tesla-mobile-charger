/**
 * Cron job runner — runs inside a dedicated Docker container
 * Executes scheduled tasks for price fetching, schedule optimization, and charge monitoring
 */
require('dotenv').config({ path: '/app/.env' });
const cron = require('node-cron');
const { initDb } = require('../src/db/database');
const { fetchTomorrowPrices } = require('../src/prices/scheduler');
const { calculateOptimalWindow, getTodaySchedule } = require('../src/charging/optimizer');
const { getStatus, startCharging, stopCharging, climateStart, getVehicleId } = require('../src/tesla/client');
const { hasCredentials } = require('../src/tesla/credentials');
const { notify } = require('../src/notifications/ntfy');
const { getTodayAndTomorrow } = require('../src/prices/energinet');
const { getConfig, getConfigValue } = require('../src/db/config');

initDb();

console.log('Tesla Charger Cron Runner started');

// 13:05 — Fetch tomorrow's prices
cron.schedule('5 13 * * *', async () => {
  console.log('[CRON] Fetching tomorrow prices...');
  try {
    await fetchTomorrowPrices();
    console.log('[CRON] Tomorrow prices fetched');
  } catch (err) {
    console.error('[CRON] Price fetch error:', err.message);
    await notify('Price Fetch Failed', err.message, 'high', ['warning']);
  }
});

// 13:10 — Recalculate optimal window using fresh tomorrow prices
cron.schedule('10 13 * * *', async () => {
  console.log('[CRON] Recalculating tomorrow schedule...');
  if (!hasCredentials()) return;
  try {
    const { tomorrow } = getTodayAndTomorrow();
    const status = await getStatus().catch(() => ({ soc: null }));
    const result = await calculateOptimalWindow(tomorrow, status.soc);
    if (result) {
      const windowsStr = result.windows.map(w => `${w.start}–${w.end}`).join(', ');
      await notify(
        'Charging Schedule Updated',
        `Tomorrow: ${windowsStr || 'No charging needed'}`,
        'default',
        ['calendar']
      );
    }
  } catch (err) {
    console.error('[CRON] Schedule recalc error:', err.message);
  }
});

// Hourly — Start/stop charging based on schedule
cron.schedule('2 * * * *', async () => {
  if (!hasCredentials()) return;
  console.log('[CRON] Checking charging schedule...');

  try {
    const now = new Date();
    const currentHour = String(now.getHours()).padStart(2, '0') + ':00';
    const sessions = getTodaySchedule();

    for (const session of sessions) {
      if (session.planned_start === currentHour && session.status === 'planned') {
        console.log(`[CRON] Starting charge at ${currentHour}`);
        const vehicleId = await getVehicleId();
        await startCharging(vehicleId);
        await notify('Charging Started', `Scheduled charging started at ${currentHour}`, 'default', ['electric_plug']);
      }

      if (session.planned_end === currentHour && session.status === 'charging') {
        console.log(`[CRON] Stopping charge at ${currentHour}`);
        const vehicleId = await getVehicleId();
        await stopCharging(vehicleId);
        await notify('Charging Complete', `Scheduled charging ended at ${currentHour}`, 'default', ['white_check_mark']);
      }
    }
  } catch (err) {
    console.error('[CRON] Schedule check error:', err.message);
  }
});

// Every 5 min while charging — verify car is actually charging
cron.schedule('*/5 * * * *', async () => {
  if (!hasCredentials()) return;

  try {
    const status = await getStatus();
    if (status.chargingState === 'Charging') {
      // Car is charging fine — do nothing
      return;
    }

    const sessions = getTodaySchedule();
    const now = new Date();
    const hourNow = now.getHours();

    const isInWindow = sessions.some(s => {
      const startH = parseInt(s.planned_start);
      const endH = parseInt(s.planned_end);
      return hourNow >= startH && hourNow < endH && s.status === 'planned';
    });

    if (isInWindow && status.pluggedIn && status.chargingState !== 'Charging') {
      console.warn('[CRON] Car should be charging but is not!');
      await notify(
        'Charging Alert ⚠️',
        `Car should be charging but state is: ${status.chargingState}`,
        'high',
        ['warning', 'electric_plug']
      );
    }
  } catch (err) {
    // Car might be sleeping — normal, don't alert
  }
});

// Keep process alive
setInterval(() => {}, 1 << 30);

// ─── Helpers ──────────────────────────────────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Every minute — pre-heat check
cron.schedule('* * * * *', async () => {
  if (!hasCredentials()) return;
  const config = getConfig();
  if (config.preheat_enabled !== '1') return;

  const departureTime = config.departure_time;
  if (!departureTime) return;

  // Check if today is an active day
  const now = new Date();
  const dayBit = 1 << ((now.getDay() + 6) % 7); // Mon=0, Sun=6
  if (!(parseInt(config.days_of_week || 0) & dayBit)) return;

  // Calculate preheat trigger time
  const [depH, depM] = departureTime.split(':').map(Number);
  const offsetMin = parseInt(config.preheat_offset_min || 15);
  const triggerTotal = depH * 60 + depM - offsetMin;
  const triggerH = Math.floor(triggerTotal / 60);
  const triggerM = triggerTotal % 60;

  if (now.getHours() !== triggerH || now.getMinutes() !== triggerM) return;

  const temp = parseFloat(config.preheat_temp_c || 21);

  try {
    const status = await getStatus();

    // Skip if car is not home (within 500m)
    const homeLat = parseFloat(config.home_lat);
    const homeLng = parseFloat(config.home_lng);
    if (homeLat && homeLng && status.latitude && status.longitude) {
      const distKm = haversineKm(homeLat, homeLng, status.latitude, status.longitude);
      if (distKm > 0.5) {
        console.log(`[CRON] Pre-heat skipped: car is ${(distKm * 1000).toFixed(0)}m from home`);
        return;
      }
    }

    const vehicleId = await getVehicleId();
    await climateStart(vehicleId, temp);
    await notify(
      'Pre-heat Started 🌡️',
      `Car pre-heating to ${temp}°C — ${offsetMin} min before departure at ${departureTime}`,
      'default', ['thermometer']
    );
    console.log(`[CRON] Pre-heat started: ${temp}°C, ${offsetMin} min before ${departureTime}`);
  } catch (err) {
    console.error('[CRON] Pre-heat error:', err.message);
  }
});
