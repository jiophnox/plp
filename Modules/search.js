// search.js
import { Innertube, Log } from 'youtubei.js';

Log.setLevel(Log.Level.NONE);

let ytInstance = null;

// Cache for search results
const searchCache = new Map();

// Cache for video details (tags)
const videoDetailsCache = new Map();

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
      searchData: null
    });
  }
  return searchCache.get(cacheKey);
}

// Extract text from various YouTube text formats
function extractText(field) {
  if (!field) return null;
  if (typeof field === 'string') return field;
  if (field.text) return field.text;
  if (field.runs) return field.runs.map(r => r.text).join('');
  if (typeof field.toString === 'function' && field.toString() !== '[object Object]') {
    return field.toString();
  }
  return null;
}

// Extract badges from video item
function extractBadges(item) {
  const badges = [];

  if (item.badges && Array.isArray(item.badges)) {
    for (const badge of item.badges) {
      const label = extractText(badge.label) || extractText(badge.text) || badge.style;
      if (label) badges.push(label);
    }
  }

  if (item.owner_badges && Array.isArray(item.owner_badges)) {
    for (const badge of item.owner_badges) {
      const label = extractText(badge.label) || extractText(badge.text) || badge.style;
      if (label) badges.push(label);
    }
  }

  if (item.is_live || item.isLive) badges.push('LIVE');
  if (item.is_upcoming || item.isUpcoming) badges.push('UPCOMING');
  if (item.is_members_only || item.is_premium) badges.push('MEMBERS ONLY');
  if (item.is_4k) badges.push('4K');
  if (item.is_hdr) badges.push('HDR');
  if (item.is_vr180 || item.is_vr) badges.push('VR');
  if (item.is_360) badges.push('360°');

  return [...new Set(badges)];
}

// Extract hashtags from title and description
function extractHashtags(title, description) {
  const hashtags = [];
  const hashtagRegex = /#[\w\u0080-\uFFFF]+/g;

  if (title) {
    const titleTags = title.match(hashtagRegex);
    if (titleTags) hashtags.push(...titleTags);
  }

  if (description) {
    const descTags = description.match(hashtagRegex);
    if (descTags) hashtags.push(...descTags);
  }

  return [...new Set(hashtags)];
}

/**
 * Fetch full video details including tags
 */
async function getVideoTags(videoId) {
  // Check cache first
  if (videoDetailsCache.has(videoId)) {
    const cached = videoDetailsCache.get(videoId);
    if (Date.now() - cached.timestamp < 30 * 60 * 1000) { // 30 min cache
      return cached.data;
    }
  }

  try {
    const youtube = await initYouTube();
    const info = await youtube.getInfo(videoId);

    const tags = [];
    const keywords = [];
    const category = null;

    // Extract from basic_info
    if (info.basic_info) {
      if (info.basic_info.tags && Array.isArray(info.basic_info.tags)) {
        tags.push(...info.basic_info.tags);
      }
      if (info.basic_info.keywords && Array.isArray(info.basic_info.keywords)) {
        keywords.push(...info.basic_info.keywords);
      }
    }

    // Extract from primary_info
    if (info.primary_info) {
      if (info.primary_info.super_title_link?.runs) {
        for (const run of info.primary_info.super_title_link.runs) {
          if (run.text && run.text.startsWith('#')) {
            tags.push(run.text);
          }
        }
      }
    }

    // Extract from secondary_info
    if (info.secondary_info?.metadata?.rows) {
      for (const row of info.secondary_info.metadata.rows) {
        if (row.metadata_row_header?.content?.text === 'Tags') {
          const tagText = row.contents?.map(c => extractText(c)).filter(Boolean);
          if (tagText) tags.push(...tagText);
        }
      }
    }

    const result = {
      tags: [...new Set(tags)],
      keywords: [...new Set(keywords)],
      category: info.basic_info?.category || null,
      channelKeywords: info.basic_info?.channel_keywords || []
    };

    // Cache the result
    videoDetailsCache.set(videoId, {
      timestamp: Date.now(),
      data: result
    });

    return result;

  } catch (error) {
    console.error(`Failed to get tags for ${videoId}:`, error.message);
    return { tags: [], keywords: [], category: null, channelKeywords: [] };
  }
}

/**
 * Batch fetch tags for multiple videos
 */
