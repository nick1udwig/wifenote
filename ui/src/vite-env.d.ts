/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly BASE_URL: string
  readonly VITE_NODE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  our?: {
    node: string
    process: string
  }
}