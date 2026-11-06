const { mongoose, Schema } = require('mongoose')
const { formatInTimeZone } = require('date-fns-tz')

const ContentSchema = new mongoose.Schema(
    {
        brand: {
            type: Schema.ObjectId,
            ref: 'Brand',
            required: true,
        },
        country: {
            type: Schema.ObjectId,
            ref: 'Country',
            required: true,
        },
        slug: {
            type: String,
            required: true,
        },
        type_id: {
            type: Schema.ObjectId,
            ref: 'ContentType',
            required: true,
        },
        type_slug: {
            type: String,
            required: true,
        },
        author: {
            type: Schema.ObjectId,
            ref: 'Admin',
            required: true,
        },
        form: [
            {
                type: Schema.ObjectId,
                ref: 'CustomForm',
                required: false,
            },
        ],
        attached_type: [
            {
                content_type: {
                    type: String,
                },
                items: [{ type: Schema.ObjectId }],
            },
        ],
        products: [
            {
                type: Schema.ObjectId,
            },
        ],
        status: {
            type: String,
            enum: ['published', 'unpublished', 'scheduled'],
            default: 'unpublished',
        },
        scheduled_at: {
            start: Date,
            end: Date,
        },
        position: {
            type: Number,
            default: 100,
        },
        // template_name: {
        //     type: String,
        // },
        // in_home: {
        //     type: Boolean,
        //     default: false,
        // },
        content: Object,
        last_edited_user: {
            type: Schema.ObjectId,
            ref: 'Admin',
        },
        revisions: [
            {
                content: Object,
                editor: {
                    type: Schema.ObjectId,
                    ref: 'Admin',
                },
                editor_name: String,
                // No default on purpose: older revisions have no date and must not get "now".
                created_at: Date,
                revision_number: {
                    type: String,
                    default: '0.0.1',
                },
            },
        ],
        meta: {},
        deleted: {
            type: Boolean,
            default: false,
        },
        deleted_at: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: {
            createdAt: 'created_at',
            updatedAt: 'updated_at',
        },
        // toObject: { virtuals: true }, // <-- These properties will configure
        // toJSON: { virtuals: true },
    }
)

ContentSchema.virtual('date_created').get(function () {
    return formatInTimeZone(
        this.created_at,
        'Asia/Dubai',
        'dd/MM/yyyy HH:mm:ss'
    )
})

ContentSchema.virtual('published').get(function () {
    return this.status === 'published'
})

ContentSchema.virtual('scheduled_start').get(function () {
    if (this.scheduled_at?.start) {
        return formatInTimeZone(
            this.scheduled_at.start,
            'Asia/Dubai',
            'yyyy-MM-dd'
        )
    }
})
ContentSchema.virtual('scheduled_end').get(function () {
    if (this.scheduled_at?.end) {
        return formatInTimeZone(
            this.scheduled_at.end,
            'Asia/Dubai',
            'yyyy-MM-dd'
        )
    }
})
ContentSchema.virtual('scheduled_dt_range').get(function () {
    let start
    let end
    if (this.scheduled_at?.start) {
        start = formatInTimeZone(
            this.scheduled_at.start,
            'Asia/Dubai',
            'dd/MM/yyyy'
        )
    }
    if (this.scheduled_at?.end) {
        end = formatInTimeZone(
            this.scheduled_at.end,
            'Asia/Dubai',
            'dd/MM/yyyy'
        )
    }
    return `${
        start
            ? 'Publish On : <span class="badge badge-light-success">' +
              start +
              '</span>'
            : ''
    } ${end ? 'Un-Publish On :<span class="badge badge-light-danger">' + end + '</span>' : ''}`
})

ContentSchema.virtual('date_updated').get(function () {
    return formatInTimeZone(
        this.updated_at,
        'Asia/Dubai',
        'dd/MM/yyyy HH:mm:ss'
    )
})

module.exports = mongoose.model('Content', ContentSchema)
