import { getApps, initializeApp, applicationDefault, cert } from 'firebase-admin/app'
import { getAuth, DecodedIdToken } from 'firebase-admin/auth'

let initialized = false

function initFirebaseAdmin() {
  if (initialized) return
  if (getApps().length === 0) {
    // Prefer explicit service account JSON via env, otherwise use Application Default Credentials
    const saBase64 = Bun.env.FIREBASE_SERVICE_ACCOUNT_BASE64
    const saJson = Bun.env.FIREBASE_SERVICE_ACCOUNT_JSON
    if (saBase64 || saJson) {
      try {
        const jsonStr = saBase64 ? Buffer.from(saBase64, 'base64').toString('utf8') : String(saJson)
        const creds = JSON.parse(jsonStr)
        initializeApp({ credential: cert(creds) })
      } catch (e) {
        console.warn('[auth] Failed to parse FIREBASE_SERVICE_ACCOUNT JSON, falling back to ADC')
        initializeApp({ credential: applicationDefault() })
      }
    } else {
      initializeApp({ credential: applicationDefault() })
    }
  }
  initialized = true
}

export type AuthUser = {
  uid: string
  email?: string
  token: DecodedIdToken
}

function extractBearer(req: Request): string | null {
  const h = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!h) return null
  const m = /^Bearer\s+(.+)$/i.exec(h)
  return m ? m[1] : null
}

export async function requireAuth(req: Request): Promise<AuthUser> {
  const token = extractBearer(req)
  if (!token) throw new Error('Missing Authorization Bearer token')
  initFirebaseAdmin()
  try {
    const decoded = await getAuth().verifyIdToken(token)
    return { uid: decoded.uid, email: decoded.email, token: decoded }
  } catch (e: any) {
    throw new Error('Invalid or expired auth token')
  }
}
