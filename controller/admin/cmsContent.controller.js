const envConfig = require('../../config/env.config')
const _ = require('lodash')
const slugify = require('slugify')
const Joi = require('joi')
const Content = require('../../model/Content')
const CustomForm = require('../../model/CustomForm')
const fs = require('fs')
const { default: collect } = require('collect.js')
const Redis = require('../../helper/Redis.helper')
const { ObjectId } = require('mongodb')
const metaFields = require('../../config/meta-fields.config')
const ContentType = require('../../model/ContentType')
const { getRevisionObject } = require('../../helper/Revision.helper')
const { logError } = require('../../helper/Logger.helper')


const list = async (req, res) => {
    try {
        const session = req.authUser
        // return res.send(req.contentType._id)
        const contentList = await Content.find({
            type_id: req.contentType._id,
            brand: session.brand._id,
            country: session.brand.country,
            deleted: { $ne: true },
        }).sort('position')

        if (req.contentType.single_type) {
            if (contentList.length) {
                // return res.send(contentList[0]._id)
                return res.redirect(
                    `/admin/cms/${req.contentType.slug}/edit/${contentList[0]._id}`
                )
            } else {
                return res.redirect(`/admin/cms/${req.contentType.slug}/add`)
            }
        }

        if (!contentList) {
            return res.render(`admin-njk/app-error-500`)
        }

        // const reqContentType = req.contentType
        const default_lang = collect(req.authUser.brand.languages)
            .sortByDesc('is_default')
            .first()
        return res.render(`admin-njk/cms/content/listing`, {
            default_lang,
            reqContentType: req.contentType,
            data: contentList,
        })
    } catch (error) {
        logError(error)
        return res.render(`admin-njk/app-error-500`)
    }
}

const detail = async (req, res) => {
    try {
        const session = req.authUser
        const contentDetail = await Content.findOne({
            _id: req.params.id,
            type_id: req.contentType._id,
            brand: session.brand._id,
            country: session.brand.country,
            deleted: { $ne: true },
        })
            .populate('author revisions.editor last_edited_user')
            .lean()

        if (!contentDetail) {
            return res.render(`admin-njk/page-error-404`)
        }

        const has_common_field_groups = collect(req.contentType.field_groups)
            .where('localisation', false)
            .count()

        const has_bilingual_field_groups = collect(req.contentType.field_groups)
            .where('localisation', true)
            .count()

        const default_lang = _.find(
            req.authUser.brand.languages,
            function (item) {
                return item.is_default === true
            }
        )

        // return res.send(metaFields)

        let template = `admin-njk/cms/content/detail`
        if (req.contentType?.page_builder) {
            // console.log(req.authUser.brand.languages)
            template = `admin-njk/cms/content/html-builder/detail`
        }

        // console.log(contentDetail.meta.en.OG.url)

        res.render(template, {
            default_lang,
            has_common_field_groups: has_common_field_groups ? true : false,
            has_bilingual_field_groups: has_bilingual_field_groups
                ? true
                : false,
            reqContentType: req.contentType,
            contentDetail,
            metaFields,
            // findalContentFieldsGroup,
        })
    } catch (error) {
        logError(error)
        return res.render(`admin-njk/app-error-500`)
    }
}

const duplicateContent = async (req, res) => {
    try {
        if (req.contentType.single_type) {
            return await duplicateSingleTypeContent(req, res)
        }

        const session = req.authUser
        const contentDetail = await Content.findOne({
            _id: req.params.id,
            type_id: req.contentType._id,
            brand: session.brand._id,
            country: session.brand.country,
            deleted: { $ne: true },
        }).lean()

        if (!contentDetail) {
            return res.render(`admin-njk/page-error-404`)
        }

        let newSlug = await generateSlugForContent(
            req.authUser,
            contentDetail.type_slug,
            contentDetail.slug
        )

        await Content.create({
            ...contentDetail,
            _id: new ObjectId(),
            slug: newSlug,
            author: req.authUser?.admin_id,
        })

        return res.redirect('back')
    } catch (error) {
        logError(error)
        return res.render(`admin-njk/app-error-500`)
    }
}

