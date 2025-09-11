# CTO Marketplace - Backend API

A comprehensive Solana token vetting API built with Node.js and Express. This backend provides automated smart contract audits, wallet behavior analysis, and tier-based risk scoring for Solana tokens.

## 🚀 Features

### Core Functionality
- **Token Scanning API**: Single and batch token analysis
- **4-Pillar Vetting System**: 
  - Smart Contract Audit
  - Wallet Reputation & Behavior Analysis
  - Governance & Transparency Scoring
  - AI-Powered Risk & Summary Reports
- **Tier Classification**: Seed, Sprout, Bloom, Stellar badges
- **Risk Scoring**: 0-100 scale with tier-specific weighting
- **AI-Generated Summaries**: Intelligent analysis and recommendations

### API Endpoints
- `POST /api/scan` - Single token analysis
- `POST /api/scan-batch` - Batch token analysis (up to 20 tokens)
- `GET /health` - Health check endpoint

## 🛠️ Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **APIs**: Helius RPC, Solscan Public API
- **Security**: Helmet, CORS, Rate Limiting
- **Deployment**: Vercel (recommended)

## 📁 Project Structure

```
server/
├── config/                 # Configuration files
│   └── tiers.json         # Tier classification rules
├── routes/                # API route handlers
│   └── scan.js           # Scan endpoints
├── services/              # Business logic
│   ├── solanaApi.js      # Solana blockchain integration
│   ├── tierClassifier.js # Tier classification logic
│   ├── riskScoring.js    # Risk calculation algorithms
│   └── aiSummary.js      # AI summary generation
├── utils/                 # Utility functions
│   ├── validation.js     # Input validation
│   └── ageFormatter.js   # Date formatting utilities
├── test/                  # Test files
│   ├── batch-scan-example.js
│   └── test-holder-count.js
├── index.js              # Server entry point
├── package.json          # Dependencies
└── README.md            # This file
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Helius API key (free tier available)
- Solscan API access

### Local Development

1. **Clone and install dependencies**:
```bash
git clone <repository-url>
cd server
npm install
```

2. **Set up environment variables**:
```bash
cp .env.example .env
# Edit .env with your API keys
```

3. **Start development server**:
```bash
npm run dev
```

The API will be available at `http://localhost:3001`

## 🔧 Environment Variables

### Required Variables
```bash
# API Configuration
NODE_ENV=production
PORT=3001

# Helius RPC Configuration
HELIUS_API_KEY=your_helius_api_key_here

# Solscan API Configuration
SOLSCAN_API_KEY=your_solscan_api_key_here

# CORS Configuration
CORS_ORIGIN=https://your-frontend-domain.vercel.app
CORS_ORIGINS=https://your-frontend-domain.vercel.app,https://localhost:5173

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Security
HELMET_ENABLED=true
TRUST_PROXY=true

# Logging
LOG_LEVEL=info
ENABLE_DEBUG_LOGS=false

# API Timeouts
API_TIMEOUT_MS=10000
HELIUS_TIMEOUT_MS=10000
SOLSCAN_TIMEOUT_MS=10000

# Cache Configuration
CACHE_TTL_SECONDS=300
REDIS_URL=your_redis_url_here

# Monitoring
ENABLE_METRICS=true
SENTRY_DSN=your_sentry_dsn_here

# Development Overrides
MOCK_DATA_ENABLED=false
SKIP_API_VALIDATION=false
```

### Getting API Keys

