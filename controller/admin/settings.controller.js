const envConfig = require('../../config/env.config')
const Joi = require('joi')
const fs = require('fs')
const _ = require('lodash')
const collect = require('collect.js')
const Brand = require('../../model/Brand')
const Country = require('../../model/Country')
const Settings = require('../../model/Settings')
const Redis = require('../../helper/Redis.helper')
const Admin = require('../../model/Admin')
const { getBrandSettings } = require('../../helper/Cache.helper')
const { getCountry, getBrand } = require('../../helper/Cache.helper')

const switchBrand = async (req, res) => {
    try {
        if (req.query.b && req.query.d) {
            const session = req.authUser

            const country = await getCountry({
                query: {
                    country: req.query.d,
                },
            })
            const brand = await getBrand(
                {
                    query: {
                        brand: req.query.b,
                    },
                },
                country
            )
            const settings = await getBrandSettings(brand, country)

            session.brand = {
                _id: brand?._id,
                name: brand?.name,
                code: brand.code,
                languages: brand?.languages,
                country: country?._id,
                country_name: country?.name.en,
                country_code: req.query?.d,
                country_currency: country?.currency,
                country_currency_symbol: country?.currency_symbol,
                currency_decimal_points: country?.currency_decimal_points,
                country_object: country,
                settings: settings ? settings : {},
            }

            // Save session (if using a session store)
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err)
                    return res.render('admin-njk/app-error-500')
                }
                // Redirect after session is successfully saved
                return res.redirect('back')
            })
        } else {
            return res.redirect('back')
        }
    } catch (error) {
        console.log(error)
        return res.render(`admin-njk/app-error-500`)
    }
}

// General settings
const generalList = async (req, res) => {
    try {
        const session = req.authUser
        const country = session.brand.country
        const brand = await Brand.findOne({
            _id: session.brand._id,
            'domains.country': session.brand.country,
        }).populate('domains.country')
        let domain = {}
        if (brand?._id) {
            domain = brand.domains.find(
                (dom) => dom.country?._id.toString() == country
            )
        }
        const domains = collect(brand.domains).sortBy('country.position').all()
        return res.render('admin-njk/settings/general/listing', {
            domain,
            brand,
            domains,
        })
    } catch (error) {
        return res.render(`admin-njk/app-error-500`)
    }
}
// Render logo edit form
const editLogo = async (req, res) => {
    try {
        const session = req.authUser
        let data
        let isBrand = false
        if (req.query.brand == 'true') {
            data = await Brand.findOne({
                _id: session.brand._id,
            })
            isBrand = true
        } else if (req.query.domain == 'true') {
            const country = req.params.id
            const brand = await Brand.findOne({
                _id: session.brand._id,
                'domains.country': country,
            }).populate('domains.country')

            if (brand?._id) {
                data = brand.domains.find(
                    (dom) => dom.country?._id.toString() == country
                )
            }
        }
        return res.render('admin-njk/settings/general/edit-logo-form', {
            data,
            isBrand,
        })
    } catch (error) {
        return res.render(`admin-njk/app-error-500`)
    }
}

// Change logo
const changeLogo = async (req, res) => {
    try {
        const session = req.authUser
        let bilingualFields = ['name', 'image']
        let bilingualValidationObj = {}
        req.authUser?.brand?.languages.forEach((lang) => {
            bilingualFields.forEach((field) => {
                if (field === 'image') {
                    bilingualValidationObj[field] = {
                        ...bilingualValidationObj[field],
                        [lang.prefix]: Joi.object({
                            media_url: Joi.string().required(),
                            title: Joi.optional(),
                            alt_text: Joi.optional(),
                        }).unknown(true),
                    }
                } else {
                    bilingualValidationObj[field] = {
                        ...bilingualValidationObj[field],
                        [lang.prefix]: Joi.string().required(),
                    }
                }
            })
        })
        const schema = Joi.object({
            name: bilingualValidationObj.name,
            image: bilingualValidationObj.image,
            id: Joi.optional(),
            is_brand: Joi.optional(),
        })

        const validationResult = schema.validate(req.body, {
            abortEarly: false,
        })

        if (validationResult.error) {
            return res.status(422).json(validationResult.error)
        }

        let update
        if (req.body.is_brand == 'true') {
            update = await Brand.findOneAndUpdate(
                {
                    _id: session.brand._id,
                },
                {
                    $set: {
                        logo: req.body.image,
                    },
                }
            )
        } else {
            update = await Brand.findOneAndUpdate(
                {
                    _id: session.brand._id,
                    'domains.country': req.body.id,
                },
                {
                    $set: {
                        [`domains.$.logo`]: req.body.image,
                    },
                }
            )
        }

        if (!update?._id) {
            return res.status(400).json({ error: 'Something went wrong' })
        }
        return res.status(200).json({ message: 'Logo changed' })
    } catch (error) {
        return res.status(400).json({ error: 'Something went wrong' })
    }
}

