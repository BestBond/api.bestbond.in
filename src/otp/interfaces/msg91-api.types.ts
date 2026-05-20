/** MSG91 JSON bodies vary slightly; we only depend on `type` + `message`. */
export type Msg91OtpResponse = {
  type?: string;
  message?: string;
  /** Present on some error payloads */
  request_id?: string;
};
