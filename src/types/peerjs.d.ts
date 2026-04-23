export {}

declare global {
  interface Window {
    Peer?: new (id?: string) => unknown
  }
}
