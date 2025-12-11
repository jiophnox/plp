// search.js
import { Innertube, Log } from 'youtubei.js';

Log.setLevel(Log.Level.NONE);

let ytInstance = null;

// Cache for search results
const searchCache = new Map();

// Generate random visitor data for fresh session
function generateVisitorData() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = 'Cgt';
  for (let i = 0; i < 22; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Initialize YouTube instance
async function initYouTube(forceNew = false) {
  if (ytInstance && !forceNew) return ytInstance;

  ytInstance = await Innertube.create({
    retrieve_player: false,
    generate_session_locally: true,
    enable_session_cache: false,
    lang: 'en',
    location: 'US',
    visitor_data: generateVisitorData()
  });

  console.log('✅ YouTube search instance initialized');
  return ytInstance;
}

// Generate cache key from query and options
function getCacheKey(query, options = {}) {
  const { type = 'all', sort = 'relevance', duration, uploadDate } = options;
  return `${query.toLowerCase().trim()}|${type}|${sort}|${duration || ''}|${uploadDate || ''}`;
}

// Initialize search cache
function initSearchCache(cacheKey) {
  if (!searchCache.has(cacheKey)) {
    searchCache.set(cacheKey, {
      results: [],
      seenIds: new Set(),
      isComplete: false,
      isFetching: false,
      lastUpdate: Date.now(),
      error: null,
      searchData: null // Store search data for continuation
    });
  }
  return searchCache.get(cacheKey);
}

// Format video result
function formatVideo(item) {
  const videoId = item.id || item.video_id;
  if (!videoId) return null;

  let title = 'Unknown';
  if (item.title) {
    if (typeof item.title === 'string') title = item.title;
    else if (item.title.text) title = item.title.text;
    else if (item.title.runs) title = item.title.runs.map(r => r.text).join('');
    else if (typeof item.title.toString === 'function') title = item.title.toString();
  }

  let thumbnail = '';
  if (item.thumbnails?.length > 0) {
    thumbnail = item.thumbnails[item.thumbnails.length - 1]?.url || item.thumbnails[0]?.url;
  } else {
    thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }

  let duration = 'N/A';
  if (item.duration) {
    if (typeof item.duration === 'string') duration = item.duration;
    else if (item.duration.text) duration = item.duration.text;
    else if (item.duration.seconds) {
      const h = Math.floor(item.duration.seconds / 3600);
      const m = Math.floor((item.duration.seconds % 3600) / 60);
      const s = item.duration.seconds % 60;
      duration = h > 0 
        ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
        : `${m}:${s.toString().padStart(2, '0')}`;
    }
  }

  let views = 'N/A';
  if (item.view_count?.text) views = item.view_count.text;
  else if (item.short_view_count?.text) views = item.short_view_count.text;
  else if (typeof item.view_count === 'string') views = item.view_count;
  else if (typeof item.view_count === 'number') views = item.view_count.toLocaleString();

  let published = 'N/A';
  if (item.published?.text) published = item.published.text;
  else if (typeof item.published === 'string') published = item.published;

  let channelName = 'Unknown';
  let channelId = null;
  let channelUrl = null;
  if (item.author) {
    channelName = item.author.name || item.author.title || 'Unknown';
    channelId = item.author.id || item.author.channel_id;
    channelUrl = item.author.url || (channelId ? `https://www.youtube.com/channel/${channelId}` : null);
  }

  return {
    type: 'video',
    id: videoId,
    title,
    thumbnail,
    duration,
    views,
    published,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    description: item.description_snippet?.text || item.description?.text || '',
    channel: {
      name: channelName,
      id: channelId,
      url: channelUrl,
      thumbnail: item.author?.thumbnails?.[0]?.url || null
    }
  };
}

// Format channel result
function formatChannel(item) {
  const channelId = item.author?.id || item.id || item.channel_id;
  if (!channelId) return null;

  let name = 'Unknown';
  if (item.author?.name) name = item.author.name;
  else if (item.title?.text) name = item.title.text;
  else if (typeof item.title === 'string') name = item.title;

  let thumbnail = null;
  if (item.author?.thumbnails?.length > 0) {
    thumbnail = item.author.thumbnails[item.author.thumbnails.length - 1]?.url;
  } else if (item.thumbnails?.length > 0) {
    thumbnail = item.thumbnails[item.thumbnails.length - 1]?.url;
  }

  let subscriberCount = 'N/A';
  if (item.subscriber_count?.text) subscriberCount = item.subscriber_count.text;
  else if (item.video_count?.text) subscriberCount = item.video_count.text;

  let videoCount = 'N/A';
  if (item.video_count?.text) videoCount = item.video_count.text;

  let description = '';
  if (item.description_snippet?.text) description = item.description_snippet.text;
  else if (item.description?.text) description = item.description.text;

  return {
    type: 'channel',
    id: channelId,
    name,
    thumbnail,
    subscriberCount,
    videoCount,
    description,
    url: item.author?.url || `https://www.youtube.com/channel/${channelId}`,
    handle: item.author?.handle || null
  };
}

// Format playlist result
function formatPlaylist(item) {
  const playlistId = item.id || item.playlist_id;
  if (!playlistId) return null;

  let title = 'Unknown';
  if (item.title) {
    if (typeof item.title === 'string') title = item.title;
    else if (item.title.text) title = item.title.text;
    else if (item.title.runs) title = item.title.runs.map(r => r.text).join('');
  }

  let thumbnail = null;
  if (item.thumbnails?.length > 0) {
    thumbnail = item.thumbnails[item.thumbnails.length - 1]?.url || item.thumbnails[0]?.url;
  }

  let videoCount = 'N/A';
  if (item.video_count?.text) videoCount = item.video_count.text;
  else if (typeof item.video_count === 'number') videoCount = item.video_count.toString();

  let channelName = 'Unknown';
  let channelId = null;
  if (item.author) {
    channelName = item.author.name || 'Unknown';
    channelId = item.author.id;
  }

  return {
    type: 'playlist',
    id: playlistId,
    title,
    thumbnail,
    videoCount,
    url: `https://www.youtube.com/playlist?list=${playlistId}`,
    channel: {
      name: channelName,
      id: channelId,
      url: channelId ? `https://www.youtube.com/channel/${channelId}` : null
    }
  };
}

// Format any search result item
function formatSearchResult(item) {
  if (!item) return null;

  const type = item.type;

  switch (type) {
    case 'Video':
      return formatVideo(item);
    case 'Channel':
      return formatChannel(item);
    case 'Playlist':
      return formatPlaylist(item);
    case 'Movie':
      return formatVideo(item);
    case 'Show':
      return formatVideo(item);
    default:
      if (item.duration || item.view_count) {
        return formatVideo(item);
      }
      if (item.subscriber_count || item.author?.id === item.id) {
        return formatChannel(item);
      }
      if (item.video_count && !item.duration) {
        return formatPlaylist(item);
      }
      return null;
  }
}

// Extract results from search data
function extractResults(searchData, seenIds) {
  const results = [];

  if (!searchData) return results;

  if (searchData.results && Array.isArray(searchData.results)) {
    for (const item of searchData.results) {
      const id = item.id || item.author?.id || item.playlist_id;
      if (id && !seenIds.has(id)) {
        const formatted = formatSearchResult(item);
        if (formatted) {
          seenIds.add(id);
          results.push(formatted);
        }
      }
    }
  }

  if (searchData.contents && Array.isArray(searchData.contents)) {
    for (const item of searchData.contents) {
      const id = item.id || item.author?.id || item.playlist_id;
      if (id && !seenIds.has(id)) {
        const formatted = formatSearchResult(item);
        if (formatted) {
          seenIds.add(id);
          results.push(formatted);
        }
      }
    }
  }

  return results;
}

// Background fetch function for search
async function backgroundFetchSearch(cacheKey, query, searchFilters, youtube) {
  const cache = searchCache.get(cacheKey);
  if (!cache || cache.isFetching || cache.isComplete) return;

  cache.isFetching = true;
  console.log(`\n🔄 [Background] Continuing search for "${query}"...`);

  try {
    let searchData = cache.searchData;
    let pageCount = Math.ceil(cache.results.length / 20); // Estimate current page
    const maxPages = 100;
    const maxResults = 500; // Max results to cache

    while (
      cache.results.length < maxResults && 
      searchData?.has_continuation && 
      pageCount < maxPages
    ) {
      try {
        searchData = await searchData.getContinuation();
        pageCount++;

        const pageResults = extractResults(searchData, cache.seenIds);

        if (pageResults.length === 0) {
          console.log(`   [Background] No more results at page ${pageCount}`);
          break;
        }

        cache.results.push(...pageResults);
        cache.searchData = searchData;
        cache.lastUpdate = Date.now();

        if (pageCount % 5 === 0) {
          console.log(`   [Background] Page ${pageCount}: +${pageResults.length} (total: ${cache.results.length})`);
        }

        // Rate limiting
        if (pageCount % 10 === 0) {
          await new Promise(r => setTimeout(r, 300));
        }

      } catch (e) {
        console.log(`   [Background] Pagination ended: ${e.message}`);
        break;
      }
    }

    cache.isComplete = true;
    console.log(`✅ [Background] Search complete: ${cache.results.length} total results\n`);

  } catch (e) {
    cache.error = e.message;
    console.error(`❌ [Background] Search error: ${e.message}`);
  } finally {
    cache.isFetching = false;
  }
}

// Wait for minimum results
async function waitForResults(cacheKey, minResults, maxWaitMs = 10000) {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const cache = searchCache.get(cacheKey);
    if (!cache) return false;

    if (cache.results.length >= minResults || cache.isComplete) {
      return true;
    }

    await new Promise(r => setTimeout(r, 100));
  }

  return false;
}

