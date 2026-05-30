/**
 * Shared timezone helper — always returns Danish local time
 * Uses hourCycle:'h23' so midnight = 0, not '24'
 */
function getDkNow() {
  const now = new Date();
  const date = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Copenhagen' });
  const hour = parseInt(
    now.toLocaleString('en-US', { timeZone: 'Europe/Copenhagen', hour: 'numeric', hourCycle: 'h23' }), 10
  );
  const minute = parseInt(
    now.toLocaleString('en-US', { timeZone: 'Europe/Copenhagen', minute: 'numeric' }), 10
  );
  return { date, hour, minute };
}

module.exports = { getDkNow };
