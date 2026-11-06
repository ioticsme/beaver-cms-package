const envConfig = require('../config/env.config')
const { logError } = require('./Logger.helper')

// Lazy-load the model so requiring this helper never opens a DB dependency early.
let AuditLogModel = null
const getModel = () => {
    if (!AuditLogModel) AuditLogModel = require('../model/AuditLog')
    return AuditLogModel
}

// Keys whose values must never be written to the audit log.
// Matched on whole words of the key, so `footprint` or `compass` are not caught.
const SENSITIVE_WORDS = new Set([
    'password',
    'passwd',
    'pass',
    'pwd',
    'secret',
    'token',
    'tokens',
    'otp',
    'authorization',
    'cookie',
    'credential',
    'credentials',
])
const SENSITIVE_PHRASES = ['api_key', 'private_key', 'access_key', 'connection_string']
const isSensitiveKey = (key = '') => {
    const normalised = String(key)
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
    if (normalised.split('_').some((w) => SENSITIVE_WORDS.has(w))) return true
    return SENSITIVE_PHRASES.some((p) => normalised.includes(p))
}
const SENSITIVE_KEY = { test: isSensitiveKey }
const REDACTED = '[REDACTED]'

// Keys that change on every save and add noise to diffs.
const DIFF_IGNORE = new Set([
    'updated_at',
    'updatedAt',
    'created_at',
    'createdAt',
    '__v',
    'revisions',
    'last_edited_user',
])

const MAX_DEPTH = 8
const MAX_CHANGES = 300
const MAX_ARRAY_ITEMS = 200

const truncate = (value) => {
    const max = envConfig.audit.MAX_VALUE_LENGTH
    if (typeof value === 'string' && value.length > max) {
        return `${value.slice(0, max)}… [truncated ${value.length - max} chars]`
    }
    return value
}

const isPlainObject = (v) =>
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    !(v instanceof Date) &&
    !(v?._bsontype === 'ObjectID' || v?._bsontype === 'ObjectId') &&
    !Buffer.isBuffer(v)

// Turn a Mongoose document (or anything) into plain JSON-safe data.
const toPlain = (value) => {
    if (value === undefined || value === null) return value
    try {
        const obj =
            typeof value.toObject === 'function'
                ? value.toObject({ depopulate: true, virtuals: false })
                : value
        return JSON.parse(JSON.stringify(obj))
    } catch (error) {
        return undefined
    }
}

// Deep copy with secrets masked, long strings cut and depth capped.
const redact = (value, depth = 0) => {
    if (value === undefined || value === null) return value
    if (depth > MAX_DEPTH) return '[max depth]'
    if (Array.isArray(value)) {
        const items = value
            .slice(0, MAX_ARRAY_ITEMS)
            .map((v) => redact(v, depth + 1))
        if (value.length > MAX_ARRAY_ITEMS) {
            items.push(`[${value.length - MAX_ARRAY_ITEMS} more items]`)
        }
        return items
    }
    if (isPlainObject(value)) {
        const out = {}
        for (const [key, v] of Object.entries(value)) {
            // Booleans (e.g. password_changed: true) can't leak a secret, so keep them
            out[key] =
                SENSITIVE_KEY.test(key) && typeof v !== 'boolean'
                    ? REDACTED
                    : redact(v, depth + 1)
        }
        return out
    }
    if (typeof value === 'object') return String(value)
    return truncate(value)
}

// Flatten an object into { 'a.b.0.c': value } leaves.
const flatten = (value, prefix = '', out = {}, depth = 0) => {
    if (depth > MAX_DEPTH) {
        out[prefix] = '[max depth]'
        return out
    }
    if (Array.isArray(value)) {
        // empty arrays/objects are treated as "no value" so {} -> undefined isn't a change
        value.forEach((v, i) =>
            flatten(v, prefix ? `${prefix}.${i}` : String(i), out, depth + 1)
        )
        return out
    }
    if (isPlainObject(value)) {
        const keys = Object.keys(value)
        keys.forEach((key) => {
            if (depth === 0 && DIFF_IGNORE.has(key)) return
            flatten(value[key], prefix ? `${prefix}.${key}` : key, out, depth + 1)
        })
        return out
    }
    if (prefix && value !== undefined) out[prefix] = value
    return out
}

const isSensitivePath = (path) => path.split('.').some((p) => SENSITIVE_KEY.test(p))

// Field-level diff between two versions of a record: [{ path, from, to }]
const diff = (before, after) => {
    const a = flatten(toPlain(before) || {})
    const b = flatten(toPlain(after) || {})
    const paths = new Set([...Object.keys(a), ...Object.keys(b)])
    const changes = []
    for (const path of paths) {
        if (JSON.stringify(a[path]) === JSON.stringify(b[path])) continue
        const sensitive = isSensitivePath(path)
        changes.push({
            path,
            from: sensitive ? REDACTED : redact(a[path]),
            to: sensitive ? REDACTED : redact(b[path]),
        })
        if (changes.length >= MAX_CHANGES) {
            changes.push({ path: '…', from: null, to: `more than ${MAX_CHANGES} changes, list cut` })
            break
        }
    }
    return changes
}

// Client IP. req.ip honours `trust proxy` (set in production), so it is the real
// client behind Azure / a load balancer. Azure appends the port ("1.2.3.4:5678"), strip it.
const cleanIp = (ip = '') => {
    let value = String(ip).trim()
    if (value.startsWith('::ffff:')) value = value.slice(7)
    if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(value)) value = value.split(':')[0]
    return value
}