const changeBrandStatus = async (req, res) => {
    try {
        const session = req.authUser
        const keys = {
            1: 'maintenance_mode',
            2: 'ecommerce_maintenance_mode',
        }
        const update = await Brand.findOneAndUpdate(
            {
                _id: session.brand._id,
                'domains.country': session.brand.country,
            },
            {
                $set: {
                    [`domains.$.${keys[req.body.mode]}`]: !req.body.status,
                },
            }
        )
        if (!update?._id) {
            return res.status(400).json({ error: 'Something went wrong' })
        }
        return res.status(200).json({ message: ' Status changed' })
    } catch (error) {
        return res.status(400).json({ error: 'Something went wrong' })
    }
}

const clearCache = async (req, res) => {
    // Redis.flushCache()
    await Redis.clearCacheAll() // Removing all caches except user tokens
    return res.status(200).json({ message: 'Cache cleared' })
}

// SEO settings
const seoList = async (req, res) => {
    try {
        const session = req.authUser
        const brand = await Brand.findOne({
            _id: session.brand._id,
            'domains.country': session.brand.country,
        }).populate('domains.country')
        let data = {}
        if (brand?._id) {
            data = brand.domains.find(
                (dom) =>
                    dom.country?._id.toString() ==
                    session.brand.country.toString()
            )
        }
        return res.render('admin-njk/settings/seo/list', { data })
    } catch (error) {
        return res.render(`admin-njk/app-error-500`)
    }
}
const seoEdit = async (req, res) => {
    try {
        const session = req.authUser
        const brand = await Brand.findOne({
            _id: session.brand._id,
            'domains.country': session.brand.country,
        }).populate('domains.country')
        let data = {}
        if (brand?._id) {
            data = brand.domains.find(
                (dom) =>
                    dom.country?._id.toString() ==
                    session.brand.country.toString()
            )
        }
        return res.render('admin-njk/settings/seo/form', { data })
    } catch (error) {
        return res.render(`admin-njk/app-error-500`)
    }
}

const seoSave = async (req, res) => {
    try {
        const session = req.authUser

        let bilingualFields = ['title', 'description', 'keywords', 'image']
        let bilingualValidationObj = {}
        req.authUser?.brand?.languages.forEach((lang) => {
            bilingualFields.forEach((field) => {
                if (field === 'image') {
                    bilingualValidationObj[field] = {
                        ...bilingualValidationObj[field],
                        [lang.prefix]: Joi.object({
                            media_url: Joi.string().required(),
                            title: Joi.optional(),
                            alt_text: Joi.optional(),
                        }).unknown(true),
                    }
                } else {
                    bilingualValidationObj[field] = {
                        ...bilingualValidationObj[field],
                        [lang.prefix]: Joi.string().required(),
                    }
                }
            })
        })

        const schema = Joi.object({
            title: bilingualValidationObj.title,
            description: bilingualValidationObj.description,
            keywords: bilingualValidationObj.keywords,
            image: bilingualValidationObj.image,
        })

        const validationResult = schema.validate(req.body, {
            abortEarly: false,
        })

        if (validationResult.error) {
            return res.status(422).json(validationResult.error)
        }

        let body = req.body

        // Getting multi language data dynamically
        let bilingualData = {}
        bilingualFields.forEach((field) => {
            bilingualData[field] = {}
            req.authUser.brand.languages.forEach((lang) => {
                bilingualData[field][lang.prefix] = body[field]?.[lang.prefix]
            })
        })

        const obj = {
            title: bilingualData.title,
            description: bilingualData.description,
            keywords: bilingualData.keywords,
            og_image: bilingualData.image,
        }

        const update = await Brand.findOneAndUpdate(
            {
                _id: session.brand._id,
                'domains.country': session.brand.country,
            },
            {
                $set: {
                    [`domains.$.meta`]: obj,
                },
            }
        )

        if (!update?._id) {
            return res.status(400).json({ error: 'Not updated' })
        }
        return res.status(200).json({ message: 'Settings updated' })
    } catch (error) {
        console.log('error :>> ', error)
        return res.status(400).json({ error: 'Something went wrong' })
    }
}

