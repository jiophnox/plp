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

    // Parse fetchTags boolean
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

// Get full video info with tags
// GET /api/search/video/:id
router.get('/video/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ 
        success: false, 
        error: 'Video ID is required' 
      });
    }

    const results = await getVideoInfo(id);
    res.json(results);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
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

// Find related videos based on video's tags
// GET /api/search/video/:id/related?start=1&end=20
router.get('/video/:id/related', async (req, res) => {
  try {
    const { id } = req.params;
    const { start, end, limit } = req.query;

    if (!id) {
      return res.status(400).json({ 
        success: false, 
        error: 'Video ID is required' 
      });
    }

    // Support both end and limit parameters
    const endVal = end ? parseInt(end) : (limit ? parseInt(limit) : 20);

    const options = {
      start: start ? parseInt(start) : 1,
      end: endVal
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

# Basic search
/api/search?q=payal&start=1&end=20

# Search with full tags (slower but complete)
/api/search?q=payal&fetchTags=true

# Get video info with tags
/api/search/video/a-PAcmi5Kas

# Get only tags for a video
/api/search/video/a-PAcmi5Kas/tags

# Find related videos based on tags
/api/search/video/a-PAcmi5Kas/related?limit=10

# Search by hashtag
/api/search/tag?q=music
/api/search/tag?q=%23bollywood

*/
export default router;