const getClientIp = (req = {}) =>
    cleanIp(req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '')

const actorFromReq = (req = {}) => {
    const s = req.authUser || req.session || {}
    if (!s.admin_id) return null
    return {
        admin_id: s.admin_id,
        name: s.admin_name,
        email: s.admin_email,
        role: s.admin_role,
    }
}

const brandFromReq = (req = {}) => {
    const b = (req.authUser || req.session || {}).brand
    if (!b) return undefined
    return {
        id: b._id || null,
        code: b.code,
        country: b.country || null,
        country_code: b.country_code,
    }
}

const requestFromReq = (req = {}, extra = {}) => ({
    ip: getClientIp(req),
    forwarded_for: req.headers?.['x-forwarded-for'],
    user_agent: truncate(req.headers?.['user-agent']),
    method: req.method,
    url: truncate(req.originalUrl),
    ...extra,
})

// ---------------------------------------------------------------------------
// Storage writer. Everything goes through this one function, so the backend can
// be swapped (e.g. buffered, Redis stream, external log service) in one place.
// ---------------------------------------------------------------------------
const writeAuditLog = async (entry) => {
    if (!envConfig.audit.ENABLED) return null
    try {
        return await getModel().create(entry)
    } catch (error) {
        // An audit failure must never break the admin action itself.
        logError(error)
        return null
    }
}

/**
 * Record an admin action.
 *
 *   audit(req, {
 *     module: 'content', action: 'update',
 *     entity: { type: 'blogs', id, label },
 *     before, after,          // documents → field diff is computed
 *     meta: { revision: '0.0.4' },
 *     status: 'success' | 'failure',
 *     actor,                  // override (login, where there is no session yet)
 *   })
 *
 * Not awaited by callers: it returns a promise but never throws.
 * Marks the request so the catch-all middleware does not log it twice.
 */
const audit = (req, opts = {}) => {
    try {
        if (req) req.auditLogged = true
        const {
            module,
            action,
            entity,
            before,
            after,
            changes,
            meta,
            status = 'success',
            actor,
        } = opts

        const entry = {
            actor: actor || actorFromReq(req) || {},
            module,
            action,
            status,
            entity: entity
                ? {
                      type: entity.type,
                      id: entity.id ? String(entity.id) : undefined,
                      label: truncate(entity.label ? String(entity.label) : undefined),
                  }
                : undefined,
            meta: meta ? redact(toPlain(meta)) : undefined,
            request: req ? requestFromReq(req) : undefined,
            brand: brandFromReq(req),
        }

        const computed = changes || (before !== undefined || after !== undefined ? diff(before, after) : undefined)
        if (computed && computed.length) entry.changes = computed

        return writeAuditLog(entry)
    } catch (error) {
        logError(error)
        return Promise.resolve(null)
    }
}

// Best-effort human label for a record (title/name in the default language, slug, email…)
const labelOf = (doc) => {
    const d = toPlain(doc) || {}
    const pick = (v) => {
        if (!v) return undefined
        if (typeof v === 'string') return v
        if (typeof v === 'object') return v.en || Object.values(v).find((x) => typeof x === 'string')
        return undefined
    }
    // Content values live under content.<lang>.<group>.<field>; look for a title/name field.
    const fromContent = () => {
        const langs = Object.values(d.content || {}).filter((v) => v && typeof v === 'object')
        for (const lang of langs) {
            const direct = pick(lang.title) || pick(lang.name)
            if (direct) return direct
            for (const group of Object.values(lang)) {
                if (group && typeof group === 'object' && !Array.isArray(group)) {
                    const v = pick(group.title) || pick(group.name) || pick(group.heading)
                    if (v) return v
                }
            }
        }
        return undefined
    }
    return (
        pick(d.title) ||
        pick(d.name) ||
        pick(d.form_name) ||
        fromContent() ||
        d.email ||
        d.slug ||
        d.code ||
        undefined
    )
}

module.exports = {
    audit,
    writeAuditLog,
    diff,
    redact,
    toPlain,
    labelOf,
    getClientIp,
    actorFromReq,
    brandFromReq,
    requestFromReq,
}

// Added / removed privilege ids between two comma-separated privilege strings.
const privilegeDelta = (before = '', after = '') => {
    const a = new Set(String(before || '').split(',').filter(Boolean))
    const b = new Set(String(after || '').split(',').filter(Boolean))
    return {
        added: [...b].filter((p) => !a.has(p)),
        removed: [...a].filter((p) => !b.has(p)),
    }
}

// Audit a change to an admin account (create / update / status / delete).
const auditAdminAccount = (req, module, action, before, after, extra = {}) => {
    const doc = toPlain(after) || toPlain(before) || {}
    const meta = { ...extra }
    const delta = privilegeDelta(toPlain(before)?.privileges, toPlain(after)?.privileges)
    if (delta.added.length || delta.removed.length) meta.privileges = delta
    if (toPlain(before)?.role !== toPlain(after)?.role && before && after) {
        meta.role_changed = { from: toPlain(before).role, to: toPlain(after).role }
    }
    return audit(req, {
        module,
        action,
        entity: { type: 'admin', id: doc._id, label: doc.email },
        before,
        after,
        meta: Object.keys(meta).length ? meta : undefined,
    })
}

module.exports.privilegeDelta = privilegeDelta
module.exports.auditAdminAccount = auditAdminAccount