// Marketing settings
const marketingList = async (req, res) => {
    try {
        const session = req.authUser
        const brand = await Brand.findOne({
            _id: session.brand._id,
        })

        return res.render('admin-njk/settings/marketing/list', { data: brand })
    } catch (error) {
        return res.render(`admin-njk/app-error-500`)
    }
}
const marketingEdit = async (req, res) => {
    try {
        const session = req.authUser
        const brand = await Brand.findOne({
            _id: session.brand._id,
        })
        return res.render('admin-njk/settings/marketing/form', { data: brand })
    } catch (error) {
        return res.render(`admin-njk/app-error-500`)
    }
}

const marketingSave = async (req, res) => {
    try {
        const session = req.authUser
        const schema = Joi.object({
            gtm_id: Joi.string().required().allow(''),
            google_analytics_id: Joi.string().required().allow(''),
            google_token: Joi.string().required().allow(''),
        })

        const validationResult = schema.validate(req.body, {
            abortEarly: false,
        })

        if (validationResult.error) {
            return res.status(422).json(validationResult.error)
        }

        let body = req.body
        const brand = session.brand._id

        const obj = {
            gtm_id: body.gtm_id,
            google_analytics_id: body.google_analytics_id,
            google_token: body.google_token,
        }

        const update = await Brand.findOneAndUpdate(
            {
                _id: brand,
            },
            {
                $set: {
                    marketing: obj,
                },
            }
        )

        if (!update?._id) {
            return res.status(400).json({ error: 'Not updated' })
        }
        return res.status(200).json({ message: 'Settings updated' })
    } catch (error) {
        return res.status(400).json({ error: 'Something went wrong' })
    }
}

// Ecommerce Settings
const ecommerceList = async (req, res) => {
    try {
        const session = req.authUser
        const settings = await Settings.findOne({
            brand: session.brand._id,
            country: session.brand.country,
        })
        return res.render('admin-njk/settings/ecommerce/listing', {
            data: settings?.ecommerce_settings || {},
        })
    } catch (error) {
        return res.render(`admin-njk/app-error-500`)
    }
}
const invoiceEdit = async (req, res) => {
    try {
        const session = req.authUser
        const settings = await Settings.findOne({
            brand: session.brand._id,
            country: session.brand.country,
        })
        return res.render('admin-njk/settings/ecommerce/edit-invoice', {
            data: settings?.ecommerce_settings || {},
        })
    } catch (error) {
        return res.render(`admin-njk/app-error-500`)
    }
}

const invoiceSave = async (req, res) => {
    try {
        const session = req.authUser
        let addressValidationObj = {}
        let termsValidationObj = {}
        let footerValidationObj = {}
        req?.authUser?.brand?.languages.forEach((lang) => {
            _.assign(addressValidationObj, {
                [lang.prefix]: eval(`Joi.string().required()`),
            })
            _.assign(termsValidationObj, {
                [lang.prefix]: eval(`Joi.string().required()`),
            })
            _.assign(footerValidationObj, {
                [lang.prefix]: eval(` Joi.string().required()`),
            })
        })
        const schema = Joi.object({
            invoice_address: Joi.object({
                ...addressValidationObj,
            }),
            terms_and_conditions: Joi.object({
                ...termsValidationObj,
            }),
            footer_text: Joi.object({
                ...footerValidationObj,
            }),
            frontend_url: Joi.string().required(),
            trn_number: Joi.string().required(),
            vat_percentage: Joi.number().required().max(99),
        })

        const validationResult = schema.validate(req.body, {
            abortEarly: false,
        })

        if (validationResult.error) {
            return res.status(422).json(validationResult.error)
        }

        let body = req.body

        // Update settings
        const update = await Settings.findOneAndUpdate(
            {
                brand: session.brand._id,
                country: session.brand.country,
            },
            {
                $set: {
                    'ecommerce_settings.invoice_address': body.invoice_address,
                    'ecommerce_settings.terms_and_conditions':
                        body.terms_and_conditions,
                    'ecommerce_settings.footer_text': body.footer_text,
                    'ecommerce_settings.trn_number': body.trn_number,
                    'ecommerce_settings.frontend_url': body.frontend_url,
                    'ecommerce_settings.vat_percentage': parseFloat(
                        body.vat_percentage
                    ),
                },
            },
            {
                new: true,
                upsert: true,
            }
        )

        await removeCache(
            `${envConfig.cache.CACHE_KEY_PREFIX}-brand-settings-${session.brand.code}-${session.brand.country?.code}`
        )
        session.brand.settings = update
        return res.status(200).json({ message: 'Settings updated' })
    } catch (error) {
        return res.status(400).json({ error: 'Something went wrong' })
    }
}

