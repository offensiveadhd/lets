export type FeedEvent = { t: string; from: string; ts: number; data: string }
export type HostInfo = { port: number; windows: number; connected: number; native: number; uniques: string[] }
export type Feed = { hosts: HostInfo[]; events: FeedEvent[]; mood: string; name: string; checkedAt: number; error?: string }

/** A live lets host, from its run file (`~/.lets/run/host-<pid>.json`). */
export type HostRef = { port: number; token: string }

/** One node of a host-rendered tree (docs/NATIVE.md §3): the element, its props, its children. */
export type TreeNode = { t: string; p?: Record<string, unknown>; c?: Tree[] }
export type Tree = TreeNode | string

/** A native window this session draws as a pane. The host token is never kept here. */
export type NativeWindow = {
  id: string
  pane: string
  port: number
  unique: string
  title: string
  columns: number
  rows: number
  rev: number
  tree: TreeNode | null
  closed: boolean
}

export type NativeState = {
  windows: Record<string, NativeWindow>
  /** Ports of the hosts this session's `open` tool answered from; empty means every live host. */
  mine: number[]
}

declare module 'claude-code' {
  interface PluginState {
    'lets-native': { feed: Feed; native: NativeState }
  }
}
