const express = require('express')
require('express-group-routes')
const router = express.Router()
const customFormsController = require('../../controller/admin/customForm.controller')

router.group('/', (router) => {
    // Custom forms
    router.group('/', (router) => {
        router.get('/', customFormsController.list)
        router.get('/add', customFormsController.add)
        router.get('/edit/:id', customFormsController.edit)
        router.get('/view-api/:id', customFormsController.viewAPI)
        router.post('/save', customFormsController.save)
        router.post('/change-status', customFormsController.changeStatus)
        router.post('/delete', customFormsController.deleteForm)
        router.post('/duplicate', customFormsController.duplicateForm)
        router.get('/submissions/:id', customFormsController.viewSubmissions)
        router.post(
            '/submissions/delete',
            customFormsController.deleteSubmissions
        )
        router.get(
            '/submissions/:id/export',
            customFormsController.exportSubmissions
        )
        router.get(
            '/submissions/:formId/:formDataId',
            customFormsController.viewSubmission
        )
    })
})

module.exports = router
