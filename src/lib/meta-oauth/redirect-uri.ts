import { MetaOAuthError } from './types'

/**
 * The `redirect_uri` sent to Meta MUST exactly match one registered
 * in the App's OAuth settings — unlike other origin-derivation in
 * this app (e.g. invite links falling back to the request's Host
 * header), there's no safe dynamic fallback here: Meta itself is the
 * one enforcing the match, so a wrong guess just fails at Meta's end
 * with a confusing error instead of a clear one from us. Fail closed
 * and require `NEXT_PUBLIC_SITE_URL` to be set for this feature.
 */
export function getMetaOAuthRedirectUri(): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (!siteUrl) {
    throw new MetaOAuthError(
      'not_configured',
      'NEXT_PUBLIC_SITE_URL must be set to use "Connect with Meta" (it becomes the OAuth redirect_uri, which must match what\'s registered in the Meta App).',
      503
    )
  }
  return `${siteUrl.replace(/\/$/, '')}/api/meta-oauth/callback`
}