async function batchGetVideoTags(videoIds, maxConcurrent = 3) {
  const results = {};

  // Process in batches to avoid rate limiting
  for (let i = 0; i < videoIds.length; i += maxConcurrent) {
    const batch = videoIds.slice(i, i + maxConcurrent);
    const promises = batch.map(async (id) => {
      results[id] = await getVideoTags(id);
    });
    await Promise.all(promises);

    // Small delay between batches
    if (i + maxConcurrent < videoIds.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  return results;
}

// Format video result with tags and labels
function formatVideo(item, fullTags = null) {
  const videoId = item.id || item.video_id;
  if (!videoId) return null;

  let title = 'Unknown';
  if (item.title) {
    title = extractText(item.title) || 'Unknown';
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
  let isVerified = false;
  let isArtist = false;

  if (item.author) {
    channelName = item.author.name || item.author.title || 'Unknown';
    channelId = item.author.id || item.author.channel_id;
    channelUrl = item.author.url || (channelId ? `https://www.youtube.com/channel/${channelId}` : null);
    isVerified = item.author.is_verified || item.author.isVerified || false;
    isArtist = item.author.is_verified_artist || item.author.isVerifiedArtist || false;
  }

  const description = item.description_snippet?.text || item.description?.text || '';

  const badges = extractBadges(item);
  const hashtags = extractHashtags(title, description);

  // Merge with full tags if available
  const tags = fullTags?.tags || [];
  const keywords = fullTags?.keywords || [];
  const category = fullTags?.category || null;

  // Build allTags from all sources
  const allTags = [...new Set([
    ...badges,
    ...hashtags,
    ...tags,
    ...keywords.slice(0, 10) // Limit keywords
  ])].filter(Boolean);

  return {
    type: 'video',
    id: videoId,
    title,
    thumbnail,
    duration,
    views,
    published,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    description,

    channel: {
      name: channelName,
      id: channelId,
      url: channelUrl,
      thumbnail: item.author?.thumbnails?.[0]?.url || null,
      isVerified,
      isArtist
    },

    metadata: {
      badges,
      hashtags,
      tags,           // Full video tags (from getInfo)
      keywords,       // Video keywords (from getInfo)
      category,       // Video category
      allTags,        // Combined unique tags

      isLive: item.is_live || item.isLive || badges.includes('LIVE') || false,
      isUpcoming: item.is_upcoming || badges.includes('UPCOMING') || false,
      isShort: item.is_short || (item.duration?.seconds && item.duration.seconds <= 60) || false,
      isPremium: item.is_premium || badges.includes('MEMBERS ONLY') || false,
      is4K: item.is_4k || badges.includes('4K') || false,
      isHDR: item.is_hdr || badges.includes('HDR') || false,

      // Flag to indicate if full tags were fetched
      hasFullTags: fullTags !== null
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

  const badges = extractBadges(item);

  return {
    type: 'channel',
    id: channelId,
    name,
    thumbnail,
    subscriberCount: item.subscriber_count?.text || 'N/A',
    videoCount: item.video_count?.text || 'N/A',
    description: item.description_snippet?.text || item.description?.text || '',
    url: item.author?.url || `https://www.youtube.com/channel/${channelId}`,
    handle: item.author?.handle || null,

    metadata: {
      badges,
      isVerified: item.author?.is_verified || item.is_verified || false,
      isArtist: item.author?.is_verified_artist || false
    }
  };
}

// Format playlist result
function formatPlaylist(item) {
  const playlistId = item.id || item.playlist_id;
  if (!playlistId) return null;

  let title = 'Unknown';
  if (item.title) {
    title = extractText(item.title) || 'Unknown';
  }

  let thumbnail = null;
  if (item.thumbnails?.length > 0) {
    thumbnail = item.thumbnails[item.thumbnails.length - 1]?.url || item.thumbnails[0]?.url;
  }

  const badges = extractBadges(item);

  return {
    type: 'playlist',
    id: playlistId,
    title,
    thumbnail,
    videoCount: item.video_count?.text || (typeof item.video_count === 'number' ? item.video_count.toString() : 'N/A'),
    url: `https://www.youtube.com/playlist?list=${playlistId}`,
    channel: {
      name: item.author?.name || 'Unknown',
      id: item.author?.id || null,
      url: item.author?.id ? `https://www.youtube.com/channel/${item.author.id}` : null
    },
    metadata: { badges }
  };
}

// Format any search result item
function formatSearchResult(item, fullTags = null) {
  if (!item) return null;

  const type = item.type;

  switch (type) {
    case 'Video':
    case 'Movie':
    case 'Show':
      return formatVideo(item, fullTags);
    case 'Channel':
      return formatChannel(item);
    case 'Playlist':
      return formatPlaylist(item);
    default:
      if (item.duration || item.view_count) {
        return formatVideo(item, fullTags);
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

  const processItems = (items) => {
    for (const item of items) {
      const id = item.id || item.author?.id || item.playlist_id;
      if (id && !seenIds.has(id)) {
        const formatted = formatSearchResult(item);
        if (formatted) {
          seenIds.add(id);
          results.push(formatted);
        }
      }
    }
  };

  if (searchData.results && Array.isArray(searchData.results)) {
    processItems(searchData.results);
  }

  if (searchData.contents && Array.isArray(searchData.contents)) {
    processItems(searchData.contents);
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
    let pageCount = Math.ceil(cache.results.length / 20);
    const maxPages = 100;
    const maxResults = 500;

    while (
      cache.results.length < maxResults && 
      searchData?.has_continuation && 
      pageCount < maxPages
    ) {
      try {
        searchData = await searchData.getContinuation();
        pageCount++;

        const pageResults = extractResults(searchData, cache.seenIds);

        if (pageResults.length === 0) break;

        cache.results.push(...pageResults);
        cache.searchData = searchData;
        cache.lastUpdate = Date.now();

        if (pageCount % 5 === 0) {
          console.log(`   [Background] Page ${pageCount}: +${pageResults.length} (total: ${cache.results.length})`);
        }

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
 * @param {string} query - Search query
 * @param {object} options - Search options
 * @param {string} options.type - 'all', 'video', 'channel', 'playlist'
 * @param {string} options.sort - 'relevance', 'date', 'views', 'rating'
 * @param {string} options.duration - 'short', 'medium', 'long'
 * @param {string} options.uploadDate - 'hour', 'today', 'week', 'month', 'year'
 * @param {number} options.start - Start index (1-based)
 * @param {number} options.end - End index
 * @param {boolean} options.fetchTags - Fetch full video tags (slower but complete)
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
      end = null,
      fetchTags = false
    } = options;

    console.log(`🔍 Searching: "${query}"${fetchTags ? ' (with tags)' : ''}`);

    const hasRange = start !== null && end !== null;
    const requestedEnd = hasRange ? end : 20;

    if (hasRange) {
      console.log(`📊 Target: results ${start}-${end}`);
    }

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

    const cacheKey = getCacheKey(query, options);
    let cache = searchCache.get(cacheKey);

    if (cache && Date.now() - cache.lastUpdate < 5 * 60 * 1000) {
      console.log(`📦 Cache hit: ${cache.results.length} results cached`);

      if (cache.results.length < requestedEnd && !cache.isComplete && !cache.isFetching) {
        backgroundFetchSearch(cacheKey, query, searchFilters, youtube);
        await waitForResults(cacheKey, requestedEnd, 15000);
      }

    } else {
      cache = initSearchCache(cacheKey);

      console.log(`🔄 Fetching fresh results...`);

      const searchData = await youtube.search(query, searchFilters);

      const firstPageResults = extractResults(searchData, cache.seenIds);
      cache.results.push(...firstPageResults);
      cache.searchData = searchData;
      cache.lastUpdate = Date.now();

      console.log(`   First page: ${firstPageResults.length} results`);

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

      if (cache.searchData?.has_continuation && !cache.isComplete) {
        backgroundFetchSearch(cacheKey, query, searchFilters, youtube);
      } else {
        cache.isComplete = true;
      }
    }

    cache = searchCache.get(cacheKey);

    let finalResults = cache.results;
    if (hasRange) {
      const startIndex = Math.max(0, start - 1);
      const endIndex = Math.min(cache.results.length, end);
      finalResults = cache.results.slice(startIndex, endIndex);
      console.log(`📊 Range [${start}:${end}] = ${finalResults.length} results`);
    } else {
      finalResults = cache.results.slice(0, 20);
    }

    // Fetch full tags if requested
    if (fetchTags) {
      console.log(`🏷️  Fetching full tags for ${finalResults.filter(r => r.type === 'video').length} videos...`);

      const videoIds = finalResults
        .filter(r => r.type === 'video' && !r.metadata.hasFullTags)
        .map(r => r.id);

      if (videoIds.length > 0) {
        const tagResults = await batchGetVideoTags(videoIds);

        // Update results with full tags
        finalResults = finalResults.map(result => {
          if (result.type === 'video' && tagResults[result.id]) {
            const fullTags = tagResults[result.id];
            return {
              ...result,
              metadata: {
                ...result.metadata,
                tags: fullTags.tags,
                keywords: fullTags.keywords,
                category: fullTags.category,
                allTags: [...new Set([
                  ...result.metadata.badges,
                  ...result.metadata.hashtags,
                  ...fullTags.tags,
                  ...fullTags.keywords.slice(0, 10)
                ])].filter(Boolean),
                hasFullTags: true
              }
            };
          }
          return result;
        });

        console.log(`✅ Tags fetched for ${videoIds.length} videos`);
      }
    }

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
      tagsIncluded: fetchTags,
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
 * Search with full tags (convenience function)
 */
async function searchWithTags(query, options = {}) {
  return search(query, { ...options, fetchTags: true });
}

/**
 * Get full video info including tags
 */
async function getVideoInfo(videoId) {
  try {
    const youtube = await initYouTube();
    const info = await youtube.getInfo(videoId);

    const basicInfo = info.basic_info || {};

    // Extract all available tags
    const tags = basicInfo.tags || [];
    const keywords = basicInfo.keywords || [];

    // Get hashtags from title
    const title = basicInfo.title || '';
    const hashtags = extractHashtags(title, basicInfo.short_description || '');

    return {
      success: true,
      video: {
        id: videoId,
        title: basicInfo.title || 'Unknown',
        description: basicInfo.short_description || '',
        thumbnail: basicInfo.thumbnail?.[0]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        duration: basicInfo.duration || 0,
        views: basicInfo.view_count || 0,
        likes: basicInfo.like_count || 0,
        published: basicInfo.publish_date || null,

        channel: {
          name: basicInfo.author || basicInfo.channel?.name || 'Unknown',
          id: basicInfo.channel_id || basicInfo.channel?.id,
          url: basicInfo.channel?.url
        },

        metadata: {
          tags,
          keywords,
          hashtags,
          category: basicInfo.category || null,
          isLive: basicInfo.is_live || false,
          isPrivate: basicInfo.is_private || false,
          isFamilySafe: basicInfo.is_family_safe || true,
          allTags: [...new Set([...tags, ...keywords, ...hashtags])].filter(Boolean)
        }
      }
    };

  } catch (error) {
    console.error('❌ Get video info error:', error);
    return { success: false, error: error.message };
  }
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

  await search(query, { ...options, start: 1, end: 20 });
  return true;
}

/**
 * Search by tag/keyword
 */
async function searchByTag(tag, options = {}) {
  const cleanTag = tag.replace(/^#/, '');
  return search(cleanTag, { ...options, type: 'video' });
}

/**
 * Find videos with similar tags to a given video
 */
async function findRelatedByTags(videoId, options = {}) {
  // First get the video's tags
  const videoInfo = await getVideoInfo(videoId);

  if (!videoInfo.success) {
    return { success: false, error: 'Could not get video info' };
  }

  const allTags = videoInfo.video.metadata.allTags;

  if (!allTags.length) {
    return { success: false, error: 'No tags available for this video' };
  }

  // Use the most relevant tags (first 3-5)
  const searchTags = allTags.slice(0, 5).join(' ');
  console.log(`🔗 Finding related videos using tags: ${searchTags}`);

  const results = await search(searchTags, { ...options, type: 'video' });

  // Filter out the original video
  if (results.success && results.videos) {
    results.videos = results.videos.filter(v => v.id !== videoId);
    results.results = results.results.filter(r => r.id !== videoId);
    results.totalResults = results.results.length;
    results.basedOnTags = allTags.slice(0, 5);
  }

  return results;
}

export {
  search,
  searchVideos,
  searchChannels,
  searchPlaylists,
  searchWithTags,
  getVideoInfo,
  getVideoTags,
  getSearchSuggestions,
  getTrending,
  getSearchCacheStatus,
  clearSearchCache,
  prefetchSearch,
  searchByTag,
  findRelatedByTags
};