const duplicateSingleTypeContent = async (req, res) => {
    try {
        const session = req.authUser
        const contentDetail = await Content.findOne({
            _id: req.params.id,
            type_id: req.contentType._id,
            brand: session.brand._id,
            country: session.brand.country,
            deleted: { $ne: true },
        }).lean()

        if (!contentDetail) {
            return res.render(`admin-njk/page-error-404`)
        }

        let contentType = await ContentType.findOne({
            _id: req.contentType._id,
        }).lean()
        if (!contentType) {
            return res.render(`admin-njk/page-error-404`)
        }

        let newContentTypeSlug = await generateSlugForContentType(
            req.authUser,
            contentType.slug
        )

        let newContentType = await ContentType.create({
            ...contentType,
            _id: new ObjectId(),
            title: `${contentType.title}-${newContentTypeSlug?.count}`,
            slug: newContentTypeSlug?.slug,
        })

        if (!newContentType?._id) {
            return res.render(`admin-njk/app-error-500`)
        }

        let newContentSlug = await generateSlugForContent(
            req.authUser,
            contentDetail.type_slug,
            contentDetail.slug
        )

        await Content.create({
            ...contentDetail,
            _id: new ObjectId(),
            slug: newContentSlug,
            type_id: newContentType._id,
            type_slug: newContentType.slug,
            author: req.authUser?.admin_id,
        })

        return res.redirect(`/admin/cms/${newContentType.slug}`)
    } catch (error) {
        logError(error)
        return res.render(`admin-njk/app-error-500`)
    }
}

const generateSlugForContentType = async (authUser, currentSlug, count = 1) => {
    // Check if the currentSlug already ends with a number
    const slugParts = currentSlug.match(/^(.*?)-(\d+)$/)
    const baseSlug = slugParts ? slugParts[1] : currentSlug
    const currentCount = slugParts ? parseInt(slugParts[2], 10) : 0

    // Generate new slug with updated count
    const newSlug =
        currentCount > 0
            ? `${baseSlug}-${currentCount + 1}`
            : `${baseSlug}-${count}`

    const isDBExist = await ContentType.findOne({
        slug: newSlug,
        brand: authUser.brand._id,
    })

    if (isDBExist) {
        return await generateSlugForContentType(
            authUser,
            baseSlug,
            currentCount > 0 ? currentCount + 1 : count + 1
        )
    } else {
        return {
            count,
            slug: newSlug,
        }
    }
}

const generateSlugForContent = async (
    authUser,
    typeSlug,
    currentSlug,
    count = 1
) => {
    // Check if currentSlug already has a count at the end
    const slugParts = currentSlug?.match(/^(.*?)-(\d+)$/)
    const baseSlug = slugParts ? slugParts[1] : currentSlug
    const currentCount = slugParts ? parseInt(slugParts[2], 10) : 0

    // Generate new slug with updated count
    const newSlug =
        currentCount > 0
            ? `${baseSlug}-${currentCount + 1}`
            : `${baseSlug}-${count}`

    const isDBExist = await Content.findOne({
        type_slug: typeSlug,
        slug: newSlug,
        brand: authUser.brand._id,
        country: authUser.brand.country,
        deleted: { $ne: true },
    })

    if (isDBExist) {
        return await generateSlugForContent(
            authUser,
            typeSlug,
            baseSlug,
            currentCount > 0 ? currentCount + 1 : count + 1
        )
    } else {
        return newSlug
    }
}

const add = async (req, res) => {
    try {
        const session = req.authUser
        let allowed_content = {}
        if (req.contentType?.allowed_type?.length) {
            const data = await Content.find({
                brand: session?.brand?._id,
                country: session?.brand?.country,
                status: 'published',
                type_slug: { $in: req.contentType.allowed_type },
                deleted: { $ne: true },
            })
            const collection = collect(data)
            const grouped = collection.groupBy('type_slug')
            allowed_content = JSON.parse(JSON.stringify(grouped.items))
        }
        const has_common_field_groups = collect(req.contentType.field_groups)
            .where('localisation', false)
            .count()

        const has_bilingual_field_groups = collect(req.contentType.field_groups)
            .where('localisation', true)
            .count()
        // return res.send(req.contentType._id)

        let forms
        if (req.contentType?.has_form) {
            forms = await CustomForm.find({
                brand: session?.brand?._id,
                country: session?.brand?.country,
                published: true,
                deleted: { $ne: true },
            })
        }

        let template = `admin-njk/cms/content/add`
        if (req.contentType?.page_builder) {
            template = `admin-njk/cms/content/html-builder/form`
        }

        let hasPdfUpload = envConfig.general.HAS_PDF_UPLOAD // Check if PDF upload is enabled
        return res.render(template, {
            reqContentType: req.contentType,
            has_common_field_groups: has_common_field_groups ? true : false,
            has_bilingual_field_groups: has_bilingual_field_groups
                ? true
                : false,
            allowed_content,
            metaFields,
            forms,
            hasPdfUpload: hasPdfUpload,
        })
    } catch (error) {
        logError(error)
        return res.render(`admin-njk/app-error-500`)
    }
}

