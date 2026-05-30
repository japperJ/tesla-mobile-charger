const { storePrices, getPricesForDate, getTodayAndTomorrow } = require('./energinet');

/**
 * Seed today's prices if cache is empty for today
 */
async function seedTodayIfEmpty() {
  const { today } = getTodayAndTomorrow();
  const existing = getPricesForDate(today);
  if (existing.length === 0) {
    console.log('Seeding today prices...');
    await storePrices(today);
  }
}

/**
 * Fetch tomorrow's prices (called daily at 13:05)
 */
async function fetchTomorrowPrices() {
  const { tomorrow } = getTodayAndTomorrow();
  console.log(`Fetching prices for ${tomorrow}...`);
  await storePrices(tomorrow);
}

module.exports = { seedTodayIfEmpty, fetchTomorrowPrices };
