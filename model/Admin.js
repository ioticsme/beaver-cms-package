const { mongoose, Schema } = require('mongoose')
const uniqueValidator = require('mongoose-unique-validator')
const Brand = require('./Brand')
const Country = require('./Country')

const AdminSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
        },
        email: {
            type: String,
            required: true,
            unique: true,
        },
        password: {
            type: String,
            required: true,
        },
        role: {
            type: String,
            default: 'admin',
            enum: ['super_admin', 'admin', 'editor', 'user', 'finance'],
        },
        brand: {
            brand: {
                type: Schema.ObjectId,
                ref: Brand,
            },
            country: {
                type: Schema.ObjectId,
                ref: Country,
            },
        },
        firebase_tokens: [{ type: String }],
        privileges: String,
        active: {
            type: Boolean,
            default: true,
        },
        // Soft delete. These were written by the delete handlers but missing from the
        // schema, so Mongoose stripped them and deleted admins could still sign in.
        deleted: {
            type: Boolean,
            default: false,
        },
        deleted_at: {
            type: Date,
            default: null,
        },
        last_login_at: {
            type: Date,
            default: null,
        },
        last_login_ip: {
            type: String,
            default: null,
        },
    },
    {
        timestamps: {
            createdAt: 'created_at',
            updatedAt: 'updated_at',
        },
    }
)

AdminSchema.plugin(uniqueValidator)

module.exports = mongoose.model('Admin', AdminSchema)
