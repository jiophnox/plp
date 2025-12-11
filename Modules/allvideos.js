import { Innertube, Log } from 'youtubei.js';

Log.setLevel(Log.Level.NONE);

let ytInstance = null;

// Cache structure for each channel
const channelCache = new Map();

// Background fetch status
const fetchStatus = new Map();

async function initYouTube() {
  if (ytInstance) return ytInstance;

  ytInstance = await Innertube.create({
    retrieve_player: false,
    generate_session_locally: true,
    lang: 'en',
    location: 'US'
  });

  console.log('✅ YouTube instance initialized');
  return ytInstance;
}

async function resolveChannelId(youtube, channelIdentifier) {
  let channelId = channelIdentifier;

  if (channelIdentifier.startsWith('@') || channelIdentifier.includes('youtube.com')) {
    if (channelIdentifier.includes('youtube.com')) {
      const handleMatch = channelIdentifier.match(/@([\w-]+)/);
      const channelMatch = channelIdentifier.match(/channel\/([\w-]+)/);
      channelIdentifier = handleMatch ? '@' + handleMatch[1] : (channelMatch ? channelMatch[1] : channelIdentifier);
    }

    if (channelIdentifier.startsWith('@')) {
      try {
        const channel = await youtube.resolveURL(`https://www.youtube.com/${channelIdentifier}`);
        if (channel?.payload?.browseId) {
          return channel.payload.browseId;
        }
      } catch (e) {}

      const search = await youtube.search(channelIdentifier.substring(1), { type: 'channel' });
      const channelResult = search.results.find(result => result.type === 'Channel');
      if (!channelResult?.author?.id) return null;
      channelId = channelResult.author.id;
    }
  }

  return channelId;
}

function formatVideo(v) {
  const videoId = v.id || v.video_id || v.videoId;
  if (!videoId) return null;

  let title = 'Unknown';
  if (v.title) {
    if (typeof v.title === 'string') title = v.title;
    else if (v.title.text) title = v.title.text;
    else if (v.title.runs) title = v.title.runs.map(r => r.text).join('');
    else if (typeof v.title.toString === 'function') title = v.title.toString();
  }

  let thumbnail = '';
  if (v.thumbnails?.length > 0) {
    thumbnail = v.thumbnails[v.thumbnails.length - 1]?.url || v.thumbnails[0]?.url;
  } else {
    thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }

  let duration = 'N/A';
  if (v.duration) {
    if (typeof v.duration === 'string') duration = v.duration;
    else if (v.duration.text) duration = v.duration.text;
    else if (v.duration.seconds) {
      const h = Math.floor(v.duration.seconds / 3600);
      const m = Math.floor((v.duration.seconds % 3600) / 60);
      const s = v.duration.seconds % 60;
      duration = h > 0 
        ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
        : `${m}:${s.toString().padStart(2, '0')}`;
    }
  }

  let views = 'N/A';
  if (v.view_count?.text) views = v.view_count.text;
  else if (v.short_view_count?.text) views = v.short_view_count.text;
  else if (typeof v.view_count === 'string') views = v.view_count;

  let published = 'N/A';
  if (v.published?.text) published = v.published.text;
  else if (typeof v.published === 'string') published = v.published;

  return {
    id: videoId,
    title,
    thumbnail,
    duration,
    views,
    published,
    url: `https://www.youtube.com/watch?v=${videoId}`
  };
}

function findAllVideos(obj, seenIds, depth = 0) {
  const videos = [];

  if (!obj || typeof obj !== 'object' || depth > 20) return videos;

  const id = obj.id || obj.video_id || obj.videoId;
  if (id && typeof id === 'string' && id.length === 11 && /^[a-zA-Z0-9_-]+$/.test(id)) {
    if (!seenIds.has(id) && (obj.title || obj.thumbnails)) {
      seenIds.add(id);
      const formatted = formatVideo(obj);
      if (formatted) videos.push(formatted);
    }
  }

  if (obj.content) {
    const contentId = obj.content.id || obj.content.video_id;
    if (contentId && !seenIds.has(contentId)) {
      seenIds.add(contentId);
      const formatted = formatVideo(obj.content);
      if (formatted) videos.push(formatted);
    }
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      videos.push(...findAllVideos(item, seenIds, depth + 1));
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (key.startsWith('_') || typeof obj[key] === 'function') continue;
      if (obj[key] && typeof obj[key] === 'object') {
        videos.push(...findAllVideos(obj[key], seenIds, depth + 1));
      }
    }
  }

  return videos;
}

