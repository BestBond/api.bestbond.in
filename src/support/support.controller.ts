import { Controller, Get } from '@nestjs/common';

@Controller('support')
export class SupportController {
  @Get()
  getSupport() {
    return {
      /** E.164-style for tel: links */
      phone: '+919686191514',
      /** Digits only (no +) for https://wa.me/{whatsapp} */
      whatsapp: '919686191514',
      email: 'bestbond03@yahoo.com',
      availability: '24/7',
    };
  }
}
