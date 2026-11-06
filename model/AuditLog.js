const { mongoose, Schema } = require('mongoose')
const envConfig = require('../config/env.config')

// Append-only record of who did what in the admin panel.
// Written through helper/AuditLog.helper.js; never update or delete entries from code.
const AuditLogSchema = new mongoose.Schema(
    {
        // Who did it. Name/email/role are copied so the entry stays readable
        // after the admin is renamed or deleted.
        actor: {
            admin_id: { type: Schema.ObjectId, ref: 'Admin', default: null },
            name: String,
            email: String,
            role: String,
        },
        // What happened, e.g. module "content", action "update".
        module: { type: String, required: true },
        action: { type: String, required: true },
        status: {
            type: String,
            enum: ['success', 'failure'],
            default: 'success',
        },
        // The record the action was on.
        entity: {
            type: { type: String },
            id: String,
            label: String,
        },
        // Field-level changes: [{ path, from, to }]
        changes: { type: Array, default: undefined },
        // Anything else worth keeping (revision number, file info, reason for a failure …)
        meta: { type: Object, default: undefined },
        // Request context
        request: {
            ip: String,
            forwarded_for: String,
            user_agent: String,
            method: String,
            url: String,
            status_code: Number,
            duration_ms: Number,
            body: { type: Object, default: undefined },
        },
        brand: {
            id: { type: Schema.ObjectId, default: null },
            code: String,
            country: { type: Schema.ObjectId, default: null },
            country_code: String,
        },
        created_at: { type: Date, default: Date.now },
    },
    {
        versionKey: false,
        minimize: true,
    }
)

AuditLogSchema.index({ created_at: -1 })
AuditLogSchema.index({ 'actor.admin_id': 1, created_at: -1 })
AuditLogSchema.index({ module: 1, action: 1, created_at: -1 })
AuditLogSchema.index({ 'entity.type': 1, 'entity.id': 1, created_at: -1 })
AuditLogSchema.index({ 'request.ip': 1, created_at: -1 })

if (envConfig.audit.RETENTION_DAYS > 0) {
    // MongoDB will not change expireAfterSeconds on an existing index. If you change
    // AUDIT_LOG_RETENTION_DAYS later, drop the `audit_ttl` index first.
    AuditLogSchema.index(
        { created_at: 1 },
        {
            name: 'audit_ttl',
            expireAfterSeconds: envConfig.audit.RETENTION_DAYS * 24 * 60 * 60,
        }
    )
}

// Block edits and deletes through Mongoose so entries can't be rewritten by app code.
const blockMutation = function (next) {
    next(new Error('Audit log entries are read-only'))
}
;[
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'replaceOne',
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
    'findOneAndRemove',
].forEach((op) => AuditLogSchema.pre(op, blockMutation))

module.exports = mongoose.model('AuditLog', AuditLogSchema, 'audit_logs')
