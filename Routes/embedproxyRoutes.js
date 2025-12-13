import express from 'express';
import { fetchVideoInfo } from '../Modules/embedproxy.js';

const router = express.Router();

const videoCache = new Map();
const CACHE_DURATION = 3 * 60 * 1000; // 3 minutes (URLs expire fast)
// API info endpoint
router.get('/info/:videoId', async (req, res) => {
  try {
    const info = await fetchVideoInfo(req.params.videoId);
    res.json(info);
  } catch (err) {
    console.error('[API Error]', err.message);
    res.json({ error: err.message });
  }
});

// Test endpoint - just returns the direct URL
router.get('/url/:videoId/:formatId', async (req, res) => {
  try {
    const info = await fetchVideoInfo(req.params.videoId);
    const format = info.formats.find(f => f.format_id === req.params.formatId);
    if (format && format.directUrl) {
      res.json({ url: format.directUrl });
    } else {
      res.json({ error: 'Format not found' });
    }
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Stream proxy endpoint
router.get('/stream/:videoId/:formatId', async (req, res) => {
  const { videoId, formatId } = req.params;

  console.log('\n[STREAM] ===== Request:', videoId, formatId, '=====');

  try {
    const info = await fetchVideoInfo(videoId);
    const format = info.formats.find(f => f.format_id === formatId);

    if (!format) {
      console.log('[STREAM] Format not found');
      return res.status(404).send('Format not found');
    }

    if (!format.directUrl) {
      console.log('[STREAM] No URL for format');
      return res.status(404).send('No URL available');
    }

    const targetUrl = format.directUrl;
    console.log('[STREAM] Target URL length:', targetUrl.length);
    console.log('[STREAM] Target host:', new URL(targetUrl).hostname);

    const urlObj = new URL(targetUrl);

    const proxyHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Encoding': 'identity', // No compression
      'Connection': 'keep-alive',
      'Referer': 'https://www.youtube.com/',
      'Origin': 'https://www.youtube.com'
    };

    // Forward range header
    if (req.headers.range) {
      proxyHeaders['Range'] = req.headers.range;
      console.log('[STREAM] Range:', req.headers.range);
    }

    console.log('[STREAM] Making request to YouTube...');

    const proxyReq = https.request({
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: proxyHeaders
    }, (proxyRes) => {
      console.log('[STREAM] Response:', proxyRes.statusCode);
      console.log('[STREAM] Content-Type:', proxyRes.headers['content-type']);
      console.log('[STREAM] Content-Length:', proxyRes.headers['content-length']);

      if (proxyRes.statusCode === 403) {
        console.log('[STREAM] 403 - URL expired, clearing cache');
        videoCache.delete(videoId);
        res.status(403).send('URL expired - please reload');
        return;
      }

      if (proxyRes.statusCode >= 400) {
        console.log('[STREAM] Error status:', proxyRes.statusCode);
        res.status(proxyRes.statusCode).send('YouTube error: ' + proxyRes.statusCode);
        return;
      }

      // Set response headers
      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (proxyRes.headers['content-length']) {
        res.setHeader('Content-Length', proxyRes.headers['content-length']);
      }
      if (proxyRes.headers['content-range']) {
        res.setHeader('Content-Range', proxyRes.headers['content-range']);
      }

      res.status(proxyRes.statusCode);

      // Pipe the response
      proxyRes.pipe(res);

      proxyRes.on('end', () => {
        console.log('[STREAM] Transfer complete');
      });
    });

    proxyReq.on('error', (err) => {
      console.error('[STREAM] Request error:', err.message);
      if (!res.headersSent) {
        res.status(500).send('Stream error: ' + err.message);
      }
    });

    req.on('close', () => {
      console.log('[STREAM] Client closed connection');
      proxyReq.destroy();
    });

    proxyReq.end();

  } catch (err) {
    console.error('[STREAM] Error:', err.message);
    if (!res.headersSent) {
      res.status(500).send('Error: ' + err.message);
    }
  }
});

// Redirect endpoint - just redirects to YouTube URL
router.get('/redirect/:videoId/:formatId', async (req, res) => {
  try {
    const info = await fetchVideoInfo(req.params.videoId);
    const format = info.formats.find(f => f.format_id === req.params.formatId);
    if (format && format.directUrl) {
      res.redirect(format.directUrl);
    } else {
      res.status(404).send('Not found');
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Cache cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of videoCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      videoCache.delete(key);
      console.log('[CACHE] Expired:', key);
    }
  }
}, 30000);

export default router;
