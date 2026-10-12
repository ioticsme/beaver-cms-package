const envConfig = require('../../config/env.config')
const _ = require('lodash')
const slugify = require('slugify')
const Joi = require('joi')
const formData = require('form-data')
const collect = require('collect.js')
const { v4: uuidv4 } = require('uuid')
const Mailgun = require('mailgun.js')
const Excel = require('exceljs/dist/es5')

const Config = require('../../model/Config')
const CustomForm = require('../../model/CustomForm')
const ContentType = require('../../model/ContentType')
const CustomFormData = require('../../model/CustomFormData')
const { mailGunTemplates } = require('../../helper/Mailgun.helper')
const { formatInTimeZone } = require('date-fns-tz')
const { format } = require('date-fns')

let session

const FIELD_TYPES = [
    {
        label: 'Textfield',
        type: 'textfield',
    },
    {
        label: 'Email',
        type: 'email',
    },
    {
        label: 'Phone',
        type: 'phone',
    },
    {
        label: 'Date',
        type: 'date',
    },
    {
        label: 'Dropdown',
        type: 'dropdown',
    },
    {
        label: 'Textarea',
        type: 'textarea',
    },
    {
        label: 'Radio',
        type: 'radio',
    },
    {
        label: 'Checkbox',
        type: 'checkbox',
    },
    {
        label: 'Terms',
        type: 'terms',
    },
    {
        label: 'Hidden',
        type: 'hidden',
    },
    {
        label: 'Content Type',
        type: 'content_type',
    },
]

const list = async (req, res) => {
    try {
        session = req.authUser

        const forms = await CustomForm.find({
            brand: session.brand._id,
            country: session.brand.country,
            deleted: { $ne: true },
        })
        return res.render(`admin-njk/custom-forms/listing`, {
            data: forms,
        })
    } catch (error) {
        return res.render(`admin-njk/app-error-500`)
    }
}

const edit = async (req, res) => {
    try {
        session = req.authUser
        const form = await CustomForm.findOne({
            _id: req.params.id,
            brand: session.brand._id,
            country: session.brand.country,
            deleted: { $ne: true },
        })
        const contentTypes = await ContentType.find()
        const config = await Config.findOne()
        // const domainTemplates = await mailGunTemplates(
        //     req.brand?.settings?.notification_settings?.mailgun
        // )

        return res.render(`admin-njk/custom-forms/edit`, {
            form,
            // domainTemplates,
            field_types: FIELD_TYPES,
            contentTypes,
            has_email_config:
                config.email_settings.default_channel != 'none' ? true : false,
        })
    } catch (error) {
        console.log(error)
        return res.render(`admin-njk/app-error-500`)
    }
}
const viewAPI = async (req, res) => {
    try {
        session = req.authUser
        const form = await CustomForm.findOne({
            _id: req.params.id,
            brand: session.brand._id,
            country: session.brand.country,
            deleted: { $ne: true },
        })
            .populate('brand')
            .populate('country')
        // const domainTemplates = await mailGunTemplates(
        //     req.brand?.settings?.notification_settings?.mailgun
        // )

        const protocol = req.protocol // 'http' or 'https'
        const host = req.get('host') // Includes hostname and port
        const fullDomain = `${protocol}://${host}` // Construct full domain

        // const test =
        let api_body = {}
        api_body['type'] = form.type
        form.fields.forEach((field) => {
            if (field.validation.data_type == 'number') {
                api_body[field.field_name] = 12
            } else if (field.validation.data_type == 'boolean') {
                api_body[field.field_name] = true
            } else {
                api_body[field.field_name] = 'sample value'
            }
        })

        const sampleAPI = `
const axios = require('axios');
const qs = require('qs');
let data = qs.stringify(${JSON.stringify(api_body)});

let config = {
  method: 'post',
  maxBodyLength: Infinity,
  url: '${fullDomain}/api/custom-forms/submit',
  headers: { 
    'brand': '${form.brand.code}', 
    'locale': '${req.authUser.brand.languages[0].prefix}-${form.country.code}', 
    'Content-Type': 'application/x-www-form-urlencoded'
  },
  data : data
};

axios.request(config)
.then((response) => {
  console.log(JSON.stringify(response.data));
})
.catch((error) => {
  console.log(error);
});
`

        return res.render(`admin-njk/custom-forms/view-api`, {
            api_body: JSON.stringify(api_body),
            fullDomain,
            form,
            sampleAPI,
        })
    } catch (error) {
        console.log(error)
        return res.render(`admin-njk/app-error-500`)
    }
}

