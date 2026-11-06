const { mongoose, Schema } = require('mongoose')
const uniqueValidator = require('mongoose-unique-validator')
const Brand = require('./Brand')

const ContentTypeSchema = new mongoose.Schema(
    {
        brand: [
            {
                type: Schema.ObjectId,
                ref: Brand,
            },
        ],
        title: {
            type: String,
            required: true,
            unique: true,
        },
        slug: {
            type: String,
            required: function () {
                return this.has_slug
            },
            unique: function () {
                return this.has_slug
            },
        },
        admin_icon: {
            type: String,
            default: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path opacity="0.3" d="M2 21V14C2 13.4 2.4 13 3 13H21C21.6 13 22 13.4 22 14V21C22 21.6 21.6 22 21 22H3C2.4 22 2 21.6 2 21Z" fill="currentColor"/>
            <path d="M2 10V3C2 2.4 2.4 2 3 2H21C21.6 2 22 2.4 22 3V10C22 10.6 21.6 11 21 11H3C2.4 11 2 10.6 2 10Z" fill="currentColor"/>
            </svg>`,
        },
        has_access: {
            type: [String],
            default: ['super_admin', 'admin', 'editor'],
        },
        admin_nav_section: {
            type: String,
        },
        nav_on_collection_api: {
            type: Boolean,
            default: true,
        },
        nav_on_single_api: {
            type: Boolean,
            default: true,
        },
        field_groups: [
            {
                row_name: String,
                row_label: String,
                repeater_group: Boolean,
                localisation: Boolean,
                inline_fields: {
                    type: Boolean,
                    default: false,
                },
                fields: [
                    {
                        field_label: String,
                        field_name: {
                            type: String,
                            lowercase: true,
                        },
                        field_type: {
                            type: String,
                            lowercase: true,
                        },
                        field_info: String,
                        placeholder: String,
                        position: {
                            type: Number,
                            default: 0,
                        },
                        show_on_list: {
                            type: Boolean,
                            default: false,
                        },
                        multi_select: Boolean,
                        options: {},
                        // addValidation: String,
                        // editValidation: String,
                        validation: {},
                        info: [
                            {
                                type: String,
                            },
                        ],
                    },
                ],
            },
        ],
        meta: {},
        allowed_type: [{ type: String }],
        page_builder: {
            type: Boolean,
            default: false,
        },
        has_slug: {
            type: Boolean,
            default: false,
        },
        single_type: {
            type: Boolean,
            default: false,
        },
        position: {
            type: Number,
            default: 0,
        },
        active: {
            type: Boolean,
            default: true,
        },
        has_form: {
            type: Boolean,
            default: false,
        },
        has_api_endpoint: {
            type: Boolean,
            default: true,
        },
        has_meta: {
            type: Boolean,
            default: false,
        },
        last_edited_user: {
            type: Schema.ObjectId,
            ref: 'Admin',
        },
        // Snapshot of the previous state on every save (same as Content.revisions)
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
    },
    {
        timestamps: {
            createdAt: 'created_at',
            updatedAt: 'updated_at',
        },
    }
)

ContentTypeSchema.plugin(uniqueValidator)

module.exports = mongoose.model('ContentType', ContentTypeSchema)
