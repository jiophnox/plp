import https from 'https';
const videoCache = new Map();
const CACHE_DURATION = 3 * 60 * 1000; 
// Simple HTTPS GET with full response
function httpsGet(url, timeout = 90000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*'
      },
      timeout
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

const YTDLP_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept': 'text/event-stream,text/plain,*/*',
  'Accept-Encoding': 'identity', // ⬅️ VERY IMPORTANT (prevents truncation)
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache'
};


const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchVideoInfo(videoId) {
  const cached = videoCache.get(videoId);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('[CACHE] Using cached:', videoId);
    return cached.data;
  }

  const apiUrl = `https://ytdlp.online/stream?command=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId} -j`
  )}`;

  const MAX_RETRIES = 3; // ⬅️ reduced attempts
  let response;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[YTDLP] Fetching (${attempt}/${MAX_RETRIES}):`, videoId);

    response = await httpsGet(apiUrl, 120000, {
      headers: YTDLP_HEADERS
    });

    const length = response?.data?.length || 0;
    console.log('[YTDLP] Status:', response.status, 'Length:', length);

    if (length > 1000) break;

    if (attempt < MAX_RETRIES) {
      console.warn('[YTDLP] Response too small, retrying in 1s...');
      await sleep(1000);
    }
  }

  if (!response || response.data.length <= 1000) {
    throw new Error('YTDLP failed after retries');
  }

  // ===== Parse SSE =====
  let jsonData = null;

  for (const line of response.data.split('\n')) {
    if (line.startsWith('data: ') && !line.includes('<font')) {
      try {
        const parsed = JSON.parse(line.slice(6));
        if (parsed.formats) {
          jsonData = parsed;
          break;
        }
      } catch {}
    }
  }

  if (!jsonData) {
    throw new Error('Could not parse video info');
  }

  console.log('[YTDLP] Found', jsonData.formats?.length, 'formats');

  const formats = (jsonData.formats || [])
    .filter(f =>
      f.url &&
      !f.format_note?.includes('storyboard') &&
      f.ext !== 'mhtml'
    )
    .map(f => ({
      format_id: String(f.format_id),
      directUrl: f.url,
      ext: f.ext || 'mp4',
      height: f.height || 0,
      width: f.width || 0,
      vcodec: f.vcodec || 'none',
      acodec: f.acodec || 'none',
      abr: f.abr || 0,
      filesize: f.filesize || f.filesize_approx || 0,
      hasVideo: f.vcodec && f.vcodec !== 'none',
      hasAudio: f.acodec && f.acodec !== 'none'
    }));

  const result = {
    id: jsonData.id || videoId,
    title: jsonData.title || 'Unknown',
    duration: jsonData.duration || 0,
    formats
  };

  videoCache.set(videoId, {
    timestamp: Date.now(),
    data: result
  });

  return result;
}



export { fetchVideoInfo }
