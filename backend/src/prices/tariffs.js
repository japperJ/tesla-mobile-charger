/**
 * Konstant tariff table for DK1
 * Three time-of-day tiers (approximate — override via config if needed)
 */

const TARIFFS = [
  // Low: 00:00–06:00
  { start: 0, end: 6, dkk: 0.20 },
  // Mid: 06:00–17:00
  { start: 6, end: 17, dkk: 0.45 },
  // Peak: 17:00–21:00
  { start: 17, end: 21, dkk: 1.10 },
  // Mid: 21:00–24:00
  { start: 21, end: 24, dkk: 0.45 },
];

function getTariffForHour(hour) {
  for (const tier of TARIFFS) {
    if (hour >= tier.start && hour < tier.end) {
      return tier.dkk;
    }
  }
  return 0.45; // fallback to mid
}

module.exports = { getTariffForHour, TARIFFS };
