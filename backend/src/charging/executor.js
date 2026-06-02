/**
 * Charging Executor
 * Runs every minute, checks whether it's time to start or stop charging
 * based on planned sessions in the DB. Also disables any Tesla native
 * scheduled charging to prevent conflicts.
 */
const { getDb } = require('../db/database');
const { getConfig } = require('../db/config');
const { resolveDepartureSettings } = require('./schedule-mode');
const { shouldStartSession, shouldStopSession } = require('./session-timing');
const { getVehicleId, startCharging, stopCharging, waitForOnline, setChargeLimit } = require('../tesla/client');
const { hasCredentials } = require('../tesla/credentials');
const { notify } = require('../notifications/ntfy');
const { getDkNow } = require('./time');

let executorInterval = null;

function startExecutor() {
  if (executorInterval) return;
  // Run immediately on startup, then every 60 seconds
  runExecutor().catch(console.error);
  executorInterval = setInterval(() => runExecutor().catch(console.error), 60_000);
  console.log('[Executor] Charging executor started');
}

function stopExecutor() {
  if (executorInterval) {
    clearInterval(executorInterval);
    executorInterval = null;
  }
}

async function runExecutor() {
  if (!hasCredentials()) return;

  const { date: todayStr, hour: nowHour, minute: nowMinute } = getDkNow();
  const timeStr = `${String(nowHour).padStart(2, '0')}:${String(nowMinute).padStart(2, '0')}`;

  const db = getDb();
  const sessions = db.prepare(`
    SELECT * FROM charging_sessions
    WHERE date = ? AND status IN ('planned', 'charging')
    ORDER BY planned_start ASC
  `).all(todayStr);

  for (const session of sessions) {
    // Start any planned session while its window is still active.
    if (shouldStartSession(session, timeStr)) {
      await handleStart(session);
    }
    // Stop charging once planned end has been reached.
    if (shouldStopSession(session, timeStr)) {
      await handleStop(session);
    }
  }
}

async function handleStart(session) {
  const db = getDb();
  console.log(`[Executor] Starting charge for session ${session.id} (${session.planned_start}–${session.planned_end})`);
  try {
    const vehicleId = await getVehicleId();
    await waitForOnline(vehicleId, 60_000);

    // Set charge limit to target SOC BEFORE starting — car is its own failsafe if app crashes
    const config = getConfig();
    const { date: todayStr, hour: nowHour } = getDkNow();
    const { targetSoc } = resolveDepartureSettings({ config, todayStr, nowHour });
    await setChargeLimit(vehicleId, targetSoc);
    console.log(`[Executor] Charge limit set to ${targetSoc}%`);

    await startCharging(vehicleId);

    db.prepare(`
      UPDATE charging_sessions SET status='charging', actual_start=? WHERE id=?
    `).run(new Date().toISOString(), session.id);

    console.log(`[Executor] Charging started for session ${session.id}`);
    notify(`⚡ Charging started (${session.planned_start}–${session.planned_end}), limit set to ${targetSoc}%`).catch(() => {});
  } catch (err) {
    console.error(`[Executor] Failed to start charging:`, err.message);
    notify(`❌ Failed to start charging: ${err.message}`).catch(() => {});
  }
}

async function handleStop(session) {
  const db = getDb();
  console.log(`[Executor] Stopping charge for session ${session.id} at ${session.planned_end}`);
  try {
    const vehicleId = await getVehicleId();
    await stopCharging(vehicleId);

    db.prepare(`
      UPDATE charging_sessions SET status='done', actual_end=? WHERE id=?
    `).run(new Date().toISOString(), session.id);

    console.log(`[Executor] Charging stopped for session ${session.id}`);
    notify(`✅ Charging complete (${session.planned_start}–${session.planned_end})`).catch(() => {});
  } catch (err) {
    console.error(`[Executor] Failed to stop charging:`, err.message);
    notify(`❌ Failed to stop charging: ${err.message}`).catch(() => {});
  }
}

module.exports = { startExecutor, stopExecutor };
