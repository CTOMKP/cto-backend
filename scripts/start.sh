#!/bin/bash
# Railway startup script - runs migrations, seed, then starts app

echo "🚀 Starting CTO Backend..."

# Run migrations
echo "📦 Running database migrations..."
npx prisma migrate deploy

# Run seed
echo "🌱 Seeding database..."
npx prisma db seed || echo "⚠️  Seed may have already run (admin exists)"

# Start the app
echo "✅ Starting application..."
npm start

