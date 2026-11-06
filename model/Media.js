const { mongoose } = require('mongoose')

const MediaSchema = new mongoose.Schema(
    {
        drive: {
            type: String,
            required: true,
            enum: ['local', 'imagekit', 'cloudinary', 'azure_blob', 's3'],
        },
        url: {
            type: String,
            required: true,
        },
        meta: {
            title: String,
            alt_text: String,
            local_drive: Boolean,
        },
        has_link: {
            type: Boolean,
            default: false,
        },
        link_url: {
            type: String,
            default: null,
        },
        open_link_in_new_tab: {
            type: Boolean,
            default: false,
        },
        response: {
            type: Object,
        },
        file: {
            type: Object,
        },
        // Who uploaded the file and from where (for auditing)
        upload_info: {
            admin_id: { type: mongoose.Schema.ObjectId, ref: 'Admin', default: null },
            admin_name: String,
            admin_email: String,
            admin_role: String,
            ip: String,
            user_agent: String,
            original_name: String,
            mime_type: String,
            size: Number,
            folder: String,
            brand: { type: mongoose.Schema.ObjectId, default: null },
            country: { type: mongoose.Schema.ObjectId, default: null },
        },
        file_type: {
            type: String,
            required: true,
            default: 'image',
            enum: ['pdf', 'image'],
        },
    },
    {
        timestamps: {
            createdAt: 'created_at',
            updatedAt: 'updated_at',
        },
    }
)

module.exports = mongoose.model('Media', MediaSchema)