const add = async (req, res) => {
    try {
        session = req.authUser
        let domainTemplates = []
        // domainTemplates = await mailGunTemplates()
        domainTemplates = []
        const contentTypes = await ContentType.find()
        const config = await Config.findOne()
        return res.render(`admin-njk/custom-forms/add`, {
            field_types: FIELD_TYPES,
            domainTemplates,
            contentTypes,
            has_email_config:
                config.email_settings.default_channel != 'none' ? true : false,
        })
    } catch (error) {
        console.log(error)
        return res.render(`admin-njk/app-error-500`)
    }
}

const save = async (req, res) => {
    try {
        // console.log(req.body)
        session = req.authUser
        // BEGIN:: Validation rule
        const schema = Joi.object({
            id: Joi.optional().allow(null, ''),
            // custom_fields: Joi.optional(),
            form_name: Joi.object({
                en: Joi.string().required(),
                ar: Joi.string().required(),
            }).required(),
            form_title: Joi.object({
                en: Joi.string().required(),
                ar: Joi.string().required(),
            }).required(),
            description: Joi.object({
                en: Joi.string().optional().allow(null, ''),
                ar: Joi.string().optional().allow(null, ''),
            })
                .optional()
                .allow(null, ''),
            cta_label: Joi.object({
                en: Joi.string().required(),
                ar: Joi.string().required(),
            }).required(),
            tnc: Joi.object({
                en: Joi.string().optional().allow(null, ''),
                ar: Joi.string().optional().allow(null, ''),
            })
                .optional()
                .allow(null, ''),
            auto_reply_email_template: Joi.string().optional().allow(null, ''),
            auto_reply_email_subject: Joi.string().optional().allow(null, ''),
            store_in_db: Joi.boolean().optional().allow(null, ''),
            recipient_emails: Joi.string().optional().allow(null, ''),
            recipient_email_template: Joi.string().optional().allow(null, ''),
            recipient_email_subject: Joi.string().optional().allow(null, ''),
            success_message: Joi.string().optional().allow(null, ''),
            slack_url: Joi.string().optional().allow(null, ''),
            web_hook: Joi.string().optional().allow(null, ''),
            form_load_mode: Joi.string().optional().allow(null, ''),
            enable_captcha: Joi.boolean().optional().allow(null, ''),
            redirect_url: Joi.string().optional().allow(null, ''),
            field_label: Joi.object({
                en: Joi.array().items(Joi.string()).required(),
                ar: Joi.array().items(Joi.string()).required(),
            }).required(),
            field_name: Joi.array().items(Joi.string().allow('')),
            field_type: Joi.array().items(Joi.optional()).required(),
            content_type: Joi.array().items(Joi.optional()).required(),
            field_default_val: Joi.object({
                en: Joi.array().items(Joi.optional()).optional(),
                ar: Joi.array().items(Joi.optional()).optional(),
            }).optional(),
            field_values: Joi.object({
                en: Joi.array().items(Joi.optional()).optional(),
                ar: Joi.array().items(Joi.optional()).optional(),
            }).optional(),
            field_show_in_list: Joi.array()
                .items(Joi.boolean().optional())
                .optional(),
            use_for_notification: Joi.array()
                .items(Joi.boolean().optional())
                .optional(),
            position: Joi.array().items(Joi.number().optional()).optional(),
            field_validation_mandatory: Joi.array()
                .items(Joi.string().required())
                .required(),
            field_validation_type: Joi.array().items(Joi.string()).required(),
            field_validation_min_length: Joi.array()
                .items(Joi.string().allow(null, ''))
                .optional()
                .allow(null, ''),
            field_validation_max_length: Joi.array()
                .items(Joi.string().allow(null, ''))
                .optional()
                .allow(null, ''),
            field_enable: Joi.array()
                .items(Joi.boolean().allow(null, ''))
                .optional()
                .allow(null, ''),
        })

        const validationResult = schema.validate(req.body, {
            abortEarly: false,
        })

        if (validationResult.error) {
            res.status(422).json(validationResult.error)
            return
        }

        const form_fields = []
        const input = req.body
        for (let i = 0; i < input.field_name.length; i++) {
            let field_obj = {
                field_label: {
                    en: input.field_label.en[i],
                    ar: input.field_label.ar[i],
                },
                field_name: input.field_name[i]
                    ? input.field_name[i]
                    : uuidv4().replace(/-/g, '_'),
                field_type: input.field_type[i],
                field_default_val: {
                    en: input.field_default_val.en[i],
                    ar: input.field_default_val.ar[i],
                },
                field_values: {
                    en: input.field_values.en[i]?.split(','),
                    ar: input.field_values.ar[i]?.split(','),
                },
                content_type: input.content_type[i]
                    ? input.content_type[i]
                    : null,
                field_show_in_list: input.field_show_in_list?.[i] == 'true',
                use_for_notification: input.use_for_notification?.[i] ?? false,
                position: input.position?.[i] ?? 0,
                validation: {
                    required: input.field_validation_mandatory[i],
                    data_type: input.field_validation_type[i],
                    min_length: input.field_validation_min_length[i],
                    max_length: input.field_validation_max_length[i],
                },
            }
            form_fields.push(field_obj)
        }

        // console.log(form_fields)

        let body = req.body
        let isEdit = body.id ? true : false

        if (!isEdit) {
            const isExist = await CustomForm.findOne({
                type: slugify(body.form_name.en.toLowerCase()),
                deleted: { $ne: true },
            })
            if (isExist) {
                return res
                    .status(404)
                    .json({ error: 'Custom Form already exist' })
            }
        }

        // Data object to insert
        let data = {
            form_name: input.form_name,
            form_title: input.form_title,
            description: input.description,
            tnc: input.tnc,
            cta_label: input.cta_label,
            type: slugify(input.form_name.en.toLowerCase()),
            auto_reply_email_template: input.auto_reply_email_template,
            auto_reply_email_subject: input.auto_reply_email_subject,
            store_in_db: input.store_in_db ?? false,
            recipient_emails: input.recipient_emails,
            recipient_email_template: input.recipient_email_template,
            recipient_email_subject: input.recipient_email_subject,
            slack_url: input.slack_url,
            success_message: input.success_message,
            web_hook: input.web_hook,
            form_load_mode: input.form_load_mode,
            is_captcha_required: input.is_captcha_required == 'true',
            fields: form_fields,
            brand: session.brand._id,
            country: session.brand.country,
        }

        if (isEdit) {
            // Update banner
            const update = await CustomForm.updateOne(
                { _id: body.id, deleted: { $ne: true } },
                data
            )
            return res
                .status(201)
                .json({ message: 'Custom Form updated successfully' })
        } else {
            // Create CustomForm
            const save = await CustomForm.create(data)
            if (!save?._id) {
                return res.status(400).json({ error: 'Something went wrong' })
            }
            return res
                .status(200)
                .json({ message: 'Custom Form added successfully' })
        }
    } catch (error) {
        console.log(error)
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
        // Update
        const update = await CustomForm.findOneAndUpdate(
            {
                _id: id,
                brand: req.authUser.brand._id,
                country: req.authUser.brand.country,
                deleted: { $ne: true },
            },
            {
                $set: {
                    published: !status,
                },
            }
        )
        // If not updated
        if (!update?._id) {
            return res.status(404).json({ error: 'Something went wrong' })
        }
        return res.status(200).json({
            message: 'Custom Form status changed',
        })
    } catch (error) {
        return res.status(500).json({ error: 'Something went wrong' })
    }
}