const edit = async (req, res) => {
    try {
        const session = req.authUser
        let allowed_content = {}
        const contentDetail = await Content.findOne({
            _id: req.params.id,
            type_id: req.contentType._id,
            brand: session.brand._id,
            country: session.brand.country,
            deleted: { $ne: true },
        })

        if (!contentDetail) {
            return res.render(`admin-njk/app-error-404`)
        }

        if (req.contentType?.allowed_type?.length) {
            const data = await Content.find({
                // brand: session?.brand?._id,
                country: session?.brand?.country,
                status: 'published',
                type_slug: { $in: req.contentType.allowed_type },
                deleted: { $ne: true },
            })
            const collection = collect(data)
            const grouped = collection.groupBy('type_slug')
            allowed_content = JSON.parse(JSON.stringify(grouped.items))
        }

        let forms
        if (req.contentType?.has_form) {
            forms = await CustomForm.find({
                brand: session?.brand?._id,
                country: session?.brand?.country,
                published: true,
                deleted: { $ne: true },
            })
        }

        const has_common_field_groups = collect(req.contentType.field_groups)
            .where('localisation', false)
            .count()

        const has_bilingual_field_groups = collect(req.contentType.field_groups)
            .where('localisation', true)
            .count()

        let template = `admin-njk/cms/content/edit`
        if (req.contentType?.page_builder) {
            template = `admin-njk/cms/content/html-builder/form`
        }

        let hasPdfUpload = envConfig.general.HAS_PDF_UPLOAD // Check if PDF upload is enabled
        return res.render(template, {
            reqContentType: req.contentType,
            has_common_field_groups: has_common_field_groups ? true : false,
            has_bilingual_field_groups: has_bilingual_field_groups
                ? true
                : false,
            contentDetail,
            allowed_content,
            forms,
            metaFields,
            hasPdfUpload: hasPdfUpload,
        })
    } catch (error) {
        logError(error)
        return res.render(`admin-njk/app-error-500`)
    }
}

const deleteContent = async (req, res) => {
    try {
        const { id } = req.body
        const slug = req.contentType.slug
        // If id not found
        if (!id) {
            return res.status(404).json({ error: 'Id not found' })
        }

        await Content.updateOne(
            {
                _id: id,
                brand: req.authUser.brand._id,
                country: req.authUser.brand.country,
            },
            { deleted: true, deleted_at: new Date() }
        )

        // :TODO: Remove cache
        const countryCode = req.authUser.brand?.country_code
        const collection_cache_key = `${envConfig.cache.CACHE_KEY_PREFIX}-content-${req.authUser.brand.code}-${countryCode}-${slug}`
        // const single_item_cache_key = `data-content-${req.authUser.brand.code}-${countryCode}-${slug}-${update.slug || update._id}`
        Redis.removeCache([collection_cache_key])

        return res.status(200).json({
            message: 'Content deleted',
            url: `/cms/${slug}`,
        })
    } catch (error) {
        logError(error)
        return res.status(404).json({ error: 'Something went wrong' })
    }
}

