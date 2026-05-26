require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/master', require('./routes/master'));
app.use('/api/work-orders', require('./routes/workOrders'));
app.use('/api/photos', require('./routes/photos'));
app.use('/api/repair-logs', require('./routes/repairLogs'));
app.use('/api/pdf',         require('./routes/pdf'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'air-system', time: new Date() });
});

app.listen(PORT, () => {
  console.log(`Air System API running on port ${PORT}`);
});
