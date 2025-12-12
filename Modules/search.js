// search.js - Fixed version with better comment fetching and cleaner metadata

import { Innertube, Log } from 'youtubei.js';

Log.setLevel(Log.Level.NONE);

let ytInstance = null;
const searchCache = new Map();
const videoDetailsCache = new Map();

function generateVisitorData() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = 'Cgt';
  for (let i = 0; i < 22; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

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

  console.log('✅ YouTube instance initialized');
  return ytInstance;
}

function getCacheKey(query, options = {}) {
  const { type = 'all', sort = 'relevance', duration, uploadDate } = options;
  return `${query.toLowerCase().trim()}|${type}|${sort}|${duration || ''}|${uploadDate || ''}`;
}

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

// Clean and validate a value (remove URLs, empty strings, etc.)
function isValidTag(value) {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();

  // Skip if empty or too short
  if (trimmed.length < 2) return false;

  // Skip URLs
  if (trimmed.includes('http://') || trimmed.includes('https://') || trimmed.includes('bit.ly')) {
    return false;
  }

  // Skip if just numbers
  if (/^\d+$/.test(trimmed)) return false;

  // Skip common junk
  if (['N/A', 'null', 'undefined', ''].includes(trimmed)) return false;

  return true;
}

// Clean array of tags
function cleanTags(tags) {
  return tags.filter(isValidTag).map(t => t.trim());
}

function extractArtistNames(title, channelName) {
  const artists = [];

  if (title) {
    // Pattern: "feat." or "ft." or "featuring"
    const featMatch = title.match(/(?:feat\.?|ft\.?|featuring)\s+([^|(\[\]]+)/i);
    if (featMatch) {
      artists.push(featMatch[1].trim());
    }

    // Pattern: "SONG: ARTIST" or "ARTIST: SONG"
    const colonParts = title.split(':');
    if (colonParts.length >= 2) {
      const potentialArtist = colonParts[1].split('|')[0].trim();
      if (potentialArtist && potentialArtist.length < 50 && potentialArtist.length > 2) {
        artists.push(potentialArtist);
      }
    }

    // Pattern: "SONG | ARTIST | ARTIST2"
    const pipeParts = title.split('|').map(p => p.trim()).filter(p => p.length > 2 && p.length < 30);
    if (pipeParts.length > 1) {
      artists.push(...pipeParts.slice(1, 4));
    }
  }

  // Clean up and filter
  return [...new Set(
    artists
      .map(a => a.replace(/[(\[\])]/g, '').trim())
      .filter(a => a.length > 2 && a.length < 40 && isValidTag(a))
  )];
}

function extractMeaningfulKeywords(keywords, title) {
  const genericTerms = [
    'song', 'video', 'official', 'full', 'hd', '4k', 'new', 'latest', 'best',
    'music', 'audio', 'lyrics', 'lyrical', 'movie', 'film', 'trailer',
    '2024', '2025', '2023', '2022', '2021', '2020',
    'bollywood', 'hollywood', 'songs', 'videos', 'movies',
    'hindi', 'english', 'punjabi', 'tamil', 'telugu',
    'tseries', 't-series', 'vevo', 'records', 'entertainment'
  ];

  return keywords.filter(kw => {
    if (!isValidTag(kw)) return false;

    const lower = kw.toLowerCase();

    if (genericTerms.some(term => lower === term || lower.includes(term + ' ') || lower.startsWith(term))) {
      return false;
    }

    if (kw.split(' ').length >= 2) return true;

    return kw.length > 4;
  });
}

// Extract credits from description
function extractCreditsFromDescription(description) {
  const credits = {
    song: null,
    singer: null,
    artists: [],
    music: null,
    lyrics: null,
    director: null,
    label: null
  };

  if (!description) return credits;

  const patterns = {
    song: /SONG\s*[:\-]\s*([^\n]+)/i,
    singer: /SINGER\s*[:\-]\s*([^\n]+)/i,
    starring: /STARRING\s*[:\-]\s*([^\n]+)/i,
    music: /MUSIC(?:\s+(?:BY|PRODUCED\s+BY))?\s*[:\-]\s*([^\n]+)/i,
    lyrics: /LYRICS\s*[:\-]\s*([^\n]+)/i,
    director: /DIRECTED\s+BY\s*[:\-]\s*([^\n]+)/i,
    label: /MUSIC\s+LABEL\s*[:\-]\s*([^\n]+)/i
  };

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = description.match(pattern);
    if (match) {
      const value = match[1].trim();
      if (isValidTag(value)) {
        if (key === 'starring') {
          // Split starring by comma or &
          credits.artists = value.split(/[,&]/).map(a => a.trim()).filter(isValidTag);
        } else {
          credits[key] = value;
        }
      }
    }
  }

  return credits;
}

