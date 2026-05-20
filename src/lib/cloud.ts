/**
 * cloud.ts — modecat tracker cloud integration
 *
 * Drop this file into src/lib/ in the modecat.net tracker repo.
 * It uses the same Supabase project as app.modecat.net.
 *
 * SETUP
 * ─────
 * 1. Install: npm install @supabase/supabase-js
 * 2. Add to your .env:
 *      VITE_SUPABASE_URL=https://jewxuottomgcxbnjkcjt.supabase.co
 *      VITE_SUPABASE_ANON_KEY=<your publishable key>
 * 3. Call `cloud.init()` once on app startup.
 * 4. Show a "Connect account" button when `cloud.isConnected()` is false.
 *
 * CROSS-DOMAIN AUTH FLOW
 * ──────────────────────
 * modecat.net and app.modecat.net are different origins — localStorage is
 * not shared. Auth works like this:
 *
 *   1. Tracker calls `cloud.connectAccount()` → redirects to app.modecat.net/auth/login
 *   2. User logs in on the account platform
 *   3. Account platform redirects back to modecat.net with ?mc_token=...&mc_refresh=...
 *   4. `cloud.init()` detects these params, establishes the session, cleans the URL
 *
 * Long-term: move tracker to tracker.modecat.net so both share the
 * .modecat.net cookie domain and no token passing is needed.
 */

import { createClient, type SupabaseClient, type Session, type User } from '@supabase/supabase-js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CloudProject {
  id: string
  owner_id: string
  title: string
  description: string | null
  slug: string | null
  is_public: boolean
  file_path: string
  bpm: number | null
  tags: string[]
  play_count: number
  schema_version: number
  created_at: string
  updated_at: string
}

export interface SaveProjectOptions {
  /** Project UUID — generate with crypto.randomUUID() on first save, persist in tracker state */
  id: string
  /** Display title */
  title: string
  /** BPM extracted from tracker state */
  bpm?: number
  /** Tags */
  tags?: string[]
  /** The full tracker state to serialise and upload */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>
}

export type CloudStatus = 'idle' | 'saving' | 'loading' | 'error'

// ─── Internal state ───────────────────────────────────────────────────────────

let _supabase: SupabaseClient | null = null
let _session: Session | null = null
let _statusListeners: Array<(status: CloudStatus) => void> = []
let _authListeners: Array<(user: User | null) => void> = []
let _requestedProjectId: string | null = null

function getClient(): SupabaseClient {
  if (!_supabase) throw new Error('cloud.ts: call cloud.init() before using cloud methods')
  return _supabase
}

function notifyStatus(status: CloudStatus) {
  _statusListeners.forEach((fn) => fn(status))
}

function notifyAuth(user: User | null) {
  _authListeners.forEach((fn) => fn(user))
}

// ─── Public API ───────────────────────────────────────────────────────────────

