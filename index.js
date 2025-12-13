import express from 'express';
import channelRoutes from './Routes/channelRoutes.js';
import searchRoutes from './Routes/searchRoutes.js';
import embedproxyRoutes from './Routes/embedproxyRoutes.js';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const port = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, 'Public')));

// API routes
app.use('/api/channel', channelRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/embedproxy', embedproxyRoutes);

// Home page route (ROOT)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'Public', 'index.html'));
});

// Watch page route
app.get('/watch', (req, res) => {
  res.sendFile(path.join(__dirname, 'Public', 'watch.html'));
});

app.get('/search', (req, res) => {
  res.sendFile(path.join(__dirname, 'Public', 'search.html'));
});

// Shorts page route (optional)
app.get('/shorts/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'Public', 'watch.html'));
});

// Catch-all for channel pages
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'Public', 'channelPage.html'));
  } else {
    next();
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
