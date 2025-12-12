import { Innertube, Log } from 'youtubei.js';

Log.setLevel(Log.Level.NONE);

let ytInstance = null;

// Cache structure for each channel
const channelCache = new Map();

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

// FIXED: formatVideo function now matches the working version
function formatVideo(v) {
  // Get video ID
  const videoId = v.id || v.video_id || v.videoId;
  if (!videoId || typeof videoId !== 'string') return null;

  // Validate video ID format (11 characters, alphanumeric with - and _)
  if (videoId.length !== 11 || !/^[a-zA-Z0-9_-]+$/.test(videoId)) return null;

  // Get title
  let title = 'Unknown';
  if (v.title) {
    if (typeof v.title === 'string') title = v.title;
    else if (v.title.text) title = v.title.text;
    else if (v.title.runs) title = v.title.runs.map(r => r.text).join('');
    else if (typeof v.title.toString === 'function') title = v.title.toString();
  }

  // Get thumbnail - prefer higher quality
  let thumbnail = '';
  if (v.thumbnails && Array.isArray(v.thumbnails) && v.thumbnails.length > 0) {
    // Get the best quality thumbnail
    const sortedThumbs = [...v.thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
    thumbnail = sortedThumbs[0]?.url || v.thumbnails[0]?.url || '';
  }
  if (!thumbnail) {
    thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }

  // Get duration
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
  } else if (v.length_text?.text) {
    duration = v.length_text.text;
  }

  // Get views
  let views = 'N/A';
  if (v.view_count?.text) views = v.view_count.text;
  else if (v.short_view_count?.text) views = v.short_view_count.text;
  else if (typeof v.view_count === 'string') views = v.view_count;
  else if (v.view_count?.short_view_count?.text) views = v.view_count.short_view_count.text;

  // Get published date
  let published = 'N/A';
  if (v.published?.text) published = v.published.text;
  else if (typeof v.published === 'string') published = v.published;
  else if (v.publishedTimeText?.text) published = v.publishedTimeText.text;

  // FIXED: Get description (was missing!)
  let description = '';
  if (v.description_snippet?.text) {
    description = v.description_snippet.text;
  } else if (v.description_snippet?.runs) {
    description = v.description_snippet.runs.map(r => r.text).join('');
  } else if (v.description?.text) {
    description = v.description.text;
  } else if (v.description?.runs) {
    description = v.description.runs.map(r => r.text).join('');
  } else if (typeof v.description === 'string') {
    description = v.description;
  } else if (v.snippetText?.runs) {
    description = v.snippetText.runs.map(r => r.text).join('');
  }

  return {
    id: videoId,
    title,
    thumbnail,
    duration,
    views,
    published,
    description  // ADDED: description field
  };
}

// FIXED: Better video extraction that preserves all data
function extractVideosFromTab(data, seenIds) {
  const videos = [];

  // Method 1: Direct videos array (like first code)
  if (data.videos && Array.isArray(data.videos)) {
    for (const v of data.videos) {
      const id = v.id || v.video_id;
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        const formatted = formatVideo(v);
        if (formatted) videos.push(formatted);
      }
    }
  }

  // Method 2: Current tab structure (like first code)
  if (data.current_tab?.content?.contents) {
    for (const section of data.current_tab.content.contents) {
      const items = section.contents || section.items || [];
      for (const item of items) {
        const v = item.content || item;
        const id = v.id || v.video_id;
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          const formatted = formatVideo(v);
          if (formatted) videos.push(formatted);
        }
      }
    }
  }

  // Method 3: Contents array directly
  if (data.contents) {
    const processContents = (contents) => {
      if (!Array.isArray(contents)) return;
      for (const item of contents) {
        // Check if this is a video item
        const v = item.content || item;
        const id = v.id || v.video_id || v.videoId;
        if (id && !seenIds.has(id) && (v.title || v.thumbnails)) {
          seenIds.add(id);
          const formatted = formatVideo(v);
          if (formatted) videos.push(formatted);
        }
        // Recurse into nested contents
        if (item.contents) processContents(item.contents);
        if (item.items) processContents(item.items);
      }
    };
    processContents(data.contents);
  }

  return videos;
}

// For browse API responses (different structure)
function extractVideosFromBrowse(data, seenIds) {
  const videos = [];

  if (!data) return videos;

  const findVideos = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 15) return;

    // Check if this object is a video
    const id = obj.videoId || obj.id || obj.video_id;
    if (id && typeof id === 'string' && id.length === 11) {
      if (!seenIds.has(id) && (obj.title || obj.thumbnail || obj.thumbnails)) {
        seenIds.add(id);

        // Build video object from various possible structures
        const videoData = {
          id: id,
          title: obj.title,
          thumbnails: obj.thumbnail?.thumbnails || obj.thumbnails,
          duration: obj.lengthText || obj.duration || obj.length_text,
          view_count: obj.viewCountText || obj.view_count || obj.shortViewCountText,
          published: obj.publishedTimeText || obj.published,
          description_snippet: obj.descriptionSnippet || obj.description_snippet || obj.snippetText
        };

        const formatted = formatVideo(videoData);
        if (formatted) videos.push(formatted);
      }
    }

    // Check for richItemRenderer (common in browse responses)
    if (obj.richItemRenderer?.content?.videoRenderer) {
      const vr = obj.richItemRenderer.content.videoRenderer;
      if (vr.videoId && !seenIds.has(vr.videoId)) {
        seenIds.add(vr.videoId);
        const videoData = {
          id: vr.videoId,
          title: vr.title,
          thumbnails: vr.thumbnail?.thumbnails,
          duration: vr.lengthText,
          view_count: vr.viewCountText || vr.shortViewCountText,
          published: vr.publishedTimeText,
          description_snippet: vr.descriptionSnippet
        };
        const formatted = formatVideo(videoData);
        if (formatted) videos.push(formatted);
      }
    }

    // Check for gridVideoRenderer
    if (obj.gridVideoRenderer) {
      const vr = obj.gridVideoRenderer;
      if (vr.videoId && !seenIds.has(vr.videoId)) {
        seenIds.add(vr.videoId);
        const videoData = {
          id: vr.videoId,
          title: vr.title,
          thumbnails: vr.thumbnail?.thumbnails,
          duration: vr.lengthText || vr.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text,
          view_count: vr.viewCountText || vr.shortViewCountText,
          published: vr.publishedTimeText,
          description_snippet: vr.descriptionSnippet
        };
        const formatted = formatVideo(videoData);
        if (formatted) videos.push(formatted);
      }
    }

    // Recurse
    if (Array.isArray(obj)) {
      for (const item of obj) {
        findVideos(item, depth + 1);
      }
    } else {
      for (const key of Object.keys(obj)) {
        if (key.startsWith('_') || typeof obj[key] === 'function') continue;
        if (obj[key] && typeof obj[key] === 'object') {
          findVideos(obj[key], depth + 1);
        }
      }
    }
  };

  findVideos(data);
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

