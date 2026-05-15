const express = require('express');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const db = require('./db');
const userRoutes = require('./routes/users');
const noteRoutes = require('./routes/notes');

const app = express();
app.use(express.json());

// mount routes
app.use('/', userRoutes);
app.use('/notes', noteRoutes);

// serve openapi spec
app.get('/openapi.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'openapi.json'));
});

// about endpoint
app.get('/about', (req, res) => {
  res.json({
    "name": "Tushar",
    "email": "tushar@gmail.com",
    "my features": {
      "Pin Notes": "Users can pin/unpin important notes so they always show up at the top of their list. I picked this because in apps like Google Keep I always find myself wanting quick access to a few important notes without scrolling, and it's a small but really useful addition."
    }
  });
});

// root - just a small landing message
app.get('/', (req, res) => {
  res.send('running fine.');
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// generic error handler (just in case)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Something went wrong" });
});

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await db.initialize();
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();
