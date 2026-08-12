import { createAdminClient } from './supabase/admin'

// Dropbox client.
//
// SERVER ONLY. Every function here touches the stored refresh token, which is
// a long-lived credential — it must never reach the browser. The
// dropbox_connection table has RLS enabled with no policies, so only the
// service-role client can read it, and only this module does.
//
// Dropbox remains the source of truth for file content. We cache metadata and
// hand out short-lived temporary links; we never copy or proxy file bytes.

const AUTH_HOST = 'https://www.dropbox.com'
const API_HOST = 'https://api.dropboxapi.com'
const CONTENT_HOST = 'https://content.dropboxapi.com'

// Access tokens last ~4 hours. Refresh a little early so a long request
// doesn't expire mid-flight.
const REFRESH_MARGIN_MS = 5 * 60 * 1000

function appCredentials() {
  const key = process.env.DROPBOX_APP_KEY
  const secret = process.env.DROPBOX_APP_SECRET
  if (!key || !secret) {
    throw new Error(
      'Dropbox is not configured. Add DROPBOX_APP_KEY and DROPBOX_APP_SECRET ' +
      'to the environment (Vercel > Project Settings > Environment Variables). ' +
      'Create the app at https://www.dropbox.com/developers/apps.'
    )
  }
  return { key, secret }
}

export function isDropboxConfigured() {
  return missingDropboxVars().length === 0
}

// Which of the required variables this server process cannot see. Names only —
// never values. Used to tell an admin exactly what to add rather than making
// them guess which of the two is absent.
export function missingDropboxVars() {
  return ['DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET'].filter(
    (name) => !process.env[name]
  )
}

// ── OAuth ──────────────────────────────────────────────────

// token_access_type=offline is what makes Dropbox return a refresh token.
// Without it we would get a 4-hour access token and no way to renew it.
export function authorizeUrl(redirectUri, state) {
  const { key } = appCredentials()
  const params = new URLSearchParams({
    client_id: key,
    response_type: 'code',
    redirect_uri: redirectUri,
    token_access_type: 'offline',
    state,
  })
  return `${AUTH_HOST}/oauth2/authorize?${params}`
}

