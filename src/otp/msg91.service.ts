import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import type { Msg91OtpResponse } from './interfaces/msg91-api.types';

@Injectable()
export class Msg91Service {
  private readonly log = new Logger(Msg91Service.name);

  constructor(private readonly config: ConfigService) {}

  private requireAuthKey(): string {
    const key = this.config.get<string>('MSG91_AUTHKEY')?.trim();
    if (!key) {
      throw new ServiceUnavailableException(
        'MSG91 is not configured: set MSG91_AUTHKEY (and MSG91_TEMPLATE_ID) on the server.',
      );
    }
    return key;
  }

  private requireTemplateId(): string {
    const id = this.config.get<string>('MSG91_TEMPLATE_ID')?.trim();
    if (!id) {
      throw new ServiceUnavailableException(
        'MSG91 is not configured: set MSG91_TEMPLATE_ID on the server.',
      );
    }
    return id;
  }

  private baseUrl(): string {
    return (
      this.config.get<string>('MSG91_BASE_URL')?.trim() ||
      'https://control.msg91.com'
    ).replace(/\/$/, '');
  }

  private parseBody(data: unknown): Msg91OtpResponse {
    if (data && typeof data === 'object') return data as Msg91OtpResponse;
    return {};
  }

  private isSuccess(body: Msg91OtpResponse): boolean {
    return String(body.type ?? '').toLowerCase() === 'success';
  }

  /**
   * POST /api/v5/otp — generates and sends OTP (DLT template must be approved for India).
   * @see https://docs.msg91.com/otp
   */
  async sendOtp(mobile: string): Promise<void> {
    const authkey = this.requireAuthKey();
    const template_id = this.requireTemplateId();
    const otpLength = Math.min(
      9,
      Math.max(4, Number(this.config.get('MSG91_OTP_LENGTH') ?? 6) || 6),
    );
    const otpExpiry = Math.min(
      1440,
      Math.max(1, Number(this.config.get('MSG91_OTP_EXPIRY_MIN') ?? 10) || 10),
    );
    const dltTeId = this.config.get<string>('MSG91_DLT_TE_ID')?.trim();

    const url = `${this.baseUrl()}/api/v5/otp`;
    const payload: Record<string, string | number> = {
      template_id,
      mobile,
      otp_length: otpLength,
      otp_expiry: otpExpiry,
    };
    if (dltTeId) payload.DLT_TE_ID = dltTeId;

    try {
      const { data, status } = await axios.post<unknown>(url, payload, {
        headers: {
          authkey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 15_000,
        validateStatus: () => true,
      });
      if (status >= 400) {
        const errBody = this.parseBody(data);
        const msg = errBody.message ?? `MSG91 HTTP ${status}`;
        this.log.warn(
          `MSG91 send HTTP ${status} mobile=${this.maskMobile(mobile)} message=${msg}`,
        );
        throw new BadGatewayException(msg);
      }
      const body = this.parseBody(data);
      if (!this.isSuccess(body)) {
        const msg = body.message ?? 'MSG91 send failed';
        this.log.warn(
          `MSG91 send rejected mobile=${this.maskMobile(mobile)} message=${msg}`,
        );
        throw new BadRequestException(msg);
      }
      this.log.log(`MSG91 OTP sent mobile=${this.maskMobile(mobile)}`);
    } catch (e) {
      if (
        e instanceof BadRequestException ||
        e instanceof BadGatewayException
      ) {
        throw e;
      }
      const ax = e as AxiosError;
      const body = this.parseBody(ax.response?.data);
      const msg =
        body.message ||
        ax.message ||
        (ax.response ? `HTTP ${ax.response.status}` : 'MSG91 request failed');
      this.log.error(
        `MSG91 send error mobile=${this.maskMobile(mobile)}: ${msg}`,
        ax.stack,
      );
      throw new BadGatewayException(msg);
    }
  }

  /**
   * GET /api/v5/otp/verify
   */
  async verifyOtp(mobile: string, otp: string): Promise<boolean> {
    const authkey = this.requireAuthKey();
    const url = `${this.baseUrl()}/api/v5/otp/verify`;
    try {
      const { data, status } = await axios.get<unknown>(url, {
        params: { mobile, otp },
        headers: {
          authkey,
          Accept: 'application/json',
        },
        timeout: 15_000,
        validateStatus: () => true,
      });
      if (status >= 400) {
        const body = this.parseBody(data);
        this.log.warn(
          `MSG91 verify HTTP ${status} mobile=${this.maskMobile(mobile)} message=${body.message ?? ''}`,
        );
        return false;
      }
      const body = this.parseBody(data);
      if (this.isSuccess(body)) return true;
      this.log.warn(
        `MSG91 verify failed mobile=${this.maskMobile(mobile)} message=${body.message ?? 'unknown'}`,
      );
      return false;
    } catch (e) {
      const ax = e as AxiosError;
      const body = this.parseBody(ax.response?.data);
      const msg = body.message || ax.message || 'MSG91 verify request failed';
      this.log.error(
        `MSG91 verify error mobile=${this.maskMobile(mobile)}: ${msg}`,
        ax.stack,
      );
      return false;
    }
  }

  private maskMobile(mobile: string): string {
    if (mobile.length < 4) return '****';
    return `${mobile.slice(0, 2)}******${mobile.slice(-2)}`;
  }
}