// Add comment cache at the top with other caches
const commentCache = new Map();

/**
 * Fetch video comments with pagination support
 * @param {string} videoId - YouTube video ID
 * @param {object} options - Options for fetching comments
 */
async function getVideoComments(videoId, options = {}) {
  try {
    const {
      start = 1,
      end = 20,
      maxComments = 500,
      sortBy = 'top',
      forceRefresh = false
    } = typeof options === 'number' ? { end: options } : options;

    const requestedCount = end - start + 1;
    const totalNeeded = Math.min(end, maxComments);

    console.log(`💬 Fetching comments for ${videoId} (${start}-${end}, sort: ${sortBy})...`);

    const cacheKey = `${videoId}|${sortBy}`;

    // Check cache first
    if (!forceRefresh && commentCache.has(cacheKey)) {
      const cached = commentCache.get(cacheKey);

      // If we have enough cached comments or fetching is complete
      if (cached.comments.length >= totalNeeded || cached.isComplete) {
        console.log(`📦 Comment cache hit: ${cached.comments.length} comments cached`);

        const startIndex = Math.max(0, start - 1);
        const endIndex = Math.min(cached.comments.length, end);

        return {
          success: true,
          videoId,
          sortBy,
          range: { start, end },
          totalFetched: cached.comments.length,
          isComplete: cached.isComplete,
          hasMore: !cached.isComplete || cached.comments.length > end,
          comments: cached.comments.slice(startIndex, endIndex)
        };
      }

      // Need to fetch more - continue from where we left off
      if (cached.continuation && !cached.isComplete && !cached.isFetching) {
        await fetchMoreComments(cacheKey, cached, totalNeeded);
      }
    } else {
      // Initialize fresh fetch
      await initializeCommentFetch(videoId, cacheKey, sortBy, totalNeeded);
    }

    // Get results from cache
    const cache = commentCache.get(cacheKey);

    if (!cache || cache.comments.length === 0) {
      return {
        success: true,
        videoId,
        sortBy,
        range: { start, end },
        totalFetched: 0,
        isComplete: true,
        hasMore: false,
        comments: [],
        message: 'No comments found or comments are disabled'
      };
    }

    const startIndex = Math.max(0, start - 1);
    const endIndex = Math.min(cache.comments.length, end);

    return {
      success: true,
      videoId,
      sortBy,
      range: { start, end },
      totalFetched: cache.comments.length,
      isComplete: cache.isComplete,
      hasMore: !cache.isComplete || cache.comments.length > end,
      comments: cache.comments.slice(startIndex, endIndex)
    };

  } catch (error) {
    console.error(`Failed to get comments for ${videoId}:`, error.message);
    return { 
      success: false, 
      error: error.message,
      comments: [] 
    };
  }
}

/**
 * Initialize comment fetching
 */
