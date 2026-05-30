/**
 * ntfy.sh push notifications
 */
const axios = require('axios');
const { getConfigValue } = require('../db/config');

async function notify(title, message, priority = 'default', tags = []) {
  const topic = getConfigValue('ntfy_topic');
  const server = getConfigValue('ntfy_server') || 'https://ntfy.sh';

  if (!topic) {
    console.log('ntfy: no topic configured, skipping notification');
    return;
  }

  try {
    await axios.post(`${server}/${topic}`, message, {
      headers: {
        Title: title,
        Priority: priority,
        Tags: tags.join(','),
        'Content-Type': 'text/plain',
      },
    });
    console.log(`ntfy sent: ${title}`);
  } catch (err) {
    console.error('ntfy error:', err.message);
  }
}

module.exports = { notify };