// Notification Settings
const notificationList = async (req, res) => {
    try {
        const session = req.authUser
        const settings = await Settings.findOne({
            brand: session.brand._id,
            country: session.brand.country,
        })
        return res.render('admin-njk/settings/notification/listing', {
            data: settings?.notification_settings || {
                mailgun: {},
                sms: {},
                communication_channels: {},
            },
        })
    } catch (error) {
        return res.render(`admin-njk/app-error-500`)
    }
}

const editNotificationSettings = async (req, res) => {
    try {
        const session = req.authUser
        const settings = await Settings.findOne({
            brand: session.brand._id,
            country: session.brand.country,
        })
        return res.render('admin-njk/settings/notification/edit', {
            title: req.params.type.replace('_', ' ').toUpperCase(),
            type: req.params.type,
            data: settings?.notification_settings || {
                mailgun: {},
                sms: {},
            },
        })
    } catch (error) {
        return res.render(`admin-njk/app-error-500`)
    }
}
const saveNoticationSettings = async (req, res) => {
    try {
        let session = req.authUser
        let body = req.body
        let schema
        if (body.type == 'sms') {
            schema = Joi.object({
                type: Joi.string(),
                sender_id: Joi.string().required(),
                username: Joi.string().required(),
                password: Joi.string().required(),
            })
        } else if (body.type == 'communication_channels') {
            schema = Joi.object({
                type: Joi.string().required(),
                email: Joi.string().required(),
            })
        } else if (body.type == 'mailgun') {
            schema = Joi.object({
                type: Joi.string(),
                from: Joi.string().required(),
                domain: Joi.string().required(),
                api_key: Joi.string().required(),
                otp_template: Joi.string().required(),
                forgot_password_template: Joi.string().required(),
                forgot_password_thankyou_template: Joi.string().required(),
                order_complete_template: Joi.string().required(),
                welcome_template: Joi.string().required(),
            })
        } else {
            return res.status(400).json({ error: 'Invalid Type' })
        }

        const validationResult = schema.validate(req.body, {
            abortEarly: false,
        })

        if (validationResult.error) {
            return res.status(422).json(validationResult.error)
        }
        // Update settings
        const update = await Settings.findOneAndUpdate(
            {
                brand: session.brand._id,
                country: session.brand.country,
            },
            {
                $set: {
                    [`notification_settings.${body.type}`]: body,
                },
            },
            {
                new: true,
                upsert: true,
            }
        )
        await removeCache(
            `${envConfig.cache.CACHE_KEY_PREFIX}-brand-settings-${session.brand.code}-${session.brand.country?.code}`
        )
        session.brand.settings = update
        return res.status(200).json({ message: 'Settings updated' })
    } catch (error) {
        return res.status(400).json({ error: 'Something went wrong' })
    }
}

const saveAdminFBWebToken = async (req, res) => {
    // console.log(req.body.token)
    // console.log(req.authUser)
    try {
        const schema = Joi.object({
            token: Joi.string().required(),
        })

        const validationResult = schema.validate(req.body, {
            abortEarly: false,
        })

        if (validationResult.error) {
            return res.status(422).json(validationResult.error)
        }
        // Update settings
        await Admin.findOneAndUpdate(
            {
                _id: req.authUser.admin_id,
            },
            {
                $push: {
                    firebase_tokens: req.body.token,
                },
            }
        )
        return res.status(200).json({ message: 'Token Saved' })
    } catch (error) {
        return res.status(400).json({ error: 'Something went wrong' })
    }
}

module.exports = {
    switchBrand,
    generalList,
    editLogo,
    changeLogo,
    changeBrandStatus,
    clearCache,
    seoList,
    seoEdit,
    seoSave,
    marketingList,
    marketingEdit,
    marketingSave,
    ecommerceList,
    invoiceEdit,
    invoiceSave,
    notificationList,
    editNotificationSettings,
    saveNoticationSettings,
    saveAdminFBWebToken,
}