const changeStatus = async (req, res) => {
    try {
        const { status, id } = req.body
        const slug = req.contentType?.slug
        // If id not found
        if (!id) {
            return res.status(404).json({ error: 'Invalid data' })
        }

        const newStatus = status ? 'unpublished' : 'published'
        // Update
        const update = await Content.findOneAndUpdate(
            {
                _id: id,
                brand: req.authUser.brand._id,
                country: req.authUser.brand.country,
                deleted: { $ne: true },
            },
            {
                $set: {
                    status: newStatus,
                    last_edited_user: req.authUser?.admin_id,
                },
            }
        )
        // If not updated
        if (!update?._id) {
            return res.status(404).json({ error: 'Something went wrong' })
        }

        // :TODO: @Ebrahim, commented this because of error with countryCode
        const countryCode = req.authUser.brand?.country_code
        const collection_cache_key = `${envConfig.cache.CACHE_KEY_PREFIX}-content-${req.authUser.brand.code}-${countryCode}-${slug}`
        const single_item_cache_key = `${
            envConfig.cache.CACHE_KEY_PREFIX
        }-content-${req.authUser.brand.code}-${countryCode}-${slug}-${
            update.slug || update._id
        }`
        Redis.removeCache([collection_cache_key, single_item_cache_key])

        return res.status(200).json({
            message: 'Content status changed',
            url: `/cms/${slug}`,
        })
    } catch (error) {
        logError(error)
        return res.status(404).json({ error: 'Something went wrong' })
    }
}

const save = async (req, res) => {
    if (!req.contentType?.page_builder) {
        return await saveDefaultContent(req, res)
    } else {
        return await savePageBuilderContent(req, res)
    }
}

const savePageBuilderContent = async (req, res) => {
    // console.log(req.body)
    // return false
    try {
        // Data object to insert
        let type = req.contentType
        let body = req.body

        // BEGIN:: Validation rule
        const schema = Joi.object({
            _id: Joi.optional(),
            name: Joi.string().required(),
            slug: req.contentType.has_slug
                ? Joi.string().required()
                : Joi.string().optional(),
            attached_type: Joi.optional(),
            meta: Joi.object().optional().allow(null, ''),
            status: Joi.string()
                .valid('published', 'unpublished', 'scheduled')
                .required()
                .messages({
                    'any.only': 'Content status is a required field',
                }),
            cms_publish_start: Joi.date().allow(null, ''),
            cms_publish_end: Joi.date().allow(null, ''),
            position: Joi.number().optional(),
        }).unknown()
        // END:: Validation rule

        const validationResult = schema.validate(req.body, {
            abortEarly: false,
        })

        if (validationResult.error) {
            return res.status(422).json(validationResult.error)
        }

        // return false
        let data = {
            type_id: type._id,
            type_slug: type.slug,
            author: req.authUser.admin_id,
            brand: req.authUser.brand._id,
            country: req.authUser.brand.country,
            status: body.status,
            scheduled_at: {
                start: req.body.cms_publish_start,
                end: req.body.cms_publish_end,
            },
            position: Number(body.position) > 0 ? Number(body.position) : 100,
            'content.name': req.body.name,
            meta: req.body.meta,
            // in_home: body.in_home || false,
        }

        // console.log(data)
        // //  console.log(req.body)
        // return false

        if (
            Object?.keys(body.attached_type ? body.attached_type : {})?.length
        ) {
            attachedData = []
            Object.keys(body.attached_type).map((item) => {
                const itemDataType = typeof body.attached_type[item]
                if (body.attached_type?.[item]?.length) {
                    let obj = {
                        content_type: item,
                        items:
                            itemDataType == 'string'
                                ? body.attached_type[item].split(',')
                                : body.attached_type[item],
                    }
                    attachedData.push(obj)
                }
            })
            if (attachedData.length) {
                data.attached_type = attachedData
            }
        }
        // const brandCode = req.authUser.brand?.code
        const countryCode = req.authUser.brand?.country_code

        if (req.body._id) {
            data.slug = req.body.slug
                ? slugify(req.body.slug).toLowerCase()
                : undefined
            // console.log(data)
            // data.slug = body.slug?.en
            //     ? slugify(body.slug?.en?.toLowerCase())
            //     : slugify(body.title?.en?.toLowerCase())
            const existingContent = await Content.findOne({
                _id: req.body._id,
                deleted: { $ne: true },
            })
            const collection_cache_key = `${envConfig.cache.CACHE_KEY_PREFIX}-content-${req.authUser.brand.code}-${countryCode}-${type.slug}`
            const single_item_cache_key = `${envConfig.cache.CACHE_KEY_PREFIX}-content-${req.authUser.brand.code}-${countryCode}-${type.slug}-${existingContent.slug}`
            // Update content
            await Content.updateOne(
                { _id: req.body._id, deleted: { $ne: true } },
                data
            )
            Redis.removeCache([collection_cache_key, single_item_cache_key])
            return res.status(201).json({
                message: 'Content updated successfully',
                redirect_to: `/admin/cms/${type.slug}/detail/${req.body._id}`,
            })
        } else {
            data.slug = req.body.slug ? slugify(req.body.slug) : undefined
            // Create content
            const save = await Content.create(data)
            if (!save?._id) {
                return res.status(400).json({ error: 'Something went wrong' })
            }
            const collection_cache_key = `${envConfig.cache.CACHE_KEY_PREFIX}-content-${req.authUser.brand.code}-${countryCode}-${type.slug}`
            Redis.removeCache([collection_cache_key])
            return res.status(200).json({
                message: 'Content added successfully',
                // redirect_to: `/admin/cms/${type.slug}/detail/${save._id}`,
                redirect_to: `/admin/cms/${type.slug}`,
            })
        }
    } catch (error) {
        logError(error)
        return res.status(400).json({ error: 'Something went wrong' })
    }
}

