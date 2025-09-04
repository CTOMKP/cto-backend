// Import the bundled NestJS application
const { createApp } = require('../dist/main');

let app;

module.exports = async (req, res) => {
  try {
    if (!app) {
      // Create the NestJS app using the createApp function from main.js
      app = await createApp();
    }
    
    // Get the Express app instance
    const handler = app.getHttpAdapter().getInstance();
    return handler(req, res);
  } catch (error) {
    console.error('Error in Vercel function:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
