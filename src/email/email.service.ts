import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

type ListingPendingEmailParams = {
  to: string;
  userName?: string | null;
  listingId: string;
  projectTitle: string;
};

type ListingApprovedEmailParams = {
  to: string;
  userName?: string | null;
  listingId: string;
  projectTitle: string;
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly configService: ConfigService) {}

  private isEnabled(): boolean {
    const value = String(this.configService.get('EMAIL_ENABLED') ?? 'false').toLowerCase();
    return value === 'true' || value === '1' || value === 'yes';
  }

  private getFrontendBaseUrl(): string {
    return (
      this.configService.get<string>('FRONTEND_BASE_URL') ||
      this.configService.get<string>('APP_FRONTEND_URL') ||
      'https://ctomarketplace.com'
    );
  }

  private displayName(name?: string | null): string {
    if (!name || !name.trim()) return 'there';
    return name.trim();
  }

  private async sendResendEmail(payload: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const from = this.configService.get<string>('EMAIL_FROM');
    const replyTo = this.configService.get<string>('EMAIL_REPLY_TO');

    if (!apiKey || !from) {
      this.logger.warn('Email skipped: RESEND_API_KEY or EMAIL_FROM missing.');
      return;
    }

    const body: any = {
      from,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    };

    if (replyTo) {
      body.reply_to = replyTo;
    }

    await axios.post('https://api.resend.com/emails', body, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
  }

  private parseFromAddress(input: string): { email: string; name?: string } {
    const value = input.trim();
    const match = value.match(/^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/);
    if (match) {
      return {
        name: match[1].trim(),
        email: match[2].trim(),
      };
    }
    return { email: value };
  }

  private async sendSendGridEmail(payload: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    const apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    const fromRaw = this.configService.get<string>('EMAIL_FROM');
    const replyTo = this.configService.get<string>('EMAIL_REPLY_TO');

    if (!apiKey || !fromRaw) {
      this.logger.warn('Email skipped: SENDGRID_API_KEY or EMAIL_FROM missing.');
      return;
    }

    const from = this.parseFromAddress(fromRaw);

    const body: any = {
      personalizations: [
        {
          to: [{ email: payload.to }],
          subject: payload.subject,
        },
      ],
      from,
      content: [
        { type: 'text/plain', value: payload.text },
        { type: 'text/html', value: payload.html },
      ],
    };

    if (replyTo) {
      body.reply_to = { email: replyTo };
    }

    await axios.post('https://api.sendgrid.com/v3/mail/send', body, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
  }

  private async sendEmail(payload: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const provider = (this.configService.get<string>('EMAIL_PROVIDER') || 'resend').toLowerCase();

    if (provider === 'sendgrid') {
      await this.sendSendGridEmail(payload);
      return;
    }

    if (provider === 'resend') {
      await this.sendResendEmail(payload);
      return;
    }

    this.logger.warn(`Email skipped: unsupported EMAIL_PROVIDER="${provider}". Expected "sendgrid" or "resend".`);
  }

  async sendListingPendingEmail(params: ListingPendingEmailParams): Promise<void> {
    const baseUrl = this.getFrontendBaseUrl().replace(/\/+$/, '');
    const statusUrl = `${baseUrl}/user-listings/mine`;
    const detailsUrl = `${baseUrl}/user-listings/${params.listingId}`;
    const name = this.displayName(params.userName);

    const subject = 'Your listing is pending review';
    const text =
      `Hi ${name},\n\n` +
      `Your listing "${params.projectTitle}" has been submitted and is now pending admin approval.\n` +
      `Track status: ${statusUrl}\n` +
      `Listing details: ${detailsUrl}\n\n` +
      `- CTO Marketplace`;

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;">
        <h2>Your listing is pending review</h2>
        <p>Hi ${name},</p>
        <p>Your listing <strong>${params.projectTitle}</strong> has been submitted and is now pending admin approval.</p>
        <p>
          <a href="${statusUrl}">Check listing status</a><br/>
          <a href="${detailsUrl}">Open listing details</a>
        </p>
        <p style="color:#666;">- CTO Marketplace</p>
      </div>
    `;

    try {
      await this.sendEmail({
        to: params.to,
        subject,
        html,
        text,
      });
    } catch (error: any) {
      this.logger.error(`Failed to send pending listing email to ${params.to}: ${error?.message ?? error}`);
    }
  }

  async sendListingApprovedEmail(params: ListingApprovedEmailParams): Promise<void> {
    const baseUrl = this.getFrontendBaseUrl().replace(/\/+$/, '');
    const liveUrl = `${baseUrl}/user-listings/${params.listingId}/live`;
    const listingUrl = `${baseUrl}/user-listings/${params.listingId}`;
    const name = this.displayName(params.userName);

    const subject = 'Your listing is now live';
    const text =
      `Hi ${name},\n\n` +
      `Great news: your listing "${params.projectTitle}" has been approved and published.\n` +
      `Live page: ${liveUrl}\n` +
      `Listing page: ${listingUrl}\n\n` +
      `- CTO Marketplace`;

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;">
        <h2>Your listing is now live</h2>
        <p>Hi ${name},</p>
        <p>Great news: your listing <strong>${params.projectTitle}</strong> has been approved and published.</p>
        <p>
          <a href="${liveUrl}">View your live listing page</a><br/>
          <a href="${listingUrl}">Open listing details</a>
        </p>
        <p style="color:#666;">- CTO Marketplace</p>
      </div>
    `;

    try {
      await this.sendEmail({
        to: params.to,
        subject,
        html,
        text,
      });
    } catch (error: any) {
      this.logger.error(`Failed to send approved listing email to ${params.to}: ${error?.message ?? error}`);
    }
  }
}
