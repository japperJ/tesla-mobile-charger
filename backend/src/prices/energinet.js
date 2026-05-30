/**
 * Energinet DK1 spot price fetcher
 * Uses the Energi Data Service API (free, no auth required)
 *
 * Important: do NOT use start/end params — they cause timezone confusion
 * and return empty results. Instead fetch the 48 newest records and filter
 * by HourDK date prefix in application code (same approach as reference app).
 */
const axios = require('axios');
const { getDb } = require('../db/database');
const { getTariffForHour } = require('./tariffs');

// DayAheadPrices replaced Elspotprices on 2025-10-01
// Fields: TimeDK (Danish local time), DayAheadPriceDKK (DKK/MWh)
// Resolution: 15-minute — filter to :00 records for one row per hour
const ENERGINET_API = 'https://api.energidataservice.dk/dataset/DayAheadPrices';

async function fetchSpotPrices(date, retries = 3) {
  const params = {
    filter: JSON.stringify({ PriceArea: ['DK1'] }),
    sort: 'TimeDK desc',
    limit: 192, // 2 days × 24h × 4 quarters
  };

  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    let resp;
    try {
      resp = await axios.get(ENERGINET_API, { params, validateStatus: null });
    } catch (err) {
      lastError = err;
      break;
    }

    if (resp.status === 429) {
      const wait = parseInt(resp.headers['retry-after'] || '60', 10);
      console.warn(`[Energinet] Rate limited — waiting ${wait}s (attempt ${attempt + 1}/${retries})`);
      await new Promise(r => setTimeout(r, wait * 1000));
      continue;
    }

    if (resp.status !== 200) {
      throw new Error(`Energinet API returned ${resp.status}`);
    }

    const records = resp.data?.records || [];
    // Keep only records for the requested date at the top of each hour (:00)
    const filtered = records.filter(r => {
      const t = r.TimeDK || '';
      return t.startsWith(date) && (t.slice(14, 16) === '00' || t.length === 13);
    });

    if (!filtered.length && records.length) {
      const available = [...new Set(records.map(r => (r.TimeDK || '').slice(0, 10)))].sort();
      console.warn(`[Energinet] 0 records for ${date}. Available dates: ${available.join(', ')}`);
    }

    return filtered;
  }

  throw lastError || new Error(`Energinet API rate-limited after ${retries} retries`);
}

async function storePrices(date) {
  const db = getDb();
  const records = await fetchSpotPrices(date);

  if (!records.length) {
    console.warn(`[Energinet] No prices found for ${date}`);
    return [];
  }

  const insert = db.prepare(`
    INSERT OR REPLACE INTO price_cache (date, hour, spot_dkk, tariff_dkk, total_dkk)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items) => {
    for (const item of items) {
      const timeDk = item.TimeDK || '';
      const hour = parseInt(timeDk.slice(11, 13), 10);
      const spotDkk = (item.DayAheadPriceDKK || 0) / 1000; // DKK/MWh → DKK/kWh
      const tariffDkk = getTariffForHour(hour);
      insert.run(date, hour, spotDkk, tariffDkk, spotDkk + tariffDkk);
    }
  });

  insertMany(records);
  console.log(`[Energinet] Stored ${records.length} price records for ${date}`);
  return records;
}

function getPricesForDate(date) {
  const db = getDb();
  return db.prepare(`
    SELECT hour, spot_dkk, tariff_dkk, total_dkk
    FROM price_cache
    WHERE date = ?
    ORDER BY hour ASC
  `).all(date);
}

function getTodayAndTomorrow() {
  const now = new Date();
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Copenhagen' });
  const tomorrowDate = new Date(now.getTime() + 86400000);
  const tomorrow = tomorrowDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Copenhagen' });
  return { today, tomorrow };
}

module.exports = { storePrices, getPricesForDate, getTodayAndTomorrow };
