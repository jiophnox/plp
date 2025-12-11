import epxress from 'express';
import { getChannelWithPlaylists, getPlaylist, getChannelHomePage } from '../Modules/channel.js';
import { getChannelVideos } from '../Modules/allvideos.js'

const router = epxress.Router();

router.get('/:identifier', async (req, res) => {
  const identifier = req.params.identifier;
  const info = await getChannelWithPlaylists(identifier);
  res.json(info);
});

router.get('/home/:identifier', async (req, res) => {
  const identifier = req.params.identifier;
  const info = await getChannelHomePage(identifier);
  res.json(info);
});

router.get('/playlist/:id', async (req, res) => {
  const id = req.params.id;
  const playlist = await getPlaylist(id);
  res.json(playlist);
});

router.get('/videos/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    const { start, end } = req.query;

    // Parse start/end if both are provided
    let startNum = null;
    let endNum = null;

    if (start && end) {
      startNum = parseInt(start);
      endNum = parseInt(end);

      // Validation
      if (isNaN(startNum) || isNaN(endNum)) {
        return res.status(400).json({ 
          success: false, 
          error: 'start and end must be valid numbers' 
        });
      }

      if (startNum < 1) {
        return res.status(400).json({ 
          success: false, 
          error: 'start must be at least 1' 
        });
      }

      if (startNum > endNum) {
        return res.status(400).json({ 
          success: false, 
          error: 'start must be less than or equal to end' 
        });
      }
    }

    const info = await getChannelVideos(identifier, startNum, endNum);
    res.json(info);

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


export default router;
