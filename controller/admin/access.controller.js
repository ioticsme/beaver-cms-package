const Joi = require('joi')
const bcrypt = require('bcryptjs')

const Admin = require('../../model/Admin')
const { auditAdminAccount } = require('../../helper/AuditLog.helper')
const {
    checkAdminSave,
    refuseAdminSave,
} = require('../../helper/AdminAccountGuard.helper')
const { privileges } = require('../../config/userPrivilege.config')
const envConfig = require('../../config/env.config')
const { logError } = require('../../helper/Logger.helper')

// List all admins excluding the super admin
const list = async (req, res) => {
    try {
        const admins = await Admin.find({
            role: {
                $ne: 'super_admin', // Exclude 'super_admin' from the results
            },
            deleted: {
                $ne: true,
            },
        })

        return res.render('admin-njk/access-control/users/listing', {
            admins, // Pass the list of admins to the view
        })
    } catch (error) {
        logError(error)
        return res.render('admin-njk/app-error-500', {
            error: 'Internal Server Error',
        })
    }
}

// Render the form to add a new admin
const add = async (req, res) => {
    try {
        const config_privilege_routes = await privileges(req)
        return res.render('admin-njk/access-control/users/form', {
            admin: {},
            current_privileges: [],
            config_privilege_routes,
            isEdit: false, // Specify that it's not an edit operation
            landing_url_privilege_id:
                envConfig.general.ADMIN_LANDING_URL_PRIVILEGE_ID,
        })
    } catch (error) {
        logError(error)
        return res.render('admin-njk/app-error-500', {
            error: 'Internal Server Error',
        })
    }
}

// Render the form to edit an existing admin
const edit = async (req, res) => {
    try {
        const admin = await Admin.findOne({
            _id: req.params.id, // Find the admin by ID from the URL
            deleted: {
                $ne: true,
            },
        })
        const config_privilege_routes = await privileges(req)
        return res.render('admin-njk/access-control/users/form', {
            admin, // Pass the admin data to the form for editing
            current_privileges: admin.privileges?.split(',') ?? [],
            config_privilege_routes,
            isEdit: true, // Specify that it's an edit operation
            landing_url_privilege_id:
                envConfig.general.ADMIN_LANDING_URL_PRIVILEGE_ID,
        })
    } catch (error) {
        logError(error)
        return res.render('admin-njk/app-error-500', {
            error: 'Internal Server Error',
        })
    }
}

// Save a new admin or update an existing admin
const save = async (req, res) => {
    try {
        const saltRounds = 10
        const salt = bcrypt.genSaltSync(saltRounds) // Generate salt for hashing password

        // Validation schema for admin data using Joi
        const schema = Joi.object({
            name: Joi.string().required().min(3).max(60), // Validate the name field
            email: Joi.string().required().min(3).max(60), // Validate the email field
            password: Joi.string().allow('', null), // Validate the password field
            role: Joi.string().required().valid('admin', 'editor', 'finance'), // Role validation
            status: Joi.boolean().required(), // Status must be boolean
            id: Joi.optional(), // Optional id field for updates
            privileges: Joi.string().optional().allow(null, ''),
        })

        const validationResult = schema.validate(req.body, {
            abortEarly: false, // Return all validation errors at once
        })

        if (validationResult.error) {
            res.status(422).json(validationResult.error) // Send validation errors as response
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
                return refuseAdminSave(req, res, 'access_user', {
                    status: 404,
                    reason: 'target_not_found',
                    message: 'Admin not found',
                })
            }
        }
        const refusal = checkAdminSave(req, {
            target,
            requestedRole: req.body.role,
            editableRoles: ['admin', 'editor', 'finance'],
        })
        if (refusal) {
            return refuseAdminSave(req, res, 'access_user', refusal, target)
        }

        // Check if the email is already taken, excluding the current admin (if updating)
        let options = {
            email: req.body.email,
            deleted: {
                $ne: true,
            },
        }
        if (req.body.id) {
            options._id = { $ne: req.body.id } // Ensure we're not checking the same user during update
        }
        const adminExist = await Admin.findOne(options)
        if (adminExist) {
            return res.status(400).json({
                error: 'Email is already taken', // Email conflict error
            })
        }

        let privileges = req.body.privileges.split(',')
        if (
            !privileges.includes(
                envConfig.general.ADMIN_LANDING_URL_PRIVILEGE_ID
            )
        ) {
            privileges.push(envConfig.general.ADMIN_LANDING_URL_PRIVILEGE_ID)
        }

        // Prepare admin data for creation or update
        let data = {
            name: req.body.name,
            email: req.body.email,
            role: req.body.role,
            active: req.body.status || false, // Default to false if no status provided
            privileges: privileges.join(','),
        }

        // Update existing admin if ID is provided, else create a new admin
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
            auditAdminAccount(req, 'access_user', 'update', before, after, {
                password_changed: !!req.body.password,
            })
        } else {
            data['password'] = bcrypt.hashSync(req.body.password, salt)
            const created = await Admin.create(data)
            auditAdminAccount(req, 'access_user', 'create', null, created)
        }

        return res.status(200).json({
            message: `User ${req.body.id ? 'updated' : 'created'}`, // Success message depending on the operation
        })
    } catch (error) {
        console.log(error) // Log the error for debugging
        return res.status(500).json({ error: 'Something went wrong' }) // Return general error response
    }
}

// Change the activation status of an admin
const changeStatus = async (req, res) => {
    try {
        const { status, id } = req.body
        // Ensure id is provided
        if (!id) {
            return res.status(404).json({ error: 'Invalid data' })
        }

        // Toggle active status for the admin, excluding 'super_admin'
        const update = await Admin.findOneAndUpdate(
            { _id: id, role: { $ne: 'super_admin' } }, // Ensure 'super_admin' cannot be modified
            {
                $set: {
                    active: !status, // Toggle the current status
                },
            }
        )

        // If no matching admin was found, return an error
        if (!update?._id) {
            return res.status(404).json({ error: 'Activation error' })
        }
        auditAdminAccount(
            req,
            'access_user',
            update.active ? 'deactivate' : 'activate',
            update,
            { ...update.toObject(), active: !update.active }
        )
        return res.status(200).json({
            message: `User status changed`, // Success message on status change
        })
    } catch (error) {
        return res.status(404).json({ error: 'Something went wrong' }) // General error response
    }
}

// Soft delete an admin by ID
const deleteItem = async (req, res) => {
    try {
        const { id } = req.body
        // Ensure id is provided
        if (!id) {
            return res.status(404).json({ error: 'Id not found' }) // Return error if no ID provided
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
        auditAdminAccount(req, 'access_user', 'delete', before, null)
        return res.status(200).json({
            message: `User Deleted`, // Success message for deletion
        })
    } catch (error) {
        return res.status(404).json({ error: 'Something went wrong' }) // General error response
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
