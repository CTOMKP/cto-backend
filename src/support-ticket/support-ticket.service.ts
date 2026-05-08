import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { FaucetRequestDto } from './dto/faucet-request.dto';

@Injectable()
export class SupportTicketService {
  private publicFaucetIpWindowMs = 60 * 1000;
  private publicFaucetIpMaxHits = 10;
  private publicFaucetIpHits = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private getSolanaConnection(): Connection {
    const rpcUrl =
      this.configService.get<string>('SOLANA_RPC_URL') ||
      'https://api.mainnet-beta.solana.com';
    return new Connection(rpcUrl, 'confirmed');
  }

  private getFaucetTreasury(): Keypair {
    const raw = (this.configService.get<string>('SOLANA_FAUCET_TREASURY_PRIVATE_KEY') || '').trim();
    if (!raw) {
      throw new ServiceUnavailableException('Faucet treasury key not configured');
    }

    try {
      if (raw.startsWith('[')) {
        const arr = JSON.parse(raw) as number[];
        return Keypair.fromSecretKey(Uint8Array.from(arr));
      }
      return Keypair.fromSecretKey(bs58.decode(raw));
    } catch {
      throw new ServiceUnavailableException('Invalid faucet treasury private key format');
    }
  }

  private getFaucetUsdcMint(): PublicKey {
    const mint =
      this.configService.get<string>('SOLANA_USDC_MINT') ||
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    return new PublicKey(mint);
  }

  private getFaucetConfig() {
    const usdcAmount = Number(this.configService.get<string>('SOLANA_FAUCET_USDC_AMOUNT', '10'));
    const solAmount = Number(this.configService.get<string>('SOLANA_FAUCET_SOL_AMOUNT', '0.01'));
    const cooldownHours = Number(this.configService.get<string>('SOLANA_FAUCET_COOLDOWN_HOURS', '24'));

    return {
      usdcAmount: Number.isFinite(usdcAmount) && usdcAmount > 0 ? usdcAmount : 10,
      solAmount: Number.isFinite(solAmount) && solAmount > 0 ? solAmount : 0.01,
      cooldownHours: Number.isFinite(cooldownHours) && cooldownHours > 0 ? cooldownHours : 24,
    };
  }

  getPublicFaucetKey(): string {
    return (this.configService.get<string>('FAUCET_API_KEY') || '').trim();
  }

  private getFaucetSystemUserId(): number {
    const configured = Number(this.configService.get<string>('FAUCET_SYSTEM_USER_ID', '1'));
    return Number.isFinite(configured) && configured > 0 ? configured : 1;
  }

  private enforcePublicIpLimit(ip: string) {
    const now = Date.now();
    const cutoff = now - this.publicFaucetIpWindowMs;
    const existing = this.publicFaucetIpHits.get(ip) || [];
    const kept = existing.filter((ts) => ts >= cutoff);
    if (kept.length >= this.publicFaucetIpMaxHits) {
      throw new ForbiddenException('Too many faucet requests from this IP. Try again shortly.');
    }
    kept.push(now);
    this.publicFaucetIpHits.set(ip, kept);
  }

