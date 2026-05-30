require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { initDb } = require('./db/database');
const { setupWebSocket } = require('./websocket');
const routes = require('./api/routes');

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Initialize database (must be before routes that read config)
initDb();

// Export EC private key for Vehicle Command Proxy sidecar
const { exportPrivateKeyFile } = require('./tesla/keys');
exportPrivateKeyFile();

// Serve Tesla public key for Fleet API partner registration
// Tesla requires this at: {domain}/.well-known/appspecific/com.tesla.3p.public-key.pem
app.get('/.well-known/appspecific/com.tesla.3p.public-key.pem', (req, res) => {
  const { getPublicKeyPem } = require('./tesla/keys');
  res.type('text/plain').send(getPublicKeyPem());
});

// REST API routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// WebSocket
setupWebSocket(server);

const PORT = process.env.PORT || 4002;
server.listen(PORT, () => {
  console.log(`Tesla Charger backend running on port ${PORT}`);

  // Seed today's prices on startup if cache empty
  const { seedTodayIfEmpty } = require('./prices/scheduler');
  seedTodayIfEmpty().catch(console.error);

  // Start the charging executor (start/stop charging at scheduled times)
  const { startExecutor } = require('./charging/executor');
  startExecutor();
});
