// import * as dotenv from 'dotenv'
// dotenv.config({ path: '../../../../.env' })
// const mongoose = require("mongoose");
const Joi = require('joi')
const bcrypt = require('bcryptjs')

const Admin = require('../../model/Admin')
const { auditAdminAccount } = require('../../helper/AuditLog.helper')
const {
    checkAdminSave,
    refuseAdminSave,
} = require('../../helper/AdminAccountGuard.helper')
const { getPrivileges } = require('../../middleware/cmsAuth.middleware')
const envConfig = require('../../config/env.config')
const { logError } = require('../../helper/Logger.helper')

const list = async (req, res) => {
    try {
        const admins = await Admin.find({ deleted: { $ne: true } })
        return res.render('admin-njk/config/admin/listing', {
            admins,
        })
    } catch (error) {
        logError(error)
        return res.render(`admin-njk/app-error-500`)
    }
}

const add = async (req, res) => {
    try {
        const config_privilege_routes = await getPrivileges(req)
        return res.render('admin-njk/config/admin/form', {
            isEdit: false,
            admin: {},
            current_privileges: [],
            config_privilege_routes,
            landing_url_privilege_id:
                envConfig.general.ADMIN_LANDING_URL_PRIVILEGE_ID,
        })
    } catch (error) {
        logError(error)
        return res.render(`admin-njk/app-error-500`)
    }
}

const edit = async (req, res) => {
    try {
        const config_privilege_routes = await getPrivileges(req)
        const admin = await Admin.findOne({
            _id: req.params.id,
            deleted: { $ne: true },
        })

        return res.render('admin-njk/config/admin/form', {
            admin,
            current_privileges: admin.privileges?.split(',') ?? [],
            config_privilege_routes,
            isEdit: true,
            landing_url_privilege_id:
                envConfig.general.ADMIN_LANDING_URL_PRIVILEGE_ID,
        })
    } catch (error) {
        logError(error)
        return res.render(`admin-njk/app-error-500`)
    }
}

const save = async (req, res) => {
    try {
        const saltRounds = 10
        const salt = bcrypt.genSaltSync(saltRounds)

        let privileges = req.body.privileges.split(',')
        if (
            !privileges.includes(
                envConfig.general.ADMIN_LANDING_URL_PRIVILEGE_ID
            )
        ) {
            privileges.push(envConfig.general.ADMIN_LANDING_URL_PRIVILEGE_ID)
        }

        const schema = Joi.object({
            name: Joi.string().required().min(3).max(60),
            email: Joi.string().required().min(3).max(60),
            password: Joi.string().allow('', null),
            role: Joi.string()
                .required()
                .valid('super_admin', 'admin', 'editor', 'user', 'finance'),
            status: Joi.boolean().required(),
            privileges: Joi.string().required(),
            id: Joi.optional(),
        })

        const validationResult = schema.validate(req.body, {
            abortEarly: false,
        })

        if (validationResult.error) {
            res.status(422).json(validationResult.error)
            return
        }

        // Load the target first and refuse edits the current admin may not make
        let target = null
        if (req.body.id) {
            target = await Admin.findOne({
                _id: req.body.id,
                deleted: { $ne: true },
            }).lean()
            if (!target) {
                return refuseAdminSave(req, res, 'admin_user', {
                    status: 404,
                    reason: 'target_not_found',
                    message: 'Admin not found',
                })
            }
        }
        const refusal = checkAdminSave(req, {
            target,
            requestedRole: req.body.role,
        })
        if (refusal) {
            return refuseAdminSave(req, res, 'admin_user', refusal, target)
        }

        let options = {
            email: req.body.email,
            deleted: { $ne: true },
        }
        if (req.body.id) {
            options._id = { $ne: req.body.id }
        }
        const adminExist = await Admin.findOne(options)
        if (adminExist) {
            return res.status(422).json({
                details: [
                    {
                        message: '"email" is already taken',
                        path: ['email'],
                        type: 'string.duplicate',
                        context: {
                            label: 'email',
                            value: req.body.email,
                            key: 'email',
                        },
                    },
                ],
            })
        }

        let data = {
            name: req.body.name,
            email: req.body.email,
            role: req.body.role,
            active: req.body.status || false,
            privileges: privileges.join(','),
        }

        if (req.body.id) {
            if (req.body.password) {
                data['password'] = bcrypt.hashSync(req.body.password, salt)
            }
            const before = target
            await Admin.updateOne(
                {
                    _id: req.body.id,
                },
                data
            )
            const after = await Admin.findOne({ _id: req.body.id }).lean()
            auditAdminAccount(req, 'admin_user', 'update', before, after, {
                password_changed: !!req.body.password,
            })
        } else {
            data['password'] = bcrypt.hashSync(req.body.password, salt)
            const created = await Admin.create(data)
            auditAdminAccount(req, 'admin_user', 'create', null, created)
        }

        return res.status(200).json({
            message: 'Admin saved successfully',
        })
    } catch (error) {
        logError(error)
        return res.status(500).json({ error: 'Something went wrong' })
    }
}

const changeStatus = async (req, res) => {
    try {
        const { status, id } = req.body
        // If id not found
        if (!id) {
            return res.status(404).json({ error: 'Invalid data' })
        }

        // Update status field
        const update = await Admin.findOneAndUpdate(
            { _id: id, role: { $ne: 'super_admin' }, deleted: { $ne: true } },
            {
                $set: {
                    active: !status,
                },
            }
        )
        // If not updated
        if (!update?._id) {
            return res.status(404).json({ error: 'Activation error' })
        }
        auditAdminAccount(
            req,
            'admin_user',
            update.active ? 'deactivate' : 'activate',
            update,
            { ...update.toObject(), active: !update.active }
        )
        return res.status(200).json({
            message: `Admin status changed`,
        })
    } catch (error) {
        logError(error)
        return res.status(404).json({ error: 'Something went wrong' })
    }
}

const deleteItem = async (req, res) => {
    try {
        const { id } = req.body
        // If id not found
        if (!id) {
            return res.status(404).json({ error: 'Id not found' })
        }

        const before = await Admin.findOne({
            _id: id,
            role: { $ne: 'super_admin' },
            deleted: { $ne: true },
        }).lean()
        if (!before) {
            return res.status(404).json({ error: 'Admin not found' })
        }
        // soft delete item
        await Admin.updateOne(
            { _id: id, role: { $ne: 'super_admin' }, deleted: { $ne: true } },
            { $set: { deleted: true, deleted_at: new Date() } }
        )
        auditAdminAccount(req, 'admin_user', 'delete', before, null)
        return res.status(200).json({
            message: `Admin Deleted`,
        })
    } catch (error) {
        logError(error)
        return res.status(404).json({ error: 'Something went wrong' })
    }
}

module.exports = {
    list,
    add,
    edit,
    save,
    changeStatus,
    deleteItem,
}
