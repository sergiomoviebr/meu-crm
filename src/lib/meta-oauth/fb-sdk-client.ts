// ============================================================
// Client-side loader for Meta's JS SDK — needed only for WhatsApp's
// Embedded Signup popup (FB.login with a config_id). Nothing else in
// this app's Meta OAuth uses the SDK; the standard
// facebook/instagram/ads flow is a plain redirect (see
// src/lib/meta-oauth/client.ts) and needs no client-side script.
//
// ⚠️ Same caveat as exchangeEmbeddedSignupCode in client.ts: this is
// the least-verified part of the Meta OAuth work — confirm against
// Meta's current Embedded Signup docs before relying on it, and test
// with a real popup (not possible to verify from here).
// ============================================================

'use client'

// Minimal shape of the pieces of the FB JS SDK this app actually
// calls — not Meta's full (much larger) type surface.
interface FacebookLoginResponse {
  authResponse?: { code?: string }
  status?: string
}
interface FacebookSdk {
  init(params: { appId: string; version: string; xfbml?: boolean }): void
  login(
    callback: (response: FacebookLoginResponse) => void,
    params: {
      config_id: string
      response_type: 'code'
      override_default_response_type: true
      extras?: Record<string, unknown>
    }
  ): void
}
declare global {
  interface Window {
    FB?: FacebookSdk
    fbAsyncInit?: () => void
  }
}

let sdkLoadPromise: Promise<FacebookSdk> | null = null

/** Injects Meta's SDK script once and resolves with the initialized `FB` object. */
export function loadFacebookSdk(appId: string): Promise<FacebookSdk> {
  if (sdkLoadPromise) return sdkLoadPromise

  sdkLoadPromise = new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      if (!window.FB) {
        reject(new Error('Meta SDK loaded but window.FB is missing'))
        return
      }
      window.FB.init({ appId, version: 'v21.0', xfbml: false })
      resolve(window.FB)
    }

    if (document.getElementById('facebook-jssdk')) return
    const script = document.createElement('script')
    script.id = 'facebook-jssdk'
    script.src = 'https://connect.facebook.net/en_US/sdk.js'
    script.async = true
    script.defer = true
    script.onerror = () => reject(new Error('Failed to load the Meta SDK script'))
    document.body.appendChild(script)
  })

  return sdkLoadPromise
}

export type { FacebookLoginResponse }