async function initializeCommentFetch(videoId, cacheKey, sortBy, targetCount) {
  const youtube = await initYouTube();

  // Initialize cache
  commentCache.set(cacheKey, {
    comments: [],
    seenIds: new Set(),
    continuation: null,
    isComplete: false,
    isFetching: true,
    lastUpdate: Date.now()
  });

  const cache = commentCache.get(cacheKey);

  try {
    let commentsThread;

    try {
      // Try direct method first
      const sortOption = sortBy === 'newest' ? 'NEWEST_FIRST' : 'TOP_COMMENTS';
      commentsThread = await youtube.getComments(videoId, sortOption);
    } catch (e) {
      console.log(`Direct comment fetch failed: ${e.message}`);
      // Fallback is handled below
    }

    if (!commentsThread) {
      cache.isComplete = true;
      cache.isFetching = false;
      return;
    }

    // Parse initial comments
    parseCommentsFromThread(commentsThread, cache);
    console.log(`   Initial fetch: ${cache.comments.length} comments`);

    // Store continuation for later
    if (commentsThread.has_continuation) {
      cache.continuation = commentsThread;
    } else {
      cache.isComplete = true;
    }

    // Fetch more if needed
    if (cache.comments.length < targetCount && cache.continuation) {
      await fetchMoreComments(cacheKey, cache, targetCount);
    }

  } catch (error) {
    console.error('Comment initialization error:', error.message);
    cache.isComplete = true;
  } finally {
    cache.isFetching = false;
    cache.lastUpdate = Date.now();
  }
}

/**
 * Fetch more comments using continuation
 */
async function fetchMoreComments(cacheKey, cache, targetCount) {
  if (!cache.continuation || cache.isComplete || cache.isFetching) {
    return;
  }

  cache.isFetching = true;
  let pageCount = 0;
  const maxPages = 50; // Safety limit

  console.log(`   Fetching more comments (have ${cache.comments.length}, need ${targetCount})...`);

  try {
    while (
      cache.comments.length < targetCount &&
      cache.continuation?.has_continuation &&
      pageCount < maxPages
    ) {
      try {
        const nextPage = await cache.continuation.getContinuation();
        pageCount++;

        if (!nextPage) {
          cache.isComplete = true;
          break;
        }

        const beforeCount = cache.comments.length;
        parseCommentsFromThread(nextPage, cache);
        const added = cache.comments.length - beforeCount;

        if (added === 0) {
          cache.isComplete = true;
          break;
        }

        cache.continuation = nextPage;
        cache.lastUpdate = Date.now();

        // Log progress every 5 pages
        if (pageCount % 5 === 0) {
          console.log(`   Page ${pageCount}: ${cache.comments.length} comments`);
        }

        // Small delay to avoid rate limiting
        if (pageCount % 10 === 0) {
          await new Promise(r => setTimeout(r, 200));
        }

      } catch (contError) {
        console.log(`   Continuation ended: ${contError.message}`);
        cache.isComplete = true;
        break;
      }
    }

    if (!cache.continuation?.has_continuation) {
      cache.isComplete = true;
    }

    console.log(`   ✅ Fetched ${cache.comments.length} total comments (${pageCount} pages)`);

  } catch (error) {
    console.error('Error fetching more comments:', error.message);
  } finally {
    cache.isFetching = false;
  }
}

/**
 * Parse comments from a thread/page response
 */