const saveDefaultContent = async (req, res) => {
    try {
        // console.log('req.body', req.body.en.branches)
        // return
        // Data object to insert
        let type = req.contentType
        let body = req.body
        let content_to_insert = _.omit(body, [
            '_id',
            'slug',
            'form',
            'status',
            'cms_publish_start',
            'cms_publish_end',
            // 'in_home',
            'position',
            'meta',
        ])

        if (req.body.status != 'scheduled') {
            req.body.cms_publish_start = undefined
            req.body.cms_publish_end = undefined
        }

        // BEGIN:: Generating content field validation rule for content type
        let validationSchema = {}

        const validTypes = {
            text: 'string()',
            textarea: 'string()',
            article_editor: 'string()',
            richtext: 'string()',
            media: 'object()',
            dropdown_single: 'string()',
            dropdown_multi: 'array()',
            email: 'string()',
            number: 'number()',
            date: 'date()',
            time: 'string()',
            color: 'string()',
            url: 'string()',
            optional: 'optional()',
        }

        const language_prefixes = _.map(req.authUser.brand.languages, 'prefix')
        language_prefixes.push('common')
        language_prefixes.forEach((lang) => {
            let fieldGroupValidationObj = {}
            let group_by_localisation
            if (lang != 'common') {
                group_by_localisation = _.filter(
                    req.contentType.field_groups,
                    function (o) {
                        return o.localisation == true
                    }
                )
            } else {
                group_by_localisation = _.filter(
                    req.contentType.field_groups,
                    function (o) {
                        return o.localisation == false
                    }
                )
            }
            group_by_localisation.forEach((group) => {
                let fieldsValidationObject = {}
                if (!group.repeater_group) {
                    group.fields.forEach((field) => {
                        const required = field.validation?.required
                            ? '.required()'
                            : `.optional().allow(null,'')`
                        const min = field.validation?.min_length
                            ? `.min(${field.validation.min_length})`
                            : ''
                        const max = field.validation?.max_length
                            ? `.max(${field.validation.max_length})`
                            : ''

                        if (field.field_type == 'media') {
                            _.assign(fieldsValidationObject, {
                                [field.field_name]: eval(
                                    ` Joi.object({
                                        url: Joi.string()${required}.label('${field.field_label}'),
                                        title: Joi.string().allow(null, ''),
                                        alt_text: Joi.string().allow(null, ''),
                                        file_type: Joi.string().allow(null, ''),
                                        link_url: Joi.string().allow(null, ''),
                                        open_link_in_new_tab: Joi.boolean().allow(null, ''),
                                        local_drive: Joi.boolean().allow(null, ''),
                                    })`
                                ),
                            })
                        } else {
                            let fieldType = field.field_type || 'optional'
                            if (field.field_type == 'dropdown') {
                                fieldType = `dropdown_${
                                    field.multi_select ? 'multi' : 'single'
                                }`
                            }
                            let rule = `Joi.${validTypes[fieldType]}${min}${max}${required}.label('${field.field_label}')`
                            _.assign(fieldsValidationObject, {
                                [field.field_name]: eval(rule),
                            })
                        }
                    })
                } else {
                    group.fields.forEach((field) => {
                        const required = field.validation?.required
                            ? '.required()'
                            : `.optional().allow(null,'')`
                        const min = field.validation?.min_length
                            ? `.min(${field.validation.min_length})`
                            : ''
                        const max = field.validation?.max_length
                            ? `.max(${field.validation.max_length})`
                            : ''

                        if (field.field_type == 'media') {
                            /*  ===== BEGIN:: Restructuring the media field array and validation ====
                                 --- Initial Structure ---
                                image: {
                                    url: [
                                        'https://ik.imagekit.io/3olumvfrg/IOTICS-CMS-TEST/Development/Media/72d545e3689a617965b5f03d30fbcbbb_x5VmamuTm',
                                        'https://ik.imagekit.io/iex/woohoo/development/media/4456e5e6f21abb7f6c9c5d93b16fc709_4EhnJgqKy'
                                    ],
                                    title: [ 'ssss', 'ffff' ],
                                    alt_text: [ 'dddd', 'ffff' ]
                                }

                                --- Converted Structure ---

                                image: [
                                    {
                                        url: https://ik.imagekit.io/3olumvfrg/IOTICS-CMS-TEST/Development/Media/72d545e3689a617965b5f03d30fbcbbb_x5VmamuTm',
                                        title: 'ssss',
                                        alt_text: 'ffff'
                                    },
                                    {
                                        url: 'https://ik.imagekit.io/iex/woohoo/development/media/4456e5e6f21abb7f6c9c5d93b16fc709_4EhnJgqKy'
                                        title: 'dddd',
                                        alt_text: 'ffff'
                                    }
                                ]
                            */
                            const mediaArray = []
                            for (
                                let i = 0;
                                i <
                                req.body?.[lang]?.[group.row_name]?.[
                                    field.field_name
                                ]?.['url']?.length;
                                i++
                            ) {
                                const item = {
                                    url: req.body[lang]?.[group.row_name]?.[
                                        field.field_name
                                    ]?.['url']?.[i],
                                    title: req.body?.[lang]?.[group.row_name]?.[
                                        field.field_name
                                    ]?.['title']?.[i],
                                    alt_text:
                                        req.body[lang]?.[group.row_name]?.[
                                            field.field_name
                                        ]?.['alt_text']?.[i],
                                    file_type:
                                        req.body[lang]?.[group.row_name]?.[
                                            field.field_name
                                        ]?.['file_type']?.[i] ?? '',
                                    link_url:
                                        req.body[lang]?.[group.row_name]?.[
                                            field.field_name
                                        ]?.['link_url']?.[i] ?? '',
                                    open_link_in_new_tab:
                                        req.body[lang]?.[group.row_name]?.[
                                            field.field_name
                                        ]?.['open_link_in_new_tab']?.[i] ??
                                        false,
                                    local_drive:
                                        req.body[lang]?.[group.row_name]?.[
                                            field.field_name
                                        ]?.['local_drive']?.[i] ?? undefined,
                                }
                                mediaArray.push(item) // Add the object to the array
                            }
                            if (req.body?.[lang]?.[group.row_name]) {
                                req.body[lang][group.row_name][
                                    field.field_name
                                ] = mediaArray
                            }
                            _.assign(fieldsValidationObject, {
                                [field.field_name]: eval(
                                    ` Joi.array().items(Joi.object({
                                        url: Joi.string()${required}.label('${field.field_label}'),
                                        title: Joi.string().allow(null, ''),
                                        alt_text: Joi.string().allow(null, ''),
                                        file_type: Joi.string().allow(null, ''),
                                        link_url: Joi.string().allow(null, ''),
                                        open_link_in_new_tab: Joi.boolean().allow(null, ''),
                                        local_drive: Joi.boolean().allow(null, ''),
                                    }))`
                                ),
                            })
                            // END:: Restructuring the media field array and validation
                        } else {
                            let fieldType = field.field_type || 'optional'
                            if (field.field_type == 'dropdown') {
                                fieldType = `dropdown_${
                                    field.multi_select ? 'multi' : 'single'
                                }`
                            }
                            _.assign(fieldsValidationObject, {
                                [field.field_name]: eval(
                                    ` Joi.array().items(Joi.${validTypes[fieldType]}${min}${max}${required}).label('${field.field_label}')`
                                ),
                            })
                        }
                    })
                }

                fieldGroupValidationObj[group.row_name] = Joi.object(
                    fieldsValidationObject
                )
            })
            validationSchema[lang] = Joi.object(fieldGroupValidationObj)
        })
        // END:: Generating content field validation rule for content type

        // BEGIN:: Validation rule
        const schema = Joi.object({
            _id: Joi.optional(),
            slug: req.contentType.has_slug
                ? Joi.string().required()
                : Joi.string().optional(),
            ...validationSchema,
            form: Joi.optional(),
            attached_type: Joi.optional(),
            meta: Joi.object().optional().allow(null, ''),
            status: Joi.string()
                .valid('published', 'unpublished', 'scheduled')
                .required()
                .messages({
                    'any.only': 'Content status is a required field',
                }),
            cms_publish_start: Joi.date().allow(null, ''),
            cms_publish_end: Joi.date().allow(null, ''),
            position: Joi.number().optional(),
        }).unknown()
        // END:: Validation rule

        const validationResult = schema.validate(req.body, {
            abortEarly: false,
        })

        if (validationResult.error) {
            return res.status(422).json(validationResult.error)
        }

        // BEGIN: Restructuring repeating array fields to Array of Objects and replacing it to `request.body` object to insert.
        language_prefixes.forEach((lang) => {
            let fieldGroupValidationObj = {}
            let repeater_group_by_localisation
            if (lang != 'common') {
                repeater_group_by_localisation = _.filter(
                    req.contentType.field_groups,
                    function (o) {
                        return (
                            o.localisation == true && o.repeater_group == true
                        )
                    }
                )
            } else {
                repeater_group_by_localisation = _.filter(
                    req.contentType.field_groups,
                    function (o) {
                        return (
                            o.localisation == false && o.repeater_group == true
                        )
                    }
                )
            }

            repeater_group_by_localisation.forEach((eachFieldGroup) => {
                if (content_to_insert[lang]?.[eachFieldGroup.row_name]) {
                    const repeater_field_keys = Object.keys(
                        content_to_insert[lang][eachFieldGroup.row_name]
                    )
                    const content_to_change = []
                    const total_items_in_each_field =
                        content_to_insert[lang][eachFieldGroup.row_name][
                            repeater_field_keys[0]
                        ].length
                    for (let i = 0; i < total_items_in_each_field; i++) {
                        const obj = {}
                        eachFieldGroup.fields.forEach((eachField) => {
                            obj[eachField.field_name] =
                                content_to_insert[lang][
                                    eachFieldGroup.row_name
                                ][eachField.field_name][i]
                        })
                        content_to_change.push(obj)
                    }
                    content_to_insert[lang][eachFieldGroup.row_name] =
                        content_to_change
                }
            })
        })
        // console.log(content_to_insert.ar.featured_blocks)
        // return false
        // END: Restructuring repeating array fields to Array of Objects and replacing it to `request.body` object to insert.

        // return false
        let data = {
            type_id: type._id,
            type_slug: type.slug,
            author: req.authUser.admin_id,
            brand: req.authUser.brand._id,
            form: body?.form || null, // If Requested content type has form required
            country: req.authUser.brand.country,
            status: body.status,
            scheduled_at: {
                start: req.body.cms_publish_start,
                end: req.body.cms_publish_end,
            },
            position: Number(body.position) > 0 ? Number(body.position) : 100,
            // template_name: type.template_name,
            content: content_to_insert,
            meta: body.meta,
            // group_content: fieldGroupData,
            // meta: metaData,
            // in_home: body.in_home || false,
        }

        // console.log(data)
        // //  console.log(req.body)
        // return false

        if (
            Object?.keys(body.attached_type ? body.attached_type : {})?.length
        ) {
            attachedData = []
            Object.keys(body.attached_type).map((item) => {
                const itemDataType = typeof body.attached_type[item]
                if (body.attached_type?.[item]?.length) {
                    let obj = {
                        content_type: item,
                        items:
                            itemDataType == 'string'
                                ? body.attached_type[item].split(',')
                                : body.attached_type[item],
                    }
                    attachedData.push(obj)
                }
            })
            if (attachedData.length) {
                data.attached_type = attachedData
            }
        }
        // const brandCode = req.authUser.brand?.code
        const countryCode = req.authUser.brand?.country_code

        if (req.body._id) {
            data.slug = req.body.slug
                ? slugify(req.body.slug).toLowerCase()
                : undefined

            const existingContent = await Content.findOne({
                _id: req.body._id,
                deleted: { $ne: true },
            })

            data.last_edited_user = req.authUser.admin_id
            data.author = existingContent.author
                ? existingContent.author
                : req.authUser.admin_id
            data.revisions = getRevisionObject(existingContent, req.authUser)

            const collection_cache_key = `${envConfig.cache.CACHE_KEY_PREFIX}-content-${req.authUser.brand.code}-${countryCode}-${type.slug}`
            const single_item_cache_key = `${envConfig.cache.CACHE_KEY_PREFIX}-content-${req.authUser.brand.code}-${countryCode}-${type.slug}-${existingContent.slug}`
            // Update content
            await Content.updateOne(
                { _id: req.body._id, deleted: { $ne: true } },
                data
            )
            Redis.removeCache([collection_cache_key, single_item_cache_key])
            return res.status(201).json({
                message: 'Content updated successfully',
                redirect_to: `/admin/cms/${type.slug}`,
            })
        } else {
            data.slug = req.body.slug ? slugify(req.body.slug) : undefined
            // Create content
            const save = await Content.create(data)
            if (!save?._id) {
                return res.status(400).json({ error: 'Something went wrong' })
            }
            const collection_cache_key = `${envConfig.cache.CACHE_KEY_PREFIX}-content-${req.authUser.brand.code}-${countryCode}-${type.slug}`
            Redis.removeCache([collection_cache_key])
            return res.status(200).json({
                message: 'Content added successfully',
                // redirect_to: `/admin/cms/${type.slug}/detail/${save._id}`,
                redirect_to: `/admin/cms/${type.slug}`,
            })
        }
    } catch (error) {
        logError(error)
        return res.status(400).json({ error: 'Something went wrong' })
    }
}

