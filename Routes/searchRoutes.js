// routes/search.js
import express from 'express';
import { 
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
  clearSearchCache
} from '../Modules/search.js';

const router = express.Router();

// ================== SEARCH ROUTES ==================

// Main search endpoint - search all types
// GET /api/search?q=query&type=video&sort=relevance&start=1&end=20&fetchTags=true
router.get('/', async (req, res) => {
  try {
    const {
      q,
      query,
      type = 'all',
      sort = 'relevance',
      duration,
      uploadDate,
      upload_date,
      start,
      end,
      fetchTags,
      fetch_tags
    } = req.query;

    const searchQuery = q || query;

    if (!searchQuery) {
      return res.status(400).json({ 
        success: false, 
        error: 'Query parameter "q" or "query" is required' 
      });
    }

    const shouldFetchTags = fetchTags === 'true' || fetchTags === '1' || 
                            fetch_tags === 'true' || fetch_tags === '1';

    const options = {
      type,
      sort,
      duration: duration || null,
      uploadDate: uploadDate || upload_date || null,
      start: start ? parseInt(start) : null,
      end: end ? parseInt(end) : null,
      fetchTags: shouldFetchTags
    };

    const results = await search(searchQuery, options);
    res.json(results);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search videos only
// GET /api/search/videos?q=query&sort=view_count&start=1&end=50&fetchTags=true
router.get('/videos', async (req, res) => {
  try {
    const {
      q,
      query,
      sort = 'relevance',
      duration,
      uploadDate,
      upload_date,
      start,
      end,
      fetchTags,
      fetch_tags
    } = req.query;

    const searchQuery = q || query;

    if (!searchQuery) {
      return res.status(400).json({ 
        success: false, 
        error: 'Query parameter "q" or "query" is required' 
      });
    }

    const shouldFetchTags = fetchTags === 'true' || fetchTags === '1' || 
                            fetch_tags === 'true' || fetch_tags === '1';

    const options = {
      sort,
      duration: duration || null,
      uploadDate: uploadDate || upload_date || null,
      start: start ? parseInt(start) : null,
      end: end ? parseInt(end) : null,
      fetchTags: shouldFetchTags
    };

    const results = await searchVideos(searchQuery, options);
    res.json(results);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search channels only
// GET /api/search/channels?q=query&start=1&end=20
router.get('/channels', async (req, res) => {
  try {
    const { q, query, start, end } = req.query;

    const searchQuery = q || query;

    if (!searchQuery) {
      return res.status(400).json({ 
        success: false, 
        error: 'Query parameter "q" or "query" is required' 
      });
    }

    const options = {
      start: start ? parseInt(start) : null,
      end: end ? parseInt(end) : null
    };

    const results = await searchChannels(searchQuery, options);
    res.json(results);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search playlists only
// GET /api/search/playlists?q=query&start=1&end=20
router.get('/playlists', async (req, res) => {
  try {
    const { q, query, start, end } = req.query;

    const searchQuery = q || query;

    if (!searchQuery) {
      return res.status(400).json({ 
        success: false, 
        error: 'Query parameter "q" or "query" is required' 
      });
    }

    const options = {
      start: start ? parseInt(start) : null,
      end: end ? parseInt(end) : null
    };

    const results = await searchPlaylists(searchQuery, options);
    res.json(results);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search by tag/hashtag
// GET /api/search/tag?q=#music or /api/search/tag?q=music
router.get('/tag', async (req, res) => {
  try {
    const { q, query, start, end, fetchTags, fetch_tags } = req.query;

    const searchQuery = q || query;

    if (!searchQuery) {
      return res.status(400).json({ 
        success: false, 
        error: 'Tag parameter "q" or "query" is required' 
      });
    }

    const shouldFetchTags = fetchTags === 'true' || fetchTags === '1' || 
                            fetch_tags === 'true' || fetch_tags === '1';

    const options = {
      start: start ? parseInt(start) : null,
      end: end ? parseInt(end) : null,
      fetchTags: shouldFetchTags
    };

    const results = await searchByTag(searchQuery, options);
    res.json(results);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get search suggestions/autocomplete
// GET /api/search/suggestions?q=how+to
router.get('/suggestions', async (req, res) => {
  try {
    const { q, query } = req.query;

    const searchQuery = q || query;

    if (!searchQuery) {
      return res.status(400).json({ 
        success: false, 
        error: 'Query parameter "q" or "query" is required' 
      });
    }

    const results = await getSearchSuggestions(searchQuery);
    res.json(results);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get trending videos
// GET /api/search/trending?region=US
router.get('/trending', async (req, res) => {
  try {
    const { region = 'US' } = req.query;

    const results = await getTrending({ region });
    res.json(results);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================== VIDEO INFO ROUTES ==================

// Get full video info with tags and optional comments
// GET /api/search/video/:id?comments=true&commentStart=1&commentEnd=50&commentSort=top
// In searchroutes.js
router.get('/video/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      comments,
      includeComments,
      include_comments,
      commentStart,
      comment_start,
      commentEnd,
      comment_end,
      maxComments,
      max_comments,
      commentSort,
      comment_sort,
      debug  // Add debug parameter
    } = req.query;

    if (!id) {
      return res.status(400).json({ 
        success: false, 
        error: 'Video ID is required' 
      });
    }

    const shouldIncludeComments = comments !== 'false' && 
                                  includeComments !== 'false' && 
                                  include_comments !== 'false';

    const options = {
      includeComments: shouldIncludeComments,
      commentStart: parseInt(commentStart || comment_start) || 1,
      commentEnd: parseInt(commentEnd || comment_end) || 20,
      maxComments: parseInt(maxComments || max_comments) || 100,
      commentSort: commentSort || comment_sort || 'top',
      debug: debug === 'true' || debug === '1'  // Enable debug mode
    };

    const results = await getVideoInfo(id, options);
    res.json(results);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// In searchroutes.js - Add this debug route
router.get('/video/:id/debug', async (req, res) => {
  try {
    const { id } = req.params;
    const { Innertube } = await import('youtubei.js');
    
    const youtube = await Innertube.create({
      retrieve_player: true,
      generate_session_locally: true,
      lang: 'en',
      location: 'US'
    });
    
    const info = await youtube.getInfo(id);
    
    // Extract key structures for debugging
    const debugData = {
      // Basic Info structure
      basic_info: info.basic_info ? {
        keys: Object.keys(info.basic_info),
        title: info.basic_info.title,
        duration: info.basic_info.duration,
        view_count: info.basic_info.view_count,
        author: info.basic_info.author,
        channel: info.basic_info.channel,
        raw_view_count: JSON.stringify(info.basic_info.view_count)?.substring(0, 200)
      } : null,
      
      // Primary Info structure
      primary_info: info.primary_info ? {
        keys: Object.keys(info.primary_info),
        title: extractTextDebug(info.primary_info.title),
        view_count: info.primary_info.view_count,
        view_count_keys: info.primary_info.view_count ? Object.keys(info.primary_info.view_count) : null,
        view_count_raw: JSON.stringify(info.primary_info.view_count)?.substring(0, 500),
        short_view_count: info.primary_info.short_view_count,
        published: extractTextDebug(info.primary_info.published),
        date_text: extractTextDebug(info.primary_info.date_text)
      } : null,
      
      // Secondary Info
      secondary_info: info.secondary_info ? {
        keys: Object.keys(info.secondary_info),
        owner: info.secondary_info.owner ? {
          keys: Object.keys(info.secondary_info.owner),
          author: info.secondary_info.owner.author,
          subscriber_count: extractTextDebug(info.secondary_info.owner.subscriber_count)
        } : null
      } : null,
      
      // Streaming Data
      streaming_data: info.streaming_data ? {
        keys: Object.keys(info.streaming_data),
        formats_count: info.streaming_data.formats?.length,
        adaptive_formats_count: info.streaming_data.adaptive_formats?.length,
        first_format: info.streaming_data.formats?.[0] ? {
          keys: Object.keys(info.streaming_data.formats[0]),
          approxDurationMs: info.streaming_data.formats[0].approxDurationMs,
          approx_duration_ms: info.streaming_data.formats[0].approx_duration_ms,
          duration: info.streaming_data.formats[0].duration
        } : null
      } : 'NOT AVAILABLE',
      
      // Player Config
      player_config: info.player_config ? {
        keys: Object.keys(info.player_config)
      } : 'NOT AVAILABLE',
      
      // Microformat
      microformat: info.microformat ? {
        keys: Object.keys(info.microformat),
        playerMicroformatRenderer: info.microformat.playerMicroformatRenderer ? {
          lengthSeconds: info.microformat.playerMicroformatRenderer.lengthSeconds,
          viewCount: info.microformat.playerMicroformatRenderer.viewCount
        } : null
      } : 'NOT AVAILABLE',
      
      // Page structure
      page: info.page ? {
        keys: Object.keys(info.page)
      } : null,
      
      // Try getBasicInfo
      all_top_level_keys: Object.keys(info)
    };
    
    // Helper function for debug
    function extractTextDebug(field) {
      if (!field) return null;
      if (typeof field === 'string') return field;
      if (field.text) return field.text;
      if (field.runs) return field.runs.map(r => r.text).join('');
      return JSON.stringify(field)?.substring(0, 200);
    }
    
    res.json({
      success: true,
      videoId: id,
      debug: debugData
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: error.stack
    });
  }
});

// Get only video tags
// GET /api/search/video/:id/tags
router.get('/video/:id/tags', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ 
        success: false, 
        error: 'Video ID is required' 
      });
    }

    const tags = await getVideoTags(id);
    res.json({ 
      success: true, 
      videoId: id,
      ...tags 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get video comments with pagination
// GET /api/search/video/:id/comments?start=1&end=50&sort=top&max=500
router.get('/video/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      start = 1, 
      end = 20, 
      sort = 'top',
      sortBy,
      sort_by,
      max = 500,
      maxComments,
      max_comments,
      refresh,
      force_refresh
    } = req.query;

    if (!id) {
      return res.status(400).json({ 
        success: false, 
        error: 'Video ID is required' 
      });
    }

    const options = {
      start: parseInt(start),
      end: parseInt(end),
      sortBy: sort || sortBy || sort_by || 'top',
      maxComments: parseInt(max || maxComments || max_comments) || 500,
      forceRefresh: refresh === 'true' || force_refresh === 'true'
    };

    const results = await getVideoComments(id, options);
    res.json(results);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Find related videos based on video's tags
// GET /api/search/video/:id/related?start=1&end=20
router.get('/video/:id/related', async (req, res) => {
  try {
    const { id } = req.params;
    const { start, end, limit, maxQueries, max_queries } = req.query;

    if (!id) {
      return res.status(400).json({ 
        success: false, 
        error: 'Video ID is required' 
      });
    }

    const endVal = end ? parseInt(end) : (limit ? parseInt(limit) : 20);

    const options = {
      start: start ? parseInt(start) : 1,
      end: endVal,
      maxQueries: parseInt(maxQueries || max_queries) || 4
    };

    const results = await findRelatedByTags(id, options);
    res.json(results);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================== CACHE MANAGEMENT ROUTES ==================

// Get cache status for a query
// GET /api/search/cache/status?q=query
router.get('/cache/status', (req, res) => {
  try {
    const { q, query, type, sort } = req.query;

    const searchQuery = q || query;

    if (!searchQuery) {
      return res.status(400).json({ 
        success: false, 
        error: 'Query parameter "q" or "query" is required' 
      });
    }

    const status = getSearchCacheStatus(searchQuery, { type, sort });
    res.json({ success: true, query: searchQuery, ...status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear cache
// DELETE /api/search/cache?q=query (optional q to clear specific query)
router.delete('/cache', (req, res) => {
  try {
    const { q, query } = req.query;
    const searchQuery = q || query || null;

    clearSearchCache(searchQuery);

    res.json({ 
      success: true, 
      message: searchQuery 
        ? `Cache cleared for "${searchQuery}"` 
        : 'All search cache cleared' 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/* 
============== API DOCUMENTATION ==============

# SEARCH ENDPOINTS

## Basic search
GET /api/search?q=payal&start=1&end=20

## Search with full tags (slower but complete)
GET /api/search?q=payal&fetchTags=true

## Search videos only
GET /api/search/videos?q=music&sort=view_count&start=1&end=50

## Search channels
GET /api/search/channels?q=tseries

## Search playlists
GET /api/search/playlists?q=workout+mix

## Search by hashtag
GET /api/search/tag?q=music
GET /api/search/tag?q=%23bollywood

## Get search suggestions
GET /api/search/suggestions?q=how+to

## Get trending videos
GET /api/search/trending?region=US

# VIDEO INFO ENDPOINTS

## Get video info with default 20 comments
GET /api/search/video/dQw4w9WgXcQ

## Get video info with more comments
GET /api/search/video/dQw4w9WgXcQ?commentEnd=100

## Get video info without comments
GET /api/search/video/dQw4w9WgXcQ?comments=false

## Get video info with newest comments
GET /api/search/video/dQw4w9WgXcQ?commentSort=newest&commentEnd=50

## Get only video tags
GET /api/search/video/dQw4w9WgXcQ/tags

# Get first 20 comments (default)
GET /api/search/video/dQw4w9WgXcQ/comments

# Get comments 21-50
GET /api/search/video/dQw4w9WgXcQ/comments?start=21&end=50

# Get 100 newest comments
GET /api/search/video/dQw4w9WgXcQ/comments?start=1&end=100&sort=newest

# Get up to 500 comments
GET /api/search/video/dQw4w9WgXcQ/comments?start=1&end=500&max=500

# Get video info with 50 comments
GET /api/search/video/dQw4w9WgXcQ?commentEnd=50

# Get video info without comments
GET /api/search/video/dQw4w9WgXcQ?comments=false

# Force refresh comments cache
GET /api/search/video/dQw4w9WgXcQ/comments?refresh=true

## Get related videos
GET /api/search/video/dQw4w9WgXcQ/related?start=1&end=20

# CACHE ENDPOINTS

## Get cache status
GET /api/search/cache/status?q=music

## Clear all cache
DELETE /api/search/cache

## Clear specific query cache
DELETE /api/search/cache?q=music

============== QUERY PARAMETERS ==============

# Search Parameters
- q / query: Search query (required)
- type: all, video, channel, playlist
- sort: relevance, upload_date, view_count, rating
- duration: short, medium, long
- uploadDate: hour, today, week, month, year
- start: Start index (1-based)
- end: End index
- fetchTags: true/false - Fetch full video tags

# Comment Parameters
- start: Start index for comments (default: 1)
- end: End index for comments (default: 20)
- sort / sortBy: top, newest (default: top)
- max / maxComments: Maximum comments to fetch (default: 500)
- refresh: Force refresh cached comments (true/false)

# Related Video Parameters
- start: Start index (default: 1)
- end / limit: End index / limit (default: 20)
- maxQueries: Number of search queries to run (default: 4)

*/

export default router;
