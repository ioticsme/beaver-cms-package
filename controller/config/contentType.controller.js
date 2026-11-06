const path = require('path')
const express = require('express')
const Joi = require('joi')
const bcrypt = require('bcryptjs')
const ContentType = require('../../model/ContentType')
const metaFields = require('../../config/meta-fields.config')
const slugify = require('slugify')
const { loadSVGIcons } = require('../../helper/Operations.helper')
const Brand = require('../../model/Brand')
const { removeCache } = require('../../helper/Redis.helper')
const envConfig = require('../../config/env.config')
const { logError } = require('../../helper/Logger.helper')
const AdminNav = require('../../model/AdminNav')
const { getNavigation } = require('../../middleware/cms.middleware')
const { getRevisionObject } = require('../../helper/Revision.helper')
const { audit } = require('../../helper/AuditLog.helper')

// Update a content type, keeping a revision of its previous state and an audit entry.
const updateWithRevision = async (req, id, update, action) => {
    const before = await ContentType.findOne({ _id: id })
    if (!before) return null
    const revisions = getRevisionObject(before, req.authUser)
    const $set = {
        ...(update.$set || update),
        revisions,
        last_edited_user: req.authUser?.admin_id,
    }
    await ContentType.updateOne({ _id: id }, { $set })
    const after = await ContentType.findOne({ _id: id }).lean()
    audit(req, {
        module: 'content_type',
        action,
        entity: { type: 'content_type', id, label: after?.title },
        before,
        after,
        meta: {
            slug: after?.slug,
            revision: revisions[revisions.length - 1]?.revision_number,
        },
    })
    return after
}

const list = async (req, res) => {
    try {
        const contentTypes = await ContentType.find().populate({
            path: 'brand',
            select: 'name',
        })
        return res.render('admin-njk/config/content-type/listing', {
            contentTypes,
        })
    } catch (e) {
        logError(e)
        return res.render(`admin-njk/app-error-500`)
    }
}

const add = async (req, res) => {
    try {
        const icons = await loadSVGIcons()
        const contentTypes = await ContentType.find()
        const brands = await Brand.find().sort({ position: 1 })
        return res.render('admin-njk/config/content-type/form', {
            isEdit: false,
            contentTypes,
            icons,
            brands,
        })
    } catch (e) {
        logError(e)
        return res.render(`admin-njk/app-error-500`)
    }
}

const edit = async (req, res) => {
    try {
        const icons = await loadSVGIcons()
        const contentType = await ContentType.findOne({
            _id: req.params.id,
        })
        // console.log('contentType :>> ', contentType)
        const contentTypes = await ContentType.find()
        const brands = await Brand.find().sort({ position: 1 })
        const currentNavigation = await getNavigation(req)
        const currentNavSections = currentNavigation.map((eachSection) => {
            return eachSection.section
        })
        const adminNavs = await AdminNav.find({ active: { $ne: false } })
        const adminNavSections = adminNavs.map((eachSection) => {
            return eachSection.section
        })

        const mixedNavSections = [
            ...new Set([...currentNavSections, ...adminNavSections]),
        ]
        return res.render('admin-njk/config/content-type/form', {
            contentType,
            isEdit: true,
            contentTypes,
            icons,
            brands,
            mixedNavSections,
        })
    } catch (e) {
        logError(e)
        return res.render(`admin-njk/app-error-500`)
    }
}

const view = async (req, res) => {
    try {
        const contentType = await ContentType.findOne({
            _id: req.params.id,
        }).populate({
            path: 'brand',
            select: 'name',
        })
        // console.log(contentType)
        // const fields_to_map = []
        const fields_to_map = await contentType.field_groups.map(
            (eachGroup) => {
                const fields = []
                eachGroup.fields.forEach((field) => {
                    fields.push({
                        label: field.field_label,
                        name: field.field_name,
                        type: field.field_type,
                        info: field.field_info,
                        show_on_list: field.show_on_list,
                        multi_select: field.multi_select,
                        position: field.position,
                        validation: field.validation,
                        options: field.options,
                    })
                })
                const group = {
                    section: eachGroup.row_name,
                    repeater_group: eachGroup.repeater_group,
                    localisation: eachGroup.localisation,
                    inline_fields: eachGroup.inline_fields,
                    fields: fields,
                }
                return group
            }
        )

        // return res.json(JSON.stringify(fields_to_map))

        // console.log('contentType :>> ', contentType)
        // const contentTypes = await ContentType.find()
        return res.render('admin-njk/config/content-type/view', {
            contentType,
            fields_to_map: JSON.stringify(fields_to_map),
            metaFields,
            // contentTypes,
        })
    } catch (e) {
        logError(e)
        return res.render(`admin-njk/app-error-500`)
    }
}