const deleteForm = async (req, res) => {
    try {
        const { id } = req.body
        // If id not found
        if (!id) {
            return res.status(404).json({ error: 'Id not found' })
        }

        await CustomForm.updateOne(
            {
                _id: id,
                brand: req.authUser.brand._id,
                country: req.authUser.brand.country,
            },
            {
                $set: {
                    deleted: true,
                    deleted_at: new Date(),
                },
            }
        )
        return res.status(200).json({
            message: 'Custom form deleted',
        })
    } catch (error) {
        return res.status(500).json({ error: 'Something went wrong' })
    }
}

const duplicateForm = async (req, res) => {
    try {
        const { id } = req.body
        // If id not found
        if (!id) {
            return res.status(404).json({ error: 'Id not found' })
        }

        const form = await CustomForm.findOne({
            _id: id,
            brand: req.authUser.brand._id,
            country: req.authUser.brand.country,
            deleted: { $ne: true },
        }).lean()
        if (!form) {
            return res.status(404).json({ error: 'Custom form not found' })
        }

        // Find a name whose slug (form type) is not taken yet.
        // The type is derived from form_name.en the same way save() does it.
        let copyNumber = 1
        let form_name, type
        do {
            const suffix = copyNumber > 1 ? ` Copy ${copyNumber}` : ' Copy'
            form_name = {
                ...form.form_name,
                en: `${form.form_name.en}${suffix}`,
                ar: `${form.form_name.ar ?? form.form_name.en}${suffix}`,
            }
            type = slugify(form_name.en.toLowerCase())
            copyNumber++
        } while (
            await CustomForm.exists({ type, deleted: { $ne: true } })
        )

        const { _id, __v, created_at, updated_at, ...formData } = form
        const copy = await CustomForm.create({
            ...formData,
            form_name,
            type,
            // Keep the copy offline until it has been reviewed
            published: false,
            fields: (form.fields || []).map(({ _id, ...field }) => field),
        })

        return res.status(200).json({
            message: 'Custom form duplicated',
            id: copy._id,
            redirect: `/admin/custom-forms/edit/${copy._id}`,
        })
    } catch (error) {
        console.log(error)
        return res.status(500).json({ error: 'Something went wrong' })
    }
}

