export type FeedEvent = { t: string; from: string; ts: number; data: string }
export type HostInfo = { port: number; windows: number; connected: number; uniques: string[] }
export type Feed = { hosts: HostInfo[]; events: FeedEvent[]; mood: string; name: string; checkedAt: number; error?: string }

declare module 'claude-code' {
  interface PluginState {
    'lets-native': { feed: Feed }
  }
}
