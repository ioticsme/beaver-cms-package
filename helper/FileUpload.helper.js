const envConfig = require('../config/env.config')
const Config = require('../model/Config')
const {
    imageKitUploadMedia,
} = require('../adaptors/file-upload/ImageKit.adaptor.js')
const {
    cloudinaryUploadMedia,
} = require('../adaptors/file-upload/Cloudinary.adaptor.js')
// const {
//     bunnyCDNUploadMedia,
//     bunnyCDNUploadMediaFromURL,
// } = require('../adaptors/file-upload/BunnyCdn.adaptor.js')
const {
    localUploadMedia,
    localDeleteMedia,
} = require('../adaptors/file-upload/localUpload.adaptor.js')
const {
    azureBlobUploadMedia,
    azureBlobDeleteMedia,
} = require('../adaptors/file-upload/AzureBlob.adaptor.js')
const {
    awsS3UploadMedia,
    awsS3DeleteMedia,
} = require('../adaptors/file-upload/AwsS3.adaptor.js')
const { decryptData } = require('./Operations.helper.js')
const { logError } = require('./Logger.helper.js')
const { getClientIp } = require('./AuditLog.helper.js')
const Media = require('../model/Media')

// Record who uploaded a file and from where on the Media document.
const stampUploadInfo = async (media, folder, file, req) => {
    if (!media?._id) return media
    try {
        const s = req?.authUser || req?.session || {}
        const upload_info = {
            admin_id: s.admin_id || null,
            admin_name: s.admin_name,
            admin_email: s.admin_email,
            admin_role: s.admin_role,
            ip: req ? getClientIp(req) : undefined,
            user_agent: req?.headers?.['user-agent'],
            original_name: file?.originalname,
            mime_type: file?.mimetype,
            size: file?.size,
            folder,
            brand: s.brand?._id || null,
            country: s.brand?.country || null,
        }
        await Media.updateOne({ _id: media._id }, { $set: { upload_info } })
        media.upload_info = upload_info
    } catch (error) {
        logError(error)
    }
    return media
}

const getDriveConfig = async () => {
    const config = await Config.findOne()
    return config?.media_drive
}
// Upload function internally uses ImageKit, Cloudinary, Azure Blob, S3, or local storage.
// Pass `req` so the uploader, IP and file details are stored on the Media record.
const uploadMedia = async (media, folder, file, req = null) => {
    const result = await uploadToDrive(media, folder, file)
    return stampUploadInfo(result, folder, file, req)
}

const uploadToDrive = async (media, folder, file) => {
    try {
        const media_drive_config = await getDriveConfig()
        if (media_drive_config.default_drive == 'local') {
            const res = await localUploadMedia(media, folder, file)
            return res
        } else {
            if (media_drive_config.default_drive == 'imagekit') {
                const public_key = decryptData(
                    media_drive_config?.imagekit?.public_key
                )
                const private_key = decryptData(
                    media_drive_config?.imagekit?.private_key
                )
                let driveConfig = {
                    public_key: public_key || envConfig.imagekit.PUBLIC_KEY,
                    private_key: private_key || envConfig.imagekit.PRIVATE_KEY,
                    url: media_drive_config?.imagekit?.url,
                    folder: media_drive_config?.imagekit?.folder,
                }
                return await imageKitUploadMedia(
                    media,
                    folder,
                    file,
                    driveConfig
                )
            } else if (media_drive_config.default_drive == 'cloudinary') {
                const api_key = decryptData(media_drive_config?.cloudinary?.api_key)
                const api_secret = decryptData(media_drive_config?.cloudinary?.api_secret)
                let driveConfig = {
                    api_key: api_key,
                    api_secret: api_secret,
                    cloud_name: media_drive_config?.cloudinary?.cloud_name,
                    folder: media_drive_config?.cloudinary?.folder,
                }
                return await cloudinaryUploadMedia(
                    media,
                    folder,
                    file,
                    driveConfig
                )
            } else if (media_drive_config.default_drive == 'azure_blob') {
                const connection_string = decryptData(
                    media_drive_config?.azure_blob?.connection_string
                )
                let driveConfig = {
                    connection_string: connection_string,
                    container_name: media_drive_config?.azure_blob?.container_name,
                    folder: media_drive_config?.azure_blob?.folder,
                    cdn_url: media_drive_config?.azure_blob?.cdn_url,
                }
                return await azureBlobUploadMedia(
                    media,
                    folder,
                    file,
                    driveConfig
                )
            } else if (media_drive_config.default_drive == 's3') {
                const access_key_id = decryptData(
                    media_drive_config?.s3?.access_key_id
                )
                const secret_access_key = decryptData(
                    media_drive_config?.s3?.secret_access_key
                )
                let driveConfig = {
                    access_key_id: access_key_id,
                    secret_access_key: secret_access_key,
                    bucket_name: media_drive_config?.s3?.bucket_name,
                    region: media_drive_config?.s3?.region,
                    folder: media_drive_config?.s3?.folder,
                    cdn_url: media_drive_config?.s3?.cdn_url,
                }
                return await awsS3UploadMedia(
                    media,
                    folder,
                    file,
                    driveConfig
                )
            } else {
                return 'No Drive Configured'
            }
        }
    } catch (error) {
        logError(error)
        return {}
    }
}

const uploadMediaFromURL = async (media_url, folder, req = {}) => {
    if (envConfig.default_drive == 'bunny_cdn') {
        return await bunnyCDNUploadMediaFromURL(media_url, folder)
    } else {
        return {}
    }
}

const deleteMediaFile = async (folder, mediaObj) => {
    const media_drive_config = await getDriveConfig()
    if (mediaObj.drive == 'bunny_cdn') {
        // TODO: Delete file from storage should be done
        return true
    } else if (mediaObj.drive == 'imagekit') {
        // TODO: Delete file from storage should be done
        return true
    } else if (mediaObj.drive == 'cloudinary') {
        // TODO: Delete file from storage should be done
        return true
    } else if (mediaObj.drive == 'azure_blob') {
        const connection_string = decryptData(
            media_drive_config?.azure_blob?.connection_string
        )
        let driveConfig = {
            connection_string: connection_string,
            container_name: media_drive_config?.azure_blob?.container_name,
            folder: media_drive_config?.azure_blob?.folder,
        }
        return await azureBlobDeleteMedia(folder, mediaObj.file.name, driveConfig)
    } else if (mediaObj.drive == 's3') {
        const access_key_id = decryptData(
            media_drive_config?.s3?.access_key_id
        )
        const secret_access_key = decryptData(
            media_drive_config?.s3?.secret_access_key
        )
        let driveConfig = {
            access_key_id: access_key_id,
            secret_access_key: secret_access_key,
            bucket_name: media_drive_config?.s3?.bucket_name,
            region: media_drive_config?.s3?.region,
            folder: media_drive_config?.s3?.folder,
        }
        return await awsS3DeleteMedia(folder, mediaObj.file.name, driveConfig)
    } else if (mediaObj.drive == 'local') {
        const res = await localDeleteMedia(folder, mediaObj.file.name)
        return res
    } else {
        return 'No Drive Configured'
    }
}

module.exports = { uploadMedia, uploadMediaFromURL, deleteMediaFile }
