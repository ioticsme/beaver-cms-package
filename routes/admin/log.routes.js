const express = require('express')
require('express-group-routes')
const router = express.Router()
const logController = require('../../controller/admin/log.controller')
const auditLogController = require('../../controller/admin/auditLog.controller')

// Audit logs are only for super admins and admins. There is no privilege id for
// them on purpose, so they can't be granted to editors by accident.
const adminsOnly = (req, res, next) => {
    if (!['super_admin', 'admin'].includes(req.authUser?.admin_role)) {
        return res.status(403).render('admin-njk/page-error-403')
    }
    next()
}

router.group('/', (router) => {
    router.get('/server', logController.serverLogList)
    router.get('/server/json', logController.serverLogJsonList)
    router.get('/audit', adminsOnly, auditLogController.list)
    router.get('/audit/json', adminsOnly, auditLogController.jsonList)
    router.get('/audit/export', adminsOnly, auditLogController.exportCsv)
    router.get('/audit/view/:id', adminsOnly, auditLogController.detail)
    // router.get('/queue', logController.queueList)
})
// router.post('/', userController.verifyOtp)

module.exports = router
