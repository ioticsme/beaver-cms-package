const { logError } = require('./Logger.helper')
const envConfig = require('../config/env.config')

const incrementVersion = (version = '') => {
    if (!version.length) return ''

    const parts = version.split('.').map(Number)
    if (parts[2] < 9) {
        parts[2] += 1 // Increment the patch number
    } else if (parts[1] < 9) {
        parts[1] += 1 // Increment the minor number
        parts[2] = 0 // Reset the patch number
    } else {
        parts[0] += 1 // Increment the major number
        parts[1] = 0 // Reset the minor number
        parts[2] = 0 // Reset the patch number
    }
    return parts.join('.')
}

// Returns the record's revisions with a snapshot of its current (pre-save) state appended.
// Used for both Content and ContentType. Keeps the last REVISION_LIMIT snapshots.
const getRevisionObject = (
    content = {},
    authUser = {},
    limit = envConfig.audit.REVISION_LIMIT
) => {
    try {
        let latestRevision = content.revisions?.[content.revisions.length - 1]
        let contentToStore = {
            ...(content?._doc || content),
            revisions: [],
        }

        let newRevision = {
            content: contentToStore,
            editor: authUser.admin_id,
            editor_name: authUser.admin_name,
            created_at: new Date(),
            revision_number: incrementVersion(
                latestRevision?.revision_number || '0.0.1'
            ),
        }

        // Add new revision and keep only the last `limit` revisions
        let updatedRevisions = [...(content.revisions || []), newRevision]
        if (updatedRevisions.length > limit) {
            updatedRevisions = updatedRevisions.slice(-limit)
        }

        return updatedRevisions || []
    } catch (error) {
        logError(error)
        // Keep the existing history rather than wiping it on an error
        return content?.revisions || []
    }
}

module.exports = {
    incrementVersion,
    getRevisionObject,
}