const save = async (req, res) => {
    try {
        // console.log(req.body.beaver_docs_repeater_nested_outer)
        const schema = Joi.object({
            brand: Joi.array().required(),
            title: Joi.string().required().min(3).max(60),
            slug: Joi.string().required().min(3).max(60),
            // template_name: Joi.string().required().min(3).max(60),
            position: Joi.number().required(),
            admin_icon: Joi.string().optional().allow(null, ''),
            admin_nav_section: Joi.string().optional().allow(null, ''),
            page_builder: Joi.boolean().optional().allow(null, ''),
            has_slug: Joi.boolean().optional().allow(null, ''),
            active: Joi.boolean().optional().allow(null, ''),
            nav_on_collection_api: Joi.boolean().optional().allow(null, ''),
            nav_on_single_api: Joi.boolean().optional().allow(null, ''),
            has_form: Joi.boolean().optional().allow(null, ''),
            has_meta: Joi.boolean().optional().allow(null, ''),
            has_api_endpoint: Joi.boolean().optional().allow(null, ''),
            single_type: Joi.boolean().optional().allow(null, ''),
            attachable_type: Joi.array(),
            id: Joi.optional(),
        })

        const validationResult = schema.validate(req.body, {
            abortEarly: false,
        })

        if (validationResult.error) {
            res.status(422).json(validationResult.error)
            return
        }

        let data = {
            brand: req.body.brand,
            title: req.body.title,
            slug: slugify(req.body.slug.toLowerCase()),
            // template_name: req.body.template_name,
            position: req.body.position,
            admin_icon: req.body.admin_icon.length
                ? req.body.admin_icon
                : undefined,
            admin_nav_section: req.body.admin_nav_section,
            allowed_type: req.body.allowed_type || [],
            page_builder: req.body?.page_builder || false,
            has_form: req.body?.has_form || false,
            has_slug: req.body.has_slug || false,
            active: req.body.active || false,
            has_meta: req.body.has_meta || false,
            nav_on_collection_api: req.body.nav_on_collection_api || false,
            nav_on_single_api: req.body.nav_on_single_api || false,
            single_type: req.body.single_type || false,
            allowed_type: req.body.attachable_type?.length
                ? req.body.attachable_type
                : null,
        }

        let c_type_id
        if (req.body.id) {
            c_type_id = req.body.id
            const updated = await updateWithRevision(req, req.body.id, data, 'update')
            if (!updated) {
                return res.status(404).json({ error: 'Content type not found' })
            }
        } else {
            const new_c_type = await ContentType.create({
                ...data,
                last_edited_user: req.authUser?.admin_id,
            })
            c_type_id = new_c_type.id
            audit(req, {
                module: 'content_type',
                action: 'create',
                entity: { type: 'content_type', id: new_c_type._id, label: new_c_type.title },
                after: new_c_type,
            })
        }

        await removeCache([
            `${envConfig.cache.CACHE_KEY_PREFIX}-mixed-privileges-${req.authUser?.brand?.code}-${req.authUser?.brand?.country_code}`,
            `${envConfig.cache.CACHE_KEY_PREFIX}-mixed-nav-${req.authUser?.brand?.code}-${req.authUser?.brand?.country_code}`,
        ])

        return res.status(200).json({
            message: 'Content Type added',
            redirect_to: `/admin/config/content-type/view/${c_type_id}`,
        })
    } catch (e) {
        logError(e)
        if (e.errors) {
            return res.status(422).json({
                details: e.errors,
            })
        }
        return res.status(500).json({ error: 'Something went wrong' })
    }
}

const deleteItem = async (req, res) => {
    try {
        const { id } = req.body
        // If id not found
        if (!id) {
            return res.status(404).json({ error: 'Id not found' })
        }

        const before = await ContentType.findOne({ _id: id }).lean()
        if (!before) {
            return res.status(404).json({ error: 'Content type not found' })
        }
        // Hard delete: the audit entry keeps a full snapshot so it can be rebuilt.
        await ContentType.deleteOne({ _id: id })
        audit(req, {
            module: 'content_type',
            action: 'delete',
            entity: { type: 'content_type', id, label: before.title },
            meta: { snapshot: { ...before, revisions: undefined } },
        })
        await removeCache([
            `${envConfig.cache.CACHE_KEY_PREFIX}-mixed-privileges-${req.authUser?.brand?.code}-${req.authUser?.brand?.country_code}`,
            `${envConfig.cache.CACHE_KEY_PREFIX}-mixed-nav-${req.authUser?.brand?.code}-${req.authUser?.brand?.country_code}`,
        ])
        return res.status(200).json({
            message: `Content Type Deleted`,
        })
    } catch (error) {
        logError(error)
        return res.status(500).json({ error: 'Something went wrong' })
    }
}

const addFields = async (req, res) => {
    try {
        const contentType = await ContentType.findOne({
            _id: req.params.id,
        })
        return res.render('admin-njk/config/content-type/field-config-form', {
            contentType,
        })
    } catch (e) {
        logError(e)
        return res.render(`admin-njk/app-error-500`)
    }
}