function findContinuationToken(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 15) return null;

  if (obj.token && typeof obj.token === 'string' && obj.token.length > 20) {
    return obj.token;
  }
  if (obj.continuation && typeof obj.continuation === 'string') {
    return obj.continuation;
  }
  if (obj.continuationCommand?.token) {
    return obj.continuationCommand.token;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const token = findContinuationToken(item, depth + 1);
      if (token) return token;
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (key.startsWith('_') || typeof obj[key] === 'function') continue;
      const token = findContinuationToken(obj[key], depth + 1);
      if (token) return token;
    }
  }

  return null;
}

/**
 * Initialize cache for a channel
 */
function initCache(channelId) {
  if (!channelCache.has(channelId)) {
    channelCache.set(channelId, {
      videos: [],
      seenIds: new Set(),
      isComplete: false,
      isFetching: false,
      lastUpdate: Date.now(),
      error: null
    });
  }
  return channelCache.get(channelId);
}

/**
 * Background fetch function - fetches ALL videos
 */
async function backgroundFetchVideos(channelId, channelName, youtube) {
  const cache = initCache(channelId);

  // Already fetching or complete
  if (cache.isFetching || cache.isComplete) {
    return;
  }

  cache.isFetching = true;
  console.log(`\n🔄 [Background] Starting fetch for ${channelName}...`);

  try {
    // Method 1: Browse endpoint (main videos)
    console.log('📁 [Background] Fetching via browse endpoint...');

    let browseData = await youtube.actions.execute('/browse', {
      browseId: channelId,
      params: 'EgZ2aWRlb3PyBgQKAjoA'
    });

    let pageCount = 0;
    let consecutiveEmpty = 0;
    const maxPages = 1000;

    while (pageCount < maxPages && consecutiveEmpty < 5) {
      pageCount++;
      const beforeCount = cache.videos.length;

      const pageVideos = findAllVideos(browseData?.data, cache.seenIds);
      cache.videos.push(...pageVideos);
      cache.lastUpdate = Date.now();

      const newCount = cache.videos.length - beforeCount;

      if (newCount === 0) {
        consecutiveEmpty++;
      } else {
        consecutiveEmpty = 0;
        if (pageCount % 20 === 0 || pageCount <= 3) {
          console.log(`   [Background] Page ${pageCount}: +${newCount} videos (total: ${cache.videos.length})`);
        }
      }

      const continuationToken = findContinuationToken(browseData?.data);

      if (!continuationToken) {
        console.log(`   [Background] No more continuation after page ${pageCount}`);
        break;
      }

      try {
        browseData = await youtube.actions.execute('/browse', {
          continuation: continuationToken
        });

        if (pageCount % 20 === 0) {
          await new Promise(r => setTimeout(r, 300));
        }
      } catch (e) {
        console.log(`   [Background] Pagination error: ${e.message}`);
        break;
      }
    }

    console.log(`   [Background] ✅ Videos tab: ${cache.videos.length} videos`);

    // Method 2: Shorts tab
    console.log('📁 [Background] Fetching Shorts...');
    try {
      const channel = await youtube.getChannel(channelId);
      let shortsTab = await channel.getShorts();
      let shortsPageCount = 0;
      const beforeShorts = cache.videos.length;

      while (shortsPageCount < 200) {
        shortsPageCount++;
        const pageVideos = findAllVideos(shortsTab, cache.seenIds);
        cache.videos.push(...pageVideos);
        cache.lastUpdate = Date.now();

        if (!shortsTab.has_continuation) break;

        try {
          shortsTab = await shortsTab.getContinuation();
          if (shortsPageCount % 20 === 0) {
            await new Promise(r => setTimeout(r, 200));
          }
        } catch (e) {
          break;
        }
      }

      console.log(`   [Background] ✅ Shorts: ${cache.videos.length - beforeShorts} videos`);
    } catch (e) {
      console.log(`   [Background] ⚠️ Shorts: ${e.message}`);
    }

    // Method 3: Live streams
    console.log('📁 [Background] Fetching Live streams...');
    try {
      const channel = await youtube.getChannel(channelId);
      let liveTab = await channel.getLiveStreams();
      let livePageCount = 0;
      const beforeLive = cache.videos.length;

      while (livePageCount < 100) {
        livePageCount++;
        const pageVideos = findAllVideos(liveTab, cache.seenIds);
        cache.videos.push(...pageVideos);
        cache.lastUpdate = Date.now();

        if (!liveTab.has_continuation) break;

        try {
          liveTab = await liveTab.getContinuation();
        } catch (e) {
          break;
        }
      }

      console.log(`   [Background] ✅ Live: ${cache.videos.length - beforeLive} videos`);
    } catch (e) {
      console.log(`   [Background] ⚠️ Live: ${e.message}`);
    }

    // Method 4: Uploads playlist (backup to catch any missed videos)
    console.log('📁 [Background] Checking uploads playlist...');
    try {
      const uploadsPlaylistId = channelId.replace('UC', 'UU');
      let playlist = await youtube.getPlaylist(uploadsPlaylistId);
      let playlistPageCount = 0;
      const beforePlaylist = cache.videos.length;

      while (playlistPageCount < 500) {
        playlistPageCount++;
        const pageVideos = findAllVideos(playlist, cache.seenIds);
        cache.videos.push(...pageVideos);
        cache.lastUpdate = Date.now();

        if (!playlist.has_continuation) break;

        try {
          playlist = await playlist.getContinuation();
          if (playlistPageCount % 20 === 0) {
            await new Promise(r => setTimeout(r, 200));
          }
        } catch (e) {
          break;
        }
      }

      console.log(`   [Background] ✅ Uploads playlist: ${cache.videos.length - beforePlaylist} new videos`);
    } catch (e) {
      console.log(`   [Background] ⚠️ Uploads playlist: ${e.message}`);
    }

    cache.isComplete = true;
    console.log(`\n✅ [Background] Complete! Total: ${cache.videos.length} videos for ${channelName}`);

  } catch (e) {
    cache.error = e.message;
    console.error(`❌ [Background] Error: ${e.message}`);
  } finally {
    cache.isFetching = false;
  }
}

