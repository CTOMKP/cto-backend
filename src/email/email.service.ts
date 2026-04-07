import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

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
  private sesClient: SESv2Client | null = null;

  constructor(private readonly configService: ConfigService) {}

  private isEnabled(): boolean {
    const value = String(this.configService.get('EMAIL_ENABLED') ?? 'false').toLowerCase();
    return value === 'true' || value === '1' || value === 'yes';
  }

  private getFrontendBaseUrl(): string {
    return (
      this.configService.get<string>('FRONTEND_BASE_URL') ||
      this.configService.get<string>('APP_FRONTEND_URL') ||
      'https://www.ctomarketplace.com'
    );
  }

  private displayName(name?: string | null): string {
    if (!name || !name.trim()) return 'there';
    return name.trim();
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private buildEmailHtml(params: {
    title: string;
    intro: string;
    projectTitle: string;
    primaryCtaText: string;
    primaryCtaUrl: string;
    secondaryCtaText: string;
    secondaryCtaUrl: string;
  }): string {
    const baseUrl = this.getFrontendBaseUrl().replace(/\/+$/, '');
    const logoUrl = `${baseUrl}/logo.png`;
    const projectTitle = this.escapeHtml(params.projectTitle);
    const intro = this.escapeHtml(params.intro);

    return `
      <div style="margin:0;padding:24px;background:#050505;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
        <table role="presentation" style="width:100%;max-width:640px;margin:0 auto;border:1px solid #2a2a2a;border-radius:14px;background:#0b0b0b;overflow:hidden;">
          <tr>
            <td style="padding:24px;border-bottom:1px solid #1f1f1f;">
              <img src="${logoUrl}" alt="CTO Marketplace" style="height:40px;display:block;" />
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 16px 24px;">
              <h1 style="margin:0 0 12px 0;font-size:26px;line-height:1.2;color:#ffffff;">${this.escapeHtml(params.title)}</h1>
              <p style="margin:0 0 12px 0;color:#d4d4d8;line-height:1.6;">${intro}</p>
              <p style="margin:0 0 20px 0;color:#ffffff;line-height:1.5;">
                Project: <strong>${projectTitle}</strong>
              </p>
              <table role="presentation" style="border-collapse:collapse;">
                <tr>
                  <td style="padding:0 8px 8px 0;">
                    <a href="${params.primaryCtaUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:linear-gradient(90deg,#FF0075 0%,#FF4A15 55%,#FFCB45 100%);color:#ffffff;text-decoration:none;font-weight:700;">
                      ${this.escapeHtml(params.primaryCtaText)}
                    </a>
                  </td>
                  <td style="padding:0 0 8px 0;">
                    <a href="${params.secondaryCtaUrl}" style="display:inline-block;padding:11px 18px;border-radius:10px;border:1px solid #3f3f46;color:#ffffff;text-decoration:none;font-weight:600;">
                      ${this.escapeHtml(params.secondaryCtaText)}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 24px 24px 24px;color:#a1a1aa;font-size:12px;line-height:1.6;">
              If a button does not work, open this link:<br/>
              <a href="${params.primaryCtaUrl}" style="color:#FFCB45;text-decoration:underline;word-break:break-all;">${params.primaryCtaUrl}</a>
              <br/><br/>
              &mdash; CTO Marketplace
            </td>
          </tr>
        </table>
      </div>
    `;
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

    this.logger.log(`Email sent via resend to ${payload.to} (${payload.subject})`);
  }

  private parseFromAddress(input: string): { email: string; name?: string } {
    const value = input.trim().replace(/\\"/g, '"');
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

    this.logger.log(`Email sent via sendgrid to ${payload.to} (${payload.subject})`);
  }

  private getSesClient(): SESv2Client {
    if (this.sesClient) {
      return this.sesClient;
    }

    const region =
      this.configService.get<string>('SES_AWS_REGION') ||
      this.configService.get<string>('AWS_REGION') ||
      'us-east-1';

    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    const sessionToken = this.configService.get<string>('AWS_SESSION_TOKEN');

    const credentials =
      accessKeyId && secretAccessKey
        ? {
            accessKeyId,
            secretAccessKey,
            ...(sessionToken ? { sessionToken } : {}),
          }
        : undefined;

    this.sesClient = new SESv2Client({
      region,
      ...(credentials ? { credentials } : {}),
    });

    return this.sesClient;
  }

  private async sendSesEmail(payload: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    const fromRaw = this.configService.get<string>('EMAIL_FROM');
    const replyTo = this.configService.get<string>('EMAIL_REPLY_TO');
    const fromArn = this.configService.get<string>('SES_FROM_ARN');
    const configurationSetName = this.configService.get<string>('SES_CONFIGURATION_SET');

    if (!fromRaw) {
      this.logger.warn('Email skipped: EMAIL_FROM missing for SES provider.');
      return;
    }

    const client = this.getSesClient();
    const from = this.parseFromAddress(fromRaw);
    const fromEmailAddress = from.name ? `${from.name} <${from.email}>` : from.email;

    const command = new SendEmailCommand({
      FromEmailAddress: fromEmailAddress,
      Destination: {
        ToAddresses: [payload.to],
      },
      Content: {
        Simple: {
          Subject: {
            Data: payload.subject,
            Charset: 'UTF-8',
          },
          Body: {
            Html: {
              Data: payload.html,
              Charset: 'UTF-8',
            },
            Text: {
              Data: payload.text,
              Charset: 'UTF-8',
            },
          },
        },
      },
      ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
      ...(fromArn ? { FromEmailAddressIdentityArn: fromArn } : {}),
      ...(configurationSetName ? { ConfigurationSetName: configurationSetName } : {}),
    });

    await client.send(command);
    this.logger.log(`Email sent via ses to ${payload.to} (${payload.subject})`);
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

    if (provider === 'ses') {
      await this.sendSesEmail(payload);
      return;
    }

    this.logger.warn(
      `Email skipped: unsupported EMAIL_PROVIDER="${provider}". Expected "sendgrid", "resend", or "ses".`,
    );
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
    const html = this.buildEmailHtml({
      title: 'Your Listing Is Pending Review',
      intro: `Hi ${name}, your listing has been submitted and is now awaiting admin approval.`,
      projectTitle: params.projectTitle,
      primaryCtaText: 'Check Listing Status',
      primaryCtaUrl: statusUrl,
      secondaryCtaText: 'Open Listing Details',
      secondaryCtaUrl: detailsUrl,
    });

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
    const html = this.buildEmailHtml({
      title: 'Your Listing Is Now Live',
      intro: `Hi ${name}, great news: your listing has been approved and published.`,
      projectTitle: params.projectTitle,
      primaryCtaText: 'View Live Listing Page',
      primaryCtaUrl: liveUrl,
      secondaryCtaText: 'Open Listing Details',
      secondaryCtaUrl: listingUrl,
    });

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
