function escapeJsString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

export function buildCouponOpenPageHtml(params: {
  appDeepLink: string;
  iosStoreUrl: string;
  androidStoreUrl: string;
}): string {
  const appDeepLink = escapeJsString(params.appDeepLink);
  const iosStoreUrl = escapeJsString(params.iosStoreUrl);
  const androidStoreUrl = escapeJsString(params.androidStoreUrl);
  const iosStoreHref = params.iosStoreUrl.replace(/"/g, '&quot;');
  const androidStoreHref = params.androidStoreUrl.replace(/"/g, '&quot;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BestBond Pro Club</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fff7ed;
      color: #1f2937;
      padding: 24px;
      text-align: center;
    }
    .card {
      max-width: 360px;
      background: #ffffff;
      border-radius: 16px;
      padding: 28px 24px;
      box-shadow: 0 10px 30px rgba(249, 115, 22, 0.15);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 22px;
    }
    p {
      margin: 0 0 16px;
      line-height: 1.5;
      color: #4b5563;
    }
    a {
      color: #ea580c;
      font-weight: 600;
      text-decoration: none;
    }
  </style>
  <script>
    (function () {
      var appLink = '${appDeepLink}';
      var iosStore = '${iosStoreUrl}';
      var androidStore = '${androidStoreUrl}';
      var ua = navigator.userAgent || '';
      var isIOS = /iPhone|iPad|iPod/i.test(ua);
      var isAndroid = /Android/i.test(ua);
      var storeUrl = isIOS ? iosStore : (isAndroid ? androidStore : iosStore);

      function openStore() {
        window.location.replace(storeUrl);
      }

      if (isIOS || isAndroid) {
        window.location.href = appLink;
        window.setTimeout(openStore, 1600);
      } else {
        openStore();
      }
    })();
  </script>
</head>
<body>
  <div class="card">
    <h1>BestBond Pro Club</h1>
    <p>Opening the app scanner…</p>
    <p>If nothing happens, install the app:</p>
    <p>
      <a href="${iosStoreHref}">App Store</a>
      &nbsp;·&nbsp;
      <a href="${androidStoreHref}">Google Play</a>
    </p>
  </div>
</body>
</html>`;
}