  async createPublicFaucetRequest(dto: FaucetRequestDto, ip: string) {
    this.enforcePublicIpLimit(ip || 'unknown');

    const systemUserId = this.getFaucetSystemUserId();
    const subject = 'USDC faucet auto-disbursement (Public)';
    const wallet = dto.walletAddress.trim();
    const { cooldownHours } = this.getFaucetConfig();
    const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

    const existingOpen = await this.prisma.supportTicket.findFirst({
      where: {
        userId: systemUserId,
        category: 'FAUCET',
        subject,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        message: { contains: `Wallet: ${wallet}` },
        createdAt: { gte: cutoff },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingOpen) {
      return {
        blocked: true,
        ticket: existingOpen,
      };
    }

    return this.createFaucetRequest(systemUserId, {
      walletAddress: wallet,
      reason: dto.reason ? `${dto.reason.trim()} | IP: ${ip}` : `IP: ${ip}`,
    });
  }

  async create(userId: number, dto: CreateSupportTicketDto) {
    return this.prisma.supportTicket.create({
      data: {
        userId,
        subject: dto.subject.trim(),
        category: (dto.category || 'GENERAL').toUpperCase(),
        priority: (dto.priority || 'NORMAL').toUpperCase(),
        message: dto.message.trim(),
      },
    });
  }

  async createFaucetRequest(userId: number, dto: FaucetRequestDto) {
    const { cooldownHours, solAmount, usdcAmount } = this.getFaucetConfig();
    const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

    const existingOpen = await this.prisma.supportTicket.findFirst({
      where: {
        userId,
        category: 'FAUCET',
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        createdAt: { gte: cutoff },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingOpen) {
      return {
        blocked: true,
        ticket: existingOpen,
      };
    }

    const recipient = new PublicKey(dto.walletAddress.trim());
    const treasury = this.getFaucetTreasury();
    const connection = this.getSolanaConnection();
    const usdcMint = this.getFaucetUsdcMint();

    const treasuryUsdcAta = await getAssociatedTokenAddress(
      usdcMint,
      treasury.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const recipientUsdcAta = await getAssociatedTokenAddress(
      usdcMint,
      recipient,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const [treasurySolLamports, treasuryUsdcBalance, recipientAtaInfo] = await Promise.all([
      connection.getBalance(treasury.publicKey, 'confirmed'),
      connection.getTokenAccountBalance(treasuryUsdcAta, 'confirmed').catch(() => null),
      connection.getAccountInfo(recipientUsdcAta, 'confirmed'),
    ]);

    const solLamportsToSend = Math.round(solAmount * LAMPORTS_PER_SOL);
    const requiredSol = solLamportsToSend + 10000;
    if (treasurySolLamports < requiredSol) {
      throw new ServiceUnavailableException('Faucet treasury has insufficient SOL');
    }

    const usdcDecimals = Number(treasuryUsdcBalance?.value?.decimals ?? 6);
    const usdcBaseUnitsToSend = BigInt(Math.round(usdcAmount * 10 ** usdcDecimals));
    const treasuryUsdcRaw = BigInt(treasuryUsdcBalance?.value?.amount || '0');
    if (treasuryUsdcRaw < usdcBaseUnitsToSend) {
      throw new ServiceUnavailableException('Faucet treasury has insufficient USDC');
    }

    const solTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: treasury.publicKey,
        toPubkey: recipient,
        lamports: solLamportsToSend,
      }),
    );

    const solTxHash = await sendAndConfirmTransaction(connection, solTx, [treasury], {
      commitment: 'confirmed',
    });

    const usdcInstructions = [];
    if (!recipientAtaInfo) {
      usdcInstructions.push(
        createAssociatedTokenAccountInstruction(
          treasury.publicKey,
          recipientUsdcAta,
          recipient,
          usdcMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
    }

    usdcInstructions.push(
      createTransferCheckedInstruction(
        treasuryUsdcAta,
        usdcMint,
        recipientUsdcAta,
        treasury.publicKey,
        usdcBaseUnitsToSend,
        usdcDecimals,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );

    const usdcTx = new Transaction().add(...usdcInstructions);
    const usdcTxHash = await sendAndConfirmTransaction(connection, usdcTx, [treasury], {
      commitment: 'confirmed',
    });

    const subject = 'USDC faucet auto-disbursement (Solana test token)';
    const message = [
      `Wallet: ${dto.walletAddress}`,
      `USDC sent: ${usdcAmount}`,
      `SOL sent: ${solAmount}`,
      `USDC tx: ${usdcTxHash}`,
      `SOL tx: ${solTxHash}`,
      dto.reason ? `Reason: ${dto.reason.trim()}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        subject,
        category: 'FAUCET',
        priority: 'NORMAL',
        message,
      },
    });

    return {
      blocked: false,
      ticket,
      disbursement: {
        walletAddress: dto.walletAddress,
        usdcAmount,
        solAmount,
        usdcTxHash,
        solTxHash,
      },
    };
  }

  async listMine(userId: number, limit = 20) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async listAll(requestingRole: string, limit = 50) {
    const role = (requestingRole || '').toUpperCase();
    if (role !== 'ADMIN' && role !== 'MODERATOR') {
      throw new ForbiddenException('Only admins can view all support tickets');
    }

    return this.prisma.supportTicket.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
    });
  }
}
