import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import {
  buildAppScanDeepLink,
  getAndroidAppLinkSha256Fingerprints,
  getAndroidPackageName,
  getAndroidPlayStoreUrl,
  getIosAppStoreUrl,
  getIosBundleId,
  getIosTeamId,
  normalizeCouponCode,
} from './coupon-link.config';
import { buildCouponOpenPageHtml } from './coupon-link.page';

@Controller()
export class CouponLinkController {
  @Public()
  @SkipThrottle()
  @Get('c/:code')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  openCoupon(@Param('code') code: string, @Res() res: Response) {
    if (!normalizeCouponCode(code)) {
      throw new NotFoundException();
    }

    res.send(
      buildCouponOpenPageHtml({
        appDeepLink: buildAppScanDeepLink(),
        iosStoreUrl: getIosAppStoreUrl(),
        androidStoreUrl: getAndroidPlayStoreUrl(),
      }),
    );
  }

  @Public()
  @SkipThrottle()
  @Get('.well-known/apple-app-site-association')
  @Header('Content-Type', 'application/json')
  appleAppSiteAssociation() {
    const appID = `${getIosTeamId()}.${getIosBundleId()}`;
    return {
      applinks: {
        apps: [],
        details: [
          {
            appID,
            paths: ['/c/*'],
          },
        ],
      },
    };
  }

  @Public()
  @SkipThrottle()
  @Get('.well-known/assetlinks.json')
  @Header('Content-Type', 'application/json')
  androidAssetLinks() {
    const fingerprints = getAndroidAppLinkSha256Fingerprints();
    if (!fingerprints.length) {
      return [];
    }

    return [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: getAndroidPackageName(),
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ];
  }

}
