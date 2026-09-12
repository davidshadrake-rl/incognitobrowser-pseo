# Privacy pages inside the Incognito Browser app

For the Android app team. It covers what the privacy pages already do when they open inside the app, and the three things the app needs to do. The web side shipped in `lib/in-app.ts`, `components/InAppBridge.tsx` and `components/Scorecard.tsx`, and is tested in `tests/in-app.test.ts`.

## 1. Tell the page it is in the app

The app spoofs its user agent, so the page can't tell from that. The app says so itself:

- Add `inapp=1` to the URL whenever the app opens one of our pages. Our hosts are `incognitobrowser-pseo.vercel.app` (free), `incognitobrowser-pro.vercel.app` (Pro tools), and `incognitobrowser.io/resources` once it goes live.
- Also add `pro=1` when the user has an active Incognito Pro subscription.
- The page keeps both flags for the rest of the tab and removes them from the address bar, so a link the user copies or shares never carries them. `inapp=0` and `pro=0` switch them off. Links between the free and Pro sites carry the flags across.
- **Only send `inapp=1` once the app handles the upgrade handoff in section 2.** The flag tells the page it may hand upgrades to the app.
- `pro=1` only changes wording. Anyone can type it, so never use it to grant anything.
- **The bridge itself also counts.** If the page finds `window.IncognitoBrowserApp` (section 2) it treats that as proof it is inside the app, even with no `inapp=1` and a spoofed user agent, because only the app's own WebView can put that object on our pages. That covers a page the user reached by a link rather than from one of the app's own tiles. Send `inapp=1` anyway: it is what carries `pro=1`, and it is the only signal that survives an app build whose bridge is not yet injected when the page's first script runs.
- **We do not fingerprint the WebView.** The user agent is the last resort, and on its own it changes wording only.

What changes on the page inside the app:

| Where | On the web | In the app | In the app with `pro=1` |
|---|---|---|---|
| Header button | Get app / Get the Android app | Get Pro (phones), Upgrade to Pro (wider) | hidden |
| Home page button | Get the free app | Upgrade to Pro | hidden |
| Footer "Android app" link | shown | hidden | hidden |
| Panel after a check | Get the app, then upgrade | "You already use Incognito Browser. Pro finishes the job." with **Upgrade to Pro** | hidden |
| Scorecard button | Download PNG | Save image | Save image |

## 2. Upgrade handoff

When someone taps **Upgrade to Pro** on a page, open the app's own upgrade screen.

**Preferred: `WebViewCompat.addWebMessageListener`** (androidx.webkit; check `WebViewFeature.isFeatureSupported(WEB_MESSAGE_LISTENER)`).

```kotlin
WebViewCompat.addWebMessageListener(
    webView,
    "IncognitoBrowserApp",
    setOf(
        "https://incognitobrowser.io",
        "https://incognitobrowser-pseo.vercel.app",
        "https://incognitobrowser-pro.vercel.app",
    ),
) { _, message, sourceOrigin, isMainFrame, _ ->
    if (!isMainFrame) return@addWebMessageListener
    val msg = JSONObject(message.data ?: return@addWebMessageListener)
    when (msg.optString("action")) {
        "upgrade" -> openUpgradeScreen(msg)   // section 2
        "saveImage" -> saveImage(msg)         // section 3
    }
}
```

This puts `window.IncognitoBrowserApp` on our origins only. **Don't use `addJavascriptInterface` for this.** It puts the object on every page and frame the WebView loads. Any site could then check for it to recognise the app, which defeats the user-agent spoofing, and could call it too. If you must use it anyway, each method has to check the page origin itself. The page then calls `openUpgrade(json)` and `saveImage(base64, filename, mime)`.

The page sends a JSON string:

```json
{"v":1,"action":"upgrade","from":"result","topic":"password-security","result":"red","tool":"password-strength","page":"/tools/password-security/password-strength-checker/"}
```

