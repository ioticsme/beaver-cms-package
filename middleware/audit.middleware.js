const {
    writeAuditLog,
    redact,
    actorFromReq,
    brandFromReq,
    requestFromReq,
} = require('../helper/AuditLog.helper')

// GET routes that change state or expose sensitive data, so they are logged too.
const SENSITIVE_GET = [
    /^\/admin\/settings\/switch-brand/,
    /^\/admin\/custom-forms\/submissions\/[^/]+\/export/,
    /^\/admin\/custom-forms\/submissions\/[^/]+\/[^/]+$/,
    /^\/admin\/logs\/audit\/export/,
    /^\/admin\/logs\/audit\/view\//,
]

// Routes that are explicitly logged by their controller, or are pure noise.
const SKIP = [/^\/admin\/auth\//, /^\/admin\/settings\/save-fbcm-token/]

// "/admin/config/content-type/save" -> module "config.content-type", action "save"
// Ids in the path ("/view/<objectId>") are pulled out so they don't become the action.
const ID_SEGMENT = /^([a-f0-9]{24}|\d+)$/i
const describePath = (path) => {
    const all = path.replace(/^\/admin\/?/, '').split('/').filter(Boolean)
    const ids = all.filter((p) => ID_SEGMENT.test(p))
    const parts = all.filter((p) => !ID_SEGMENT.test(p))
    const id = ids[ids.length - 1]
    if (!parts.length) return { module: 'admin', action: 'request', id }
    if (parts.length === 1) return { module: parts[0], action: 'request', id }
    return {
        module: parts.slice(0, -1).join('.'),
        action: parts[parts.length - 1],
        id,
    }
}

// Catch-all audit trail for the admin panel.
// Every non-GET request by a signed-in admin (plus the sensitive GETs above) is
// written once the response is sent, unless the controller already wrote a richer
// entry with audit() (which sets req.auditLogged).
const auditTrail = (req, res, next) => {
    const path = req.originalUrl.split('?')[0]
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    const isSensitiveRead = !isWrite && SENSITIVE_GET.some((r) => r.test(path))

    if ((!isWrite && !isSensitiveRead) || SKIP.some((r) => r.test(path))) {
        return next()
    }

    const startedAt = Date.now()
    res.on('finish', () => {
        try {
            if (req.auditLogged) return
            const actor = actorFromReq(req)
            if (!actor) return // anonymous hits are redirected to login; nothing changed

            const { module, action, id: pathId } = describePath(path)
            const body = req.body && Object.keys(req.body).length ? redact(req.body) : undefined
            const files = (req.files || []).map((f) => ({
                field: f.fieldname,
                original_name: f.originalname,
                mime_type: f.mimetype,
                size: f.size,
            }))
            const entityId = req.body?.id || req.body?._id || pathId

            writeAuditLog({
                actor,
                module,
                action,
                status: res.statusCode < 400 ? 'success' : 'failure',
                entity: entityId ? { id: String(entityId) } : undefined,
                meta: files.length ? { files } : undefined,
                request: requestFromReq(req, {
                    status_code: res.statusCode,
                    duration_ms: Date.now() - startedAt,
                    body,
                }),
                brand: brandFromReq(req),
            })
        } catch (error) {
            // never let auditing break a response
        }
    })
    next()
}

module.exports = { auditTrail, describePath }