function parseCommentsFromThread(thread, cache) {
  if (!thread) return;

  const contents = thread.contents || thread.comments || [];

  for (const item of contents) {
    const comment = item.comment || 
                   item.commentRenderer || 
                   item.commentThreadRenderer?.comment ||
                   item;

    if (!comment) continue;

    const commentId = comment.comment_id || 
                     comment.commentId || 
                     comment.id ||
                     null;

    // Skip if already seen
    if (commentId && cache.seenIds.has(commentId)) {
      continue;
    }

    const text = extractText(comment.content) ||
                extractText(comment.content_text) ||
                extractText(comment.contentText) ||
                extractText(comment.text) || '';

    if (!text) continue;

    if (commentId) {
      cache.seenIds.add(commentId);
    }

    // Parse author info
    const author = comment.author || {};
    const authorName = author.name || 
                      extractText(comment.author_text) ||
                      extractText(comment.authorText) ||
                      'Unknown';

    // Parse like count
    let likes = '0';
    if (comment.vote_count) {
      likes = extractText(comment.vote_count);
    } else if (comment.voteCount) {
      likes = extractText(comment.voteCount);
    } else if (comment.like_count !== undefined) {
      likes = String(comment.like_count);
    }

    // Parse reply count
    let replyCount = 0;
    if (comment.reply_count !== undefined) {
      replyCount = comment.reply_count;
    } else if (item.commentThreadRenderer?.replies) {
      replyCount = item.commentThreadRenderer.replies.length || 0;
    }

    cache.comments.push({
      id: commentId,
      text: text.trim(),
      author: {
        name: authorName,
        id: author.id || 
            comment.author_endpoint?.browse_endpoint?.browse_id ||
            null,
        thumbnail: author.thumbnails?.[0]?.url ||
                  comment.author_thumbnail?.thumbnails?.[0]?.url ||
                  null,
        isVerified: author.is_verified || false,
        isChannelOwner: comment.is_channel_owner || 
                       comment.author_is_channel_owner || 
                       false
      },
      likes,
      likesCount: parseLikeCount(likes),
      published: extractText(comment.published) ||
                extractText(comment.published_time_text) ||
                extractText(comment.publishedTimeText) || '',
      replyCount,
      isHearted: comment.is_hearted || 
                (comment.action_buttons?.creator_heart ? true : false) ||
                (comment.creatorHeart ? true : false),
      isPinned: comment.is_pinned || 
               (comment.pinned_comment_badge ? true : false) ||
               false,
      isReply: comment.is_reply || false
    });
  }
}

/**
 * Parse like count string to number
 */
function parseLikeCount(likeStr) {
  if (!likeStr || likeStr === '0') return 0;

  const str = String(likeStr).toLowerCase().replace(/,/g, '');

  if (str.includes('k')) {
    return Math.round(parseFloat(str) * 1000);
  }
  if (str.includes('m')) {
    return Math.round(parseFloat(str) * 1000000);
  }

  const num = parseInt(str, 10);
  return isNaN(num) ? 0 : num;
}

/**
 * Clear comment cache
 */
function clearCommentCache(videoId = null) {
  if (videoId) {
    for (const key of commentCache.keys()) {
      if (key.startsWith(videoId)) {
        commentCache.delete(key);
      }
    }
  } else {
    commentCache.clear();
  }
}

/**
 * Get comment cache status
 */
function getCommentCacheStatus(videoId, sortBy = 'top') {
  const cacheKey = `${videoId}|${sortBy}`;
  const cache = commentCache.get(cacheKey);

  if (!cache) {
    return { exists: false };
  }

  return {
    exists: true,
    commentCount: cache.comments.length,
    isComplete: cache.isComplete,
    isFetching: cache.isFetching,
    lastUpdate: cache.lastUpdate
  };
}
/**
 * Fetch full video details including tags
 */