const cloud = {
  /**
   * Initialise the cloud client. Call once on app startup.
   * Automatically handles the mc_token / mc_refresh params from the
   * cross-domain auth redirect and cleans them from the URL.
   */
  async init(): Promise<void> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn('cloud.ts: missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — cloud features disabled')
      return
    }

    _supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false, // we handle the cross-domain token manually below
      },
    })

    // ── Handle cross-domain token from account platform ──
    const params = new URLSearchParams(window.location.search)
    const mcToken = params.get('mc_token')
    const mcRefresh = params.get('mc_refresh')

    // Capture optional project to auto-load (set by account platform Open button)
    _requestedProjectId = params.get('mc_project')

    if (mcToken && mcRefresh) {
      const { data, error } = await _supabase.auth.setSession({
        access_token: mcToken,
        refresh_token: mcRefresh,
      })
      if (!error && data.session) {
        _session = data.session
        notifyAuth(data.session.user)
      } else {
        console.warn('cloud.ts: failed to set session from mc_token', error?.message)
      }

      // Clean tokens from URL immediately so they don't linger in browser history
      params.delete('mc_token')
      params.delete('mc_refresh')
      params.delete('mc_project')
      const cleanUrl = [
        window.location.pathname,
        params.toString() ? `?${params.toString()}` : '',
        window.location.hash,
      ].join('')
      window.history.replaceState({}, '', cleanUrl)
    } else {
      // Check for an existing persisted session
      const { data } = await _supabase.auth.getSession()
      _session = data.session
      if (_session) notifyAuth(_session.user)
    }

    // Keep session in sync
    _supabase.auth.onAuthStateChange((_event, session) => {
      _session = session
      notifyAuth(session?.user ?? null)
    })
  },

  /** Whether the user is currently signed in to their modecat account. */
  isConnected(): boolean {
    return _session !== null
  },

  /** The signed-in user, or null if not connected. */
  getUser(): User | null {
    return _session?.user ?? null
  },

  /**
   * Returns the project ID passed via `mc_project` when the account platform
   * opened the tracker. Call once after `init()` to auto-load a specific project.
   * Returns null if no project was requested.
   *
   * @example
   * await cloud.init()
   * const projectId = cloud.getRequestedProjectId()
   * if (projectId && cloud.isConnected()) {
   *   const { data } = await cloud.loadProject(projectId)
   *   store.setState(data)
   * }
   */
  getRequestedProjectId(): string | null {
    return _requestedProjectId
  },

  /**
   * Redirect to the account platform login page.
   * After sign-in, the user is sent back here with mc_token params.
   * Call `cloud.init()` on the next page load to pick them up.
   */
  connectAccount(options?: { accountPlatformUrl?: string }): void {
    const platform = options?.accountPlatformUrl ?? 'https://modecat-account.netlify.app'
    const redirectTo = window.location.href
    window.location.href = `${platform}/auth/login?redirect_to=${encodeURIComponent(redirectTo)}`
  },

  /** Sign out of the modecat account on this device. */
  async signOut(): Promise<void> {
    await getClient().auth.signOut()
    _session = null
    notifyAuth(null)
  },

  /**
   * Save the current project to the cloud.
   * Creates or overwrites the project — idempotent on the same `id`.
   *
   * @example
   * const projectId = useStore.getState().cloudId ?? crypto.randomUUID()
   * await cloud.saveProject({
   *   id: projectId,
   *   title: 'My track',
   *   bpm: 140,
   *   data: useStore.getState(),
   * })
   * useStore.setState({ cloudId: projectId })
   */
  async saveProject(options: SaveProjectOptions): Promise<CloudProject> {
    const sb = getClient()
    const user = _session?.user
    if (!user) throw new Error('Not connected — call cloud.connectAccount() first')

    notifyStatus('saving')
    try {
      const { id, title, bpm, tags = [], data } = options
      const filePath = `${user.id}/${id}.json`

      // 1. Upload the project JSON to storage
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
      const { error: uploadError } = await sb.storage
        .from('projects')
        .upload(filePath, blob, { upsert: true, contentType: 'application/json' })
      if (uploadError) throw uploadError

      // 2. Upsert the metadata row
      const { data: row, error: dbError } = await sb
        .from('projects')
        .upsert({
          id,
          owner_id: user.id,
          title,
          bpm: bpm ?? null,
          tags,
          file_path: filePath,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single()
      if (dbError) throw dbError

      notifyStatus('idle')
      return row as CloudProject
    } catch (err) {
      notifyStatus('error')
      throw err
    }
  },

  /**
   * Load a project's JSON data from the cloud.
   *
   * @example
   * const { meta, data } = await cloud.loadProject(projectId)
   * useStore.setState(data)
   */
  async loadProject(projectId: string): Promise<{ meta: CloudProject; data: unknown }> {
    const sb = getClient()
    const user = _session?.user
    if (!user) throw new Error('Not connected')

    notifyStatus('loading')
    try {
      // 1. Fetch metadata
      const { data: meta, error: metaError } = await sb
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single()
      if (metaError) throw metaError

      // 2. Download the file
      const { data: blob, error: downloadError } = await sb.storage
        .from('projects')
        .download((meta as CloudProject).file_path)
      if (downloadError) throw downloadError

      const data = JSON.parse(await blob.text())

      notifyStatus('idle')
      return { meta: meta as CloudProject, data }
    } catch (err) {
      notifyStatus('error')
      throw err
    }
  },

  /**
   * List all projects belonging to the signed-in user.
   */
  async listProjects(): Promise<CloudProject[]> {
    const sb = getClient()
    const user = _session?.user
    if (!user) throw new Error('Not connected')

    const { data, error } = await sb
      .from('projects')
      .select('*')
      .eq('owner_id', user.id)
      .order('updated_at', { ascending: false })

    if (error) throw error
    return data as CloudProject[]
  },

  /**
   * Delete a project and its storage file.
   */
  async deleteProject(projectId: string): Promise<void> {
    const sb = getClient()
    const user = _session?.user
    if (!user) throw new Error('Not connected')

    // Get the file path first
    const { data: meta, error: metaError } = await sb
      .from('projects')
      .select('file_path')
      .eq('id', projectId)
      .single()
    if (metaError) throw metaError

    // Delete storage file
    await sb.storage.from('projects').remove([(meta as { file_path: string }).file_path])

    // Delete DB row
    const { error } = await sb.from('projects').delete().eq('id', projectId)
    if (error) throw error
  },

  // ── Event listeners ────────────────────────────────────────────────────────

  /**
   * Subscribe to auth state changes.
   * @returns unsubscribe function
   * @example
   * const unsub = cloud.onAuthChange((user) => {
   *   setIsConnected(!!user)
   * })
   * // on cleanup: unsub()
   */
  onAuthChange(fn: (user: User | null) => void): () => void {
    _authListeners.push(fn)
    // Fire immediately with current state
    fn(_session?.user ?? null)
    return () => {
      _authListeners = _authListeners.filter((l) => l !== fn)
    }
  },

  /**
   * Subscribe to save/load status changes.
   * @returns unsubscribe function
   */
  onStatusChange(fn: (status: CloudStatus) => void): () => void {
    _statusListeners.push(fn)
    return () => {
      _statusListeners = _statusListeners.filter((l) => l !== fn)
    }
  },
}

export default cloud