const viewSubmissions = async (req, res) => {
    try {
        session = req.authUser

        const reqForm = await CustomForm.findOne({
            _id: req.params.id,
            // brand: session.selected_brand._id,
            // country: session.selected_brand.country,
        })
        const submissions = await CustomFormData.find({
            form_id: req.params.id,
            brand: session.brand._id,
            country: session.brand.country,
            deleted: { $ne: true },
        }).sort({ _id: -1 })

        // const fields = form.fields
        let column_to_list = collect(reqForm.fields)
            .where('field_show_in_list', true)
            .all()

        return res.render(`admin-njk/custom-forms/submissions`, {
            data: submissions,
            reqForm: reqForm,
            column_to_list: column_to_list,
        })
    } catch (error) {
        console.log(error)
        return res.render(`admin-njk/app-error-500`)
    }
}

const viewSubmission = async (req, res) => {
    try {
        session = req.authUser

        const customForm = await CustomForm.findOne({
            _id: req.params.formId,
            deleted: { $ne: true },
        })

        if (!customForm) {
            return res.render(`admin-njk/app-error-404`)
        }

        const submission = await CustomFormData.findOne({
            _id: req.params.formDataId,
            form_id: req.params.formId,
        })

        if (!submission) {
            return res.render(`admin-njk/app-error-404`)
        }

        const fieldValues = []
        customForm.fields.forEach((field) => {
            fieldValues.push({
                name: field.field_label.en,
                value: submission.field_values[field.field_name],
            })
        })

        return res.render(`admin-njk/custom-forms/view-submission`, {
            customForm,
            submission,
            fieldValues,
        })
    } catch (error) {
        console.log(error)
        return res.render(`admin-njk/app-error-500`)
    }
}

