const express = require('express');
const router = express.Router();
const { getPublicStreams } = require('../controllers/streamController');

/**
 * API endpoint to retrieve the list of currently active streams. This
 * allows external clients or admin panels to query the server for
 * available streams without using WebSockets.
 *
 * GET /api/streams
 * Response: { streams: Array<{streamId, title, hostId}> }
 */
router.get('/streams', (req, res) => {
  const streams = getPublicStreams();
  res.json({ streams });
});

module.exports = router;