async function backgroundFetchVideos(channelId, channelName, youtube) {
  const cache = initCache(channelId);

  if (cache.isFetching || cache.isComplete) {
    return;
  }

  cache.isFetching = true;
  console.log(`\n🔄 [Background] Starting fetch for ${channelName}...`);

  try {
    // Method 1: Use getChannel().getVideos() first (like the working code!)
    console.log('📁 [Background] Fetching via getVideos()...');

    try {
      const channel = await youtube.getChannel(channelId);
      let videosTab = await channel.getVideos();
      let pageCount = 0;
      let consecutiveEmpty = 0;

      while (pageCount < 1000 && consecutiveEmpty < 5) {
        pageCount++;
        const beforeCount = cache.videos.length;

        // Use the extraction method from working code
        const pageVideos = extractVideosFromTab(videosTab, cache.seenIds);
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

        if (!videosTab.has_continuation) {
          console.log(`   [Background] No more continuation after page ${pageCount}`);
          break;
        }

        try {
          videosTab = await videosTab.getContinuation();
          if (pageCount % 20 === 0) {
            await new Promise(r => setTimeout(r, 300));
          }
        } catch (e) {
          console.log(`   [Background] Pagination error: ${e.message}`);
          break;
        }
      }

      console.log(`   [Background] ✅ Videos tab: ${cache.videos.length} videos`);
    } catch (e) {
      console.log(`   [Background] ⚠️ getVideos error: ${e.message}`);

      // Fallback to browse endpoint
      console.log('📁 [Background] Fallback to browse endpoint...');

      let browseData = await youtube.actions.execute('/browse', {
        browseId: channelId,
        params: 'EgZ2aWRlb3PyBgQKAjoA'
      });

      let pageCount = 0;
      let consecutiveEmpty = 0;

      while (pageCount < 1000 && consecutiveEmpty < 5) {
        pageCount++;
        const beforeCount = cache.videos.length;

        const pageVideos = extractVideosFromBrowse(browseData?.data, cache.seenIds);
        cache.videos.push(...pageVideos);
        cache.lastUpdate = Date.now();

        const newCount = cache.videos.length - beforeCount;

        if (newCount === 0) {
          consecutiveEmpty++;
        } else {
          consecutiveEmpty = 0;
        }

        const continuationToken = findContinuationToken(browseData?.data);
        if (!continuationToken) break;

        try {
          browseData = await youtube.actions.execute('/browse', {
            continuation: continuationToken
          });
        } catch (e) {
          break;
        }
      }
    }

    // Method 2: Shorts tab
    console.log('📁 [Background] Fetching Shorts...');
    try {
      const channel = await youtube.getChannel(channelId);
      let shortsTab = await channel.getShorts();
      let shortsPageCount = 0;
      const beforeShorts = cache.videos.length;

      while (shortsPageCount < 200) {
        shortsPageCount++;
        const pageVideos = extractVideosFromTab(shortsTab, cache.seenIds);
        cache.videos.push(...pageVideos);
        cache.lastUpdate = Date.now();

        if (!shortsTab.has_continuation) break;

        try {
          shortsTab = await shortsTab.getContinuation();
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
        const pageVideos = extractVideosFromTab(liveTab, cache.seenIds);
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

    cache.isComplete = true;
    console.log(`\n✅ [Background] Complete! Total: ${cache.videos.length} videos for ${channelName}`);

  } catch (e) {
    cache.error = e.message;
    console.error(`❌ [Background] Error: ${e.message}`);
  } finally {
    cache.isFetching = false;
  }
}

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

    const cache = initCache(channelId);

    if (!cache.isFetching && !cache.isComplete) {
      backgroundFetchVideos(channelId, channelName, youtube);
    }

    if (hasRange) {
      if (cache.videos.length >= requiredEnd || cache.isComplete) {
        console.log(`📦 Cache hit: ${cache.videos.length} videos available`);
      } else {
        console.log(`⏳ Waiting for videos ${start}-${end}...`);
        await waitForVideos(channelId, requiredEnd, 60000);
      }
    } else {
      if (!cache.isComplete) {
        console.log(`⏳ Waiting for all videos...`);
        const maxWait = 120000;
        const startTime = Date.now();
        while (!cache.isComplete && Date.now() - startTime < maxWait) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }

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

function clearCache(channelId = null) {
  if (channelId) {
    channelCache.delete(channelId);
    console.log(`🗑️ Cleared cache for ${channelId}`);
  } else {
    channelCache.clear();
    console.log('🗑️ Cleared all cache');
  }
}

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