const deleteSubmissions = async (req, res) => {
    try {
        const { id } = req.body
        // If id not found
        if (!id) {
            return res.status(404).json({ error: 'Id not found' })
        }

        await CustomFormData.deleteOne({
            _id: id,
        })
        return res.status(200).json({
            message: 'Form data deleted',
        })
    } catch (error) {
        console.log(error)
        return res.status(500).json({ error: 'Something went wrong' })
    }
}

const exportSubmissions = async (req, res) => {
    session = req.authUser
    // Create a new workbook
    const workbook = new Excel.Workbook()
    // Add a new worksheet
    const worksheet = workbook.addWorksheet('Submissions')
    try {
        const form = await CustomForm.findOne({
            _id: req.params.id,
            deleted: { $ne: true },
        })
        if (!form) {
            return workbook.xlsx.write(res).then(function () {
                res.status(200).end()
            })
        }

        const submissions = await CustomFormData.find({
            form_id: req.params.id,
        }).sort({ _id: -1 })

        let headers = []
        for (const field of form.fields) {
            headers.push({
                header: field?.field_label?.en,
                key: field?.field_name,
            })
        }

        headers.push({ header: 'Submitted At', key: 'created_at' })

        worksheet.columns = headers

        let timeZone =
            req.authUser?.selected_brand?.country_object?.timezone ||
            'Asia/Dubai'
        submissions.forEach((submission) => {
            let row = []
            headers.forEach((header) => {
                if (header.key == 'created_at') {
                    row.push(
                        formatInTimeZone(
                            submission.created_at,
                            timeZone,
                            'dd/MM/yyyy HH:mm:ss'
                        )
                    )
                } else {
                    row.push(submission?.field_values?.[header.key] || '')
                }
            })

            worksheet.addRow(row)
        })

        // Add bold style to all column headers
        worksheet.getRow(1).font = { bold: true }

        // Adjust column widths dynamically based on content
        worksheet.columns.forEach((column) => {
            // Some columns need custom width
            let keysHaveCustomWidth = []
            let customWidths = {}
            let maxLength = 0
            if (keysHaveCustomWidth.includes(column._key)) {
                maxLength = customWidths[column._key]
                    ? customWidths[column._key]
                    : 10
            } else {
                column.eachCell({ includeEmpty: true }, (cell) => {
                    let cellValue = cell.value
                    let longestString =
                        (cellValue &&
                            findLongestString(
                                cellValue.toString().split('\n')
                            )) ||
                        5
                    if (longestString?.length > maxLength) {
                        maxLength = longestString?.length
                    }
                })
            }
            column.width = maxLength < 10 ? 10 : maxLength
        })

        // Align cell values vertically centered
        worksheet.eachRow((row) => {
            row.eachCell((cell) => {
                cell.alignment = { vertical: 'middle' }
            })
        })

        // Set the filename and send the workbook as a response
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        res.setHeader(
            'Content-Disposition',
            `attachment; filename=${form?.form_name?.en}-submissions-${format(
                Date.now(),
                'dd-MM-yyyy'
            )}.xlsx`
        )
        return workbook.xlsx.write(res).then(function () {
            res.status(200).end()
        })
    } catch (error) {
        console.log('error :>> ', error)
        return workbook.xlsx.write(res).then(function () {
            res.status(200).end()
        })
    }
}

const findLongestString = (array) => {
    if (!Array.isArray(array) || array.length === 0) {
        return null // Handle edge case for an empty or non-array input
    }

    let longestString = array[0] // Assume the first string is the longest initially

    for (let i = 1; i < array.length; i++) {
        const currentString = array[i]
        if (currentString.length > longestString.length) {
            longestString = currentString
        }
    }

    return longestString
}

module.exports = {
    list,
    edit,
    viewAPI,
    add,
    save,
    changeStatus,
    deleteForm,
    duplicateForm,
    viewSubmissions,
    viewSubmission,
    deleteSubmissions,
    exportSubmissions,
}