async function getVideoTags(videoId) {
  if (videoDetailsCache.has(videoId)) {
    const cached = videoDetailsCache.get(videoId);
    if (Date.now() - cached.timestamp < 30 * 60 * 1000) {
      return cached.data;
    }
  }

  try {
    const youtube = await initYouTube();
    const info = await youtube.getInfo(videoId);

    const tags = [];
    const keywords = [];

    if (info.basic_info) {
      if (info.basic_info.tags && Array.isArray(info.basic_info.tags)) {
        tags.push(...info.basic_info.tags);
      }
      if (info.basic_info.keywords && Array.isArray(info.basic_info.keywords)) {
        keywords.push(...info.basic_info.keywords);
      }
    }

    if (info.primary_info?.super_title_link?.runs) {
      for (const run of info.primary_info.super_title_link.runs) {
        if (run.text && run.text.startsWith('#')) {
          tags.push(run.text);
        }
      }
    }

    const result = {
      tags: cleanTags([...new Set(tags)]),
      keywords: cleanTags([...new Set(keywords)]),
      category: info.basic_info?.category || null,
      channelKeywords: cleanTags(info.basic_info?.channel_keywords || [])
    };

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

async function batchGetVideoTags(videoIds, maxConcurrent = 3) {
  const results = {};

  for (let i = 0; i < videoIds.length; i += maxConcurrent) {
    const batch = videoIds.slice(i, i + maxConcurrent);
    const promises = batch.map(async (id) => {
      results[id] = await getVideoTags(id);
    });
    await Promise.all(promises);

    if (i + maxConcurrent < videoIds.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  return results;
}

/**
 * Get full video info with tags and comments
 */
/**
 * Get full video info with tags and comments
 */
async function getVideoInfo(videoId, options = {}) {
  try {
    const { 
      includeComments = true, 
      commentStart = 1,
      commentEnd = 20,
      maxComments = 100,
      commentSort = 'top'
    } = options;

    console.log(`📹 Getting video info for ${videoId}...`);

    const youtube = await initYouTube();
    const info = await youtube.getInfo(videoId);

    const basicInfo = info.basic_info || {};
    const title = basicInfo.title || '';
    const description = basicInfo.short_description || '';
    const channelName = basicInfo.author || basicInfo.channel?.name || 'Unknown';

    // Extract all metadata
    const tags = cleanTags(basicInfo.tags || []);
    const keywords = cleanTags(basicInfo.keywords || []);
    const hashtags = extractHashtags(title, description);
    const artists = extractArtistNames(title, channelName);
    const meaningfulKeywords = extractMeaningfulKeywords(keywords, title);
    const credits = extractCreditsFromDescription(description);

    // Add artists from credits
    if (credits.artists.length > 0) {
      artists.push(...credits.artists);
    }
    if (credits.singer && !artists.includes(credits.singer)) {
      artists.unshift(credits.singer);
    }

    const uniqueArtists = [...new Set(artists)].filter(isValidTag);

    const relatedTopics = [];
    if (credits.song) relatedTopics.push(credits.song);
    if (credits.singer) relatedTopics.push(credits.singer);
    if (credits.music) relatedTopics.push(credits.music);

    // Get comments if requested
    let commentsResult = { 
      comments: [], 
      totalFetched: 0, 
      isComplete: true,
      hasMore: false
    };

    if (includeComments) {
      commentsResult = await getVideoComments(videoId, {
        start: commentStart,
        end: commentEnd,
        maxComments,
        sortBy: commentSort
      });
    }

    // Build clean allTags
    const allTags = cleanTags([...new Set([
      ...tags,
      ...keywords,
      ...hashtags,
      ...uniqueArtists,
      ...relatedTopics
    ])]);

    return {
      success: true,
      video: {
        id: videoId,
        title,
        description,
        thumbnail: basicInfo.thumbnail?.[0]?.url || `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
        duration: basicInfo.duration || 0,
        durationFormatted: formatDuration(basicInfo.duration || 0),
        views: basicInfo.view_count || 0,
        viewsFormatted: formatViews(basicInfo.view_count || 0),
        likes: basicInfo.like_count || 0,
        likesFormatted: formatViews(basicInfo.like_count || 0),
        published: basicInfo.publish_date || null,
        uploadDate: basicInfo.upload_date || null,

        channel: {
          name: channelName,
          id: basicInfo.channel_id || basicInfo.channel?.id,
          url: basicInfo.channel?.url,
          subscriberCount: basicInfo.channel?.subscriber_count || null
        },

        credits: {
          song: credits.song,
          singer: credits.singer,
          music: credits.music,
          lyrics: credits.lyrics,
          director: credits.director,
          label: credits.label
        },

        metadata: {
          tags,
          keywords,
          meaningfulKeywords,
          hashtags,
          artists: uniqueArtists,
          relatedTopics: cleanTags(relatedTopics),
          category: basicInfo.category || null,
          isLive: basicInfo.is_live || false,
          isPrivate: basicInfo.is_private || false,
          isFamilySafe: basicInfo.is_family_safe !== false,
          allTags,
          searchTags: {
            primary: hashtags.slice(0, 3),
            artists: uniqueArtists.slice(0, 3),
            topics: meaningfulKeywords.slice(0, 5),
            category: basicInfo.category ? [basicInfo.category] : []
          }
        },

        comments: {
          count: commentsResult.totalFetched || 0,
          fetched: commentsResult.comments?.length || 0,
          isComplete: commentsResult.isComplete,
          hasMore: commentsResult.hasMore,
          sortBy: commentSort,
          items: commentsResult.comments || []
        }
      }
    };

  } catch (error) {
    console.error('❌ Get video info error:', error);
    return { success: false, error: error.message };
  }
}

// Format duration in seconds to HH:MM:SS or MM:SS
function formatDuration(seconds) {
  if (!seconds || seconds === 0) return '0:00';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Format view count
function formatViews(count) {
  if (!count) return '0';

  if (count >= 1000000000) {
    return (count / 1000000000).toFixed(1) + 'B';
  }
  if (count >= 1000000) {
    return (count / 1000000).toFixed(1) + 'M';
  }
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'K';
  }
  return count.toString();
}

// Format video result
function formatVideo(item, fullTags = null) {
  const videoId = item.id || item.video_id;
  if (!videoId) return null;

  let title = extractText(item.title) || 'Unknown';

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
      duration = formatDuration(item.duration.seconds);
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

  const tags = cleanTags(fullTags?.tags || []);
  const keywords = cleanTags(fullTags?.keywords || []);
  const category = fullTags?.category || null;

  const allTags = cleanTags([...new Set([
    ...badges,
    ...hashtags,
    ...tags,
    ...keywords.slice(0, 10)
  ])]);

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
      tags,
      keywords,
      category,
      allTags,

      isLive: item.is_live || item.isLive || badges.includes('LIVE') || false,
      isUpcoming: item.is_upcoming || badges.includes('UPCOMING') || false,
      isShort: item.is_short || (item.duration?.seconds && item.duration.seconds <= 60) || false,
      isPremium: item.is_premium || badges.includes('MEMBERS ONLY') || false,
      is4K: item.is_4k || badges.includes('4K') || false,
      isHDR: item.is_hdr || badges.includes('HDR') || false,
      hasFullTags: fullTags !== null
    }
  };
}

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

function formatPlaylist(item) {
  const playlistId = item.id || item.playlist_id;
  if (!playlistId) return null;

  let title = extractText(item.title) || 'Unknown';

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
        break;
      }
    }

    cache.isComplete = true;
    console.log(`✅ [Background] Search complete: ${cache.results.length} total results\n`);

  } catch (e) {
    cache.error = e.message;
  } finally {
    cache.isFetching = false;
  }
}

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
 * Search YouTube
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

      const searchData = await youtube.search(query, searchFilters);

      const firstPageResults = extractResults(searchData, cache.seenIds);
      cache.results.push(...firstPageResults);
      cache.searchData = searchData;
      cache.lastUpdate = Date.now();

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
    } else {
      finalResults = cache.results.slice(0, 20);
    }

    if (fetchTags) {
      const videoIds = finalResults
        .filter(r => r.type === 'video' && !r.metadata.hasFullTags)
        .map(r => r.id);

      if (videoIds.length > 0) {
        const tagResults = await batchGetVideoTags(videoIds);

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
                allTags: cleanTags([...new Set([
                  ...result.metadata.badges,
                  ...result.metadata.hashtags,
                  ...fullTags.tags,
                  ...fullTags.keywords.slice(0, 10)
                ])]),
                hasFullTags: true
              }
            };
          }
          return result;
        });
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

async function searchVideos(query, options = {}) {
  return search(query, { ...options, type: 'video' });
}

async function searchChannels(query, options = {}) {
  return search(query, { ...options, type: 'channel' });
}

async function searchPlaylists(query, options = {}) {
  return search(query, { ...options, type: 'playlist' });
}

async function getSearchSuggestions(query) {
  try {
    const youtube = await initYouTube();
    const suggestions = await youtube.getSearchSuggestions(query);
    return { success: true, query, suggestions: suggestions || [] };
  } catch (error) {
    return { success: false, error: error.message, suggestions: [] };
  }
}

async function getTrending(options = {}) {
  try {
    const youtube = await initYouTube();
    const { region = 'US' } = options;

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
      } catch (e) {}
    }

    return { success: true, region, totalResults: allResults.length, results: allResults };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

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

function clearSearchCache(query = null, options = {}) {
  if (query) {
    const cacheKey = getCacheKey(query, options);
    searchCache.delete(cacheKey);
  } else {
    searchCache.clear();
  }
}

async function searchByTag(tag, options = {}) {
  const cleanTag = tag.replace(/^#/, '');
  return search(cleanTag, { ...options, type: 'video' });
}

/**
 * Build smart search queries for related videos
 */
function buildSmartSearchQueries(videoInfo) {
  const queries = [];
  const meta = videoInfo.video.metadata;
  const credits = videoInfo.video.credits;
  const title = videoInfo.video.title;
  const channelName = videoInfo.video.channel.name;

  // 1. Artist/Singer based queries (highest priority)
  if (credits.singer) {
    queries.push({
      query: `${credits.singer} songs`,
      type: 'singer',
      weight: 12
    });
  }

  // 2. Hashtag-based queries (very specific)
  if (meta.hashtags && meta.hashtags.length > 0) {
    const cleanHashtags = meta.hashtags.map(h => h.replace('#', ''));

    // Artist hashtags (usually all caps like YOYOHONEYSINGH)
    const artistHashtags = cleanHashtags.filter(h => /^[A-Z]+$/.test(h) && h.length > 4);
    if (artistHashtags.length > 0) {
      queries.push({
        query: artistHashtags[0].toLowerCase().replace(/([A-Z])/g, ' $1').trim(),
        type: 'artist_hashtag',
        weight: 11
      });
    }

    // Other hashtags
    const otherHashtags = cleanHashtags.filter(h => !/^[A-Z]+$/.test(h) && h.length > 3);
    if (otherHashtags.length > 0) {
      queries.push({
        query: otherHashtags[0],
        type: 'topic_hashtag',
        weight: 8
      });
    }
  }

  // 3. Artists extracted from title
  if (meta.artists && meta.artists.length > 0) {
    queries.push({
      query: `${meta.artists[0]} latest songs`,
      type: 'artist',
      weight: 10
    });

    if (meta.artists.length > 1) {
      queries.push({
        query: `${meta.artists[1]} songs`,
        type: 'featured_artist',
        weight: 7
      });
    }
  }

  // 4. Category + meaningful keyword combo
  if (meta.category && meta.meaningfulKeywords?.length > 0) {
    const topKeyword = meta.meaningfulKeywords[0].split(' ').slice(0, 3).join(' ');
    queries.push({
      query: `${topKeyword}`,
      type: 'topic_category',
      weight: 6
    });
  }

  // 5. Music label query
  if (credits.label && credits.label !== 'T-SERIES') {
    queries.push({
      query: `${credits.label} latest`,
      type: 'label',
      weight: 5
    });
  }

  // 6. Diverse keyword queries
  if (meta.meaningfulKeywords && meta.meaningfulKeywords.length > 2) {
    // Pick a keyword that's different from the first one
    const diverseKeyword = meta.meaningfulKeywords.find((kw, i) => 
      i > 0 && !kw.toLowerCase().includes(meta.meaningfulKeywords[0].split(' ')[0].toLowerCase())
    );

    if (diverseKeyword) {
      queries.push({
        query: diverseKeyword,
        type: 'diverse_keyword',
        weight: 5
      });
    }
  }

  // 7. Category-based trending
  if (meta.category) {
    const categoryQueries = {
      'Music': 'trending music videos india',
      'Entertainment': 'trending entertainment videos',
      'Film & Animation': 'latest movie songs',
      'Gaming': 'trending gaming',
      'Comedy': 'funny videos trending'
    };

    if (categoryQueries[meta.category]) {
      queries.push({
        query: categoryQueries[meta.category],
        type: 'category_trending',
        weight: 3
      });
    }
  }

  return queries.sort((a, b) => b.weight - a.weight);
}

/**
 * Find related videos using smart mixed search
 */
async function findRelatedByTags(videoId, options = {}) {
  try {
    const { start = 1, end = 20, maxQueries = 4 } = options;
    const limit = end - start + 1;

    console.log(`🔗 Finding related videos for ${videoId}...`);

    const videoInfo = await getVideoInfo(videoId, { includeComments: false });

    if (!videoInfo.success) {
      return { success: false, error: 'Could not get video info' };
    }

    const searchQueries = buildSmartSearchQueries(videoInfo);

    if (searchQueries.length === 0) {
      return { 
        success: false, 
        error: 'No suitable tags found for related search',
        videoInfo: videoInfo.video
      };
    }

    console.log(`📝 Generated ${searchQueries.length} search queries:`);
    searchQueries.slice(0, maxQueries).forEach((q, i) => {
      console.log(`   ${i + 1}. [${q.type}] "${q.query}" (weight: ${q.weight})`);
    });

    const allResults = [];
    const seenIds = new Set([videoId]);
    const queriesUsed = [];

    const queriesToRun = searchQueries.slice(0, maxQueries);

    const searchPromises = queriesToRun.map(async (queryInfo) => {
      try {
        const result = await search(queryInfo.query, { 
          type: 'video',
          start: 1,
          end: Math.ceil(limit / queriesToRun.length) + 5
        });

        return {
          ...queryInfo,
          results: result.success ? result.videos : []
        };
      } catch (e) {
        return { ...queryInfo, results: [] };
      }
    });

    const searchResults = await Promise.all(searchPromises);

    for (const searchResult of searchResults) {
      if (searchResult.results && searchResult.results.length > 0) {
        queriesUsed.push({
          query: searchResult.query,
          type: searchResult.type,
          resultCount: searchResult.results.length
        });

        for (const video of searchResult.results) {
          if (!seenIds.has(video.id)) {
            seenIds.add(video.id);

            video.relatedVia = {
              query: searchResult.query,
              type: searchResult.type,
              weight: searchResult.weight
            };

            allResults.push(video);
          }
        }
      }
    }

    // Sort by relevance
    allResults.sort((a, b) => {
      // Weight
      const weightDiff = (b.relatedVia?.weight || 0) - (a.relatedVia?.weight || 0);
      if (weightDiff !== 0) return weightDiff;

      // Verified channels
      if (b.channel.isVerified && !a.channel.isVerified) return 1;
      if (a.channel.isVerified && !b.channel.isVerified) return -1;

      // Prefer non-shorts
      if (b.metadata.isShort && !a.metadata.isShort) return -1;
      if (a.metadata.isShort && !b.metadata.isShort) return 1;

      return 0;
    });

    const startIndex = Math.max(0, start - 1);
    const paginatedResults = allResults.slice(startIndex, startIndex + limit);

    console.log(`✅ Found ${allResults.length} related videos, returning ${paginatedResults.length}`);

    return {
      success: true,
      originalVideo: {
        id: videoInfo.video.id,
        title: videoInfo.video.title,
        channel: videoInfo.video.channel.name
      },
      searchStrategy: {
        queriesUsed,
        totalQueries: searchQueries.length,
        queriesExecuted: queriesToRun.length
      },
      basedOn: {
        hashtags: videoInfo.video.metadata.hashtags,
        artists: videoInfo.video.metadata.artists,
        singer: videoInfo.video.credits?.singer,
        category: videoInfo.video.metadata.category,
        keywords: videoInfo.video.metadata.meaningfulKeywords?.slice(0, 5)
      },
      range: { start, end },
      totalResults: paginatedResults.length,
      totalFound: allResults.length,
      results: paginatedResults,
      videos: paginatedResults
    };

  } catch (error) {
    console.error('❌ Find related error:', error);
    return { success: false, error: error.message };
  }
}

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

export {
  search,
  searchVideos,
  searchChannels,
  searchPlaylists,
  getSearchSuggestions,
  getTrending,
  getVideoInfo,
  getVideoTags,
  getVideoComments,
  findRelatedByTags,
  searchByTag,
  getSearchCacheStatus,
  clearSearchCache,
  prefetchSearch,
  clearCommentCache,
  getCommentCacheStatus
};
