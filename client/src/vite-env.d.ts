/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origin-qualified API base, e.g. https://api.example.com/api. Left unset in
   * dev and in the Cloudflare Pages build so the client calls same-origin /api.
   */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