const loadEditorData = async (req, res) => {
    try {
        const contentDetail = await Content.findOne({
            _id: req.params.id,
            type_id: req.contentType._id,
            // brand: session.brand._id,
            country: req.authUser.brand.country,
            deleted: { $ne: true },
        })
        // const html_data = await HtmlBuilder.findOne({
        //     _id: req.params.id,
        // })
        const lang_content = contentDetail.content[req.query.lang]
        return res.status(200).json(lang_content)
    } catch (error) {
        logError(error)
        return res.status(500).json(`Something went wrong`)
    }
}

const pageBuildEditor = async (req, res) => {
    try {
        const page_id = req.params.id
        const language = collect(req.authUser.brand.languages)
            .where('prefix', req.query.lang)
            .first()
        if (!language) {
            return res.render(`admin-njk/page-error-404`)
        }
        return res.render('admin-njk/cms/content/html-builder/editor', {
            reqContentType: req.contentType,
            page_id,
            lang: req.query.lang,
        })
    } catch (error) {
        logError(error)
        return res.render(`admin-njk/app-error-500`)
    }
}

const savePageBuilderData = async (req, res) => {
    try {
        const languages = collect(req.authUser.brand.languages)
            .pluck('prefix')
            .toArray()
        // BEGIN:: Validation rule
        const schema = Joi.object({
            id: Joi.optional(),
            lang: Joi.string()
                .required()
                .valid(...languages),
        }).unknown()
        // END:: Validation rule

        const validationResult = schema.validate(req.body, {
            abortEarly: false,
        })

        if (validationResult.error) {
            return res.status(422).json(validationResult.error)
        }

        const page = await Content.findOne({
            _id: req.body.id,
            deleted: { $ne: true },
        })
        if (!page) {
            return res.status(404).json({
                error: 'Content Not Found',
            })
        }
        await Content.updateOne(
            {
                _id: req.body.id,
                deleted: { $ne: true },
            },
            {
                $set: {
                    [`content.${req.body.lang}`]: {
                        name: page.content.name,
                        html: req.body.html,
                        css: req.body.css,
                    },
                },
            }
        )

        return res.status(200).json('Saved')
    } catch (error) {
        logError(error)
        return res.status(500).json(`Something went wrong`)
    }
}

const previewPageBuildData = async (req, res) => {
    try {
        const html_data = await Content.findOne({
            _id: req.params.id,
            deleted: { $ne: true },
        })
        return res.render('admin-njk/cms/content/html-builder/view', {
            html_data: html_data.content[req.query.lang],
        })
    } catch (error) {
        logError(error)
        return res.render(`admin-njk/app-error-500`)
    }
}

module.exports = {
    list,
    detail,
    edit,
    deleteContent,
    changeStatus,
    add,
    save,
    loadEditorData,
    pageBuildEditor,
    savePageBuilderData,
    previewPageBuildData,
    duplicateContent,
}