/**
 * Search YouTube with background caching
 * Returns first 20 results immediately, continues fetching in background
 */
async function search(query, options = {}) {
  try {
    const youtube = await initYouTube();

    const {
      type = 'all',
      sort = 'relevance',
      duration = null,
      uploadDate = null,
      start = null,
      end = null
    } = options;

    console.log(`🔍 Searching: "${query}"`);

    const hasRange = start !== null && end !== null;
    const requestedEnd = hasRange ? end : 20; // Default 20 results

    if (hasRange) {
      console.log(`📊 Target: results ${start}-${end}`);
    }

    // Build search filters
    const searchFilters = {};

    if (type && type !== 'all') {
      searchFilters.type = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
    }

    const sortMap = {
      'relevance': 'relevance',
      'upload_date': 'upload_date',
      'date': 'upload_date',
      'view_count': 'view_count',
      'views': 'view_count',
      'rating': 'rating'
    };
    if (sort && sortMap[sort.toLowerCase()]) {
      searchFilters.sort_by = sortMap[sort.toLowerCase()];
    }

    const durationMap = { 'short': 'short', 'medium': 'medium', 'long': 'long' };
    if (duration && durationMap[duration.toLowerCase()]) {
      searchFilters.duration = durationMap[duration.toLowerCase()];
    }

    const uploadDateMap = { 'hour': 'hour', 'today': 'today', 'week': 'week', 'month': 'month', 'year': 'year' };
    if (uploadDate && uploadDateMap[uploadDate.toLowerCase()]) {
      searchFilters.upload_date = uploadDateMap[uploadDate.toLowerCase()];
    }

    // Get or create cache
    const cacheKey = getCacheKey(query, options);
    let cache = searchCache.get(cacheKey);

    // Check if cache exists and is fresh (5 minutes)
    if (cache && Date.now() - cache.lastUpdate < 5 * 60 * 1000) {
      console.log(`📦 Cache hit: ${cache.results.length} results cached`);

      // If we need more than cached, wait or trigger background fetch
      if (cache.results.length < requestedEnd && !cache.isComplete && !cache.isFetching) {
        backgroundFetchSearch(cacheKey, query, searchFilters, youtube);
        await waitForResults(cacheKey, requestedEnd, 15000);
      }

    } else {
      // Fresh search
      cache = initSearchCache(cacheKey);

      console.log(`🔄 Fetching fresh results...`);

      // Execute initial search
      const searchData = await youtube.search(query, searchFilters);

      // Extract first page
      const firstPageResults = extractResults(searchData, cache.seenIds);
      cache.results.push(...firstPageResults);
      cache.searchData = searchData;
      cache.lastUpdate = Date.now();

      console.log(`   First page: ${firstPageResults.length} results`);

      // If first page isn't enough, get more pages immediately (up to requested amount)
      let pageCount = 1;
      while (
        cache.results.length < requestedEnd && 
        cache.searchData?.has_continuation && 
        pageCount < 10
      ) {
        try {
          cache.searchData = await cache.searchData.getContinuation();
          pageCount++;

          const pageResults = extractResults(cache.searchData, cache.seenIds);
          if (pageResults.length === 0) break;

          cache.results.push(...pageResults);
          cache.lastUpdate = Date.now();

          console.log(`   Page ${pageCount}: +${pageResults.length} (total: ${cache.results.length})`);

        } catch (e) {
          break;
        }
      }

      // Start background fetch for more results (don't await)
      if (cache.searchData?.has_continuation && !cache.isComplete) {
        backgroundFetchSearch(cacheKey, query, searchFilters, youtube);
      } else {
        cache.isComplete = true;
      }
    }

    // Get current cache state
    cache = searchCache.get(cacheKey);

    // Apply range
    let finalResults = cache.results;
    if (hasRange) {
      const startIndex = Math.max(0, start - 1);
      const endIndex = Math.min(cache.results.length, end);
      finalResults = cache.results.slice(startIndex, endIndex);
      console.log(`📊 Range [${start}:${end}] = ${finalResults.length} results`);
    } else {
      // Default: return first 20
      finalResults = cache.results.slice(0, 20);
    }

    // Categorize results
    const videos = finalResults.filter(r => r.type === 'video');
    const channels = finalResults.filter(r => r.type === 'channel');
    const playlists = finalResults.filter(r => r.type === 'playlist');

    const cacheStatus = cache.isComplete 
      ? 'complete' 
      : cache.isFetching 
        ? 'fetching' 
        : 'partial';

    console.log(`✅ Returning ${finalResults.length} results (cache: ${cacheStatus}, total: ${cache.results.length})\n`);

    return {
      success: true,
      query,
      filters: {
        type: type || 'all',
        sort: sort || 'relevance',
        duration,
        uploadDate
      },
      range: hasRange ? { start, end } : { start: 1, end: finalResults.length },
      totalResults: finalResults.length,
      totalCached: cache.results.length,
      cacheStatus,
      isComplete: cache.isComplete,
      hasMore: !cache.isComplete || cache.results.length > (end || 20),
      results: finalResults,
      summary: {
        videos: videos.length,
        channels: channels.length,
        playlists: playlists.length
      },
      videos,
      channels,
      playlists
    };

  } catch (error) {
    console.error('❌ Search error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Search for videos only
 */
async function searchVideos(query, options = {}) {
  return search(query, { ...options, type: 'video' });
}

/**
 * Search for channels only
 */
async function searchChannels(query, options = {}) {
  return search(query, { ...options, type: 'channel' });
}

/**
 * Search for playlists only
 */
async function searchPlaylists(query, options = {}) {
  return search(query, { ...options, type: 'playlist' });
}

/**
 * Get search suggestions/autocomplete
 */
async function getSearchSuggestions(query) {
  try {
    const youtube = await initYouTube();
    const suggestions = await youtube.getSearchSuggestions(query);

    return {
      success: true,
      query,
      suggestions: suggestions || []
    };
  } catch (error) {
    console.error('❌ Suggestions error:', error);
    return { success: false, error: error.message, suggestions: [] };
  }
}

/**
 * Get trending videos
 */
async function getTrending(options = {}) {
  try {
    const youtube = await initYouTube();
    const { region = 'US' } = options;

    console.log(`🔥 Getting trending videos (${region})...`);

    const trending = await youtube.getTrending();

    const allResults = [];
    const seenIds = new Set();

    if (trending.videos) {
      for (const item of trending.videos) {
        if (item.id && !seenIds.has(item.id)) {
          const formatted = formatVideo(item);
          if (formatted) {
            seenIds.add(item.id);
            allResults.push(formatted);
          }
        }
      }
    }

    const sections = ['now', 'music', 'gaming', 'movies'];
    for (const section of sections) {
      try {
        if (trending[section]) {
          for (const item of trending[section]) {
            if (item.id && !seenIds.has(item.id)) {
              const formatted = formatVideo(item);
              if (formatted) {
                seenIds.add(item.id);
                formatted.trendingSection = section;
                allResults.push(formatted);
              }
            }
          }
        }
      } catch (e) {
        // Section not available
      }
    }

    console.log(`✅ Found ${allResults.length} trending videos\n`);

    return {
      success: true,
      region,
      totalResults: allResults.length,
      results: allResults
    };

  } catch (error) {
    console.error('❌ Trending error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get cache status for a search query
 */
function getSearchCacheStatus(query, options = {}) {
  const cacheKey = getCacheKey(query, options);
  const cache = searchCache.get(cacheKey);

  if (!cache) {
    return { exists: false };
  }

  return {
    exists: true,
    resultCount: cache.results.length,
    isComplete: cache.isComplete,
    isFetching: cache.isFetching,
    lastUpdate: cache.lastUpdate,
    error: cache.error
  };
}

/**
 * Clear search cache
 */
function clearSearchCache(query = null, options = {}) {
  if (query) {
    const cacheKey = getCacheKey(query, options);
    searchCache.delete(cacheKey);
    console.log(`🗑️ Cleared cache for "${query}"`);
  } else {
    searchCache.clear();
    console.log('🗑️ Cleared all search cache');
  }
}

/**
 * Prefetch search results in background
 */
async function prefetchSearch(query, options = {}) {
  const cacheKey = getCacheKey(query, options);
  const cache = searchCache.get(cacheKey);

  if (cache && !cache.isComplete && !cache.isFetching) {
    const youtube = await initYouTube();
    backgroundFetchSearch(cacheKey, query, {}, youtube);
    return true;
  }

  // Start fresh search
  await search(query, { ...options, start: 1, end: 20 });
  return true;
}

export {
  search,
  searchVideos,
  searchChannels,
  searchPlaylists,
  getSearchSuggestions,
  getTrending,
  getSearchCacheStatus,
  clearSearchCache,
  prefetchSearch
};