const saveFields = async (req, res) => {
    try {
        // console.log(req.body.fieldSchemaJson[0].fields)
        const schema = Joi.object({
            id: Joi.string().required(),
            fieldSchemaJson: Joi.array().items(
                Joi.object({
                    section: Joi.string().required(),
                    repeater_group: Joi.boolean().required(),
                    localisation: Joi.boolean().optional(),
                    inline_fields: Joi.boolean().optional(),
                    fields: Joi.array().optional(),
                    options: Joi.array().optional(),
                })
            ),
        })

        const validationResult = schema.validate(req.body, {
            abortEarly: false,
        })

        if (validationResult.error) {
            // console.log(validationResult.error)
            return res.status(422).json(validationResult.error)
        }

        // let customFieldGroups = []
        // req.body.beaver_docs_repeater_nested_outer?.map((repeater) => {
        //     let fields = []
        //     repeater.beaver_docs_repeater_nested_inner?.map((inner) => {
        //         let obj = {
        //             field_label: inner.field_label,
        //             field_name: inner.field_name,
        //             placeholder: inner.placeholder,
        //             validation: inner.validation,
        //             localisation: inner.localisation || false,
        //             field_type: inner.field_type,
        //         }
        //         let options = []
        //         for (
        //             let j = 0;
        //             j < inner.option_label?.split(',').length;
        //             j++
        //         ) {
        //             if (inner.option_value?.split(',')?.[j]) {
        //                 options.push({
        //                     label: inner.option_label?.split(',')?.[j],
        //                     value: inner.option_value.split(',')[j],
        //                 })
        //             }
        //         }
        //         if (options.length) {
        //             obj.options = options
        //         }
        //         fields.push(obj)
        //     })
        //     customFieldGroups.push({
        //         row_name: repeater.name,
        //         row_label: repeater.label,
        //         repeater_group:
        //             repeater.repeater_group == 'true' ? true : false,
        //         localisation: repeater.localisation == 'true' ? true : false,
        //         fields: fields,
        //     })
        // })

        const fields_to_update = []
        req.body.fieldSchemaJson.forEach((eachGroup) => {
            const fields = []
            eachGroup.fields.forEach((field) => {
                fields.push({
                    field_label: field.label,
                    field_name: slugify(field.name, '_').toLowerCase(),
                    field_type: field.type.toLowerCase(),
                    field_info: field.info,
                    show_on_list: field.show_on_list,
                    multi_select: field.multi_select,
                    placeholder: field.label,
                    position: field.position || 0,
                    validation: field.validation,
                    options: field.options,
                })
            })
            const group = {
                row_name: slugify(eachGroup.section, '_').toLowerCase(),
                row_label: eachGroup.section,
                repeater_group: eachGroup.repeater_group,
                localisation: eachGroup.localisation,
                inline_fields: eachGroup.inline_fields,
                fields: fields,
            }
            fields_to_update.push(group)
        })
        // return false

        // console.log(fields_to_update)
        const updated = await updateWithRevision(
            req,
            req.body.id,
            { field_groups: fields_to_update },
            'update_fields'
        )
        if (!updated) {
            return res.status(404).json({ error: 'Content type not found' })
        }

        await removeCache([
            `${envConfig.cache.CACHE_KEY_PREFIX}-mixed-privileges-${req.authUser?.brand?.code}-${req.authUser?.brand?.country_code}`,
            `${envConfig.cache.CACHE_KEY_PREFIX}-mixed-nav-${req.authUser?.brand?.code}-${req.authUser?.brand?.country_code}`,
        ])

        return res.status(200).json({ message: 'Content Type added' })
    } catch (e) {
        logError(e)
        if (e.errors) {
            return res.status(422).json({
                details: e.errors,
            })
        }
        return res.status(500).json({ error: 'Something went wrong' })
    }
}

const saveMeta = async (req, res) => {
    try {
        // console.log(req.body)
        const schema = Joi.object({
            _id: Joi.string().required(),
            meta: Joi.object().required(),
        })

        const validationResult = schema.validate(req.body, {
            abortEarly: false,
        })

        if (validationResult.error) {
            return res.status(422).json(validationResult.error)
        }
        const updated = await updateWithRevision(
            req,
            req.body._id,
            { meta: req.body.meta },
            'update_meta'
        )
        if (!updated) {
            return res.status(404).json({ error: 'Content type not found' })
        }

        return res.status(200).json({ message: 'Content Type Meta updated' })
    } catch (e) {
        logError(e)
        if (e.errors) {
            return res.status(422).json({
                details: e.errors,
            })
        }
        return res.status(500).json({ error: 'Something went wrong' })
    }
}

module.exports = {
    list,
    add,
    edit,
    view,
    save,
    deleteItem,
    addFields,
    saveFields,
    saveMeta,
}
