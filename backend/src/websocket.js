const WebSocket = require('ws');
const { parse: parseCookie } = require('cookie');
const { getStatus } = require('./tesla/client');
const { hasCredentials } = require('./tesla/credentials');
const { getConfig } = require('./db/config');
const { toDepartureInfo } = require('./charging/schedule-mode');
const { getTodaySchedule, calculateOptimalWindow } = require('./charging/optimizer');
const { isValidWsToken, TOKEN_COOKIE } = require('./middleware/auth');

let wss;
const clients = new Set();
let statusInterval;
let lastScheduledSoc = null; // track SOC used for last schedule calculation

function setupWebSocket(server) {
  wss = new WebSocket.Server({
    server,
    path: '/ws',
    verifyClient: ({ req }, cb) => {
      // Extract token from cookie header
      const cookies = parseCookie(req.headers['cookie'] || '');
      const token = cookies[TOKEN_COOKIE];
      if (isValidWsToken(token)) {
        cb(true);
      } else {
        cb(false, 401, 'Unauthorized');
      }
    },
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`WS client connected (${clients.size} total)`);

    // Send current status immediately on connect
    pushStatusToClient(ws);

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`WS client disconnected (${clients.size} total)`);
    });

    ws.on('error', (err) => {
      console.error('WS error:', err.message);
      clients.delete(ws);
    });
  });

  // Push status to all clients every 30 seconds while anyone is connected
  statusInterval = setInterval(async () => {
    if (clients.size === 0) return;
    const payload = await buildStatusPayload();
    broadcast(payload);
  }, 30000);

  console.log('WebSocket server ready on /ws');
}

async function buildStatusPayload() {
  try {
    if (!hasCredentials()) {
      return { type: 'status', data: { configured: false } };
    }
    const config = getConfig();
    const [status, schedule] = await Promise.allSettled([
      getStatus(),
      Promise.resolve(getTodaySchedule()),
    ]);

    const currentSoc = status.status === 'fulfilled' ? status.value?.soc : null;

    // Auto-recalculate if SOC dropped ≥5% since last calculation (e.g. after a drive)
    if (
      currentSoc != null &&
      lastScheduledSoc != null &&
      currentSoc < lastScheduledSoc - 5
    ) {
      console.log(`[Schedule] SOC dropped from ${lastScheduledSoc}% to ${currentSoc}% — auto-recalculating`);
      try {
        await calculateOptimalWindow(null, currentSoc);
        lastScheduledSoc = currentSoc;
      } catch (e) {
        console.warn('[Schedule] Auto-recalculate on SOC drop failed:', e.message);
      }
    } else if (currentSoc != null && lastScheduledSoc == null) {
      lastScheduledSoc = currentSoc;
    }

    return {
      type: 'status',
      ts: Date.now(),
      data: {
        configured: true,
        vehicle: status.status === 'fulfilled' ? status.value : { error: status.reason?.message },
        schedule: getTodaySchedule(),
        departureInfo: toDepartureInfo(config.last_departure_date, config.last_departure_hour),
      },
    };
  } catch (err) {
    return { type: 'error', message: err.message };
  }
}

async function pushStatusToClient(ws) {
  if (ws.readyState !== WebSocket.OPEN) return;
  const payload = await buildStatusPayload();
  ws.send(JSON.stringify(payload));
}

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function broadcastUpdate(type, data) {
  broadcast({ type, ts: Date.now(), data });
}

function setLastScheduledSoc(soc) {
  lastScheduledSoc = soc;
}

module.exports = { setupWebSocket, broadcastUpdate, setLastScheduledSoc, broadcastNow: () => buildStatusPayload().then(broadcast) };