#### Helius API Key
1. Visit [Helius](https://www.helius.dev/)
2. Sign up for a free account
3. Create a new API key
4. Add to your environment variables

#### Solscan API Key
1. Visit [Solscan](https://public-api.solscan.io/)
2. Register for API access
3. Get your API key
4. Add to your environment variables

## 📚 API Documentation

### Single Token Scan

**Endpoint**: `POST /api/scan`

**Request Body**:
```json
{
  "contractAddress": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
}
```

**Response**:
```json
{
  "tier": "Sprout",
  "risk_score": 65,
  "risk_level": "Medium",
  "eligible": true,
  "summary": "This is a relatively new project...",
  "metadata": {
    "token_symbol": "BONK",
    "token_name": "Bonk",
    "project_age_days": 25,
    "age_display": "25 days",
    "age_display_short": "25d",
    "lp_amount_usd": 45000,
    "token_price": 0.00001234,
    "volume_24h": 2500000,
    "market_cap": 123456789,
    "holder_count": 15000,
    "scan_timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### Batch Token Scan

**Endpoint**: `POST /api/scan-batch`

**Request Body**:
```json
{
  "contractAddresses": [
    "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "So11111111111111111111111111111111111111112"
  ]
}
```

**Response**:
```json
{
  "batch_summary": {
    "total_requested": 3,
    "total_scanned": 3,
    "successful_scans": 3,
    "failed_scans": 0,
    "eligible_tokens": 2,
    "ineligible_tokens": 1,
    "scan_timestamp": "2024-01-01T00:00:00.000Z"
  },
  "tokens_by_tier": {
    "Stellar": [...],
    "Bloom": [...]
  },
  "all_results": [...],
  "statistics": {
    "tier_distribution": {...},
    "average_risk_score": 52,
    "total_liquidity": 75000000
  }
}
```

### Health Check

**Endpoint**: `GET /health`

**Response**:
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## 🏗️ Tier System
Projects move through 4 listing tiers based on age, liquidity, locks, audits, and risk score.

### Seed Tier 
- **Age**: 14-21 days
- **Liquidity**: $10k–20k
- **LP Lock**: 6–12 months (burn preferred)
- **Target Risk Score**: ≤ 70 (Medium or better)

### Sprout Tier 
- **Age**: 21–30 days  
- **Liquidity**: $20k–50k (min. $20k)
- **LP Lock**: 12–18 months
- **Target Risk Score**: < 50 (Low)

### Bloom Tier 
- **Age**: 30–60 days
- **Liquidity**: $50k–100k (min. $50k) 
- **LP Lock**: 24–36 months (36m rec. / 15% burn = 24m)
- **Target Risk Score**: < 50 (Low)

### Stellar Tier ⭐
- **Age**: 60+ days
- **Liquidity**: $100k–200k (min. $100k)
- **LP Lock**: 24–36 months (20% burn = 24m)
- **Target Risk Score**: < 30 (Very Low)

## 🚀 Deployment

### Vercel Deployment (Recommended)

1. **Connect Repository**:
   - Push code to GitHub
   - Connect repository to Vercel
   - Set root directory to `server`

2. **Configure Build Settings**:
   - Build Command: `npm install`
   - Output Directory: `server`
   - Install Command: `npm install`

3. **Set Environment Variables**:
   - Add all required environment variables in Vercel dashboard
   - Ensure `NODE_ENV=production`

4. **Deploy**:
   - Vercel will automatically deploy on push
   - API will be available at `https://your-app.vercel.app`

### Other Platforms

#### Railway
```bash
# Set root directory to server/
# Add environment variables in dashboard
# Deploy automatically on push
```

#### Heroku
```bash
# Add Procfile with: web: node index.js
# Set environment variables
# Deploy with: git push heroku main
```

## 🧪 Testing

### Run Tests
```bash
# Test holder count functionality
node test/test-holder-count.js

# Test batch scan functionality
node test/batch-scan-example.js
```

### Example Test Addresses
```javascript
const testAddresses = [
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'So11111111111111111111111111111111111111112',   // SOL
];
```

## 🔒 Security Features

- **Rate Limiting**: 100 requests per 15 minutes per IP
- **CORS Protection**: Configurable origins
- **Helmet Security**: HTTP headers protection
- **Input Validation**: Solana address format validation
- **Error Handling**: Graceful error responses
- **Request Size Limits**: 10MB max request size

## 📊 Monitoring & Logging

### Log Levels
- `error`: Critical errors and failures
- `warn`: Warning messages
- `info`: General information
- `debug`: Detailed debugging (development only)

### Health Monitoring
- Health check endpoint for uptime monitoring
- API response time tracking
- Error rate monitoring
- Rate limit tracking

## 🔧 Development

### Available Scripts
```bash
npm run dev          # Start development server
npm start           # Start production server
npm test            # Run tests
npm run lint        # Lint code
npm run format      # Format code
```

### Code Structure
- **Routes**: Handle HTTP requests and responses
- **Services**: Business logic and external API calls
- **Utils**: Helper functions and utilities
- **Config**: Configuration files and constants

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

### Common Issues

#### API Rate Limiting
- Check your API key limits
- Implement proper caching
- Use batch endpoints for multiple requests

#### CORS Errors
- Verify CORS_ORIGIN configuration
- Check frontend domain in environment variables
- Ensure proper CORS headers

#### Holder Count Issues
- Check Solscan API availability
- Verify API key configuration
- Review fallback mechanisms

### Getting Help
- Check the [API Documentation](./BATCH_SCAN_API.md)
- Review [Holder Count Fix](./HOLDER_COUNT_FIX.md)
- Open an issue on GitHub

## 🔗 Related Links

- [Frontend Repository](../frontend-repo)
- [API Documentation](./BATCH_SCAN_API.md)
- [Holder Count Fix](./HOLDER_COUNT_FIX.md)
- [Vercel Deployment Guide](https://vercel.com/docs)

---

**Built for the Aptos Hackathon** - Professional Solana token vetting and risk assessment platform.