async function tokenRequest(body) {
  const { key, secret } = appCredentials()
  const res = await fetch(`${API_HOST}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...body, client_id: key, client_secret: secret }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'Dropbox token request failed')
  }
  return data
}

export async function exchangeCodeForTokens(code, redirectUri) {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
}

// ── Connection record ──────────────────────────────────────

export async function getConnection() {
  const admin = createAdminClient()
  const { data } = await admin.from('dropbox_connection').select('*').eq('id', 1).maybeSingle()
  return data || null
}

export async function saveConnection({ tokens, account, userId }) {
  const admin = createAdminClient()
  const row = {
    id: 1,
    account_id: account?.account_id || null,
    account_email: account?.email || null,
    account_name: account?.name?.display_name || null,
    access_token: tokens.access_token,
    // Dropbox only returns refresh_token on the initial authorization, so
    // keep the existing one if this is a re-auth that omits it.
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null,
    connected_by: userId || null,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const { error } = await admin.from('dropbox_connection').upsert(row, { onConflict: 'id' })
  if (error) throw new Error(error.message)
  // A different account may have a different namespace layout.
  clearPathRootCache()
}

export async function disconnect() {
  const admin = createAdminClient()
  await admin.from('dropbox_connection').delete().eq('id', 1)
  clearPathRootCache()
}

// Returns a usable access token, refreshing it first if it has expired or is
// about to. The refreshed token is written back so concurrent requests don't
// each mint their own.
async function getAccessToken() {
  const conn = await getConnection()
  if (!conn) throw new Error('Dropbox is not connected. An admin can connect it in Settings.')

  const stillValid =
    conn.access_token &&
    conn.expires_at &&
    new Date(conn.expires_at).getTime() - Date.now() > REFRESH_MARGIN_MS

  if (stillValid) return conn.access_token

  const tokens = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: conn.refresh_token,
  })

  const admin = createAdminClient()
  await admin.from('dropbox_connection').update({
    access_token: tokens.access_token,
    expires_at: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString(),
  }).eq('id', 1)

  return tokens.access_token
}

// ── API calls ──────────────────────────────────────────────

// On a Dropbox Business account, the team's shared folders live in a
// different namespace from the member's personal home folder, and requests
// address the home namespace by default. Listing the root then returns the
// member's own files — usually almost nothing — while every team folder stays
// invisible. Sending Dropbox-API-Path-Root switches the request to the team
// root so paths mean what a person looking at Dropbox would expect.
//
// Personal accounts have a single namespace and must not send the header.
// root_info tells the two apart, so ask once per process and remember it.
let pathRootCache = null

function clearPathRootCache() {
  pathRootCache = null
}

async function pathRootHeader() {
  if (pathRootCache) return pathRootCache.header
  let header = null
  try {
    const account = await callApi('/2/users/get_current_account', null, { pathRoot: false })
    const info = account?.root_info
    // root differs from home exactly when the account is team-based.
    if (info?.root_namespace_id && info.root_namespace_id !== info.home_namespace_id) {
      header = JSON.stringify({ '.tag': 'root', root: info.root_namespace_id })
    }
  } catch {
    // If this fails the request still works against the home namespace, which
    // is the behaviour before this existed. Don't cache a failure.
    return null
  }
  pathRootCache = { header }
  return header
}

async function callApi(path, body, { pathRoot = true } = {}) {
  const token = await getAccessToken()
  const init = {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }
  if (pathRoot) {
    const root = await pathRootHeader()
    if (root) init.headers['Dropbox-API-Path-Root'] = root
  }
  // Dropbox rejects an empty JSON body on some endpoints — send none at all.
  if (body !== undefined && body !== null) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  const res = await fetch(`${API_HOST}${path}`, init)
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { /* non-JSON error body */ }

  if (!res.ok) {
    const summary = data?.error_summary || text || `Dropbox request failed (${res.status})`
    const err = new Error(summary)
    err.status = res.status
    err.dropbox = data
    throw err
  }
  return data
}

export async function getCurrentAccount() {
  return callApi('/2/users/get_current_account', null, { pathRoot: false })
}

// Lists folders only — used by the folder picker. Dropbox uses '' for root,
// not '/'.
//
// A single response can be capped regardless of the requested limit, so follow
// has_more rather than assuming one page holds everything. A team root with
// many folders would otherwise appear truncated with no sign it was.
export async function listFolders(path = '') {
  const normalized = path === '/' ? '' : path
  let data = await callApi('/2/files/list_folder', {
    path: normalized,
    recursive: false,
    include_deleted: false,
    limit: 1000,
  })
  const entries = [...(data.entries || [])]
  while (data.has_more && data.cursor) {
    data = await listFolderContinue(data.cursor)
    entries.push(...(data.entries || []))
  }
  return entries.filter(e => e['.tag'] === 'folder')
}

// First page of a full listing, returning a cursor for subsequent deltas.
export async function listFolderStart(path, { recursive = true } = {}) {
  return callApi('/2/files/list_folder', {
    path: path === '/' ? '' : path,
    recursive,
    include_deleted: true,
    limit: 2000,
  })
}

export async function listFolderContinue(cursor) {
  return callApi('/2/files/list_folder/continue', { cursor })
}

// Short-lived (about 4 hours) direct link. Handing these out means file
// content never passes through this app, and nothing durable is exposed.
export async function getTemporaryLink(path) {
  const data = await callApi('/2/files/get_temporary_link', { path })
  return data.link
}

// Reads a file's bytes server-side. Used only for extraction, where the
// content has to be sent to a model — browsing and opening still go through
// temporary links so file bytes never pass through this app for those.
//
// Content endpoints put the arguments in a header instead of the body, and
// that header must be ASCII, so non-ASCII characters in a path are escaped.
export async function downloadFile(path) {
  const token = await getAccessToken()
  const root = await pathRootHeader()
  const headers = {
    Authorization: `Bearer ${token}`,
    'Dropbox-API-Arg': asciiHeader(JSON.stringify({ path })),
  }
  if (root) headers['Dropbox-API-Path-Root'] = root

  const res = await fetch(`${CONTENT_HOST}/2/files/download`, { method: 'POST', headers })
  if (!res.ok) {
    const text = await res.text()
    const err = new Error(text || `Dropbox download failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return Buffer.from(await res.arrayBuffer())
}

function asciiHeader(value) {
  return value.replace(/[-￿]/g, c =>
    '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
  )
}
