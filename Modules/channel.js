import { Innertube, Log } from 'youtubei.js';

// Disable youtubei.js warnings
Log.setLevel(Log.Level.NONE);


async function getChannelInfo(channelIdentifier) {
  try {
    const youtube = await Innertube.create();
    let channelId = channelIdentifier;

    // Convert handle/URL to channel ID
    if (channelIdentifier.startsWith('@') || channelIdentifier.includes('youtube.com')) {
      if (channelIdentifier.includes('youtube.com')) {
        const handleMatch = channelIdentifier.match(/@([\w-]+)/);
        const channelMatch = channelIdentifier.match(/channel\/([\w-]+)/);
        channelIdentifier = handleMatch ? '@' + handleMatch[1] : (channelMatch ? channelMatch[1] : channelIdentifier);
      }

      if (channelIdentifier.startsWith('@')) {
        const search = await youtube.search(channelIdentifier.substring(1), { type: 'channel' });
        const channelResult = search.results.find(result => result.type === 'Channel');
        if (!channelResult?.author?.id) return { success: false, error: 'Channel not found' };
        channelId = channelResult.author.id;
      }
    }

    const channel = await youtube.getChannel(channelId);
    if (!channel) return { success: false, error: 'Channel not found' };

    const about = await channel.getAbout();

    // Parse subscriber count
    let subscriberCount = 'N/A';
    if (about.metadata?.subscriber_count) {
      const match = about.metadata.subscriber_count.match(/([\d.]+)\s*([KMB]?)/);
      if (match) {
        let count = parseFloat(match[1]);
        if (match[2] === 'K') count *= 1000;
        else if (match[2] === 'M') count *= 1000000;
        else if (match[2] === 'B') count *= 1000000000;
        subscriberCount = Math.round(count);
      }
    }

    // Parse video count
    let videoCount = 0;
    if (about.metadata?.video_count) {
      const match = about.metadata.video_count.match(/([\d,]+)/);
      if (match) videoCount = parseInt(match[1].replace(/,/g, ''));
    }

    // Extract channel thumbnail (avatar)
    const thumbnails = channel.metadata?.thumbnail || 
                       channel.metadata?.avatar?.thumbnails || 
                       about.metadata?.avatar?.thumbnails || 
                       [];

    // Get the best quality thumbnail (last one is usually highest res)
    const thumbnail = thumbnails.length > 0 
      ? thumbnails[thumbnails.length - 1]?.url || thumbnails[thumbnails.length - 1] 
      : null;

    // Extract channel banner
    const bannerThumbnails = channel.metadata?.banner?.thumbnails || 
                              channel.header?.banner?.thumbnails ||
                              about.metadata?.banner?.thumbnails || 
                              [];

    // Get the best quality banner (last one is usually highest res)
    const banner = bannerThumbnails.length > 0 
      ? bannerThumbnails[bannerThumbnails.length - 1]?.url || bannerThumbnails[bannerThumbnails.length - 1]
      : null;

    // Also get mobile banner if available
    const mobileBannerThumbnails = channel.header?.mobile_banner?.thumbnails || [];
    const mobileBanner = mobileBannerThumbnails.length > 0
      ? mobileBannerThumbnails[mobileBannerThumbnails.length - 1]?.url
      : null;

    // Get TV banner if available
    const tvBannerThumbnails = channel.header?.tv_banner?.thumbnails || [];
    const tvBanner = tvBannerThumbnails.length > 0
      ? tvBannerThumbnails[tvBannerThumbnails.length - 1]?.url
      : null;

    return {
      success: true,
      channel: {
        name: channel.metadata?.title || 'N/A',
        id: about.metadata?.channel_id || channel.metadata?.external_id || channelId,
        url: about.metadata?.canonical_channel_url || channel.metadata?.vanity_channel_url || `https://www.youtube.com/channel/${channelId}`,
        videoCount,
        subscriber_count: subscriberCount,
        description: about.metadata?.description || channel.metadata?.description || 'N/A',

        // Thumbnails
        thumbnail: thumbnail || 'N/A',
        thumbnailAll: thumbnails.map(t => t?.url || t).filter(Boolean),

        // Banners
        banner: banner || 'N/A',
        bannerAll: bannerThumbnails.map(t => t?.url || t).filter(Boolean),
        mobileBanner: mobileBanner || 'N/A',
        tvBanner: tvBanner || 'N/A'
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Get only playlist IDs and total count
async function getAllPlaylists(channelIdentifier) {
  try {
    const youtube = await Innertube.create();
    let channelId = channelIdentifier;

    // Convert handle/URL to channel ID
    if (channelIdentifier.startsWith('@') || channelIdentifier.includes('youtube.com')) {
      if (channelIdentifier.includes('youtube.com')) {
        const handleMatch = channelIdentifier.match(/@([\w-]+)/);
        const channelMatch = channelIdentifier.match(/channel\/([\w-]+)/);
        channelIdentifier = handleMatch ? '@' + handleMatch[1] : (channelMatch ? channelMatch[1] : channelIdentifier);
      }

      if (channelIdentifier.startsWith('@')) {
        const search = await youtube.search(channelIdentifier.substring(1), { type: 'channel' });
        const channelResult = search.results.find(result => result.type === 'Channel');
        if (!channelResult?.author?.id) return { success: false, error: 'Channel not found' };
        channelId = channelResult.author.id;
      }
    }

    const channel = await youtube.getChannel(channelId);
    if (!channel) return { success: false, error: 'Channel not found' };

    let playlistsData = await channel.getPlaylists();
    let playlistIds = [];

    // Extract playlists from nested Grid structure
    const extractPlaylistIds = (data, isContinuation = false) => {
      const ids = [];

      let items;

      if (isContinuation) {
        // Continuation: data.contents.contents (AppendContinuationItemsAction.contents)
        items = data.contents?.contents || [];
      } else {
        // First page: navigate through Grid structure
        const tabContents = data.current_tab?.content?.contents || [];
        items = [];

        for (const section of tabContents) {
          if (section.contents) {
            for (const gridContainer of section.contents) {
              if (gridContainer.type === 'Grid' && gridContainer.items) {
                items.push(...gridContainer.items);
              }
            }
          }
        }
      }

      // Extract playlist IDs from items
      for (const item of items) {
        if (item.content_id && item.content_type === 'PLAYLIST') {
          ids.push(item.content_id);
        }
      }

      return ids;
    };

    // Extract IDs from first page
    playlistIds = extractPlaylistIds(playlistsData, false);
    console.log(`Extracted ${playlistIds.length} playlists from first page`);

    // Fetch remaining pages
    let pageCount = 1;
    while (playlistsData.has_continuation) {
      try {
        playlistsData = await playlistsData.getContinuation();
        const moreIds = extractPlaylistIds(playlistsData, true);

        if (moreIds.length > 0) {
          playlistIds.push(...moreIds);
          console.log(`Extracted ${moreIds.length} playlists from page ${pageCount + 1} (total: ${playlistIds.length})`);
        }

        pageCount++;

        // Safety limit
        if (pageCount > 100) {
          console.log('Reached safety limit of 100 pages');
          break;
        }
      } catch (e) {
        console.error('Continuation error:', e.message);
        break;
      }
    }

    console.log(`Final total: ${playlistIds.length} playlists`);

    return {
      success: true,
      totalPlaylists: playlistIds.length,
      playlistIds: playlistIds
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
} 

let ytInstance = null;

// Generate random visitor data for fresh session
function generateVisitorData() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = 'Cgt';
  for (let i = 0; i < 22; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Initialize YouTube with proper session
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

  return ytInstance;
}

// Helper function to convert identifier to channel ID
async function resolveChannelId(youtube, channelIdentifier) {
  let channelId = channelIdentifier;

  if (channelIdentifier.startsWith('@') || channelIdentifier.includes('youtube.com')) {
    if (channelIdentifier.includes('youtube.com')) {
      const handleMatch = channelIdentifier.match(/@([\w-]+)/);
      const channelMatch = channelIdentifier.match(/channel\/([\w-]+)/);
      channelIdentifier = handleMatch ? '@' + handleMatch[1] : (channelMatch ? channelMatch[1] : channelIdentifier);
    }

    if (channelIdentifier.startsWith('@')) {
      // Try resolveURL first
      try {
        const resolved = await youtube.resolveURL(`https://www.youtube.com/${channelIdentifier}`);
        if (resolved?.payload?.browseId) {
          return resolved.payload.browseId;
        }
      } catch (e) {
        // Fall back to search
      }

      const search = await youtube.search(channelIdentifier.substring(1), { type: 'channel' });
      const channelResult = search.results.find(result => result.type === 'Channel');
      if (!channelResult?.author?.id) return null;
      channelId = channelResult.author.id;
    }
  }

  return channelId;
}

// Extract playlist IDs from data structure
function extractPlaylistIds(data, isContinuation = false) {
  const ids = [];

  try {
    let items = [];

    if (isContinuation) {
      // Continuation response structure
      items = data.contents?.contents || data.contents || [];

      // Deep search for playlists in continuation
      const findPlaylists = (obj, depth = 0) => {
        if (!obj || typeof obj !== 'object' || depth > 10) return;

        if (obj.content_id && obj.content_type === 'PLAYLIST') {
          if (!ids.includes(obj.content_id)) {
            ids.push(obj.content_id);
          }
        }

        if (obj.id && typeof obj.id === 'string' && obj.id.startsWith('PL')) {
          if (!ids.includes(obj.id)) {
            ids.push(obj.id);
          }
        }

        if (obj.playlist_id && typeof obj.playlist_id === 'string') {
          if (!ids.includes(obj.playlist_id)) {
            ids.push(obj.playlist_id);
          }
        }

        if (Array.isArray(obj)) {
          obj.forEach(item => findPlaylists(item, depth + 1));
        } else {
          Object.keys(obj).forEach(key => {
            if (!key.startsWith('_') && typeof obj[key] === 'object') {
              findPlaylists(obj[key], depth + 1);
            }
          });
        }
      };

      findPlaylists(data);

    } else {
      // First page structure
      const tabContents = data.current_tab?.content?.contents || [];

      for (const section of tabContents) {
        if (section.contents) {
          for (const gridContainer of section.contents) {
            if (gridContainer.type === 'Grid' && gridContainer.items) {
              items.push(...gridContainer.items);
            }
            if (gridContainer.items) {
              items.push(...gridContainer.items);
            }
          }
        }

        if (section.type === 'Grid' && section.items) {
          items.push(...section.items);
        }

        if (section.items) {
          items.push(...section.items);
        }
      }

      for (const item of items) {
        if (item.content_id && item.content_type === 'PLAYLIST') {
          if (!ids.includes(item.content_id)) {
            ids.push(item.content_id);
          }
        }

        if (item.id && typeof item.id === 'string' && item.id.startsWith('PL')) {
          if (!ids.includes(item.id)) {
            ids.push(item.id);
          }
        }
      }

      // Also do deep search on first page
      const findPlaylists = (obj, depth = 0) => {
        if (!obj || typeof obj !== 'object' || depth > 10) return;

        if (obj.content_id && obj.content_type === 'PLAYLIST') {
          if (!ids.includes(obj.content_id)) {
            ids.push(obj.content_id);
          }
        }

        if (obj.id && typeof obj.id === 'string' && obj.id.startsWith('PL')) {
          if (!ids.includes(obj.id)) {
            ids.push(obj.id);
          }
        }

        if (Array.isArray(obj)) {
          obj.forEach(item => findPlaylists(item, depth + 1));
        } else {
          Object.keys(obj).forEach(key => {
            if (!key.startsWith('_') && typeof obj[key] === 'object') {
              findPlaylists(obj[key], depth + 1);
            }
          });
        }
      };

      findPlaylists(data);
    }
  } catch (e) {
    console.log(`   Warning: Error extracting playlists: ${e.message}`);
  }

  return ids;
}

// Get playlists using browse endpoint (more reliable)
async function getPlaylistsViaBrowse(youtube, channelId) {
  const playlistIds = [];

  try {
    // Use browse endpoint with playlists tab parameter
    let browseData = await youtube.actions.execute('/browse', {
      browseId: channelId,
      params: 'EglwbGF5bGlzdHPyBgQKAkIA' // Playlists tab parameter
    });

    if (!browseData?.data) {
      return playlistIds;
    }

    // Find continuation token
    const findContinuationToken = (obj, depth = 0) => {
      if (!obj || typeof obj !== 'object' || depth > 15) return null;

      if (obj.token && typeof obj.token === 'string' && obj.token.length > 20) {
        return obj.token;
      }
      if (obj.continuation && typeof obj.continuation === 'string' && obj.continuation.length > 20) {
        return obj.continuation;
      }

      if (Array.isArray(obj)) {
        for (const item of obj) {
          const token = findContinuationToken(item, depth + 1);
          if (token) return token;
        }
      } else {
        for (const key of Object.keys(obj)) {
          if (key.startsWith('_')) continue;
          const token = findContinuationToken(obj[key], depth + 1);
          if (token) return token;
        }
      }
      return null;
    };

    // Find all playlist IDs in data
    const findPlaylistIds = (obj, depth = 0) => {
      if (!obj || typeof obj !== 'object' || depth > 15) return;

      // Check for playlist ID patterns
      if (obj.playlistId && typeof obj.playlistId === 'string') {
        if (!playlistIds.includes(obj.playlistId)) {
          playlistIds.push(obj.playlistId);
        }
      }

      if (obj.id && typeof obj.id === 'string' && obj.id.startsWith('PL')) {
        if (!playlistIds.includes(obj.id)) {
          playlistIds.push(obj.id);
        }
      }

      if (obj.content_id && obj.content_type === 'PLAYLIST') {
        if (!playlistIds.includes(obj.content_id)) {
          playlistIds.push(obj.content_id);
        }
      }

      if (Array.isArray(obj)) {
        obj.forEach(item => findPlaylistIds(item, depth + 1));
      } else {
        Object.keys(obj).forEach(key => {
          if (!key.startsWith('_') && typeof obj[key] === 'object') {
            findPlaylistIds(obj[key], depth + 1);
          }
        });
      }
    };

    // Extract from first page
    findPlaylistIds(browseData.data);
    console.log(`   Browse page 1: Found ${playlistIds.length} playlists`);

    // Paginate
    let pageCount = 1;
    let continuationToken = findContinuationToken(browseData.data);

    while (continuationToken && pageCount < 50) {
      try {
        const contData = await youtube.actions.execute('/browse', {
          continuation: continuationToken
        });

        pageCount++;
        const beforeCount = playlistIds.length;
        findPlaylistIds(contData?.data);

        const newCount = playlistIds.length - beforeCount;
        if (newCount > 0 && pageCount % 5 === 0) {
          console.log(`   Browse page ${pageCount}: +${newCount} playlists (total: ${playlistIds.length})`);
        }

        continuationToken = findContinuationToken(contData?.data);

        if (pageCount % 10 === 0) {
          await new Promise(r => setTimeout(r, 200));
        }
      } catch (e) {
        break;
      }
    }

  } catch (e) {
    console.log(`   Browse endpoint error: ${e.message}`);
  }

  return playlistIds;
}

// Combined function - Channel info with playlists
async function getChannelWithPlaylists(channelIdentifier) {
  try {
    const youtube = await initYouTube();

    // Normalize identifier
    let normalizedIdentifier = channelIdentifier.trim();
    if (!normalizedIdentifier.startsWith('@') && 
        !normalizedIdentifier.includes('youtube.com') && 
        !normalizedIdentifier.startsWith('UC')) {
      normalizedIdentifier = '@' + normalizedIdentifier;
    }

    console.log(`🔍 Resolving channel: ${normalizedIdentifier}`);

    // Resolve channel ID
    const channelId = await resolveChannelId(youtube, normalizedIdentifier);
    if (!channelId) {
      return { success: false, error: 'Channel not found' };
    }

    console.log(`✅ Found channel ID: ${channelId}`);

    // Get channel
    const channel = await youtube.getChannel(channelId);
    if (!channel) {
      return { success: false, error: 'Channel not found' };
    }

    // Get about info (with error handling)
    let about = null;
    try {
      about = await channel.getAbout();
    } catch (e) {
      console.log(`⚠️ Could not get about info: ${e.message}`);
    }

    // Extract channel thumbnail
    let thumbnail = null;
    if (channel.metadata?.thumbnail) {
      if (Array.isArray(channel.metadata.thumbnail)) {
        thumbnail = channel.metadata.thumbnail[channel.metadata.thumbnail.length - 1]?.url;
      } else if (channel.metadata.thumbnail.url) {
        thumbnail = channel.metadata.thumbnail.url;
      }
    } else if (channel.header?.author?.thumbnails) {
      const thumbnails = channel.header.author.thumbnails;
      thumbnail = thumbnails[thumbnails.length - 1]?.url;
    } else if (about?.metadata?.avatar) {
      if (Array.isArray(about.metadata.avatar)) {
        thumbnail = about.metadata.avatar[about.metadata.avatar.length - 1]?.url;
      } else if (about.metadata.avatar.url) {
        thumbnail = about.metadata.avatar.url;
      }
    }

    // Parse subscriber count
    let subscriberCount = 'N/A';
    if (about?.metadata?.subscriber_count) {
      const match = about.metadata.subscriber_count.match(/([\d.]+)\s*([KMB]?)/i);
      if (match) {
        let count = parseFloat(match[1]);
        const suffix = match[2].toUpperCase();
        if (suffix === 'K') count *= 1000;
        else if (suffix === 'M') count *= 1000000;
        else if (suffix === 'B') count *= 1000000000;
        subscriberCount = Math.round(count);
      }
    } else if (channel.metadata?.subscriber_count) {
      subscriberCount = channel.metadata.subscriber_count;
    }

    // Parse video count
    let videoCount = 0;
    if (about?.metadata?.video_count) {
      const match = about.metadata.video_count.match(/([\d,]+)/);
      if (match) videoCount = parseInt(match[1].replace(/,/g, ''));
    }

    // Get playlists - multiple methods
    let playlistIds = [];
    let playlistError = null;

    console.log(`\n📁 Fetching playlists...`);

    // Method 1: Try getPlaylists() method
    try {
      let playlistsData = await channel.getPlaylists();

      // Extract from first page
      playlistIds = extractPlaylistIds(playlistsData, false);
      console.log(`   Method 1 (getPlaylists): Found ${playlistIds.length} playlists`);

      // Paginate
      let pageCount = 1;
      while (playlistsData.has_continuation && pageCount < 100) {
        try {
          playlistsData = await playlistsData.getContinuation();
          const moreIds = extractPlaylistIds(playlistsData, true);

          for (const id of moreIds) {
            if (!playlistIds.includes(id)) {
              playlistIds.push(id);
            }
          }

          pageCount++;

          if (pageCount % 10 === 0) {
            await new Promise(r => setTimeout(r, 200));
          }
        } catch (e) {
          break;
        }
      }

    } catch (e) {
      playlistError = e.message;
      console.log(`   Method 1 failed: ${e.message}`);
    }

    // Method 2: Try browse endpoint if method 1 failed or got few results
    if (playlistIds.length < 5) {
      console.log(`   Trying browse endpoint...`);
      try {
        const browsePlaylistIds = await getPlaylistsViaBrowse(youtube, channelId);

        for (const id of browsePlaylistIds) {
          if (!playlistIds.includes(id)) {
            playlistIds.push(id);
          }
        }

        console.log(`   Method 2 (browse): Total ${playlistIds.length} playlists`);
      } catch (e) {
        console.log(`   Method 2 failed: ${e.message}`);
      }
    }

    // Method 3: Try with fresh session if still no results
    if (playlistIds.length === 0 && playlistError?.includes('not found')) {
      console.log(`   Trying with fresh session...`);
      try {
        const freshYoutube = await initYouTube(true);
        const freshChannel = await freshYoutube.getChannel(channelId);
        const freshPlaylistsData = await freshChannel.getPlaylists();

        playlistIds = extractPlaylistIds(freshPlaylistsData, false);

        let pageCount = 1;
        let data = freshPlaylistsData;
        while (data.has_continuation && pageCount < 100) {
          try {
            data = await data.getContinuation();
            const moreIds = extractPlaylistIds(data, true);
            for (const id of moreIds) {
              if (!playlistIds.includes(id)) {
                playlistIds.push(id);
              }
            }
            pageCount++;
          } catch (e) {
            break;
          }
        }

        console.log(`   Method 3 (fresh session): Found ${playlistIds.length} playlists`);
        playlistError = null;
      } catch (e) {
        console.log(`   Method 3 failed: ${e.message}`);
      }
    }

    console.log(`\n📊 Total playlists found: ${playlistIds.length}`);

    // Build response
    const channelName = channel.metadata?.title || 'N/A';
    const channelUrl = about?.metadata?.canonical_channel_url || 
                       channel.metadata?.vanity_channel_url || 
                       `https://www.youtube.com/channel/${channelId}`;
    const description = about?.metadata?.description || 
                        channel.metadata?.description || 
                        'N/A';

    return {
      success: true,
      channel: {
        name: channelName,
        id: about?.metadata?.channel_id || channel.metadata?.external_id || channelId,
        url: channelUrl,
        thumbnail: thumbnail || 'N/A',
        videoCount,
        subscriber_count: subscriberCount,
        description: description,
        totalPlaylists: playlistIds.length,
        playlistIds: playlistIds,
        // Include note if playlists couldn't be fetched
        playlistNote: playlistIds.length === 0 && playlistError 
          ? 'Could not fetch playlists - channel may have none or they may be private' 
          : null
      }
    };

  } catch (error) {
    console.error('❌ Error:', error);

    // Even on error, try to return partial channel info
    try {
      const youtube = await initYouTube();
      const channelId = await resolveChannelId(youtube, channelIdentifier);

      if (channelId) {
        const channel = await youtube.getChannel(channelId);

        return {
          success: true,
          partial: true,
          error: error.message,
          channel: {
            name: channel?.metadata?.title || 'N/A',
            id: channelId,
            url: `https://www.youtube.com/channel/${channelId}`,
            thumbnail: channel?.metadata?.thumbnail?.[0]?.url || 'N/A',
            videoCount: 0,
            subscriber_count: channel?.metadata?.subscriber_count || 'N/A',
            description: channel?.metadata?.description || 'N/A',
            totalPlaylists: 0,
            playlistIds: [],
            playlistNote: `Error fetching playlists: ${error.message}`
          }
        };
      }
    } catch (e) {
      // Complete failure
    }

    return { success: false, error: error.message };
  }
}




const playlistCache = new Map();
const CACHE_EXPIRY = 1000 * 60 * 30; // 30 minutes


async function getPlaylist(playlistId) {
  // Check cache with expiry
  const cached = playlistCache.get(playlistId);
  if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY) {
    console.log(`✅ Cache hit: ${playlistId}`);
    return cached.data;
  }

  try {
    console.log(`🔄 Fetching: ${playlistId}`);
    const yt = await initYouTube();
    let playlist = await yt.getPlaylist(playlistId);

    const allVideos = [];

    // Get first page
    if (playlist.videos && playlist.videos.length > 0) {
      allVideos.push(...playlist.videos);
      console.log(`First page: ${allVideos.length} videos`);
    }

    // Get remaining pages
    let pageCount = 1;
    while (playlist.has_continuation && pageCount < 200) {
      try {
        playlist = await playlist.getContinuation();
        if (playlist.videos && playlist.videos.length > 0) {
          allVideos.push(...playlist.videos);
          console.log(`Page ${pageCount + 1}: ${playlist.videos.length} videos (total: ${allVideos.length})`);
        }
        pageCount++;
      } catch (error) {
        console.error(`Error on page ${pageCount + 1}:`, error.message);
        break;
      }
    }

    const videoData = {
      id: playlistId,
      title: playlist.info?.title || 'Playlist',
      description: playlist.info?.description || '',
      videoCount: allVideos.length,
      author: playlist.info?.author?.name || 'Unknown',
      videos: allVideos.map(v => ({
        id: v.id,
        title: v.title?.text || 'Unknown',
        img: v.thumbnails?.[0]?.url || '',
        duration: v.duration?.text || 'N/A',
        author: v.author?.name || 'Unknown'
      }))
    };

    // Cache with timestamp
    playlistCache.set(playlistId, {
      data: videoData,
      timestamp: Date.now()
    });

    console.log(`✅ Cached ${videoData.videos.length} videos for "${videoData.title}"`);
    return videoData;

  } catch (error) {
    console.error(`❌ Error fetching playlist ${playlistId}:`, error.message);
    throw error;
  }
}



async function getChannelHomePage(channelIdentifier) {
  try {
    const youtube = await Innertube.create();

    const channelId = await resolveChannelId(youtube, channelIdentifier);
    if (!channelId) return { success: false, error: 'Channel not found' };

    const channel = await youtube.getChannel(channelId);
    if (!channel) return { success: false, error: 'Channel not found' };

    let channelInfo = {
      name: channel.metadata?.title || 'N/A',
      id: channelId,
      url: channel.metadata?.vanity_channel_url || `https://www.youtube.com/channel/${channelId}`,
      thumbnail: null
    };

    if (channel.header?.author?.thumbnails) {
      const thumbnails = channel.header.author.thumbnails;
      channelInfo.thumbnail = thumbnails[thumbnails.length - 1]?.url;
    } else if (channel.metadata?.thumbnail) {
      if (Array.isArray(channel.metadata.thumbnail)) {
        channelInfo.thumbnail = channel.metadata.thumbnail[channel.metadata.thumbnail.length - 1]?.url;
      }
    }

    const sections = [];
    let contentSource = channel.current_tab?.content;

    const contents = contentSource?.contents || 
                    contentSource?.section_list?.contents ||
                    contentSource?.rich_grid?.contents ||
                    [];

    // Helper: Get thumbnail URL from various formats
    function getThumbnailUrl(item) {
      if (item.thumbnails && Array.isArray(item.thumbnails) && item.thumbnails.length > 0) {
        return item.thumbnails[item.thumbnails.length - 1]?.url || item.thumbnails[0]?.url;
      }
      if (item.thumbnail) {
        if (Array.isArray(item.thumbnail) && item.thumbnail.length > 0) {
          return item.thumbnail[item.thumbnail.length - 1]?.url || item.thumbnail[0]?.url;
        }
        if (item.thumbnail.url) {
          return item.thumbnail.url;
        }
        if (item.thumbnail.thumbnails && Array.isArray(item.thumbnail.thumbnails)) {
          return item.thumbnail.thumbnails[item.thumbnail.thumbnails.length - 1]?.url;
        }
      }
      if (item.author?.thumbnails && Array.isArray(item.author.thumbnails)) {
        return item.author.thumbnails[item.author.thumbnails.length - 1]?.url;
      }
      return null;
    }

    // Helper: Get text from various text formats
    function getText(field) {
      if (!field) return null;
      if (typeof field === 'string') return field;
      if (field.text) return field.text;
      if (field.simpleText) return field.simpleText;
      if (field.runs && Array.isArray(field.runs)) {
        return field.runs.map(r => r.text).join('');
      }
      if (typeof field === 'object' && field.toString) {
        const str = field.toString();
        if (str !== '[object Object]') return str;
      }
      return null;
    }

    // Helper: Process post/community item
    function processPostItem(item) {
      const type = item.type;

      // Handle BackstagePost (community posts)
      if (type === 'BackstagePost' || type === 'Post' || type === 'SharedPost') {
        const postId = item.id || item.post_id;

        // Extract post content/text
        let content = getText(item.content) || getText(item.content_text) || null;

        // Extract attachment info (images, videos, polls, etc.)
        let attachment = null;

        // Check for backstage image
        if (item.backstage_image || item.image) {
          const imgSource = item.backstage_image || item.image;
          attachment = {
            type: 'image',
            url: getThumbnailUrl(imgSource) || imgSource?.url
          };
        }

        // Check for video attachment
        if (item.video || item.backstage_attachment?.type === 'Video') {
          const video = item.video || item.backstage_attachment;
          attachment = {
            type: 'video',
            id: video.id,
            title: getText(video.title),
            thumbnail: getThumbnailUrl(video),
            url: `https://www.youtube.com/watch?v=${video.id}`
          };
        }

        // Check for poll
        if (item.poll || item.backstage_attachment?.type === 'Poll') {
          const poll = item.poll || item.backstage_attachment;
          attachment = {
            type: 'poll',
            choices: poll.choices?.map(c => getText(c.text) || getText(c)) || []
          };
        }

        // Check for multi-image post
        if (item.backstage_image_gallery || item.image_gallery) {
          const gallery = item.backstage_image_gallery || item.image_gallery;
          attachment = {
            type: 'image_gallery',
            images: gallery.images?.map(img => getThumbnailUrl(img) || img?.url) || []
          };
        }

        return {
          type: 'post',
          id: postId,
          content: content,
          publishedTime: getText(item.published) || getText(item.published_time_text) || null,
          voteCount: getText(item.vote_count) || getText(item.likes) || null,
          commentCount: getText(item.comment_count) || getText(item.reply_count) || null,
          attachment: attachment,
          authorThumbnail: getThumbnailUrl(item.author) || item.author?.thumbnails?.[0]?.url || null,
          url: postId ? `https://www.youtube.com/post/${postId}` : null
        };
      }

      return null;
    }

    // Helper: Process individual media item
    function processMediaItem(item) {
      let actualItem = item;
      if (item.type === 'RichItem' && item.content) {
        actualItem = item.content;
      }

      const type = actualItem.type;
      const thumbUrl = getThumbnailUrl(actualItem);

      // Check for post types first
      if (type === 'BackstagePost' || type === 'Post' || type === 'SharedPost') {
        return processPostItem(actualItem);
      }

      if (type === 'Video' || type === 'GridVideo' || type === 'CompactVideo') {
        return {
          type: 'video',
          id: actualItem.id,
          title: getText(actualItem.title) || 'N/A',
          thumbnail: thumbUrl,
          duration: getText(actualItem.duration) || null,
          views: getText(actualItem.view_count) || getText(actualItem.short_view_count) || null,
          published: getText(actualItem.published) || null,
          url: `https://www.youtube.com/watch?v=${actualItem.id}`
        };
      } else if (type === 'Playlist' || type === 'GridPlaylist' || type === 'CompactPlaylist' || type === 'LockupView') {
        return {
          type: 'playlist',
          id: actualItem.id,
          title: getText(actualItem.title) || 'N/A',
          thumbnail: thumbUrl,
          videoCount: getText(actualItem.video_count) || actualItem.video_count || null,
          url: `https://www.youtube.com/playlist?list=${actualItem.id}`
        };
      } else if (type === 'ReelItem' || type === 'ShortsLockupView' || type === 'ShortsLockupViewModel') {
        const videoId = actualItem.id || actualItem.video_id || actualItem.entity_id;
        return {
          type: 'short',
          id: videoId,
          title: getText(actualItem.title) || actualItem.accessibility_text || 'N/A',
          thumbnail: thumbUrl,
          views: getText(actualItem.views) || null,
          url: `https://www.youtube.com/shorts/${videoId}`
        };
      } else if (type === 'Channel' || type === 'GridChannel' || type === 'ChannelCard') {
        const channelId = actualItem.id || actualItem.channel_id || actualItem.endpoint?.browseEndpoint?.browseId;
        return {
          type: 'channel',
          id: channelId,
          title: getText(actualItem.title) || getText(actualItem.author?.name) || actualItem.author?.name || 'N/A',
          thumbnail: thumbUrl,
          subscriberCount: getText(actualItem.subscriber_count) || getText(actualItem.subscribers) || getText(actualItem.video_count_text) || null,
          url: `https://www.youtube.com/channel/${channelId}`
        };
      }

      return null;
    }

    // Helper: Process channel items specifically (for Featured Channels shelf)
    function processChannelItem(item) {
      const type = item.type;

      if (type === 'Channel' || type === 'GridChannel' || type === 'ChannelCard' || type === 'CompactChannel') {
        const channelId = item.id || item.channel_id || item.endpoint?.browseEndpoint?.browseId;
        const thumbUrl = getThumbnailUrl(item);

        return {
          type: 'channel',
          id: channelId,
          title: getText(item.title) || getText(item.author?.name) || item.author?.name || 'N/A',
          thumbnail: thumbUrl,
          subscriberCount: getText(item.subscriber_count) || getText(item.subscribers) || getText(item.video_count_text) || null,
          description: getText(item.description_snippet) || getText(item.description) || null,
          url: `https://www.youtube.com/channel/${channelId}`
        };
      }

      if (item.author || item.channel_id) {
        const channelId = item.channel_id || item.id || item.author?.id;
        return {
          type: 'channel',
          id: channelId,
          title: getText(item.title) || item.author?.name || 'N/A',
          thumbnail: getThumbnailUrl(item) || item.author?.thumbnails?.[0]?.url,
          subscriberCount: getText(item.subscriber_count) || null,
          url: `https://www.youtube.com/channel/${channelId}`
        };
      }

      return null;
    }

    // Helper: Extract items from a shelf/container
    function extractShelfItems(shelf, shelfType = 'default') {
      const items = [];
      const sources = [
        shelf.content?.items,
        shelf.content?.contents,
        shelf.items,
        shelf.contents,
        shelf.content?.horizontal_list?.items,
        shelf.content?.expanded_shelf?.items,
        shelf.content?.post_thread?.post ? [shelf.content.post_thread.post] : null,
        shelf.posts
      ];

      const itemList = sources.find(s => Array.isArray(s) && s.length > 0) || [];

      for (const item of itemList) {
        let processed = null;

        if (shelfType === 'channel') {
          processed = processChannelItem(item) || processMediaItem(item);
        } else if (shelfType === 'post') {
          processed = processPostItem(item) || processMediaItem(item);
        } else {
          processed = processMediaItem(item);
        }

        if (processed && (processed.id || processed.content)) {
          items.push(processed);
        }
      }

      return items;
    }

    // Helper: Determine shelf type from title
    function getShelfType(title) {
      const lowerTitle = title.toLowerCase();
      if (lowerTitle.includes('channel') || lowerTitle.includes('subscribe')) {
        return 'channel';
      }
      if (lowerTitle.includes('post') || lowerTitle.includes('community')) {
        return 'post';
      }
      return 'default';
    }

    // Process each section in contents
    for (const section of contents) {

      // Handle ItemSection - the main wrapper type
      if (section.type === 'ItemSection') {
        const innerContents = section.contents || [];

        for (const innerItem of innerContents) {
          const innerType = innerItem.type;
          const shelfTitle = getText(innerItem.title) || '';
          const shelfType = getShelfType(shelfTitle);

          // Featured Video Player
          if (innerType === 'ChannelVideoPlayer') {
            sections.push({
              type: 'FeaturedVideo',
              title: 'Featured Video',
              items: [{
                type: 'featured_video',
                id: innerItem.id,
                title: getText(innerItem.title) || 'Featured Video',
                description: getText(innerItem.description) || null,
                url: `https://www.youtube.com/watch?v=${innerItem.id}`
              }]
            });
          }

          // Regular Shelf (videos, playlists, channels, posts)
          else if (innerType === 'Shelf') {
            const shelfData = {
              type: 'Shelf',
              title: shelfTitle,
              items: extractShelfItems(innerItem, shelfType)
            };
            if (shelfData.items.length > 0 || shelfData.title) {
              sections.push(shelfData);
            }
          }

          // Shorts/Reels Shelf
          else if (innerType === 'ReelShelf') {
            const reelItems = innerItem.items || [];
            const shelfData = {
              type: 'ShortsShelf',
              title: getText(innerItem.title) || 'Shorts',
              items: []
            };

            for (const reel of reelItems) {
              const videoId = reel.id || reel.video_id || reel.entity_id;
              if (videoId) {
                shelfData.items.push({
                  type: 'short',
                  id: videoId,
                  title: getText(reel.title) || reel.accessibility_text || 'N/A',
                  thumbnail: getThumbnailUrl(reel),
                  views: getText(reel.views) || null,
                  url: `https://www.youtube.com/shorts/${videoId}`
                });
              }
            }

            if (shelfData.items.length > 0) {
              sections.push(shelfData);
            }
          }

          // Vertical List (usually playlists or videos)
          else if (innerType === 'VerticalList') {
            const listData = {
              type: 'VerticalList',
              title: getText(innerItem.header?.title) || '',
              items: []
            };

            const listItems = innerItem.items || innerItem.contents || [];
            for (const item of listItems) {
              const processed = processMediaItem(item);
              if (processed && processed.id) {
                listData.items.push(processed);
              }
            }

            if (listData.items.length > 0) {
              sections.push(listData);
            }
          }

          // Horizontal Card List (Memberships, Featured Channels, etc.)
          else if (innerType === 'HorizontalCardList') {
            const cardData = {
              type: 'HorizontalCardList',
              title: getText(innerItem.header?.title) || '',
              items: []
            };

            const cards = innerItem.cards || innerItem.items || [];
            for (const card of cards) {
              const processed = processChannelItem(card) || processMediaItem(card);
              if (processed && processed.id) {
                cardData.items.push(processed);
              }
            }

            if (cardData.items.length > 0) {
              sections.push(cardData);
            }
          }

          // Recognition Shelf (About/Achievements)
          else if (innerType === 'RecognitionShelf') {
            sections.push({
              type: 'Recognition',
              title: getText(innerItem.title) || 'About',
              subtitle: getText(innerItem.subtitle) || null,
              items: []
            });
          }

          // Channel Featured Content
          else if (innerType === 'ChannelFeaturedContent') {
            const featuredData = {
              type: 'FeaturedContent',
              title: getText(innerItem.title) || 'Featured',
              items: extractShelfItems(innerItem)
            };
            if (featuredData.items.length > 0) {
              sections.push(featuredData);
            }
          }

          // BackstagePost / Community Post directly in section
          else if (innerType === 'BackstagePost' || innerType === 'Post') {
            const post = processPostItem(innerItem);
            if (post) {
              // Find or create Posts section
              let postsSection = sections.find(s => s.type === 'PostsShelf');
              if (!postsSection) {
                postsSection = {
                  type: 'PostsShelf',
                  title: 'Posts',
                  items: []
                };
                sections.push(postsSection);
              }
              postsSection.items.push(post);
            }
          }

          // Try to process unknown types as containers
          else {
            // Check if it contains posts
            const postItems = [];
            const unknownItems = [];

            const itemSources = [
              innerItem.content?.items,
              innerItem.content?.contents,
              innerItem.items,
              innerItem.contents
            ];

            const itemList = itemSources.find(s => Array.isArray(s) && s.length > 0) || [];

            for (const subItem of itemList) {
              const postProcessed = processPostItem(subItem);
              if (postProcessed) {
                postItems.push(postProcessed);
              } else {
                const mediaProcessed = processMediaItem(subItem);
                if (mediaProcessed && mediaProcessed.id) {
                  unknownItems.push(mediaProcessed);
                }
              }
            }

            if (postItems.length > 0) {
              sections.push({
                type: 'PostsShelf',
                title: shelfTitle || 'Posts',
                items: postItems
              });
            } else if (unknownItems.length > 0) {
              sections.push({
                type: innerType || 'Unknown',
                title: shelfTitle || getText(innerItem.header?.title) || '',
                items: unknownItems
              });
            }
          }
        }
      }

      // Handle RichSection (alternative format)
      else if (section.type === 'RichSection') {
        const richContent = section.content;
        if (richContent?.type === 'RichShelf') {
          const shelfData = {
            type: 'RichShelf',
            title: getText(richContent.title) || '',
            items: []
          };

          const richItems = richContent.contents || [];
          for (const item of richItems) {
            const processed = processMediaItem(item);
            if (processed && processed.id) {
              shelfData.items.push(processed);
            }
          }

          if (shelfData.items.length > 0) {
            sections.push(shelfData);
          }
        }
      }
    }

    // Fallback: RichGrid handling (some channels use this)
    if (sections.length === 0 && contentSource?.type === 'RichGrid') {
      const richGridSection = {
        type: 'RichGrid',
        title: 'Videos',
        items: []
      };

      for (const item of (contentSource.contents || [])) {
        const processed = processMediaItem(item);
        if (processed && processed.id) {
          richGridSection.items.push(processed);
        }
      }

      if (richGridSection.items.length > 0) {
        sections.push(richGridSection);
      }
    }

    return {
      success: true,
      channel: channelInfo,
      featuredContent: {
        totalSections: sections.length,
        sections: sections
      }
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Example usage:
// const result = await getChannelHomePage('@TED');
// const result = await getChannelHomePage('https://www.youtube.com/@TED');
// const result = await getChannelHomePage('UCAuUUnT6oDeKwE6v1NGQxug'); // TED channel ID

// Test
//const playlists = await getChannelInfo('@TED');
//console.log(JSON.stringify(playlists, null, 2));

export { getChannelWithPlaylists, getPlaylist, getChannelHomePage };