/**
 * Wait for enough videos to be cached
 */
async function waitForVideos(channelId, requiredCount, maxWaitMs = 30000) {
  const cache = channelCache.get(channelId);
  if (!cache) return false;

  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    if (cache.videos.length >= requiredCount || cache.isComplete) {
      return true;
    }
    await new Promise(r => setTimeout(r, 100));
  }

  return false;
}

/**
 * Get videos from a YouTube channel
 * Returns immediately with available videos, continues fetching in background
 */
async function getChannelVideos(channelIdentifier, start = null, end = null) {
  try {
    const youtube = await initYouTube();

    let normalizedIdentifier = channelIdentifier.trim();
    if (!normalizedIdentifier.startsWith('@') && 
        !normalizedIdentifier.includes('youtube.com') && 
        !normalizedIdentifier.startsWith('UC')) {
      normalizedIdentifier = '@' + normalizedIdentifier;
    }

    console.log(`🔍 Resolving channel: ${normalizedIdentifier}`);

    const channelId = await resolveChannelId(youtube, normalizedIdentifier);
    if (!channelId) {
      return { success: false, error: 'Channel not found' };
    }

    console.log(`✅ Found channel ID: ${channelId}`);

    const channel = await youtube.getChannel(channelId);
    if (!channel) {
      return { success: false, error: 'Channel not found' };
    }

    const channelName = channel.metadata?.title || '';
    console.log(`📺 Channel: ${channelName}`);

    const hasRange = start !== null && end !== null;
    const requiredEnd = hasRange ? end : Infinity;

    console.log(hasRange 
      ? `📊 Target: videos ${start}-${end}` 
      : '📊 Target: ALL videos'
    );

    // Initialize cache
    const cache = initCache(channelId);

    // Start background fetch if not already running
    if (!cache.isFetching && !cache.isComplete) {
      // Start background fetch (don't await)
      backgroundFetchVideos(channelId, channelName, youtube);
    }

    // If we need specific range, wait for those videos
    if (hasRange) {
      // Check if we already have enough
      if (cache.videos.length >= requiredEnd || cache.isComplete) {
        console.log(`📦 Cache hit: ${cache.videos.length} videos available`);
      } else {
        // Wait for required videos (max 30 seconds)
        console.log(`⏳ Waiting for videos ${start}-${end}...`);
        await waitForVideos(channelId, requiredEnd, 60000);
      }
    } else {
      // For all videos, wait until complete or timeout
      if (!cache.isComplete) {
        console.log(`⏳ Waiting for all videos...`);
        const maxWait = 120000; // 2 minutes max
        const startTime = Date.now();
        while (!cache.isComplete && Date.now() - startTime < maxWait) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }

    // Get videos from cache
    let finalVideos = cache.videos;

    if (hasRange) {
      const startIndex = Math.max(0, start - 1);
      const endIndex = Math.min(cache.videos.length, end);
      finalVideos = cache.videos.slice(startIndex, endIndex);
      console.log(`📊 Range [${start}:${end}] = ${finalVideos.length} videos`);
    }

    const cacheStatus = cache.isComplete 
      ? 'complete' 
      : cache.isFetching 
        ? 'fetching' 
        : 'partial';

    console.log(`✅ Returning ${finalVideos.length} videos (cache: ${cacheStatus}, total cached: ${cache.videos.length})\n`);

    return {
      success: true,
      channel: {
        name: channelName,
        id: channelId,
        url: `https://www.youtube.com/channel/${channelId}`,
        handle: normalizedIdentifier,
        thumbnail: channel.metadata?.thumbnail?.[0]?.url || '',
        subscriberCount: channel.metadata?.subscriber_count || 'N/A'
      },
      range: hasRange ? { start, end } : null,
      totalVideos: finalVideos.length,
      totalCached: cache.videos.length,
      cacheStatus,
      isComplete: cache.isComplete,
      videos: finalVideos
    };

  } catch (error) {
    console.error('❌ Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get cache status for a channel
 */
function getCacheStatus(channelId) {
  const cache = channelCache.get(channelId);
  if (!cache) {
    return { exists: false };
  }

  return {
    exists: true,
    videoCount: cache.videos.length,
    isComplete: cache.isComplete,
    isFetching: cache.isFetching,
    lastUpdate: cache.lastUpdate,
    error: cache.error
  };
}

/**
 * Clear cache for a channel or all channels
 */
function clearCache(channelId = null) {
  if (channelId) {
    channelCache.delete(channelId);
    console.log(`🗑️ Cleared cache for ${channelId}`);
  } else {
    channelCache.clear();
    console.log('🗑️ Cleared all cache');
  }
}

/**
 * Pre-fetch channel videos in background
 */
async function prefetchChannel(channelIdentifier) {
  const youtube = await initYouTube();

  let normalizedIdentifier = channelIdentifier.trim();
  if (!normalizedIdentifier.startsWith('@') && 
      !normalizedIdentifier.includes('youtube.com') && 
      !normalizedIdentifier.startsWith('UC')) {
    normalizedIdentifier = '@' + normalizedIdentifier;
  }

  const channelId = await resolveChannelId(youtube, normalizedIdentifier);
  if (!channelId) {
    console.log('❌ Channel not found');
    return false;
  }

  const channel = await youtube.getChannel(channelId);
  const channelName = channel.metadata?.title || '';

  const cache = initCache(channelId);

  if (!cache.isFetching && !cache.isComplete) {
    backgroundFetchVideos(channelId, channelName, youtube);
  }

  console.log(`🚀 Prefetching started for ${channelName}`);
  return true;
}

export { 
  getChannelVideos, 
  resolveChannelId, 
  clearCache, 
  getCacheStatus,
  prefetchChannel 
};
