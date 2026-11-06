const { audit } = require('./AuditLog.helper')

/**
 * Decide whether the current admin may save (create or update) an admin account.
 *
 * Returns null when allowed, or { status, reason, message } when refused.
 *
 *   target          the existing admin being updated (lean doc), or null on create
 *   requestedRole   the role posted in the form
 *   editableRoles   roles this form is allowed to touch (null = no limit)
 */
const checkAdminSave = (req, { target, requestedRole, editableRoles = null }) => {
    const actor = req.authUser || req.session || {}
    const actorIsSuper = actor.admin_role === 'super_admin'

    if (!actorIsSuper && requestedRole === 'super_admin') {
        return {
            status: 403,
            reason: 'assign_super_admin_role',
            message: 'You are not allowed to assign the super admin role',
        }
    }

    if (!target) return null

    if (target.role === 'super_admin' && !actorIsSuper) {
        return {
            status: 403,
            reason: 'target_is_super_admin',
            message: 'You are not allowed to edit a super admin',
        }
    }

    if (editableRoles && !editableRoles.includes(target.role)) {
        return {
            status: 403,
            reason: 'target_role_not_editable',
            message: 'This account cannot be edited here',
        }
    }

    const isSelf = actor.admin_id && String(actor.admin_id) === String(target._id)
    if (isSelf && !actorIsSuper && requestedRole !== target.role) {
        return {
            status: 403,
            reason: 'self_role_change',
            message: 'You are not allowed to change your own role',
        }
    }

    return null
}

// Write a failure audit entry for a refused admin-account save and send the 403/404.
const refuseAdminSave = (req, res, module, refusal, target) => {
    audit(req, {
        module,
        action: target ? 'update' : 'create',
        status: 'failure',
        entity: {
            type: 'admin',
            id: target?._id || req.body?.id,
            label: target?.email || req.body?.email,
        },
        meta: {
            reason: refusal.reason,
            target_role: target?.role,
            requested_role: req.body?.role,
            requested_email: req.body?.email,
            password_change_attempted: !!req.body?.password,
        },
    })
    return res.status(refusal.status).json({ error: refusal.message })
}

module.exports = { checkAdminSave, refuseAdminSave }