| Field | Values |
|---|---|
| `from` | `header`, `home`, `result` (the panel after a check), `link` |
| `topic` | the page's topic slug, e.g. `password-security` (not always present) |
| `result` | the visitor's result: `red`, `amber`, `green` or `info` (only after a check) |
| `tool` | which check produced it, e.g. `password-strength` (only after a check) |
| `page` | the page path |

Open the upgrade screen, and keep the fields for attribution if you log upgrade sources.

**Fallback for app versions without the listener.** If a page was opened with `inapp=1` and finds no `IncognitoBrowserApp` object, it navigates to:

```
incognitobrowser://upgrade?from=result&topic=password-security&result=red&tool=password-strength
```

Catch it in `shouldOverrideUrlLoading`, open the upgrade screen, and return `true`. If the app already has a URL scheme, tell us and we'll change one constant (`APP_UPGRADE_URL` in `lib/in-app.ts`).

## 3. Saving the scorecard image

**Why the download fails.** The scorecard is drawn inside the page and downloaded through a `blob:` link. That is standard, and it works in Chrome. The app's download manager only accepts `http(s)` links, hence "Invalid URL: blob".

**a) Save through the listener.** Inside the app, **Save image** sends:

```json
{"v":1,"action":"saveImage","filename":"privacy-scorecard-password-strength-checker.png","mime":"image/png","base64":"iVBORw0KGgo…"}
```

The image is around 100–200 KB. Decode it, save it with MediaStore (Pictures or Downloads), and confirm with a toast.

**b) Support `blob:` downloads in general.** Any site's generated download fails in the app today, not just ours. The usual fix: when `DownloadListener.onDownloadStart` gets a `blob:` URL, run a script in that page (`evaluateJavascript`) that fetches the blob and returns its bytes to the app. One way is over a `WebMessageChannel` port the app posts to the page, which leaves no global object behind for sites to detect. Handle `data:` URLs too.

Until (a) ships, the page shows the image with "To save it, press and hold the image, or take a screenshot." Press-and-hold only works if the app's long-press menu can save a `data:` image, so (b) matters too.

## 4. Scores inside the app

The tools measure the browser they run in, and they give the app the same result they would give any other browser. We won't change that, because anyone can run the same test in Chrome and in the app and compare. What will move the app's own numbers:

- **Ad-Blocker Test.** It scored 56% on the test phone: 22 of 50 test requests got through, and 0 of 12 ad elements were hidden. The test requests use common ad and tracker URL patterns on our own domain, so domain-based blocking (DNS-style lists) misses them and URL filter lists catch them. Two changes would raise the score:
  - Add a tracking filter list (EasyPrivacy) to the ad list.
  - Turn on cosmetic filtering (element hiding).

  Once Pro's blocking is checked against this test, the in-app result can say what Pro adds.
- **WebRTC "Leaking".** This was our bug. On mobile data, the page request and WebRTC can leave from two addresses in the carrier's same block (185.192.16.66 and .72 on the test phone). The page now treats the same /24 as the same network, not a leak.
- **What's My IP.** This isn't a browser score, because every browser shows sites your IP. The verdict now reads "Visible to sites" instead of "Exposed", and the page says that only a VPN, a proxy or Tor changes the address.

## 5. How to test

1. Open `https://incognitobrowser-pseo.vercel.app/tools/password-security/password-strength-checker/?inapp=1`. The header says **Get Pro**. Type any password, then tap **Upgrade to Pro** in the panel below the result. The upgrade screen should open with `from=result`, `topic=password-security` and a `result`.
2. Add `&pro=1`. The header button and the upgrade panel should be gone.
3. Tap **Save image** under the scorecard. The image should save. Without the listener, the image appears to press and hold.
4. On mobile data, open `/tools/vpn-privacy/whats-my-ip/?inapp=1`. It should not say "Leaking" for two addresses from the same carrier.
5. Share or copy the page link from the app. The link should not contain `inapp=1`.
