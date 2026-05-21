import axios, { AxiosError } from 'axios';

type SmokeResult = {
  name: string;
  passed: boolean;
  details: string;
};

type QuoteResponse = {
  success?: boolean;
  data?: any;
};

const backendUrl = process.env.SMOKE_BACKEND_URL || 'http://localhost:3000';
const authToken = process.env.SMOKE_AUTH_TOKEN;
const solanaTradableMint =
  process.env.SMOKE_SOLANA_TRADABLE_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const solanaInvalidMint = process.env.SMOKE_SOLANA_INVALID_MINT || 'gh8ers4yzkr3ukdvgvu8cqjfgzu4cu62mteg9bcj7ug6';
const solanaWallet =
  process.env.SMOKE_SOLANA_WALLET || 'CQTzmKH5kezYkPFX5aGqdBCbmhtKevWVSBpVkwkdVPjx';
const amount = process.env.SMOKE_AMOUNT || '1000000';
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || '25000');

function headers() {
  if (!authToken) return undefined;
  return { Authorization: `Bearer ${authToken}` };
}

function extractQuote(payload: QuoteResponse | any): any {
  let quote = payload?.data ?? payload;
  if (quote?.data && !quote?.inputMint) quote = quote.data;
  if (quote?.quoteResponse && !quote?.inputMint) quote = quote.quoteResponse;
  if (quote?.quote && !quote?.inputMint) quote = quote.quote;
  return quote;
}

function errMessage(error: unknown): string {
  const e = error as AxiosError<any>;
  return (
    e?.response?.data?.message ||
    e?.response?.data?.error ||
    e?.message ||
    'Unknown error'
  );
}

async function post(path: string, body: any) {
  return axios.post(`${backendUrl}${path}`, body, {
    headers: headers(),
    timeout: timeoutMs,
  });
}

async function testSolanaTradableBuild(): Promise<SmokeResult> {
  const name = 'solana tradable quote+build';
  try {
    const quoteRes = await post('/api/v1/trades/quote', {
      chain: 'solana',
      inputToken: 'So11111111111111111111111111111111111111112',
      outputToken: solanaTradableMint,
      amount,
      slippageBps: 50,
    });

    const quote = extractQuote(quoteRes.data);
    if (!quote?.inputMint || !quote?.outputMint || !quote?.inAmount) {
      return {
        name,
        passed: false,
        details: `Quote incomplete. keys=${Object.keys(quote || {}).join(',')}`,
      };
    }

    const buildRes = await post('/api/v1/trades/build-transaction', {
      chain: 'solana',
      quote,
      walletAddress: solanaWallet,
    });

    const built = buildRes.data?.data ?? buildRes.data;
    if (!built?.transaction) {
      return {
        name,
        passed: false,
        details: 'Build returned no transaction payload',
      };
    }

    return { name, passed: true, details: 'transaction payload returned' };
  } catch (error) {
    return { name, passed: false, details: errMessage(error) };
  }
}

async function testSolanaInvalidMintRejected(): Promise<SmokeResult> {
  const name = 'solana invalid mint rejected';
  try {
    await post('/api/v1/trades/quote', {
      chain: 'solana',
      inputToken: 'So11111111111111111111111111111111111111112',
      outputToken: solanaInvalidMint,
      amount,
      slippageBps: 50,
    });
    return {
      name,
      passed: false,
      details: 'Expected quote failure for invalid/non-tradable mint, but quote succeeded',
    };
  } catch (error) {
    const msg = errMessage(error).toLowerCase();
    const expected =
      msg.includes('not tradable') ||
      msg.includes('invalid') ||
      msg.includes('address') ||
      msg.includes('liquidity');
    return {
      name,
      passed: expected,
      details: expected ? `expected failure: ${errMessage(error)}` : `unexpected failure: ${errMessage(error)}`,
    };
  }
}

async function main() {
  const results: SmokeResult[] = [];
  console.log(`Running trade smoke tests against ${backendUrl}`);
  if (!authToken) {
    console.log('SMOKE_AUTH_TOKEN not set. Running without Authorization header.');
  }

  results.push(await testSolanaTradableBuild());
  results.push(await testSolanaInvalidMintRejected());

  console.log('\nSmoke Results');
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'} - ${r.name} - ${r.details}`);
  }

  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    process.exitCode = 1;
    return;
  }
}

void main();
