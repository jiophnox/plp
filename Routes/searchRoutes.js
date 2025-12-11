// routes/search.js
import express from 'express';
import { 
  search, 
  searchVideos, 
  searchChannels, 
  searchPlaylists,
  getSearchSuggestions,
  getTrending 
} from '../Modules/search.js';

const router = express.Router();

// ================== SEARCH ROUTES ==================

// Main search endpoint - search all types
// GET /api/search?q=query&type=video&sort=relevance&start=1&end=20
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
      end
    } = req.query;

    const searchQuery = q || query;

    if (!searchQuery) {
      return res.status(400).json({ 
        success: false, 
        error: 'Query parameter "q" or "query" is required' 
      });
    }

    const options = {
      type,
      sort,
      duration: duration || null,
      uploadDate: uploadDate || upload_date || null,
      start: start ? parseInt(start) : null,
      end: end ? parseInt(end) : null
    };

    const results = await search(searchQuery, options);
    res.json(results);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search videos only
// GET /api/search/videos?q=query&sort=view_count&start=1&end=50
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
      end
    } = req.query;

    const searchQuery = q || query;

    if (!searchQuery) {
      return res.status(400).json({ 
        success: false, 
        error: 'Query parameter "q" or "query" is required' 
      });
    }

    const options = {
      sort,
      duration: duration || null,
      uploadDate: uploadDate || upload_date || null,
      start: start ? parseInt(start) : null,
      end: end ? parseInt(end) : null
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

export default router;
