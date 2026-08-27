// StatTrak has no login, so SportQuery scopes conversations to a random,
// browser-local identifier instead of a shared 'local' bucket. Without this,
// every visitor to the public site would see (and could delete) every
// session anyone has ever created — including whoever's history was there
// before this existed.
const STORAGE_KEY = 'sportquery_client_id'

export function getSportQueryClientId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY)
    if (existing) return existing
    const id = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY, id)
    return id
  } catch {
    // Storage unavailable (private browsing, disabled storage, ...) — fall
    // back to a per-load id. Sessions won't persist across reloads, which is
    // the honest behavior when the browser won't let us remember one.
    return crypto.randomUUID()
  }
}
