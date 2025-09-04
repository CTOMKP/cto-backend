// Import the bundled NestJS application
let app;

module.exports = async (req, res) => {
  try {
    console.log('Vercel function called:', req.method, req.url);
    
    if (!app) {
      console.log('Creating NestJS app...');
      const { createApp } = require('../dist/main');
      app = await createApp();
      console.log('NestJS app created successfully');
    }
    
    // Get the Express app instance
    const handler = app.getHttpAdapter().getInstance();
    return handler(req, res);
  } catch (error) {
    console.error('Error in Vercel function:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
